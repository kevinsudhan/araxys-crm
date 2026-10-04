import { supabase } from "../lib/supabase";
import { normaliseHbl } from "../lib/hbl";
import { blanksFromCopy, type ImportConsole, type ImportStep, type MasterCopy } from "../lib/importMaster";
import type { MasterRelease } from "../lib/masterBill";
import { listBills, type Bill } from "./bills";
import type { Console } from "./consoles";
import { readBillFile } from "./masterBill";

/**
 * An import console's master B/L at this end (120): each step recorded on the
 * console when it happens. The rules are lib/importMaster.ts.
 */

export const importConsole = (c: Console): ImportConsole => ({
  console_no: c.console_no,
  carrier: c.carrier,
  mbl_number: c.mbl_number,
  mbl_date: c.mbl_date,
  vessel: c.vessel,
  voyage: c.voyage,
  pol: c.pol,
  pod: c.pod,
  eta: c.eta,
  igm_no: c.igm_no ?? "",
  igm_date: c.igm_date,
  mbl_copy_at: c.mbl_copy_at ?? null,
  mbl_release: c.mbl_release ?? null,
  release_in_hand_at: c.release_in_hand_at ?? null,
  release_in_hand_ref: c.release_in_hand_ref ?? "",
  line_invoice_no: c.line_invoice_no ?? "",
  line_charges_inr: c.line_charges_inr ?? null,
  line_paid_at: c.line_paid_at ?? null,
  line_do_no: c.line_do_no ?? "",
  line_do_at: c.line_do_at ?? null,
  line_do_valid_till: c.line_do_valid_till ?? null,
  cfs_name: c.cfs_name ?? "",
  cfs_nominated_at: c.cfs_nominated_at ?? null,
  cfs_nominated_to: c.cfs_nominated_to ?? "",
  destuffed_on: c.destuffed_on ?? null,
});

async function patch(id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("consoles").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

export const copyOf = (c: Console): MasterCopy | null => {
  const raw = c.mbl_copy as Partial<MasterCopy> | null | undefined;
  if (!raw?.bill) return null;
  return { bill: normaliseHbl(raw.bill as never), bl_no: raw.bl_no ?? "", issuer: raw.issuer ?? "", originals: raw.originals ?? null };
};

/**
 * The master's copy from the origin agent, read and kept on the console. The
 * console's blank particulars are filled from it; nothing it already says is
 * changed. How it is released is taken from the copy only when not yet said.
 */
export async function readMasterCopy(c: Console, file: File): Promise<string[]> {
  const read = await readBillFile(file, "master B/L");
  const copy: MasterCopy = { bill: read.data, bl_no: read.blNo, issuer: read.issuer, originals: read.originals };
  const { values, filled } = blanksFromCopy(importConsole(c), copy);
  const release: Record<string, unknown> = {};
  if (!c.mbl_release && read.originals) {
    release.mbl_release = "original";
    release.mbl_originals = read.originals;
  }
  await patch(c.id, { ...values, ...release, mbl_copy: copy, mbl_copy_at: new Date().toISOString() });
  return filled;
}

export const setReleasedAs = (c: Console, release: MasterRelease) =>
  patch(c.id, { mbl_release: release, mbl_originals: release === "original" ? c.mbl_originals || 3 : 0 });

export const markReleaseInHand = (c: Console, ref: string) => patch(c.id, { release_in_hand_at: new Date().toISOString(), release_in_hand_ref: ref.trim() });

export const saveLineCharges = (c: Console, invoiceNo: string, chargesInr: number | null) =>
  patch(c.id, { line_invoice_no: invoiceNo.trim(), line_charges_inr: chargesInr });

export const markLinePaid = (c: Console, invoiceNo: string, chargesInr: number | null) =>
  patch(c.id, { line_invoice_no: invoiceNo.trim(), line_charges_inr: chargesInr, line_paid_at: new Date().toISOString() });

export const markLineDo = (c: Console, doNo: string, validTill: string | null) =>
  patch(c.id, { line_do_no: doNo.trim(), line_do_valid_till: validTill || null, line_do_at: new Date().toISOString() });

/** A DO's validity extended by the line, after it was collected. */
export const saveLineDoValidity = (c: Console, validTill: string | null) => patch(c.id, { line_do_valid_till: validTill || null });

export const saveCfs = (c: Console, cfs: string) => patch(c.id, { cfs_name: cfs.trim() });

export const markCfsNominated = (c: Console, cfs: string, to: string) =>
  patch(c.id, { cfs_name: cfs.trim(), cfs_nominated_at: new Date().toISOString(), cfs_nominated_to: to });

export const markDestuffed = (c: Console, on: string) => patch(c.id, { destuffed_on: on });

/** A step recorded by mistake, taken back. Its details stay for the next time. */
export function undoStep(c: Console, step: ImportStep): Promise<void> {
  const col: Record<ImportStep, string> = {
    copy: "mbl_copy_at",
    cfs: "cfs_nominated_at",
    release: "release_in_hand_at",
    paid: "line_paid_at",
    do: "line_do_at",
    destuffed: "destuffed_on",
  };
  return patch(c.id, { [col[step]]: null });
}

/** The bills Accounts holds against this console: the line's own among them. */
export const consoleBills = (c: Console): Promise<Bill[]> => listBills({ consoleId: c.id });
