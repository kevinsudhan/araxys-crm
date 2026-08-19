/**
 * Live space state, seeded from the CRM's own knowledge-base data.
 *
 * This is the authority for "what space is actually left right now" — the voice agent
 * queries it mid-call through /api/tools/check-space, and the CRM reads the same state,
 * so the answer a customer hears on the phone and the number an ops person sees on
 * screen can never disagree.
 *
 * Occupancy is DERIVED from the individual consignments loaded in each container
 * (see placements.ts), not stored as a separate total — so the load plan drawn on screen
 * and the remaining-space figure always describe the same reality.
 *
 * In-memory for now (restart resets to seed). Swapping this for a real DB is a
 * self-contained change: keep the function signatures, replace the bodies.
 */
import { containerSpecs, sailingSlots } from "../src/data/knowledgeBase";
import type { CargoPiece, ContainerDims } from "./spaceEngine";
import { remainingCbm } from "./spaceEngine";
import { seedConsignments, place, type PlacedConsignment } from "./placements";

export interface LiveSlot {
  id: string;
  route: string;
  carrier: string;
  sailingDate: string;
  cutoffDate: string;
  containerCode: string;
  mode: "LCL" | "FCL";
  status: "open" | "closing_soon" | "full";
}

const slots: LiveSlot[] = sailingSlots.map(({ usedLengthM, usedWeightKg, ...rest }) => ({ ...rest }));
const placements: PlacedConsignment[] = [];

const round2 = (n: number) => Math.round(n * 100) / 100;

export function containerDimsFor(code: string): ContainerDims | null {
  const spec = containerSpecs.find((c) => c.code === code);
  if (!spec || !spec.internalDimsM || spec.maxPayloadKg === null) return null;
  return {
    code: spec.code,
    internalLengthM: spec.internalDimsM.length,
    internalWidthM: spec.internalDimsM.width,
    internalHeightM: spec.internalDimsM.height,
    maxPayloadKg: spec.maxPayloadKg,
  };
}

export function placementsFor(slotId: string): PlacedConsignment[] {
  return placements.filter((p) => p.slotId === slotId).sort((a, b) => a.xM - b.xM);
}

export function usedFor(slotId: string) {
  const mine = placementsFor(slotId);
  const lengthM = round2(mine.reduce((sum, p) => sum + p.lengthM, 0));
  const weightKg = round2(mine.reduce((sum, p) => sum + p.weightKg, 0));
  return { lengthM, weightKg };
}

/** Seed each slot by loading its consignments back-to-front. */
(function seed() {
  let colorIndex = 0;
  const clientColor = new Map<string, number>();

  for (const slot of slots) {
    const dims = containerDimsFor(slot.containerCode);
    if (!dims) continue;
    let cursor = 0;
    let n = 0;
    for (const sc of seedConsignments.filter((s) => s.slotId === slot.id)) {
      if (!clientColor.has(sc.clientName)) clientColor.set(sc.clientName, colorIndex++);
      const placed = place(dims, sc.piece, cursor, {
        id: `pl-${slot.id}-${++n}`,
        slotId: slot.id,
        clientName: sc.clientName,
        reference: sc.reference,
        colorIndex: clientColor.get(sc.clientName)!,
        source: "seed",
      });
      if (!placed) continue;
      placements.push(placed);
      cursor = round2(cursor + placed.lengthM);
    }
    refreshStatus(slot.id);
  }
})();

function refreshStatus(slotId: string) {
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return;
  const rem = remainingFor(slot);
  if (!rem) return;
  if (rem.lengthM <= 0.5) slot.status = "full";
  else if (rem.lengthM <= 2) slot.status = "closing_soon";
  else slot.status = "open";
}

export function listSlots(): LiveSlot[] {
  return slots;
}

export function getSlot(id: string): LiveSlot | undefined {
  return slots.find((s) => s.id === id);
}

export function remainingFor(slot: LiveSlot) {
  const dims = containerDimsFor(slot.containerCode);
  if (!dims) return null;
  const used = usedFor(slot.id);
  const lengthM = round2(Math.max(0, dims.internalLengthM - used.lengthM));
  const payloadKg = round2(Math.max(0, dims.maxPayloadKg - used.weightKg));
  return { dims, used, lengthM, payloadKg, cbm: remainingCbm(dims, lengthM) };
}

/**
 * Commits a consignment into a slot: places it against the free floor and updates
 * occupancy as a consequence. Returns null if the slot is unknown or it doesn't fit.
 */
export function commitBooking(args: {
  slotId: string;
  clientName: string;
  reference: string;
  piece: CargoPiece;
  source: "crm" | "voice_agent";
}): PlacedConsignment | null {
  const slot = getSlot(args.slotId);
  if (!slot) return null;
  const dims = containerDimsFor(slot.containerCode);
  if (!dims) return null;

  const used = usedFor(slot.id);
  const existingClients = new Map(placements.map((p) => [p.clientName, p.colorIndex]));
  const colorIndex =
    existingClients.get(args.clientName) ??
    (existingClients.size ? Math.max(...existingClients.values()) + 1 : 0);

  const placed = place(dims, args.piece, used.lengthM, {
    id: `pl-${slot.id}-${Date.now().toString(36)}`,
    slotId: slot.id,
    clientName: args.clientName,
    reference: args.reference,
    colorIndex,
    source: args.source,
  });
  if (!placed) return null;

  placements.push(placed);
  refreshStatus(slot.id);
  return placed;
}

export function listPlacements(): PlacedConsignment[] {
  return placements;
}

/** Normalises the many ways a caller might name a route into the canonical string. */
export function resolveRoute(input: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const target = norm(input);
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
