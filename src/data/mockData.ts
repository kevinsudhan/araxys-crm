import type {
  InboundRequest,
  Shipment,
  CallRecord,
  Complaint,
  Invoice,
  AgentConfig,
  AuditEntry,
  ContainerAllocation,
} from "../types";

/**
 * Emptied on purpose.
 *
 * ---------------------------------------------------------------------------
 * This file used to hold several hundred lines of invented shipments, calls,
 * complaints and invoices. They made every screen look busy and told nobody
 * whether any of it worked — a page full of convincing rows is indistinguishable
 * from a page that is working, right up until somebody trusts one.
 *
 * v2 shows real data or nothing. The inbound half runs on real tables in v2's
 * own Supabase project; mail is real Outlook through Graph. The surfaces below
 * belong to the downstream half — booking, documentation, billing, analytics —
 * which is not wired to a backend yet, so they render empty states that say so
 * rather than fixtures that imply otherwise.
 *
 * The exports stay so those pages keep compiling. When each one is wired to a
 * real source, it stops importing from here.
 * ---------------------------------------------------------------------------
 */

export const inboundRequests: InboundRequest[] = [];
export const shipments: Shipment[] = [];
export const callRecords: CallRecord[] = [];
export const complaints: Complaint[] = [];
export const invoices: Invoice[] = [];
export const agentConfigs: AgentConfig[] = [];
export const auditLog: AuditEntry[] = [];
export const containerAllocations: ContainerAllocation[] = [];

/** No invented figures. A dash is honest; a number nobody computed is not. */
export const kpis = {
  demurrageAvoidedInr: null as number | null,
  callsDeflected: null as number | null,
  quoteToBookingPct: null as number | null,
  activeShipments: null as number | null,
  inboundRequestsOpen: null as number | null,
  openComplaints: null as number | null,
};

export const callsPerWeek: number[] = [];
