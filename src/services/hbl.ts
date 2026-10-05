import { supabase } from "../lib/supabase";
import { hblFromJob, normaliseHbl, paperless, type HblData, type JobForHbl, type ReleaseMode } from "../lib/hbl";
import { getConsole } from "./consoles";
import type { Shipment } from "./enquiries";
import { listPartners, type Partner } from "./partners";
import { listShipmentContainers } from "./shipmentContainers";
import { extraPartiesFor } from "./shipmentExtras";

/**
 * The house bill of lading on a shipment (085).
 *
 * One per shipment. Saved as the boxes of the form; numbered on the first
 * save that names a consignee; locked once issued; every save and every print
 * on its history. The same shape as the HAWB (services/hawb.ts).
 */

export interface HblRow {
  shipment_id: string;
  hbl_no: string | null;
  status: "draft" | "issued";
  release_mode: ReleaseMode;
  originals: number;
  mto_partner_id: string | null;
  /** Issued under our own MTO registration (132), not a partner's. */
  mto_own: boolean;
  data: HblData;
  issued_at: string | null;
  updated_at: string;
  updated_by: string | null;
  /* The release, once issued (089). */
  charges_received_on: string | null;
  originals_released_on: string | null;
  originals_released_to: string;
  originals_returned: number;
  originals_returned_on: string | null;
  release_sent_on: string | null;
  release_sent_to: string;
  released_on: string | null;
  release_note: string;
  /* An electronic B/L (132): where, its reference there, who holds it, when given up to our agent. */
  ebl_platform: string;
  ebl_ref: string;
  ebl_issued_on: string | null;
  ebl_holder: string;
  ebl_surrendered_on: string | null;
  /* The shipper's approval of the draft, and corrections after issue (123). */
  /** How many times it has been reopened after issue; printed on it from then on. */
  amendment: number;
  reopen_reason: string;
  approval: HblApproval;
  approval_token: string | null;
  /** The draft as sent to the shipper: what an approval is an approval of. */
  draft_sent: { data: unknown; hbl_no: string | null; release_mode: ReleaseMode; originals: number; amendment: number } | null;
  draft_sent_at: string | null;
  draft_sent_to: string;
  approval_at: string | null;
  approval_by: string;
  approval_note: string;
}

export type HblApproval = "none" | "sent" | "approved" | "changes";

export type HblReleasePatch = Partial<
  Pick<
    HblRow,
    | "charges_received_on"
    | "originals_released_on"
    | "originals_released_to"
    | "originals_returned"
    | "originals_returned_on"
    | "release_sent_on"
    | "release_sent_to"
    | "released_on"
    | "release_note"
    | "ebl_platform"
    | "ebl_ref"
    | "ebl_issued_on"
    | "ebl_holder"
    | "ebl_surrendered_on"
  >
>;

export interface HblHistory {
  id: string;
  at: string;
  actor: string | null;
  action: "created" | "updated" | "numbered" | "issued" | "reopened" | "printed" | "released" | "draft_sent" | "approved" | "changes_requested";
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  note: string;
}

const failure = (e: { message: string; hint?: string | null }) => new Error(e.hint ? `${e.message}. ${e.hint}` : e.message);

