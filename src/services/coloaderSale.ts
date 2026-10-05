import { supabase } from "../lib/supabase";
import type { ColoaderConsole, ColoaderHouse } from "../lib/coloaderSale";
import { shipmentsOn, updateConsole, type Console } from "./consoles";
import { updateShipment } from "./enquiries";

/**
 * Space on our console sold to other forwarders (124): which houses are
 * theirs, and the records of what we sent them. The rules are
 * lib/coloaderSale.ts.
 */

export const coloaderConsole = (c: Console): ColoaderConsole => ({
  console_no: c.console_no,
  vessel: c.vessel,
  voyage: c.voyage,
  pol: c.pol,
  pod: c.pod,
  place_of_delivery: c.place_of_delivery,
  etd: c.etd,
  cutoff_date: c.cutoff_date,
  cfs_name: c.cfs_name ?? "",
});

type CustomerRow = { id: string; name: string; company: string; emails: string[]; forwarder: boolean; billing_address: string | null; billing_city: string | null; billing_country: string | null };

/** The houses on the console whose customer is a forwarder, with what each needs. */
export async function coloaderHousesFor(c: Console): Promise<ColoaderHouse[]> {
  const jobs = await shipmentsOn(c.id);
  const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
  if (!customerIds.length) return [];
  const { data: cs, error } = await supabase
    .from("customers")
    .select("id, name, company, emails, forwarder, billing_address, billing_city, billing_country")
    .in("id", customerIds)
    .eq("forwarder", true);
  if (error) throw new Error(error.message);
  const forwarders = new Map(((cs ?? []) as CustomerRow[]).map((x) => [x.id, x]));
  const theirs = jobs.filter((j) => forwarders.has(j.customer_id));
  if (!theirs.length) return [];

  const ids = theirs.map((j) => j.id);
  const refs = theirs.map((j) => j.enquiry_ref);
  const [bills, quotes] = await Promise.all([
    supabase.from("house_bills").select("shipment_id, hbl_no, status, data").in("shipment_id", ids),
    supabase.from("quotes").select("enquiry_ref, version, amount_inr").eq("status", "accepted").in("enquiry_ref", refs),
  ]);
  if (bills.error) throw new Error(bills.error.message);
  if (quotes.error) throw new Error(quotes.error.message);
  const billBy = new Map(((bills.data ?? []) as Array<{ shipment_id: string; hbl_no: string | null; status: string; data: { shipper_name?: string } | null }>).map((b) => [b.shipment_id, b]));
  // The latest accepted version of each enquiry's quotation.
  const quoteBy = new Map<string, { version: number; amount_inr: number }>();
  for (const q of (quotes.data ?? []) as Array<{ enquiry_ref: string; version: number; amount_inr: number | string }>) {
    const was = quoteBy.get(q.enquiry_ref);
    if (!was || q.version > was.version) quoteBy.set(q.enquiry_ref, { version: q.version, amount_inr: Number(q.amount_inr) });
  }

  return theirs.map((j): ColoaderHouse => {
    const f = forwarders.get(j.customer_id)!;
    const b = billBy.get(j.id);
    return {
      shipmentId: j.id,
      ref: j.enquiry_ref,
      forwarder: {
        id: f.id,
        name: f.company || f.name,
        email: f.emails?.[0] ?? "",
        address: [f.billing_address, f.billing_city, f.billing_country].filter(Boolean).join(", "),
      },
      hblNo: b?.hbl_no ?? j.bl_number ?? null,
      hblIssued: b?.status === "issued",
      hblShipper: (b?.data?.shipper_name ?? "").trim(),
      grossKg: Number(j.gross_weight_kg ?? 0),
      cbm: Number(j.volume_cbm ?? 0),
      quotedInr: quoteBy.get(j.enquiry_ref)?.amount_inr ?? null,
      instructionsSentAt: j.coload_instructions_sent_at ?? null,
      instructionsSentTo: j.coload_instructions_sent_to ?? "",
    };
  });
}

/** The CFS the box is stuffed at (consoles.cfs_name, 120). */
export const saveStuffingCfs = (c: Console, cfs: string) => updateConsole(c.id, { cfs_name: cfs.trim() });

export const markInstructionsSent = (shipmentId: string, to: string) =>
  updateShipment(shipmentId, { coload_instructions_sent_at: new Date().toISOString(), coload_instructions_sent_to: to });
