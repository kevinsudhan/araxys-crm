/**
 * In-memory backend for the v2 workspace.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * v2 is a clone of the production CRM that we are free to redesign. The
 * production copy in ../araxys-crm talks to a live Supabase project, a live
 * SnapServe account, and real customers' shipments. If v2 pointed at the same
 * backend, then promoting a record here, restowing a container here, or booking
 * space here would change what the voice agent tells a real caller tomorrow.
 *
 * So v2 has no backend. Every request the UI makes is answered from the store
 * below. Nothing leaves the machine -- there is no URL to get wrong, no key to
 * leak, and no way to corrupt v1's data from this workspace by accident.
 *
 * Writes mutate this store, so the UI behaves like the real thing: book space
 * and the container fills up, restow it and the plan moves, promote a record
 * and it changes stage. State lives for the life of the page; reloading resets
 * it to the seed below, which is usually what you want while designing.
 * ---------------------------------------------------------------------------
 *
 * The data is fictional but internally consistent -- weights agree with piece
 * counts, floor lengths agree with the placements, remaining space agrees with
 * what is loaded. A mock whose numbers contradict each other teaches you
 * nothing about whether a screen is right.
 */

import {
  listFolders,
  listMessages,
  getMessage as getMailMessage,
  setRead,
  moveMessage,
  sendMessage,
  type FolderId,
} from "./mockMail";

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/**
 * No seeded sailings, placements, records or calls.
 *
 * The space board and the pipeline show nothing until something real is in
 * them. Container specifications stay, because those are physical facts about
 * standard boxes rather than invented business data.
 */
const CONTAINERS: Record<
  string,
  { code: string; lengthM: number; widthM: number; heightM: number; maxPayloadKg: number }
> = {
  "40HC": { code: "40HC", lengthM: 12.03, widthM: 2.35, heightM: 2.69, maxPayloadKg: 28_600 },
  "20GP": { code: "20GP", lengthM: 5.9, widthM: 2.35, heightM: 2.39, maxPayloadKg: 28_200 },
  "40GP": { code: "40GP", lengthM: 12.03, widthM: 2.35, heightM: 2.39, maxPayloadKg: 26_700 },
};

// ---------------------------------------------------------------------------
// Seed state
// ---------------------------------------------------------------------------

interface Placement {
  id: string;
  slotId: string;
  clientName: string;
  reference: string;
  xM: number;
  lengthM: number;
  piecesAcross: number;
  piecesHigh: number;
  rows: number;
  quantity: number;
  pieceLengthM: number;
  pieceWidthM: number;
  pieceHeightM: number;
  weightKg: number;
  colorIndex: number;
  source: "seed" | "crm" | "voice_agent";
}

interface Slot {
  id: string;
  route: string;
  carrier: string;
  sailingDate: string;
  cutoffDate: string;
  containerCode: string;
  mode: "LCL" | "FCL";
}

const slots: Slot[] = [];

const placements: Placement[] = [];

function mkPlacement(
  id: string,
  slotId: string,
  clientName: string,
  reference: string,
  xM: number,
  lengthM: number,
  pieceLengthM: number,
  pieceWidthM: number,
  pieceHeightM: number,
  quantity: number,
  weightEachKg: number,
  piecesAcross: number,
  piecesHigh: number,
  colorIndex: number
): Placement {
  return {
    id,
    slotId,
    clientName,
    reference,
    xM,
    lengthM,
    piecesAcross,
    piecesHigh,
    rows: Math.ceil(quantity / (piecesAcross * piecesHigh)),
    quantity,
    pieceLengthM,
    pieceWidthM,
    pieceHeightM,
    weightKg: quantity * weightEachKg,
    colorIndex,
    source: "seed",
  };
}

interface Record_ {
  ref: string;
  phone: string;
  customerName?: string;
  company?: string;
  blNumber?: string;
  stage: "enquiry" | "processing" | "processed";
  processingStartedAt?: string;
  status: string;
  origin?: string;
  destination?: string;
  cargoDescription?: string;
  volumeCbm?: number;
  containerType?: string;
  quotedAmountInr?: number;
  agreedAmountInr?: number;
  sailingDate?: string;
  notes?: string;
  requestDetails?: Record<string, unknown>;
  sourceLanguage?: string;
  createdAt: string;
  updatedAt: string;
}

const records: Record_[] = [];

