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

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

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

const slots: Slot[] = [
  { id: "sl-1", route: "Chennai to Jebel Ali", carrier: "MSC", sailingDate: day(4), cutoffDate: day(2), containerCode: "40HC", mode: "LCL" },
  { id: "sl-2", route: "Chennai to Singapore", carrier: "ONE", sailingDate: day(7), cutoffDate: day(5), containerCode: "40HC", mode: "LCL" },
  { id: "sl-3", route: "Chennai to Colombo", carrier: "CMA CGM", sailingDate: day(3), cutoffDate: day(1), containerCode: "20GP", mode: "LCL" },
  { id: "sl-4", route: "Chennai to Jeddah", carrier: "Maersk", sailingDate: day(11), cutoffDate: day(9), containerCode: "40GP", mode: "LCL" },
];

const placements: Placement[] = [
  // sl-1 — three consignments, loaded front to back with a gap at 5.4m that the
  // trapped-floor figure should pick up.
  mkPlacement("pl-1", "sl-1", "Kavitha Textiles", "ARX-ENQ-0001", 0, 1.2, 0.6, 0.4, 0.35, 96, 18, 2, 2, 0),
  mkPlacement("pl-2", "sl-1", "Surya Auto Components", "ARX-ENQ-0004", 1.2, 2.4, 1.2, 1.0, 1.1, 8, 240, 2, 1, 1),
  mkPlacement("pl-3", "sl-1", "Anand Marine Supplies", "ARX-ENQ-0007", 6.0, 1.8, 1.2, 0.8, 0.9, 12, 95, 2, 2, 2),

  // sl-2 — nearly empty, the obvious place to test a booking.
  mkPlacement("pl-4", "sl-2", "Rajesh Exports", "ARX-ENQ-0002", 0, 2.4, 1.2, 1.0, 1.1, 8, 180, 2, 1, 0),

  // sl-3 — a 20GP almost full, for testing the "does not fit" path.
  mkPlacement("pl-5", "sl-3", "Meenakshi Spices", "ARX-ENQ-0005", 0, 4.8, 1.2, 0.8, 0.9, 32, 60, 2, 2, 0),
];

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

const records: Record_[] = [
  {
    ref: "ARX-ENQ-0001",
    phone: "+919840112233",
    customerName: "Meera Raghavan",
    company: "Kavitha Textiles",
    blNumber: "MSCU7845120",
    stage: "processing",
    processingStartedAt: iso(-3),
    status: "booked",
    origin: "Chennai",
    destination: "Jebel Ali",
    cargoDescription: "Cotton bed linen sets",
    volumeCbm: 8.06,
    containerType: "40HC",
    quotedAmountInr: 195_000,
    agreedAmountInr: 185_000,
    sailingDate: day(4),
    sourceLanguage: "ta",
    createdAt: iso(-9),
    updatedAt: iso(-1),
    requestDetails: {
      customer_name: "Meera Raghavan",
      company: "Kavitha Textiles",
      origin: "Chennai",
      destination: "Jebel Ali",
      cargo_description: "Cotton bed linen sets",
      cargo_type: "textiles_garments",
      piece_length_cm: 60,
      piece_width_cm: 40,
      piece_height_cm: 35,
      piece_count: 96,
      weight_per_piece_kg: 18,
      total_gross_weight_kg: 1728,
      volume_cbm: 8.06,
      container_type: "40HC",
      preferred_sailing_date: day(4),
      quote_accepted: true,
      shipper_legal_name: "Kavitha Textiles Private Limited",
      shipper_gstin_iec: "33AAGCK4521M1Z8",
      consignee_name: "Al Noor Trading LLC",
      consignee_address: "Warehouse 12, Jebel Ali Free Zone, Dubai",
      consignee_country: "United Arab Emirates",
      hs_code: "6302.31",
      invoice_value_inr: 850_000,
      package_count: 96,
      package_type: "cartons",
      net_weight_kg: 1_640,
      gross_weight_kg: 1_728,
      incoterm: "FOB",
      payment_terms: "30 days from bill of lading date",
      wood_packaging_used: true,
    },
  },
  {
    ref: "ARX-ENQ-0002",
    phone: "+919176554321",
    customerName: "Rajesh Kumar",
    company: "Rajesh Exports",
    stage: "processing",
    processingStartedAt: iso(-2),
    status: "booked",
    origin: "Chennai",
    destination: "Singapore",
    cargoDescription: "Machined steel fittings",
    volumeCbm: 10.56,
    containerType: "40HC",
    quotedAmountInr: 142_000,
    agreedAmountInr: 138_000,
    sailingDate: day(7),
    sourceLanguage: "en",
    createdAt: iso(-6),
    updatedAt: iso(-2),
    requestDetails: {
      customer_name: "Rajesh Kumar",
      company: "Rajesh Exports",
      origin: "Chennai",
      destination: "Singapore",
      cargo_description: "Machined steel fittings",
      cargo_type: "machinery_parts",
      piece_length_cm: 120,
      piece_width_cm: 100,
      piece_height_cm: 110,
      piece_count: 8,
      weight_per_piece_kg: 180,
      total_gross_weight_kg: 1_440,
      volume_cbm: 10.56,
      container_type: "40HC",
      preferred_sailing_date: day(7),
      quote_accepted: true,
    },
  },
  {
    ref: "ARX-ENQ-0003",
    phone: "+918939153390",
    customerName: "Kevin",
    company: "Sudhan Trading",
    stage: "enquiry",
    status: "quoted",
    origin: "Chennai",
    destination: "Colombo",
    cargoDescription: "Packaged food products",
    volumeCbm: 4.2,
    quotedAmountInr: 68_000,
    sourceLanguage: "ta",
    createdAt: iso(-1),
    updatedAt: iso(-1),
    requestDetails: {
      customer_name: "Kevin",
      company: "Sudhan Trading",
      origin: "Chennai",
      destination: "Colombo",
      cargo_description: "Packaged food products",
      cargo_type: "food_perishable",
      piece_length_cm: 50,
      piece_width_cm: 40,
      piece_height_cm: 30,
      piece_count: 70,
      weight_per_piece_kg: 22,
      volume_cbm: 4.2,
      // No sailing date and no acceptance yet -- this is what keeps it an enquiry,
      // and what the promote button on the detail page needs before it will move.
    },
  },
  {
    ref: "ARX-ENQ-0004",
    phone: "+917448506170",
    customerName: "Priya Nair",
    company: "Surya Auto Components",
    blNumber: "ONEU4471209",
    stage: "processed",
    status: "delivered",
    origin: "Chennai",
    destination: "Jebel Ali",
    cargoDescription: "Automotive castings",
    volumeCbm: 10.56,
    containerType: "40HC",
    quotedAmountInr: 210_000,
    agreedAmountInr: 205_000,
    sailingDate: day(-14),
    sourceLanguage: "en",
    createdAt: iso(-30),
    updatedAt: iso(-5),
  },
  {
    ref: "ARX-ENQ-0005",
    phone: "+919094887766",
    customerName: "Suresh Babu",
    company: "Meenakshi Spices",
    stage: "enquiry",
    status: "awaiting_details",
    origin: "Chennai",
    destination: "Jeddah",
    cargoDescription: "Ground spices in sacks",
    sourceLanguage: "ta",
    createdAt: iso(-1),
    updatedAt: iso(-1),
    requestDetails: {
      customer_name: "Suresh Babu",
      company: "Meenakshi Spices",
      origin: "Chennai",
      destination: "Jeddah",
      cargo_description: "Ground spices in sacks",
      cargo_type: "food_dry",
    },
  },
];

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