export async function getHbl(shipmentId: string): Promise<HblRow | null> {
  const { data, error } = await supabase.from("house_bills").select("*").eq("shipment_id", shipmentId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ({ ...data, data: normaliseHbl(data.data) } as HblRow) : null;
}

/**
 * Save the form, and number it the first time.
 *
 * A draft saved without a consignee is kept unnumbered and says why, rather
 * than failing the save.
 */
export async function saveHbl(
  shipmentId: string,
  input: { release_mode: ReleaseMode; originals: number; mto_partner_id: string | null; mto_own: boolean; ebl_platform?: string; data: HblData },
  exists: boolean
): Promise<{ row: HblRow; numberError: string | null }> {
  const values = {
    release_mode: input.release_mode,
    originals: paperless(input.release_mode) ? 0 : Math.min(3, Math.max(1, input.originals || 3)),
    mto_partner_id: input.mto_own ? null : input.mto_partner_id,
    mto_own: input.mto_own,
    ...(input.release_mode === "ebl" && input.ebl_platform !== undefined ? { ebl_platform: input.ebl_platform.trim() } : {}),
    data: input.data,
  };
  const { error } = exists
    ? await supabase.from("house_bills").update(values).eq("shipment_id", shipmentId)
    : await supabase.from("house_bills").insert({ shipment_id: shipmentId, ...values });
  if (error) throw failure(error);

  let numberError: string | null = null;
  const current = await getHbl(shipmentId);
  if (current && !current.hbl_no) {
    const { error: e2 } = await supabase.rpc("number_hbl", { p_shipment_id: shipmentId });
    if (e2) numberError = failure(e2).message;
  }
  return { row: (await getHbl(shipmentId))!, numberError };
}

/**
 * Issue it, or set an issued one back to draft for a correction. Reopening
 * needs the reason (123): the database refuses one without, and counts the
 * amendment.
 */
export async function setHblIssued(shipmentId: string, issued: boolean, reason = ""): Promise<void> {
  const { error } = await supabase
    .from("house_bills")
    .update(issued ? { status: "issued" } : { status: "draft", reopen_reason: reason.trim() })
    .eq("shipment_id", shipmentId);
  if (error) throw failure(error);
}

/** The draft's link for the shipper (123): minted once, the same on every send. */
export async function hblDraftToken(shipmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc("hbl_draft_link", { p_shipment: shipmentId });
  if (error) throw failure(error);
  return String(data);
}

/** The draft has gone to the shipper: what they were sent is what they approve. */
export async function markHblDraftSent(shipmentId: string, to: string): Promise<void> {
  const { error } = await supabase.rpc("hbl_draft_sent", { p_shipment: shipmentId, p_to: to });
  if (error) throw failure(error);
}

/** Approved by mail or on the phone, recorded by the desk with how. */
export async function recordHblApproval(shipmentId: string, how: string): Promise<void> {
  const { error } = await supabase.rpc("hbl_record_approval", { p_shipment: shipmentId, p_how: how });
  if (error) throw failure(error);
}

/**
 * A step of the release (089). The database refuses a release on an unissued
 * B/L and a telex release before every original is back, in words.
 */
export async function patchHblRelease(shipmentId: string, patch: HblReleasePatch): Promise<void> {
  const { error } = await supabase.from("house_bills").update(patch).eq("shipment_id", shipmentId);
  if (error) throw failure(error);
}

/**
 * Who the release message goes to: the destination agent on the Party tab,
 * else the console's agent, else the agent the job is routed through.
 */
export async function releaseAgent(shipment: Shipment): Promise<{ name: string; email: string } | null> {
  const [parties, partners, con] = await Promise.all([
    extraPartiesFor(shipment.id).catch(() => []),
    listPartners(true).catch(() => [] as Partner[]),
    shipment.console_id ? getConsole(shipment.console_id).catch(() => null) : Promise.resolve(null),
  ]);
  const party = parties.find((p) => p.role === "destination_agent" && p.email);
  if (party) return { name: party.contact_person || party.name || "", email: party.email! };
  const partner = partners.find((p) => p.id === con?.agent_id) ?? partners.find((p) => p.id === shipment.routed_agent_id);
  if (partner?.emails[0]) return { name: partner.organisation || partner.name, email: partner.emails[0] };
  return partner ? { name: partner.organisation || partner.name, email: "" } : null;
}

/** Invoices on the job not yet fully paid: a word of warning beside "charges received". */
export async function unpaidInvoices(shipmentId: string): Promise<number> {
  const { data, error } = await supabase.from("invoices").select("status").eq("shipment_id", shipmentId).in("status", ["issued", "part_paid"]);
  if (error) return 0;
  return (data ?? []).length;
}

export async function hblHistory(shipmentId: string): Promise<HblHistory[]> {
  const { data, error } = await supabase
    .from("house_bill_history")
    .select("id, at, actor, action, changes, note")
    .eq("shipment_id", shipmentId)
    .order("at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as HblHistory[];
}

export async function logHblPrint(shipmentId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("log_hbl_print", { p_shipment_id: shipmentId, p_note: note });
  if (error) throw new Error(error.message);
}

/** The partners a house B/L can be issued under: the ones with an MTO registration recorded. */
export async function mtoPartners(): Promise<Partner[]> {
  return (await listPartners()).filter((p) => p.mto_registration?.trim());
}

const contactOf = (p: Partner) => [p.name, ...(p.phones ?? []), ...(p.emails ?? [])].filter(Boolean).join(" · ");

/**
 * Everything "Fetch details" reads: the shipment, its boxes, the agent who
 * delivers it — the console's where it is on one, the job's own otherwise —
 * and the MTO it is issued under.
 */
export async function jobForHbl(shipment: Shipment, mtoPartnerId: string | null, own: { name: string; registration: string } | null = null): Promise<JobForHbl> {
  const [boxes, partners, con] = await Promise.all([
    listShipmentContainers(shipment.id).catch(() => []),
    listPartners(true).catch(() => [] as Partner[]),
    shipment.console_id ? getConsole(shipment.console_id).catch(() => null) : Promise.resolve(null),
  ]);
  const byId = (id: string | null | undefined) => (id ? partners.find((p) => p.id === id) : undefined);
  const agent = byId(con?.agent_id) ?? byId(shipment.routed_agent_id);
  const mto = byId(mtoPartnerId);
  return {
    shipment,
    containers: boxes,
    agent: agent ? { name: agent.organisation || agent.name, address: agent.address ?? "", contact: contactOf(agent) } : null,
    // Our own registration (132), or the partner's it is issued under.
    mto: own ?? (mto ? { name: mto.organisation || mto.name, registration: mto.mto_registration } : null),
    place: "Chennai",
    today: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
  };
}

export { hblFromJob };
