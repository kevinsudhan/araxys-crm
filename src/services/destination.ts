import { supabase } from "../lib/supabase";
import { arrivalHouseFrom, consigneeEmail, type ArrivalHouse } from "../lib/arrivalNotice";
import type { OutturnConsole, OutturnHouse } from "../lib/outturn";
import { releaseChecklist, type ReleaseItem } from "../lib/receivedHbl";
import { shipmentsOn, updateConsole, type Console } from "./consoles";
import { logEvent, updateShipment } from "./enquiries";
import { listPartners } from "./partners";
import { addReceipt, type Condition } from "./warehouse";

/**
 * An import console at destination (126): each house's arrival notice, its
 * outturn at destuffing, and where its release stands. The rules are
 * lib/arrivalNotice.ts, lib/outturn.ts and lib/receivedHbl.ts.
 */

export interface DestinationHouse {
  shipmentId: string;
  ref: string;
  email: string;
  arrival: ArrivalHouse;
  arrivalSentAt: string | null;
  arrivalSentTo: string;
  arrivalVia: "auto" | "desk" | null;
  outturn: OutturnHouse;
  /** The release checklist (088, 120), or null while their B/L is not saved. */
  release: { items: ReleaseItem[]; ready: boolean } | null;
  doIssuedOn: string | null;
}

export interface ArrivalSend {
  shipment_id: string | null;
  to_addresses: string[];
  status: "sent" | "failed" | "skipped";
  error: string | null;
  created_at: string;
}

export interface DestinationData {
  houses: DestinationHouse[];
  agent: { name: string; email: string } | null;
  sends: ArrivalSend[];
}

type Rec = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

async function rowsIn(table: string, select: string, column: string, values: string[]): Promise<Rec[]> {
  if (!values.length) return [];
  const { data, error } = await supabase.from(table).select(select).in(column, values);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Rec[];
}

export const outturnConsole = (c: Console, containers: string[]): OutturnConsole => ({
  console_no: c.console_no,
  mbl_number: c.mbl_number,
  vessel: c.vessel,
  voyage: c.voyage,
  pol: c.pol,
  pod: c.pod,
  cfs_name: c.cfs_name ?? "",
  destuffed_on: c.destuffed_on ?? null,
  containers,
});

export async function destinationFor(c: Console): Promise<DestinationData> {
  const jobs = await shipmentsOn(c.id);
  const ids = jobs.map((j) => j.id);
  const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
  const [customers, received, boxes, receipts, sendsRes, partners] = await Promise.all([
    rowsIn("customers", "id, emails, billing_email", "id", customerIds),
    rowsIn("received_house_bills", "shipment_id, hbl_no, release_mode, stage, issuer_name, data, telex_received_on, originals_surrendered_on, charges_cleared_on, do_issued_on", "shipment_id", ids),
    rowsIn("shipment_containers", "shipment_id, container_no, size_type", "shipment_id", ids),
    rowsIn("warehouse_receipts", "shipment_id, pieces, gross_weight_kg, condition, remarks", "shipment_id", ids),
    supabase.from("arrival_notice_sends").select("shipment_id, to_addresses, status, error, created_at").eq("console_id", c.id).order("created_at", { ascending: false }).limit(20),
    listPartners(true).catch(() => []),
  ]);
  if (sendsRes.error) throw new Error(sendsRes.error.message);
  const customerBy = new Map(customers.map((x) => [String(x.id), x]));
  const consoleFacts = { mbl_number: c.mbl_number, vessel: c.vessel, voyage: c.voyage, pol: c.pol, pod: c.pod, eta: c.eta, igm_no: c.igm_no, igm_date: c.igm_date, cfs_name: c.cfs_name ?? "" };

  const houses = jobs.map((j): DestinationHouse => {
    const r = received.find((x) => x.shipment_id === j.id) ?? null;
    const data = (r?.data ?? null) as { packages?: string; package_type?: string; freight_terms?: string; consignee_name?: string } | null;
    const arrival = arrivalHouseFrom({
      job: j as never,
      received: r ? { hbl_no: (r.hbl_no as string) ?? null, release_mode: (r.release_mode as string) ?? null, data } : null,
      boxes: boxes.filter((b) => b.shipment_id === j.id) as never,
      console: consoleFacts,
    });
    const mine = receipts.filter((x) => x.shipment_id === j.id);
    const landed = mine.length && mine.every((x) => num(x.pieces) !== null) ? mine.reduce((n, x) => n + (num(x.pieces) ?? 0), 0) : null;
    const landedKg = mine.length && mine.every((x) => num(x.gross_weight_kg) !== null) ? mine.reduce((n, x) => n + (num(x.gross_weight_kg) ?? 0), 0) : null;
    const manifested = num(data?.packages) ?? num(j.piece_count ?? j.package_count);
    return {
      shipmentId: j.id,
      ref: j.enquiry_ref,
      email: consigneeEmail(j, (customerBy.get(j.customer_id) as never) ?? null),
      arrival,
      arrivalSentAt: j.arrival_notice_sent_at ?? null,
      arrivalSentTo: j.arrival_notice_sent_to ?? "",
      arrivalVia: (j.arrival_notice_via ?? null) as DestinationHouse["arrivalVia"],
      outturn: {
        shipmentId: j.id,
        ref: j.enquiry_ref,
        hblNo: arrival.hblNo,
        consignee: arrival.consignee,
        manifestedPkgs: manifested,
        packageType: data?.package_type ?? j.package_type ?? "",
        landedPkgs: landed,
        landedKg,
        conditions: [...new Set(mine.map((x) => String(x.condition)))],
        remarks: mine.map((x) => String(x.remarks ?? "").trim()).filter(Boolean).join("; "),
      },
      release: r
        ? releaseChecklist({
            stage: r.stage as never,
            release_mode: r.release_mode as never,
            issuer_name: String(r.issuer_name ?? ""),
            freight_terms: /collect/i.test(data?.freight_terms ?? "") ? "collect" : "prepaid",
            originals_surrendered_on: (r.originals_surrendered_on as string) ?? null,
            telex_received_on: (r.telex_received_on as string) ?? null,
            charges_cleared_on: (r.charges_cleared_on as string) ?? null,
            console: { console_no: c.console_no, line_do_at: c.line_do_at ?? null, destuffed_on: c.destuffed_on ?? null, coload: c.space_from === "coloader" },
          })
        : null,
      doIssuedOn: (r?.do_issued_on as string) ?? null,
    };
  });

  const agent = partners.find((p) => p.id === c.agent_id);
  return { houses, agent: agent ? { name: agent.organisation || agent.name, email: agent.emails[0] ?? "" } : null, sends: (sendsRes.data ?? []) as ArrivalSend[] };
}

