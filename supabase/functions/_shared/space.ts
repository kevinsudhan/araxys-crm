/**
 * Container space, backed by Postgres.
 *
 * The fit logic is a straight port of server/spaceEngine.ts — it decides in three
 * dimensions rather than by comparing volumes, because volume math gets real cases wrong:
 * 30 CBM of cargo "fits" a 33 CBM container by volume, while a single 2.6m-tall crate
 * does not fit a 2.39m-high 20GP in any arrangement.
 *
 * State lives in the database rather than in memory because Edge Function invocations are
 * independent processes — a booking made on one request would not exist on the next.
 * Occupancy is derived from placements, never stored as a separate total.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ------------------------------------------------------------------ container specs

export interface ContainerDims {
  code: string;
  internalLengthM: number;
  internalWidthM: number;
  internalHeightM: number;
  maxPayloadKg: number;
}

/** Mirrors containerSpecs in src/data/knowledgeBase.ts. */
const CONTAINERS: Record<string, ContainerDims> = {
  "20GP": { code: "20GP", internalLengthM: 5.9, internalWidthM: 2.35, internalHeightM: 2.39, maxPayloadKg: 28180 },
  "40GP": { code: "40GP", internalLengthM: 12.03, internalWidthM: 2.35, internalHeightM: 2.39, maxPayloadKg: 26700 },
  "40HC": { code: "40HC", internalLengthM: 12.03, internalWidthM: 2.35, internalHeightM: 2.69, maxPayloadKg: 28600 },
  "20RF": { code: "20RF", internalLengthM: 5.44, internalWidthM: 2.29, internalHeightM: 2.27, maxPayloadKg: 27400 },
  "40RF": { code: "40RF", internalLengthM: 11.56, internalWidthM: 2.29, internalHeightM: 2.5, maxPayloadKg: 29000 },
};

export const containerDimsFor = (code: string): ContainerDims | null => CONTAINERS[code] ?? null;

// ------------------------------------------------------------------ fit engine

export interface CargoPiece {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  quantity: number;
  weightKgEach: number;
  stackable?: boolean;
  /** "This way up" cargo — drums, machinery, liquids. Cannot be laid on its side. */
  uprightOnly?: boolean;
}

const EPS = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;

function orientations(l: number, w: number, h: number, uprightOnly: boolean): Array<[number, number, number]> {
  if (uprightOnly) return [[l, w, h], [w, l, h]];
  return [[l, w, h], [l, h, w], [w, l, h], [w, h, l], [h, l, w], [h, w, l]];
}

export interface FitResult {
  fits: boolean;
  reason?: string;
  explanation: string;
  orientation?: { lengthM: number; widthM: number; heightM: number };
  piecesAcrossWidth?: number;
  piecesStackedHigh?: number;
  piecesPerRow?: number;
  rowsNeeded?: number;
  lengthConsumedM?: number;
  totalWeightKg?: number;
  maxPiecesThatFit?: number;
  remainingAfter?: { lengthM: number; payloadKg: number };
}

