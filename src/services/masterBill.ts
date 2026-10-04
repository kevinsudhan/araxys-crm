import { supabase } from "../lib/supabase";
import { billFromReading, type BillReading } from "../lib/receivedHbl";
import { normaliseHbl, type HblData } from "../lib/hbl";
import { boxesFrom, stageIndex, type ConsoleBox, type JobBoxLine, type MasterConsole, type MasterRelease, type MasterStage, type SiTerms } from "../lib/masterBill";
import type { ManifestLine } from "../lib/consoleManifest";
import { listPartners } from "./partners";
import { manifestFor } from "./consoleManifest";
import type { Console } from "./consoles";

/**
 * A console's master B/L with the line (119): what it is built from, and each
 * step recorded on the console. The rules are lib/masterBill.ts.
 */

export const masterConsole = (c: Console): MasterConsole => ({
  console_no: c.console_no,
  direction: c.direction,
  carrier: c.carrier,
  carrier_booking_no: c.carrier_booking_no ?? "",
  mbl_number: c.mbl_number,
  vessel: c.vessel,
  voyage: c.voyage,
  pol: c.pol,
  pod: c.pod,
  place_of_delivery: c.place_of_delivery,
  etd: c.etd,
  cutoff_date: c.cutoff_date,
});

export interface MasterInputs {
  /** The house bills under the console (the manifest's lines): the attached list. */
  lines: ManifestLine[];
  provisional: boolean;
  boxes: ConsoleBox[];
  agent: { name: string; address: string; email: string } | null;
  /** Where the instruction goes: the line's contact on the partner directory, when the console names one. */
  carrierEmail: string;
  houseBillNos: string[];
}

export async function masterFor(c: Console): Promise<MasterInputs> {
  const [manifest, partners] = await Promise.all([manifestFor(c), listPartners(true).catch(() => [])]);
  const ids = manifest.lines.map((l) => l.shipmentId);
  const { data, error } = ids.length
    ? await supabase.from("shipment_containers").select("shipment_id, container_no, size_type, seal_no, package_count, weight_kg, volume_cbm").in("shipment_id", ids)
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const agent = partners.find((p) => p.id === c.agent_id);
  const carrier = partners.find((p) => p.id === c.carrier_id);
  return {
    lines: manifest.lines,
    provisional: manifest.provisional,
    boxes: boxesFrom((data ?? []) as JobBoxLine[]),
    agent: agent ? { name: agent.organisation || agent.name, address: agent.address ?? "", email: agent.emails[0] ?? "" } : null,
    carrierEmail: carrier?.emails[0] ?? "",
    houseBillNos: manifest.lines.map((l) => l.hblNo).filter(Boolean),
  };
}

async function patch(id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("consoles").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

/** The stage to record: never behind where the master already is. */
const forward = (current: MasterStage, to: MasterStage): MasterStage => (stageIndex(to) > stageIndex(current) ? to : current);

export const saveBookingNo = (c: Console, bookingNo: string) => patch(c.id, { carrier_booking_no: bookingNo.trim() });

/** What the desk chose for the instruction: parties, freight, wording. */
export const saveSiTerms = (c: Console, terms: SiTerms) => patch(c.id, { mbl_si: terms });

export const markSiSent = (c: Console, to: string) =>
  patch(c.id, { mbl_stage: forward(c.mbl_stage ?? "none", "si_sent"), si_sent_at: new Date().toISOString(), si_sent_to: to });

/** A master B/L's PDF or picture, read by the house B/L reader (classify-enquiry, mode "hbl"). */
export async function readBillFile(file: File, what: string): Promise<ReturnType<typeof billFromReading>> {
  const types = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!types.includes(file.type)) throw new Error(`Send the ${what} as a PDF, or a JPG, PNG or WebP picture of it.`);
  if (file.size > 7 * 1024 * 1024) throw new Error("That file is over 7 MB, too large to read. A smaller scan will do.");
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("The file could not be read."));
    r.readAsDataURL(file);
  });
  const { data, error } = await supabase.functions.invoke("classify-enquiry", { body: { mode: "hbl", file_base64: base64, file_mime: file.type } });
  if (error) throw new Error(error.message);
  const r = data as BillReading & { error?: string };
  if (r.error) throw new Error(r.error);
  if (r.is_bill_of_lading === false) throw new Error("That does not look like a bill of lading.");
  return billFromReading(r);
}

/**
 * The line's draft, read as an agent's house B/L is and kept on the console
 * to check against the instruction. Nothing is approved by reading it.
 */
export async function readMasterDraft(c: Console, file: File): Promise<HblData> {
  const draft = (await readBillFile(file, "draft")).data;
  await patch(c.id, { mbl_draft: draft, mbl_draft_at: new Date().toISOString(), mbl_stage: forward(c.mbl_stage ?? "none", "draft_received") });
  return draft;
}

export const draftOf = (c: Console): HblData | null => (c.mbl_draft ? normaliseHbl(c.mbl_draft as never) : null);

export const approveDraft = (c: Console) =>
  patch(c.id, { mbl_stage: forward(c.mbl_stage ?? "none", "draft_approved"), mbl_draft_approved_at: new Date().toISOString() });

/** The line has issued it: its number and date, and how it is released. */
export const markIssued = (c: Console, input: { mblNumber: string; mblDate: string | null; release: MasterRelease; originals: number | null }) =>
  patch(c.id, {
    mbl_number: input.mblNumber.trim() || null,
    mbl_date: input.mblDate || null,
    mbl_release: input.release,
    mbl_originals: input.release === "original" ? input.originals ?? 3 : 0,
    mbl_stage: forward(c.mbl_stage ?? "none", "issued"),
  });

/** Released to the destination agent: the courier, the telex release or the eBL transfer, by its reference. */
export const markReleased = (c: Console, ref: string) =>
  patch(c.id, { mbl_release_ref: ref.trim(), mbl_released_at: new Date().toISOString(), mbl_stage: forward(c.mbl_stage ?? "none", "released") });
