import { supabase } from "../lib/supabase";
import type { DgHouse } from "../lib/dgAcceptance";
import type { Console } from "./consoles";
import { updateEnquiry } from "./enquiries";

/**
 * The dangerous goods on a console, and accepting them into it (131). The
 * rules are lib/dgAcceptance.ts.
 *
 * The UN number, class, packing group, flash point and whether the safety data
 * sheet is in hand are the job's facts: kept on the enquiry, which the job
 * follows (065), so they are written there. The papers and the acceptance are
 * the console desk's, on the job.
 */

const COLS =
  "id, enquiry_ref, un_number, imo_class, packing_group, flash_point_c, msds_provided, msds_date, dg_declaration_at, dg_line_ref, dg_accepted_at, dg_accept_note, customer:customers(name, company), enquiry:enquiries(hazardous)";

type Row = {
  id: string;
  enquiry_ref: string | null;
  un_number: string | null;
  imo_class: string | null;
  packing_group: string | null;
  flash_point_c: number | null;
  msds_provided: boolean | null;
  msds_date: string | null;
  dg_declaration_at: string | null;
  dg_line_ref: string | null;
  dg_accepted_at: string | null;
  dg_accept_note: string | null;
  customer: { name?: string | null; company?: string | null } | null;
  enquiry: { hazardous?: boolean | null } | null;
};

/** The DG houses on the console: a job marked hazardous, or with a UN number or a class. */
export async function dgHousesOn(c: Console): Promise<DgHouse[]> {
  const { data, error } = await supabase.from("shipments").select(COLS).eq("console_id", c.id).order("created_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.enquiry?.hazardous === true || Boolean(r.un_number?.trim()) || Boolean(r.imo_class?.trim()))
    .map((r) => ({
      shipmentId: r.id,
      ref: r.enquiry_ref,
      customer: r.customer?.company?.trim() || r.customer?.name?.trim() || "—",
      unNumber: r.un_number,
      imoClass: r.imo_class,
      packingGroup: r.packing_group,
      flashPointC: r.flash_point_c === null ? null : Number(r.flash_point_c),
      msdsProvided: r.msds_provided,
      msdsDate: r.msds_date,
      declarationAt: r.dg_declaration_at,
      lineRef: r.dg_line_ref,
      acceptedAt: r.dg_accepted_at,
      acceptNote: r.dg_accept_note,
    }));
}

/** A job fact, on the enquiry; the job follows it. */
export async function saveDgFact(
  h: DgHouse,
  patch: Partial<{ un_number: string | null; imo_class: string | null; packing_group: "I" | "II" | "III" | null; flash_point_c: number | null; msds_provided: boolean | null }>
): Promise<void> {
  if (!h.ref) throw new Error("This job has no enquiry to keep its dangerous goods on.");
  await updateEnquiry(h.ref, patch as never, "Dangerous goods updated from the console");
}

/** The desk's papers for it, on the job. */
export async function saveDgPapers(shipmentId: string, patch: Partial<{ msds_date: string | null; dg_declaration_at: string | null; dg_line_ref: string | null }>): Promise<void> {
  const { error } = await supabase.from("shipments").update(patch).eq("id", shipmentId);
  if (error) throw new Error(error.message);
}

export async function acceptDgHouse(shipmentId: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc("accept_dg_house", { p_shipment: shipmentId, p_note: note });
  if (error) throw new Error(error.message);
}

export async function withdrawDgAcceptance(shipmentId: string): Promise<void> {
  const { error } = await supabase.from("shipments").update({ dg_accepted_at: null, dg_accepted_by: null, dg_accept_note: null }).eq("id", shipmentId);
  if (error) throw new Error(error.message);
}