export function checkFit(
  container: ContainerDims,
  remaining: { lengthM: number; payloadKg: number },
  piece: CargoPiece
): FitResult {
  const qty = Math.floor(piece.quantity);
  if (!(piece.lengthCm > 0) || !(piece.widthCm > 0) || !(piece.heightCm > 0) || !(qty > 0)) {
    return {
      fits: false,
      reason: "invalid_input",
      explanation:
        "The cargo dimensions or quantity given aren't usable -- length, width, height and quantity all need to be positive numbers.",
    };
  }

  const pl = piece.lengthCm / 100;
  const pw = piece.widthCm / 100;
  const ph = piece.heightCm / 100;
  const stackable = piece.stackable !== false;
  const totalWeightKg = round2(qty * piece.weightKgEach);

  let best: {
    orientation: { lengthM: number; widthM: number; heightM: number };
    across: number;
    stacked: number;
    perRow: number;
    rows: number;
    lengthNeeded: number;
  } | null = null;
  let anyPossible = false;
  let capacityInRemaining = 0;

  for (const [ol, ow, oh] of orientations(pl, pw, ph, piece.uprightOnly === true)) {
    if (ow > container.internalWidthM + EPS) continue;
    if (oh > container.internalHeightM + EPS) continue;
    if (ol > container.internalLengthM + EPS) continue;
    anyPossible = true;

    const across = Math.floor((container.internalWidthM + EPS) / ow);
    const stacked = stackable ? Math.floor((container.internalHeightM + EPS) / oh) : 1;
    const perRow = across * stacked;
    if (perRow <= 0) continue;

    capacityInRemaining = Math.max(capacityInRemaining, Math.floor((remaining.lengthM + EPS) / ol) * perRow);

    const rows = Math.ceil(qty / perRow);
    const lengthNeeded = round2(rows * ol);
    if (!best || lengthNeeded < best.lengthNeeded) {
      best = {
        orientation: { lengthM: round2(ol), widthM: round2(ow), heightM: round2(oh) },
        across,
        stacked,
        perRow,
        rows,
        lengthNeeded,
      };
    }
  }

  if (!anyPossible || !best) {
    const uprightNote = piece.uprightOnly
      ? " Because this cargo has to stay upright, it can't be laid on its side to make it fit."
      : "";
    return {
      fits: false,
      reason: "piece_too_large_for_container",
      explanation:
        `A single piece measuring ${piece.lengthCm} by ${piece.widthCm} by ${piece.heightCm} centimetres won't physically go into a ${container.code} in any allowed orientation -- ` +
        `that container's internal space is ${container.internalLengthM}m long, ${container.internalWidthM}m wide and ${container.internalHeightM}m high.${uprightNote} This needs a different container type.`,
      totalWeightKg,
    };
  }

  if (totalWeightKg > remaining.payloadKg + EPS && best.lengthNeeded <= remaining.lengthM + EPS) {
    return {
      fits: false,
      reason: "over_payload_limit",
      explanation:
        `The cargo physically fits, but the weight doesn't. ${qty} pieces at ${piece.weightKgEach}kg each is ${totalWeightKg}kg, ` +
        `and only ${round2(remaining.payloadKg)}kg of payload is left on this container.`,
      totalWeightKg,
      maxPiecesThatFit: capacityInRemaining,
    };
  }

  if (best.lengthNeeded > remaining.lengthM + EPS) {
    return {
      fits: false,
      reason: "not_enough_length_remaining",
      explanation:
        `This consignment needs about ${best.lengthNeeded}m of container floor, but only ${round2(remaining.lengthM)}m is left on this sailing. ` +
        (capacityInRemaining > 0
          ? `About ${capacityInRemaining} of the ${qty} pieces would fit in the space remaining.`
          : "There isn't enough room for even one piece."),
      lengthConsumedM: best.lengthNeeded,
      totalWeightKg,
      maxPiecesThatFit: capacityInRemaining,
    };
  }

  return {
    fits: true,
    explanation:
      `Yes -- ${qty} pieces load as ${best.across} across by ${best.stacked} high, ${best.perRow} per row, ${best.rows} rows deep, ` +
      `taking about ${best.lengthNeeded}m of container floor and ${totalWeightKg}kg of payload.`,
    orientation: best.orientation,
    piecesAcrossWidth: best.across,
    piecesStackedHigh: best.stacked,
    piecesPerRow: best.perRow,
    rowsNeeded: best.rows,
    lengthConsumedM: best.lengthNeeded,
    totalWeightKg,
    maxPiecesThatFit: capacityInRemaining,
    remainingAfter: {
      lengthM: round2(remaining.lengthM - best.lengthNeeded),
      payloadKg: round2(remaining.payloadKg - totalWeightKg),
    },
  };
}

// ------------------------------------------------------------------ slot state

export interface SlotRow {
  id: string;
  route: string;
  carrier: string;
  sailing_date: string;
  cutoff_date: string;
  container_code: string;
  mode: "LCL" | "FCL";
  status: "open" | "closing_soon" | "full";
}