const TRANSCRIPT_1 = `Agent: Hi, this is Priya from the Aashish Logistics Global desk. How can I help you today?
Customer: Hi, I need to send some bed linen to Dubai.
Agent: Of course. Whereabouts are you shipping from?
Customer: Chennai.
Agent: Chennai to Jebel Ali, got it. What's the cargo exactly?
Customer: Cotton bed linen sets, packed in cartons.
Agent: Understood. How many cartons are we looking at?
Customer: Ninety-six.
Agent: Ninety-six cartons. And roughly what size is each carton?
Customer: About sixty by forty by thirty-five centimetres.
Agent: Perfect. And the weight per carton?
Customer: Around eighteen kilos each.
Agent: That gives us about eight cubic metres. Let me check what we have sailing.
Agent: We have an MSC sailing on the fourth with space available. For that volume the rate would be one lakh ninety-five thousand rupees, all in.
Customer: Can you do anything better on that?
Agent: I can bring it to one lakh eighty-five thousand. That's the best I can do on this lane.
Customer: That works. Let's book it.
Agent: Booked. I'll pass you to Arun who'll take the documentation details.`;

interface CallLogRow {
  call_id: string;
  agent_name: string;
  direction: string;
  from_number: string;
  to_number: string;
  status: string;
  duration_secs: number;
  transcript: string;
  summary: string;
  extracted: Record<string, unknown>;
  started_at: string;
}

const callLogs: CallLogRow[] = [];

// ---------------------------------------------------------------------------
// Derived figures — computed, never stored, exactly as the real backend does it
// ---------------------------------------------------------------------------

const placementsFor = (slotId: string) =>
  placements.filter((p) => p.slotId === slotId).sort((a, b) => a.xM - b.xM);

/** Where the loaded section ends — the back edge of the last block, not the sum. */
function frontierOf(slotId: string) {
  const ps = placementsFor(slotId);
  return ps.length ? Math.max(...ps.map((p) => p.xM + p.lengthM)) : 0;
}

/** Floor stranded in gaps between blocks. Recoverable by restowing, not bookable. */
function trappedOf(slotId: string) {
  const ps = placementsFor(slotId);
  let trapped = 0;
  let cursor = 0;
  for (const p of ps) {
    if (p.xM > cursor) trapped += p.xM - cursor;
    cursor = Math.max(cursor, p.xM + p.lengthM);
  }
  return Number(trapped.toFixed(2));
}

function slotView(slot: Slot) {
  const container = CONTAINERS[slot.containerCode];
  const ps = placementsFor(slot.id);
  const usedLengthM = Number(ps.reduce((n, p) => n + p.lengthM, 0).toFixed(2));
  const usedWeightKg = ps.reduce((n, p) => n + p.weightKg, 0);
  const freeLength = Number((container.lengthM - frontierOf(slot.id)).toFixed(2));

  const status: "open" | "closing_soon" | "full" =
    freeLength <= 0.5 ? "full" : freeLength <= 2 ? "closing_soon" : "open";

  return {
    id: slot.id,
    route: slot.route,
    carrier: slot.carrier,
    sailingDate: slot.sailingDate,
    cutoffDate: slot.cutoffDate,
    containerCode: slot.containerCode,
    mode: slot.mode,
    usedLengthM,
    usedWeightKg,
    consignmentCount: ps.length,
    status,
    internal: {
      lengthM: container.lengthM,
      widthM: container.widthM,
      heightM: container.heightM,
      maxPayloadKg: container.maxPayloadKg,
    },
    remaining: {
      lengthM: freeLength,
      payloadKg: container.maxPayloadKg - usedWeightKg,
      cbm: Number((freeLength * container.widthM * container.heightM).toFixed(2)),
    },
  };
}

function planFor(slotId: string) {
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) throw new Error(`unknown slot ${slotId}`);
  const container = CONTAINERS[slot.containerCode];
  const view = slotView(slot);
  return {
    slot: view,
    container,
    consignments: placementsFor(slotId),
    used: { lengthM: view.usedLengthM, weightKg: view.usedWeightKg },
    frontier: frontierOf(slotId),
    trappedM: trappedOf(slotId),
    remaining: view.remaining,
  };
}

/**
 * The fit check, in three dimensions.
 *
 * Kept faithful to the real engine rather than reduced to a volume comparison,
 * because the screens being redesigned show orientation, pieces across and
 * stack height -- a mock that returned a single boolean would make those
 * impossible to lay out honestly.
 */
