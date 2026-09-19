import type {
  CheckSpaceResponse, LiveCall, RealRecord, SlotPlan,
} from "../../services/backend";

/**
 * The enquiry the scripted run performs.
 *
 * ---------------------------------------------------------------------------
 * EVERY VALUE IN THIS FILE IS INVENTED.
 *
 * It is not a real customer, a real sailing or a real rate, and nothing here is written
 * to the CRM — the script swaps these in for the page's own state while it plays and the
 * desk's real data is untouched underneath.
 *
 * It exists because the script used to perform whatever call happened to be selected, so
 * the recording showed a real caller's half-filled record: 24 of 39 fields, a one-row
 * stow, documents that could not be issued. That is the honest picture of a short call
 * and it is a poor demonstration of a pipeline. A fixture lets the run show the whole
 * thing finished — every field captured, a stow worth watching, and documents that
 * actually issue at the end of it.
 * ---------------------------------------------------------------------------
 *
 * The numbers are internally consistent on purpose: 24 pieces at 120 x 100 x 145cm and
 * 310kg each is 7,440kg over 6 rows of 2 across x 2 high, taking 7.20m of floor. A viewer
 * who checks the arithmetic on screen should find it holds.
 */

const REF = "ARX-ENQ-0142";
const PHONE = "+91 98404 11821";

export const DEMO_CALL: LiveCall = {
  id: 25891,
  agentName: "Priya",
  fromNumber: PHONE,
  toNumber: "+91 44 4012 8800",
  status: "in_progress",
  direction: "inbound",
  startedAt: new Date().toISOString(),
  durationSeconds: null,
  transcript:
    "Agent: Good morning, Araxys Logistics, this is Priya. How can I help?\n" +
    "Caller: Hi, this is Meera from Meera Textiles. I need a quote, Chennai to Jebel Ali.\n" +
    "Agent: Of course. What are we shipping?\n" +
    "Caller: Cotton garments, twenty four cartons. Each one is about 120 by 100 by 145 centimetres.\n" +
    "Agent: And the weight per carton?\n" +
    "Caller: Around 310 kilos each. They can be stacked, two high is fine.\n" +
    "Agent: Any date you are working to?\n" +
    "Caller: We would like the 24th sailing if there is space.",
};

export const DEMO_RECORD: RealRecord = {
  ref: REF,
  phone: PHONE,
  customerName: "Meera Subramanian",
  company: "Meera Textiles",
  blNumber: "ARXCHNJEA0142",
  stage: "processed",
  status: "quoting",
  origin: "Chennai",
  destination: "Jebel Ali",
  cargoDescription: "Cotton garments, cartoned",
  volumeCbm: 41.76,
  containerType: "40HC",
  quotedAmountInr: 284000,
  agreedAmountInr: 284000,
  sailingDate: "2026-09-24",
  notes: "Repeat shipper. Wants the 24th sailing; confirmed on the call.",
  sourceLanguage: "en",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  requestDetails: {
    // ------------------------------------------------------------------ enquiry
    customer_name: "Meera Subramanian",
    company: "Meera Textiles",
    origin: "Chennai",
    destination: "Jebel Ali",
    cargo_description: "Cotton garments, cartoned",
    cargo_type: "textiles_garments",
    // ------------------------------------------------------------------ booking
    piece_length_cm: 120,
    piece_width_cm: 100,
    piece_height_cm: 145,
    piece_count: 24,
    weight_per_piece_kg: 310,
    total_gross_weight_kg: 7440,
    volume_cbm: 41.76,
    stackable: true,
    upright_only: false,
    preferred_sailing_date: "2026-09-24",
    container_type: "40HC",
    quote_accepted: true,
    target_price_inr: 275000,
    // ------------------------------------------------------------ documentation
    shipper_legal_name: "Meera Textiles Private Limited",
    shipper_gstin_iec: "33AAGCM4821P1ZK",
    consignee_name: "Al Nakheel Trading LLC",
    consignee_address: "Warehouse 14, Jebel Ali Free Zone South, Dubai, UAE",
    consignee_country: "United Arab Emirates",
    hs_code: "6109.10.00",
    invoice_value_inr: 4820000,
    package_count: 24,
    package_type: "Cartons",
    net_weight_kg: 7080,
    gross_weight_kg: 7440,
    incoterm: "FOB",
    payment_terms: "30 days from B/L date",
    letter_of_credit: false,
    // -------------------------------------------------------------- compliance
    msds_provided: false,
    un_packaging_spec: "Not applicable — non-hazardous",
    carrier_dg_approval: false,
    temperature_setpoint_c: null,
    pre_cooling_required: false,
    wood_packaging_used: false,
  },
};