export interface PlacementRow {
  id: string;
  slot_id: string;
  client_name: string;
  reference: string;
  x_m: number;
  length_m: number;
  pieces_across: number;
  pieces_high: number;
  rows_count: number;
  quantity: number;
  piece_length_m: number;
  piece_width_m: number;
  piece_height_m: number;
  weight_kg: number;
  color_index: number;
  source: string;
}

export const listSlots = () => rest("space_slots?select=*&order=sailing_date") as Promise<SlotRow[]>;
export const getSlot = (id: string) =>
  rest(`space_slots?select=*&id=eq.${encodeURIComponent(id)}&limit=1`).then((r: SlotRow[]) => r[0] ?? null);
export const placementsFor = (slotId: string) =>
  rest(`space_placements?select=*&slot_id=eq.${encodeURIComponent(slotId)}&order=x_m`) as Promise<PlacementRow[]>;

export async function remainingFor(slot: SlotRow) {
  const dims = containerDimsFor(slot.container_code);
  if (!dims) return null;
  const placed = await placementsFor(slot.id);
  const usedLength = round2(placed.reduce((s, p) => s + Number(p.length_m), 0));
  const usedWeight = round2(placed.reduce((s, p) => s + Number(p.weight_kg), 0));

  // Free floor is measured from where the cargo actually ends, not from the sum of what
  // is aboard. Those two agree only while the stow is packed tight against the back
  // wall. They stop agreeing the moment anyone leaves a gap -- and once an operator can
  // drag a consignment forward in the CRM, gaps are a thing that happens. Using the sum
  // would let us sell floor that is physically stranded between two blocks.
  const frontier = round2(placed.reduce((m, p) => Math.max(m, Number(p.x_m) + Number(p.length_m)), 0));
  const freeLength = round2(Math.max(0, dims.internalLengthM - frontier));

  return {
    dims,
    used: { lengthM: usedLength, weightKg: usedWeight },
    /** Where the loaded section ends -- new cargo goes here. */
    frontier,
    /** Floor lost to gaps between blocks. Recoverable by restowing, not by booking. */
    trappedM: round2(Math.max(0, frontier - usedLength)),
    lengthM: freeLength,
    payloadKg: round2(Math.max(0, dims.maxPayloadKg - usedWeight)),
    cbm: round2(freeLength * dims.internalWidthM * dims.internalHeightM),
    placements: placed,
  };
}

/** Normalises however a caller names a route into the canonical stored string. */
export async function resolveRoute(input: string): Promise<string | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const target = norm(input);
  const slots = await listSlots();
  const routes = [...new Set(slots.map((s) => s.route))];

  const exact = routes.find((r) => norm(r) === target);
  if (exact) return exact;

  for (const r of routes) {
    const [from, to] = r.split("->").map((p) => norm(p));
    if (target.includes(from) && to.split(",").some((t) => target.includes(t))) return r;
    if (target.includes(from) && target.includes(to)) return r;
  }
  for (const r of routes) {
    const [from, to] = r.split("->").map((p) => norm(p));
    const toHead = to.replace(/dubai|srilanka/g, "");
    if (target.includes(from) && (target.includes(toHead) || toHead.includes(target))) return r;
  }
  return null;
}

