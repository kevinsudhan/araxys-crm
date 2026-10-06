import { myId, supabase } from "../lib/supabase";
import { dsrRow, type DsrMilestone, type DsrRow, type DsrSource } from "../lib/dsr";
import type { Customer } from "./customers";

/**
 * The customer's DSR (108): their live shipments read into report lines, the
 * desk's REASON and STATUS for each, and the record of every DSR mailed.
 * The lines themselves are laid out by lib/dsr.ts.
 */

/** A delivered job stays on the report this long, so the customer sees it arrive. */
export const DELIVERED_KEPT_DAYS = 7;

const SHIPMENT_COLUMNS =
  "id, enquiry_ref, stage, transport_mode, trade_direction, incoterm, booking_number, bl_number, forwarders_bl_no, vessel, voyage, flight_number, etd, eta, cargo_cutoff, origin, destination, port_of_loading, port_of_discharge, package_count, package_type, piece_count, gross_weight_kg, volume_cbm, created_at, updated_at, cancelled_at";

type ShipmentRow = DsrSource["shipment"] & { updated_at: string; cancelled_at: string | null };

const need = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? ([] as unknown)) as T;
};

export const customerName = (c: Pick<Customer, "company" | "name">) => (c.company?.trim() || c.name?.trim() || "").trim();

/**
 * Every shipment of the customer's that belongs on the report: all those in
 * progress, and those delivered in the last week. Cancelled jobs never.
 */
export async function dsrFor(customer: Customer, now = new Date()): Promise<DsrRow[]> {
  const shipments = need<ShipmentRow[]>(
    await supabase.from("shipments").select(SHIPMENT_COLUMNS).eq("customer_id", customer.id).is("cancelled_at", null)
  ).filter((s) => s.stage !== "cancelled");
  if (!shipments.length) return [];
  const ids = shipments.map((s) => s.id);
  const refs = [...new Set(shipments.map((s) => s.enquiry_ref))];

  const [milestones, moves, hbls, hawbs, quotes, notes] = await Promise.all([
    supabase.from("shipment_milestones").select("shipment_id, code, label, position, reached_on, hidden").in("shipment_id", ids),
    supabase.from("shipment_movements").select("shipment_id, planned_date, actual_at, seq").eq("kind", "pickup").in("shipment_id", ids),
    supabase.from("house_bills").select("shipment_id, hbl_no").in("shipment_id", ids),
    supabase.from("house_airwaybills").select("shipment_id, hawb_no").in("shipment_id", ids),
    supabase.from("quotes").select("enquiry_ref, status, responded_at, verbal_accept_at").eq("status", "accepted").in("enquiry_ref", refs),
    supabase.from("shipment_dsr_notes").select("shipment_id, remark, status").in("shipment_id", ids),
  ]);
  const ms = need<Array<DsrMilestone & { shipment_id: string }>>(milestones);
  const mv = need<Array<{ shipment_id: string; planned_date: string | null; actual_at: string | null; seq: number }>>(moves);
  const hb = need<Array<{ shipment_id: string; hbl_no: string | null }>>(hbls);
  const hw = need<Array<{ shipment_id: string; hawb_no: string | null }>>(hawbs);
  const qs = need<Array<{ enquiry_ref: string; responded_at: string | null; verbal_accept_at: string | null }>>(quotes);
  const ns = need<Array<{ shipment_id: string; remark: string; status: string }>>(notes);

  const cutoff = new Date(now.getTime() - DELIVERED_KEPT_DAYS * 86400000).toISOString().slice(0, 10);
  const name = customerName(customer);

  return shipments
    .map((s) => {
      const mine = ms.filter((m) => m.shipment_id === s.id);
      const pickup = mv.filter((m) => m.shipment_id === s.id).sort((a, b) => a.seq - b.seq)[0];
      const accepted = qs
        .filter((q) => q.enquiry_ref === s.enquiry_ref)
        .map((q) => q.verbal_accept_at ?? q.responded_at)
        .filter((v): v is string => Boolean(v))
        .sort()[0];
      const note = ns.find((x) => x.shipment_id === s.id) ?? null;
      const withPickup = pickup?.actual_at && !mine.some((m) => m.code === "picked_up" && m.reached_on)
        ? [...mine, { code: "picked_up", label: "Cargo picked up", position: -1, reached_on: pickup.actual_at.slice(0, 10), hidden: true }]
        : mine;
      return {
        row: dsrRow({
          shipment: s,
          customerName: name,
          houseBill: hb.find((x) => x.shipment_id === s.id)?.hbl_no ?? hw.find((x) => x.shipment_id === s.id)?.hawb_no ?? null,
          bookingReceived: accepted ?? s.created_at,
          milestones: withPickup,
          pickupPlanned: pickup && !pickup.actual_at ? pickup.planned_date : null,
          note,
        }),
        deliveredOn: mine.find((m) => m.code === "delivered")?.reached_on ?? (s.stage === "delivered" ? s.updated_at.slice(0, 10) : null),
      };
    })
    .filter(({ row, deliveredOn }) => !row.delivered || (deliveredOn ?? "") >= cutoff)
    .map(({ row }) => row);
}

/** The desk's REASON and STATUS for one shipment's line. Blank STATUS reads from the milestones. */
export async function saveDsrNote(shipmentId: string, note: { remark: string; status: string }): Promise<void> {
  const { error } = await supabase
    .from("shipment_dsr_notes")
    .upsert({ shipment_id: shipmentId, remark: note.remark.trim(), status: note.status.trim() }, { onConflict: "shipment_id" });
  if (error) throw new Error(error.message);
}

export interface DsrSend {
  id: number;
  customer_id: string;
  sent_by: string | null;
  sent_from: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  shipment_ids: string[];
  sent_at: string;
  /** The sender's name, from their login. */
  by_name?: string | null;
}

/** The DSRs mailed to this customer, newest first. */
export async function dsrSends(customerId: string, limit = 10): Promise<DsrSend[]> {
  const rows = need<DsrSend[]>(
    await supabase.from("customer_dsr_sends").select("*").eq("customer_id", customerId).order("sent_at", { ascending: false }).limit(limit)
  );
  const ids = [...new Set(rows.map((r) => r.sent_by).filter((v): v is string => Boolean(v)))];
  if (!ids.length) return rows;
  const people = need<Array<{ id: string; full_name: string | null }>>(await supabase.from("profiles").select("id, full_name").in("id", ids));
  const name = new Map(people.map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({ ...r, by_name: r.sent_by ? name.get(r.sent_by) ?? null : null }));
}

/** After the mail has gone: who it went to, and which shipments were on it. */
export async function recordDsrSent(input: {
  customerId: string;
  sentFrom: string;
  to: string[];
  cc: string[];
  subject: string;
  shipmentIds: string[];
}): Promise<void> {
  const me = await myId();
  const { error } = await supabase.from("customer_dsr_sends").insert({
    customer_id: input.customerId,
    sent_by: me,
    sent_from: input.sentFrom,
    to_addresses: input.to,
    cc_addresses: input.cc,
    subject: input.subject,
    shipment_ids: input.shipmentIds,
  });
  if (error) throw new Error(error.message);
}