/** 2 across x 2 high x 6 rows of 1.20 x 1.00 x 1.45 = 24 pieces over 7.20m of floor. */
export const DEMO_FIT: CheckSpaceResponse = {
  available: true,
  route: "Chennai → Jebel Ali",
  slot_id: "demo-slot-40hc",
  sailing_date: "2026-09-24",
  cutoff_date: "2026-09-22",
  carrier: "Bengal Star Lines",
  container: "40HC",
  mode: "LCL",
  spoken_answer:
    "Yes — the 2026-09-24 sailing works. 24 pieces load as 2 across by 2 high, 4 per row, " +
    "6 rows deep, taking 7.20m of container floor and 7,440kg of payload. That leaves 2.83m " +
    "and 20,560kg on the sailing. Booking has to be confirmed by 2026-09-22.",
  loading_plan: {
    across: 2,
    high: 2,
    per_row: 4,
    rows: 6,
    floor_length_needed_m: 7.2,
    total_weight_kg: 7440,
  },
  space_left_after: { lengthM: 2.83, payloadKg: 20560 },
  orientation: { lengthM: 1.2, widthM: 1.0, heightM: 1.45 },
};

/**
 * The sailing, with two consignments already aboard.
 *
 * The existing cargo matters to the recording: a box hunting for a position in an empty
 * container has nothing to hunt around, and the search reads as an animation rather than
 * as a decision. The frontier at 2.02m is where the loaded section ends.
 */
export const DEMO_PLAN: SlotPlan = {
  slot: {
    id: "demo-slot-40hc",
    route: "Chennai → Jebel Ali",
    carrier: "Bengal Star Lines",
    sailingDate: "2026-09-24",
    cutoffDate: "2026-09-22",
    containerCode: "40HC",
    mode: "LCL",
    usedLengthM: 2.02,
    usedWeightKg: 4180,
    consignmentCount: 2,
    status: "open",
    internal: { lengthM: 12.05, widthM: 2.35, heightM: 2.69, maxPayloadKg: 28180 },
    remaining: { lengthM: 10.03, payloadKg: 24000, cbm: 63.4 },
  },
  container: { code: "40HC", lengthM: 12.05, widthM: 2.35, heightM: 2.69, maxPayloadKg: 28180 },
  consignments: [
    {
      id: "demo-aboard-1",
      slotId: "demo-slot-40hc",
      clientName: "Coral Exports",
      reference: "ARX-ENQ-0118",
      xM: 0,
      lengthM: 1.1,
      piecesAcross: 2,
      piecesHigh: 2,
      rows: 1,
      quantity: 4,
      pieceLengthM: 1.1,
      pieceWidthM: 1.0,
      pieceHeightM: 1.05,
      weightKg: 1840,
      colorIndex: 1,
      source: "seed",
    },
    {
      id: "demo-aboard-2",
      slotId: "demo-slot-40hc",
      clientName: "Vantage Traders",
      reference: "ARX-ENQ-0126",
      xM: 1.1,
      lengthM: 0.92,
      piecesAcross: 2,
      piecesHigh: 1,
      rows: 1,
      quantity: 2,
      pieceLengthM: 0.92,
      pieceWidthM: 1.05,
      pieceHeightM: 1.2,
      weightKg: 2340,
      colorIndex: 2,
      source: "seed",
    },
  ],
  used: { lengthM: 2.02, weightKg: 4180 },
  frontier: 2.02,
  trappedM: 0,
  remaining: { lengthM: 10.03, payloadKg: 24000, cbm: 63.4 },
};

/**
 * The two facts a document needs that an enquiry record cannot carry.
 *
 * A container number and a vessel ETA belong to a booked shipment, not to an enquiry, so
 * documentDataFromRecord deliberately never produces them — which is right, and which
 * caps a record at nine of twelve issuable documents. The fixture is performing a booking
 * that has already gone through, so it supplies them, and all twelve issue.
 *
 * Applied only on script, and only over the fixture.
 */
export const DEMO_DOC_EXTRAS = {
  containerId: "BSLU 4829137",
  etaDate: "2026-10-06",
} as const;
