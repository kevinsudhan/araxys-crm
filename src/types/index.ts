export type Channel = "voice" | "email" | "whatsapp" | "web_form";

export type RequestStatus = "new" | "quoting" | "negotiating" | "accepted" | "rejected";

export interface InboundRequest {
  id: string;
  channel: Channel;
  customerName: string;
  company: string;
  phone: string;
  email: string;
  origin: string;
  destination: string;
  cargoDescription: string;
  volumeCbm: number;
  requestedAt: string;
  status: RequestStatus;
  quoteAmount?: number;
  negotiationFloor?: number;
  negotiationCeiling?: number;
  negotiationNote?: string;
  pastShipmentsCount: number;
  routedTo: "intake_quote_agent" | "human_review";
}

export type ShipmentStage = "in_process" | "completed";

export interface DocumentItem {
  name: string;
  status: "received" | "missing" | "generated";
  dueDate?: string;
}

export interface TimelineStep {
  label: string;
  date: string;
  state: "done" | "current" | "pending";
}

export interface CallHistoryEntry {
  date: string;
  agent: string;
  disposition: string;
}

export interface TranscriptTurn {
  speaker: "agent" | "customer";
  text: string;
}

export type CargoTypeCode =
  | "general_dry"
  | "textiles_garments"
  | "perishable_food"
  | "hazardous_dg"
  | "electronics"
  | "agri_grain";

export type CallOutcome =
  | "quote_provided"
  | "negotiating"
  | "booked"
  | "status_check"
  | "docs_missing"
  | "escalated"
  | "complaint";

/** Structured fields extracted by the SnapServe agent's disposition schema for one call. */
export interface CallExtraction {
  snapserveCallId: string;
  callDate: string;
  channel: Channel;
  transcript: TranscriptTurn[];
  cargoDescription?: string;
  cargoType?: CargoTypeCode;
  volumeCbm?: number;
  containerTypeRequested?: string;
  priceAskedInr?: number;
  priceNegotiatedInr?: number;
  callOutcome?: CallOutcome;
  nextStep?: string;
}

export type DocumentationStatus = "complete" | "partial_callback_needed" | "escalated";

/** Structured fields extracted by Arun's (documentation-desk agent) disposition schema. */
export interface DocGenDetails {
  snapserveCallId: string;
  callDate: string;
  shipperName?: string;
  shipperGstinIec?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeCountry?: string;
  hsCode?: string;
  invoiceValueInr?: number;
  packageCount?: number;
  packageType?: string;
  netWeightKg?: number;
  grossWeightKg?: number;
  documentationStatus: DocumentationStatus;
  missingFields?: string;
}

export interface Shipment {
  id: string;
  blNumber: string;
  customerName: string;
  company: string;
  phone: string;
  origin: string;
  destination: string;
  stage: ShipmentStage;
  status: string;
  carrier: string;
  containerId?: string;
  containerFillPct?: number;
  etaDate: string;
  deliveredDate?: string;
  freeDaysRemaining?: number;
  demurrageStartDate?: string;
  documents: DocumentItem[];
  timeline: TimelineStep[];
  pickup?: { date: string; window: string; confirmed: boolean };
  delivery?: { date: string; window: string; confirmed: boolean };
  callHistory: CallHistoryEntry[];
  lastSyncedToSnapserve: string;
  quoteAmount: number;
  /** Present when this shipment record originated from (or was updated by) a real SnapServe call. */
  callExtraction?: CallExtraction;
  /** Present once the customer has gone through the documentation handoff with Arun. */
  docGenDetails?: DocGenDetails;
}

export interface CallRecord {
  id: string;
  phone: string;
  customerName: string;
  agent: string;
  status: "live" | "ended";
  durationSec: number;
  channel: Channel;
  transcriptSnippet: string;
  disposition?: string;
  squadHandoff?: string;
  blNumber?: string;
}

export interface Complaint {
  id: string;
  blNumber: string;
  customerName: string;
  type: "billing" | "damage" | "delay" | "other";
  status: "open" | "resolved" | "escalated";
  raisedAt: string;
  channel: Channel;
  note: string;
  resolutionNote?: string;
}

export interface Invoice {
  id: string;
  blNumber: string;
  customerName: string;
  amount: number;
  currency: string;
  status: "paid" | "pending" | "disputed";
  dueDate: string;
  queryNote?: string;
}

export type AgentRole = "forwarder_rep" | "ground_truth" | "human_ops";

export interface AgentConfig {
  id: string;
  name: string;
  role: AgentRole;
  languages: string[];
  status: "active" | "inactive";
  squad: string;
  negotiationFloor?: number;
  negotiationCeiling?: number;
  knowledgeBase?: string[];
  instructions?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
}

export interface ContainerAllocation {
  id: string;
  route: string;
  carrier: string;
  fillPct: number;
  closingIn: string;
  suggestedShipments: string[];
}