const callLogs = [
  {
    call_id: "12970",
    agent_name: "Priya",
    direction: "inbound",
    from_number: "+919840112233",
    to_number: "+917965854267",
    status: "completed",
    duration_secs: 214,
    transcript: TRANSCRIPT_1,
    summary:
      "Meera Raghavan of Kavitha Textiles booked 96 cartons of cotton bed linen, Chennai to Jebel Ali, on the MSC sailing. Negotiated from ₹195,000 to ₹185,000 and accepted. Handed to documentation.",
    extracted: { extracted_by: "llm-mock", fields: 21 },
    started_at: iso(-1),
  },
  {
    call_id: "12968",
    agent_name: "Priya",
    direction: "inbound",
    from_number: "+918939153390",
    to_number: "+917965854267",
    status: "completed",
    duration_secs: 138,
    transcript:
      "Agent: வணக்கம், ஆஷிஷ் லாஜிஸ்டிக்ஸ் ப்ரியா பேசுறேன். எப்படி உதவ முடியும்?\nCustomer: கொழும்புக்கு சரக்கு அனுப்பணும்.\nAgent: கண்டிப்பா. என்ன சரக்கு?\nCustomer: பேக் பண்ண food products.\nAgent: எத்தனை பெட்டி?\nCustomer: எழுபது.\nAgent: சரி, ஒரு மணி நேரத்துல quote அனுப்புறேன்.",
    summary:
      "Kevin of Sudhan Trading enquired about 70 cartons of packaged food, Chennai to Colombo. Quoted ₹68,000. No sailing date agreed yet — call back needed.",
    extracted: { extracted_by: "llm-mock", fields: 11 },
    started_at: iso(-1),
  },
  {
    call_id: "12965",
    agent_name: "Arun",
    direction: "inbound",
    from_number: "+919176554321",
    to_number: "+917965854267",
    status: "completed",
    duration_secs: 96,
    transcript:
      "Agent: Hi, this is Arun from the documentation desk. Priya's passed me your shipment — I just need a few more details.\nCustomer: Go ahead.\nAgent: What's the full legal name of the shipper?\nCustomer: Rajesh Exports Private Limited.\nAgent: Thank you. And the consignee in Singapore?\nCustomer: I'll have to send that across, I don't have it here.\nAgent: No problem at all — call back whenever you have it and we'll pick up right here.",
    summary:
      "Arun collected shipper legal name for ARX-ENQ-0002. Consignee details still outstanding; customer to call back.",
    extracted: { extracted_by: "llm-mock", fields: 4 },
    started_at: iso(-2),
  },
];

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