function fit(
  container: { lengthM: number; widthM: number; heightM: number },
  freeLengthM: number,
  piece: { l: number; w: number; h: number; qty: number; stackable: boolean; uprightOnly: boolean }
) {
  const orientations = piece.uprightOnly
    ? [
        [piece.l, piece.w, piece.h],
        [piece.w, piece.l, piece.h],
      ]
    : [
        [piece.l, piece.w, piece.h],
        [piece.w, piece.l, piece.h],
        [piece.l, piece.h, piece.w],
        [piece.h, piece.l, piece.w],
        [piece.w, piece.h, piece.l],
        [piece.h, piece.w, piece.l],
      ];

  let best: { across: number; high: number; rows: number; floorM: number } | null = null;

  for (const [L, W, H] of orientations) {
    if (H > container.heightM) continue;
    const across = Math.floor(container.widthM / W);
    if (across < 1) continue;
    const high = piece.stackable ? Math.max(1, Math.floor(container.heightM / H)) : 1;
    const perRow = across * high;
    const rows = Math.ceil(piece.qty / perRow);
    const floorM = Number((rows * L).toFixed(2));
    if (floorM > freeLengthM) continue;
    if (!best || floorM < best.floorM) best = { across, high, rows, floorM };
  }
  return best;
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

/** Simulated latency, so loading states are visible while designing them. */
const LATENCY_MS = 180;
const delay = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

export function mockGet(path: string): Promise<unknown> {
  if (path === "/api/calls/live") {
    return delay({
      live: [],
      recent: callLogs.map((c) => ({
        id: Number(c.call_id),
        agentName: c.agent_name,
        fromNumber: c.from_number,
        status: c.status,
        durationSeconds: c.duration_secs,
        createdAt: c.started_at,
      })),
      checkedAt: new Date().toISOString(),
    });
  }

  if (path.startsWith("/api/calls/logs")) {
    const q = path.includes("?") ? new URLSearchParams(path.split("?")[1]) : null;
    const phone = q?.get("phone");
    const logs = phone
      ? callLogs.filter((c) => (c.from_number ?? "").endsWith(phone.replace(/\D/g, "").slice(-10)))
      : callLogs;
    return delay({ logs });
  }

  const callMatch = path.match(/^\/api\/calls\/(\d+)$/);
  if (callMatch) {
    const c = callLogs.find((x) => x.call_id === callMatch[1]);
    if (!c) return Promise.reject(new Error(`${path} -> 404`));
    return delay({
      id: Number(c.call_id),
      agentName: c.agent_name,
      status: c.status,
      fromNumber: c.from_number,
      toNumber: c.to_number,
      direction: c.direction,
      durationSeconds: c.duration_secs,
      createdAt: c.started_at,
      endedAt: c.started_at,
      transcriptAvailable: true,
      inProgress: false,
      transcript: c.transcript,
      callSummary: c.summary,
      dispositionResult: null,
    });
  }

  // ---- mail ---------------------------------------------------------------
  // Scoped by mailbox on every call. Graph infers the mailbox from the OAuth
  // token; here it is an explicit parameter, so the scoping stays visible
  // rather than becoming an implicit assumption the UI could drift away from.
  if (path.startsWith("/api/mail/")) {
    const [route, query] = path.split("?");
    const q = new URLSearchParams(query ?? "");
    const mailbox = q.get("mailbox") ?? "";
    if (!mailbox) return Promise.reject(new Error("mail requests must name a mailbox"));

    if (route === "/api/mail/folders") return delay({ folders: listFolders(mailbox) });

    if (route === "/api/mail/messages") {
      const folder = (q.get("folder") ?? "inbox") as FolderId;
      return delay({ messages: listMessages(mailbox, folder, q.get("q") ?? undefined) });
    }

    const one = route.match(/^\/api\/mail\/messages\/([^/]+)$/);
    if (one) {
      const m = getMailMessage(mailbox, one[1]);
      if (!m) return Promise.reject(new Error(`${path} -> 404`));
      return delay({ message: m });
    }
  }

  if (path === "/api/records") return delay({ records });

  if (path === "/api/space/slots") return delay({ slots: slots.map(slotView) });

  const planMatch = path.match(/^\/api\/space\/slots\/([^/]+)\/plan$/);
  if (planMatch) {
    try {
      return delay(planFor(planMatch[1]));
    } catch {
      return Promise.reject(new Error(`${path} -> 404`));
    }
  }

  return Promise.reject(new Error(`mock backend has no GET ${path}`));
}

export function mockPost(path: string, body: unknown): Promise<unknown> {
  const b = (body ?? {}) as Record<string, any>;

  // --- mail ----------------------------------------------------------------
  if (path === "/api/mail/send") {
    if (!b.mailbox) return Promise.reject(new Error("send must name a mailbox"));
    const to: string[] = (b.to ?? []).filter((x: string) => x.trim());
    if (!to.length) return Promise.reject(new Error("add at least one recipient"));
    if (!String(b.subject ?? "").trim()) return Promise.reject(new Error("add a subject"));
    return delay({
      message: sendMessage({
        mailbox: b.mailbox,
        fromName: b.fromName ?? "",
        to,
        cc: b.cc ?? [],
        subject: b.subject,
        content: b.content ?? "",
        conversationId: b.conversationId,
      }),
    });
  }

  const readMatch = path.match(/^\/api\/mail\/messages\/([^/]+)\/read$/);
  if (readMatch) {
    const m = setRead(b.mailbox, readMatch[1], b.isRead !== false);
    if (!m) return Promise.reject(new Error(`${path} -> 404`));
    return delay({ message: m });
  }

  const moveMatch = path.match(/^\/api\/mail\/messages\/([^/]+)\/move$/);
  if (moveMatch) {
    const m = moveMessage(b.mailbox, moveMatch[1], b.folder);
    if (!m) return Promise.reject(new Error(`${path} -> 404`));
    return delay({ message: m });
  }

  // --- promote / demote a record ------------------------------------------
  const stageMatch = path.match(/^\/api\/records\/([^/]+)\/stage$/);
  if (stageMatch) {
    const ref = decodeURIComponent(stageMatch[1]);
    const rec = records.find((r) => r.ref === ref);
    if (!rec) return Promise.reject(new Error(`${path} -> 404`));

    const sailing = b.sailing_date ?? rec.sailingDate;
    // The same 409 the real backend returns: a booking needs a date somebody agreed to.
    if (b.stage === "processing" && !sailing) {
      return Promise.reject(new Error("a sailing date is needed before this becomes a booking"));
    }

    rec.stage = b.stage;
    if (sailing) rec.sailingDate = sailing;
    if (b.stage === "processing") {
      rec.processingStartedAt = new Date().toISOString();
      rec.status = "booked";
    }
    if (b.stage === "processed") rec.status = "delivered";
    rec.updatedAt = new Date().toISOString();
    return delay({ record: rec });
  }

  // --- three-dimensional space check --------------------------------------
  if (path === "/api/tools/check-space") {
    const candidates = slots.filter(
      (s) => s.route.toLowerCase() === String(b.route ?? "").toLowerCase()
    );
    if (!candidates.length) {
      return delay({
        available: false,
        spoken_answer: `We don't have a sailing on ${b.route} at the moment. Let me take your details and have the desk come back to you.`,
        considered: [],
      });
    }

    const piece = {
      l: (b.length_cm ?? 0) / 100,
      w: (b.width_cm ?? 0) / 100,
      h: (b.height_cm ?? 0) / 100,
      qty: b.quantity ?? 0,
      stackable: b.stackable === true,
      uprightOnly: b.upright_only === true,
    };

    const considered: any[] = [];
    for (const slot of candidates) {
      if (b.sailing_date && slot.sailingDate !== b.sailing_date) continue;
      const container = CONTAINERS[slot.containerCode];
      const view = slotView(slot);
      const f = fit(container, view.remaining.lengthM, piece);
      if (!f) {
        considered.push({
          slot_id: slot.id,
          sailing_date: slot.sailingDate,
          container: slot.containerCode,
          reason: "does not fit the space left",
          max_pieces_that_fit: 0,
        });
        continue;
      }
      const totalWeight = piece.qty * (b.weight_kg_each ?? 0);
      if (totalWeight > view.remaining.payloadKg) {
        considered.push({
          slot_id: slot.id,
          sailing_date: slot.sailingDate,
          container: slot.containerCode,
          reason: "over the remaining payload",
          max_pieces_that_fit: Math.floor(view.remaining.payloadKg / (b.weight_kg_each || 1)),
        });
        continue;
      }

      return delay({
        available: true,
        route: slot.route,
        slot_id: slot.id,
        sailing_date: slot.sailingDate,
        cutoff_date: slot.cutoffDate,
        carrier: slot.carrier,
        container: slot.containerCode,
        mode: slot.mode,
        spoken_answer: `Yes — we have space on the ${slot.carrier} sailing on ${slot.sailingDate}, cut-off ${slot.cutoffDate}. Your cargo would take ${f.floorM} metres of floor.`,
        loading_plan: {
          across: f.across,
          high: f.high,
          per_row: f.across * f.high,
          rows: f.rows,
          floor_length_needed_m: f.floorM,
          total_weight_kg: totalWeight,
        },
        space_left_after: {
          lengthM: Number((view.remaining.lengthM - f.floorM).toFixed(2)),
          payloadKg: view.remaining.payloadKg - totalWeight,
        },
        alternatives: candidates
          .filter((s) => s.id !== slot.id)
          .map((s) => ({
            slot_id: s.id,
            sailing_date: s.sailingDate,
            cutoff_date: s.cutoffDate,
            container: s.containerCode,
          })),
        considered,
      });
    }

    return delay({
      available: false,
      route: b.route,
      spoken_answer:
        "That cargo won't fit the space we have left on that lane. Let me check the next sailing and call you back.",
      considered,
    });
  }

  // --- book space ----------------------------------------------------------
  if (path === "/api/space/book") {
    const slot = slots.find((s) => s.id === b.slot_id);
    if (!slot) return Promise.reject(new Error(`${path} -> 404`));

    const container = CONTAINERS[slot.containerCode];
    const view = slotView(slot);
    const piece = {
      l: (b.length_cm ?? 0) / 100,
      w: (b.width_cm ?? 0) / 100,
      h: (b.height_cm ?? 0) / 100,
      qty: b.quantity ?? 0,
      stackable: b.stackable === true,
      uprightOnly: b.upright_only === true,
    };
    const f = fit(container, view.remaining.lengthM, piece);
    if (!f) return Promise.reject(new Error("does not fit the space left on this sailing"));

    const existing = placementsFor(slot.id).find((p) => p.clientName === b.client_name);
    const colorIndex =
      existing?.colorIndex ??
      (placementsFor(slot.id).length
        ? Math.max(...placementsFor(slot.id).map((p) => p.colorIndex)) + 1
        : 0);

    const placement: Placement = {
      id: `pl-${slot.id}-${Date.now().toString(36)}`,
      slotId: slot.id,
      clientName: b.client_name,
      reference: b.reference,
      xM: frontierOf(slot.id),
      lengthM: f.floorM,
      piecesAcross: f.across,
      piecesHigh: f.high,
      rows: f.rows,
      quantity: piece.qty,
      pieceLengthM: piece.l,
      pieceWidthM: piece.w,
      pieceHeightM: piece.h,
      weightKg: piece.qty * (b.weight_kg_each ?? 0),
      colorIndex,
      source: b.source ?? "crm",
    };
    placements.push(placement);
    return delay({ placement, slot: slotView(slot) });
  }

  // --- restow --------------------------------------------------------------
  const restowMatch = path.match(/^\/api\/space\/slots\/([^/]+)\/restow$/);
  if (restowMatch) {
    const slot = slots.find((s) => s.id === restowMatch[1]);
    if (!slot) return Promise.reject(new Error(`${path} -> 404`));
    const container = CONTAINERS[slot.containerCode];

    const moves: Array<{ id: string; xM: number }> = b.placements ?? [];
    const proposed = placementsFor(slot.id).map((p) => {
      const m = moves.find((x) => x.id === p.id);
      return { ...p, xM: m ? m.xM : p.xM };
    });

    /**
     * Validated as a whole and rejected as a unit, like the real endpoint.
     * Two consignments in the same metre of floor would corrupt every
     * availability figure downstream, so a partially-applied restow is worse
     * than a refused one.
     */
    const sorted = [...proposed].sort((a, b2) => a.xM - b2.xM);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].xM < -0.001) {
        return Promise.reject(new Error("a consignment cannot start before the door"));
      }
      if (sorted[i].xM + sorted[i].lengthM > container.lengthM + 0.001) {
        return Promise.reject(new Error("that arrangement runs past the end of the container"));
      }
      if (i > 0 && sorted[i].xM < sorted[i - 1].xM + sorted[i - 1].lengthM - 0.001) {
        return Promise.reject(new Error("two consignments would overlap in that arrangement"));
      }
    }

    let moved = 0;
    for (const p of proposed) {
      const live = placements.find((x) => x.id === p.id);
      if (live && live.xM !== p.xM) {
        live.xM = p.xM;
        moved++;
      }
    }
    return delay({ slot: slotView(slot), moved });
  }

  return Promise.reject(new Error(`mock backend has no POST ${path}`));
}
