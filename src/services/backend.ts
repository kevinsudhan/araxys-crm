/**
 * Client for the Araxys backend (server/index.ts).
 *
 * Everything SnapServe-related goes through here rather than the browser talking to
 * SnapServe directly — the API key stays server-side and never ships in the bundle.
 *
 * ---------------------------------------------------------------------------
 * V2 WORKSPACE: THIS TALKS TO NOTHING BY DEFAULT.
 *
 * This clone exists so the CRM can be redesigned without touching the running
 * one. The production copy shares a Supabase project and a SnapServe account
 * with the live voice agents, so a booking made here, a container restowed
 * here, or a record promoted here would change what a real caller is told.
 *
 * So the default is the in-memory mock in ./mockBackend, and reaching the real
 * backend takes a deliberate act: set VITE_MOCK_BACKEND=off *and* point
 * VITE_API_BASE somewhere. Defaulting the other way -- real unless told
 * otherwise -- would mean one missing env file silently writes to production,
 * which is exactly the accident this workspace is meant to make impossible.
 * ---------------------------------------------------------------------------
 */
import { mockGet, mockPost } from "./mockBackend";

const USE_MOCK = import.meta.env.VITE_MOCK_BACKEND !== "off";
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

if (USE_MOCK && typeof console !== "undefined") {
  console.info(
    "[araxys v2] in-memory backend — no requests leave this machine. " +
      "Set VITE_MOCK_BACKEND=off to use a real API."
  );
}

async function get<T>(path: string): Promise<T> {
  if (USE_MOCK) return mockGet(path) as Promise<T>;
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (USE_MOCK) return mockPost(path, body) as Promise<T>;
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `${path} -> ${r.status}`);
  }
  return r.json() as Promise<T>;
}

// ---- live calls ----------------------------------------------------------

export interface LiveCall {
  id: number;
  agentName: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  direction?: string;
  startedAt: string;
  durationSeconds: number | null;
}

export interface RecentCall {
  id: number;
  agentName: string;
  fromNumber: string;
  status: string;
  durationSeconds: number | null;
  createdAt: string;
}

export interface CallDetail {
  id: number;
  agentName: string;
  status: string;
  fromNumber: string;
  toNumber: string;
  direction?: string;
  durationSeconds: number | null;
  createdAt: string;
  endedAt: string | null;
  transcriptAvailable: boolean;
  inProgress: boolean;
  transcript: string | null;
  callSummary: string | null;
  dispositionResult: unknown;
}

export const getLiveCalls = () =>
  get<{ live: LiveCall[]; recent: RecentCall[]; checkedAt: string }>("/api/calls/live");

export const getCallDetail = (id: number) => get<CallDetail>(`/api/calls/${id}`);

// ---- space ---------------------------------------------------------------

export interface SlotRemaining {
  lengthM: number;
  payloadKg: number;
  cbm: number;
}

export interface SpaceSlot {
  id: string;
  route: string;
  carrier: string;
  sailingDate: string;
  cutoffDate: string;
  containerCode: string;
  mode: "LCL" | "FCL";
  usedLengthM: number;
  usedWeightKg: number;
  consignmentCount: number;
  status: "open" | "closing_soon" | "full";
  internal: { lengthM: number; widthM: number; heightM: number; maxPayloadKg: number } | null;
  remaining: SlotRemaining | null;
}

/** One customer's cargo, sized and positioned inside a specific container. */
export interface PlacedConsignment {
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

export interface SlotPlan {
  slot: SpaceSlot;
  container: { code: string; lengthM: number; widthM: number; heightM: number; maxPayloadKg: number };
  consignments: PlacedConsignment[];
  used: { lengthM: number; weightKg: number };
  /** Where the loaded section ends. New cargo is placed here, not at `used.lengthM`. */
  frontier: number;
  /** Floor stranded in gaps between blocks — recoverable by restowing, not bookable. */
  trappedM: number;
  remaining: SlotRemaining;
}

export interface CheckSpaceRequest {
  route: string;
  sailing_date?: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  quantity: number;
  weight_kg_each: number;
  stackable?: boolean;
  upright_only?: boolean;
}

export interface CheckSpaceResponse {
  available: boolean;
  route?: string;
  slot_id?: string;
  sailing_date?: string;
  cutoff_date?: string;
  carrier?: string;
  container?: string;
  mode?: string;
  spoken_answer: string;
  loading_plan?: {
    across: number;
    high: number;
    per_row: number;
    rows: number;
    floor_length_needed_m: number;
    total_weight_kg: number;
  };
  space_left_after?: { lengthM: number; payloadKg: number };
  alternatives?: Array<{ slot_id: string; sailing_date: string; cutoff_date: string; container: string }>;
  considered?: Array<{
    slot_id: string;
    sailing_date: string;
    container: string;
    reason?: string;
    max_pieces_that_fit: number;
  }>;
}

/** A real customer captured from an actual call — distinct from seeded demo shipments. */
import type { RequestDetails, SourceLanguage } from "../data/requestFields";

/**
 * enquiry -> someone rang; processing -> the desk committed to a booking; processed -> delivered.
 * The move out of enquiry is a human decision, never inferred from a transcript.
 */
export type RecordStage = "enquiry" | "processing" | "processed";

export interface RealRecord {
  ref: string;
  phone: string;
  customerName?: string;
  company?: string;
  blNumber?: string;
  stage: RecordStage;
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
  /** Keyed by the field catalogue in src/data/requestFields.ts — see RequestDetailsGrid. */
  requestDetails?: RequestDetails;
  sourceLanguage?: SourceLanguage;
  createdAt: string;
  updatedAt: string;
}

export const getRealRecords = () => get<{ records: RealRecord[] }>("/api/records");

/** Rejected with a 409 if the move needs a sailing date and none is on file. */
export const setRecordStage = (ref: string, stage: RecordStage, sailingDate?: string) =>
  post<{ record: RealRecord }>(`/api/records/${encodeURIComponent(ref)}/stage`, {
    stage,
    ...(sailingDate ? { sailing_date: sailingDate } : {}),
  });

/** A stored call: what was said, plus the summary we generate from it. */
export interface CallLog {
  call_id: string;
  agent_name: string | null;
  direction: string | null;
  from_number: string | null;
  to_number: string | null;
  status: string | null;
  duration_secs: number | null;
  transcript: string | null;
  summary: string | null;
  extracted: Record<string, unknown> | null;
  started_at: string | null;
}

export const getCallLogs = (phone?: string) =>
  get<{ logs: CallLog[] }>(`/api/calls/logs${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`);

export const getSpaceSlots = () => get<{ slots: SpaceSlot[] }>("/api/space/slots");

export const getSlotPlan = (slotId: string) => get<SlotPlan>(`/api/space/slots/${slotId}/plan`);

export const checkSpace = (req: CheckSpaceRequest) =>
  post<CheckSpaceResponse>("/api/tools/check-space", req);

/**
 * Persists a rearranged stow. The server re-validates the whole arrangement and rejects
 * it as a unit, so a 409 here means the plan on screen is not loadable, not that one
 * consignment failed to save.
 */
export const restowSlot = (slotId: string, placements: Array<{ id: string; xM: number }>) =>
  post<{ slot: SpaceSlot; moved: number }>(`/api/space/slots/${slotId}/restow`, { placements });

export const bookSpace = (body: {
  slot_id: string;
  client_name: string;
  reference: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  quantity: number;
  weight_kg_each: number;
  stackable?: boolean;
  upright_only?: boolean;
  source?: "crm" | "voice_agent";
}) => post<{ placement: PlacedConsignment; slot: SpaceSlot }>("/api/space/book", body);