/** The desk sent this house's notice from its own Outlook. */
export async function markArrivalSent(h: DestinationHouse, to: string): Promise<void> {
  await updateShipment(h.shipmentId, { arrival_notice_sent_at: new Date().toISOString(), arrival_notice_sent_to: to, arrival_notice_via: "desk" });
  await logEvent(h.ref, "arrival_notice", `Arrival notice sent to ${to}`, { console_hbl: h.arrival.hblNo });
}

/** Whether the scheduler sends this console's notices, from which mailbox, how many days before the ETA. */
export const saveArrivalAuto = (c: Console, v: { auto: boolean; from: string; days: number }) =>
  updateConsole(c.id, { arrival_auto: v.auto, arrival_from: v.from.trim(), arrival_days: v.days });

export interface SendOutcome {
  ok: boolean;
  sent?: number;
  outcomes?: Array<{ ref: string; status: string; error?: string }>;
  stopped?: string | null;
  error?: string | null;
}

/** Every notice of the console not yet sent, now, by the CRM app from the console's mailbox (or yours). */
export async function sendWaitingNow(c: Console): Promise<SendOutcome> {
  const { data, error } = await supabase.functions.invoke("arrival-notices", { body: { mode: "console", console_id: c.id } });
  if (error) throw new Error(error.message);
  return data as SendOutcome;
}

/** Whether Microsoft lets the CRM app send on its own yet. Sends nothing. */
export async function checkSending(): Promise<SendOutcome> {
  const { data, error } = await supabase.functions.invoke("arrival-notices", { body: { mode: "check" } });
  if (error) throw new Error(error.message);
  return data as SendOutcome;
}

/** What came out of the box for a house at destuffing: its warehouse receipt (068). */
export const recordOutturn = (h: DestinationHouse, v: { pieces: number; condition: Condition; remarks: string; cfs: string; on: string | null }) =>
  addReceipt(h.shipmentId, {
    received_at: v.on ? `${v.on}T12:00:00+05:30` : new Date().toISOString(),
    location: v.cfs || null,
    pieces: v.pieces,
    gross_weight_kg: null,
    volume_cbm: null,
    condition: v.condition,
    bay: null,
    remarks: v.remarks.trim() || null,
  });

export const markOutturnSent = (c: Console, to: string) => updateConsole(c.id, { outturn_sent_at: new Date().toISOString(), outturn_sent_to: to });