async function refreshStatus(slotId: string) {
  const slot = await getSlot(slotId);
  if (!slot) return;
  const rem = await remainingFor(slot);
  if (!rem) return;
  const status = rem.lengthM <= 0.5 ? "full" : rem.lengthM <= 2 ? "closing_soon" : "open";
  if (status !== slot.status) {
    await rest(`space_slots?id=eq.${encodeURIComponent(slotId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }
}

/** Places a consignment against the free floor and persists it. */
export async function commitBooking(args: {
  slotId: string;
  clientName: string;
  reference: string;
  piece: CargoPiece;
  source: "crm" | "voice_agent";
}) {
  const slot = await getSlot(args.slotId);
  if (!slot) return null;
  const rem = await remainingFor(slot);
  if (!rem) return null;

  const fit = checkFit(rem.dims, { lengthM: rem.lengthM, payloadKg: rem.payloadKg }, args.piece);
  if (!fit.fits || !fit.orientation) return null;

  const existingColor = rem.placements.find((p) => p.client_name === args.clientName)?.color_index;
  const colorIndex =
    existingColor ?? (rem.placements.length ? Math.max(...rem.placements.map((p) => p.color_index)) + 1 : 0);

  const row = {
    id: `pl-${slot.id}-${Date.now().toString(36)}`,
    slot_id: slot.id,
    client_name: args.clientName,
    reference: args.reference,
    // Against the last block, not against the sum of the blocks -- with a gap in the
    // stow those differ, and the sum would drop this consignment on top of another one.
    x_m: rem.frontier,
    length_m: fit.lengthConsumedM ?? 0,
    pieces_across: fit.piecesAcrossWidth ?? 1,
    pieces_high: fit.piecesStackedHigh ?? 1,
    rows_count: fit.rowsNeeded ?? 1,
    quantity: Math.floor(args.piece.quantity),
    piece_length_m: fit.orientation.lengthM,
    piece_width_m: fit.orientation.widthM,
    piece_height_m: fit.orientation.heightM,
    weight_kg: fit.totalWeightKg ?? 0,
    color_index: colorIndex,
    source: args.source,
  };

  await rest("space_placements", { method: "POST", body: JSON.stringify(row) });
  await refreshStatus(slot.id);
  return row;
}

/**
 * Repositions consignments along the container floor after an operator restows them.
 *
 * The browser proposes the arrangement, but it does not get to be the authority on it --
 * anyone can post to this endpoint, and a stow with two consignments in the same metre of
 * floor would corrupt every availability figure downstream, including the ones the voice
 * agent reads out. So the whole arrangement is re-validated here and rejected as a unit.
 */
export async function restow(
  slotId: string,
  moves: Array<{ id: string; xM: number }>
): Promise<{ ok: true; placements: PlacementRow[] } | { ok: false; error: string }> {
  const slot = await getSlot(slotId);
  if (!slot) return { ok: false, error: "unknown slot" };
  const dims = containerDimsFor(slot.container_code);
  if (!dims) return { ok: false, error: "slot has no container dimensions" };

  const existing = await placementsFor(slotId);
  const byId = new Map(existing.map((p) => [p.id, p]));

  const proposed = existing.map((p) => {
    const m = moves.find((x) => x.id === p.id);
    return {
      id: p.id,
      xM: m ? Math.round(Number(m.xM) * 1000) / 1000 : Number(p.x_m),
      lengthM: Number(p.length_m),
    };
  });

  for (const m of moves) {
    if (!byId.has(m.id)) return { ok: false, error: `consignment ${m.id} is not in this container` };
    if (!Number.isFinite(Number(m.xM))) return { ok: false, error: `consignment ${m.id} has no valid position` };
  }

  for (const p of proposed) {
    if (p.xM < -0.001) return { ok: false, error: `${p.id} would sit behind the back wall` };
    if (p.xM + p.lengthM > dims.internalLengthM + 0.001) {
      return { ok: false, error: `${p.id} would hang out of the doors` };
    }
  }

  const ordered = [...proposed].sort((a, b) => a.xM - b.xM);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (cur.xM < prev.xM + prev.lengthM - 0.001) {
      return { ok: false, error: `${cur.id} overlaps ${prev.id}` };
    }
  }

  // Only write what actually moved; a no-op save should not churn the table.
  const changed = proposed.filter((p) => Math.abs(p.xM - Number(byId.get(p.id)!.x_m)) > 0.0005);
  for (const p of changed) {
    await rest(`space_placements?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ x_m: p.xM }),
    });
  }

  await refreshStatus(slotId);
  return { ok: true, placements: await placementsFor(slotId) };
}
