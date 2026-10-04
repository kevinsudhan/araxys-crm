import type { HblData } from "./hbl";
import type { CargoTotals, ConsoleBox, MasterRelease } from "./masterBill";
import { sameName, samePlace, type CheckRow } from "./receivedHbl";

/**
 * An import console's master B/L at this end (120): the line's bill for the
 * box, with Aashish as its consignee, cleared with the line before any house
 * under it can be delivered.
 *
 * ---------------------------------------------------------------------------
 * SIX FACTS, IN THE ORDER THEY HAPPEN
 *
 *   1  The master's copy, from the origin agent, read and checked against
 *      the console and the houses on it.
 *   2  The CFS nominated to the line, so the box goes there on discharge.
 *   3  The release in hand: the originals received, the telex release
 *      confirmed, or the eBL transferred. A sea waybill needs none.
 *   4  The line's charges paid.
 *   5  The line's delivery order collected, valid to a date.
 *   6  The box destuffed at the CFS.
 *
 * Each is a date on the console, set when it happened, so the progress is
 * read from the console and never kept separately. A house's delivery order
 * (lib/receivedHbl.ts releaseChecklist) waits for 5 and 6 on its console.
 *
 * On a co-load (121) the master is the co-loader's B/L to us: their copy,
 * their release, their charges, their DO. Their box goes to their CFS, so
 * step 2 is noting which one, not nominating it.
 * ---------------------------------------------------------------------------
 */

/** The master's copy as read: the bill's boxes, and what is printed outside them. */
export interface MasterCopy {
  bill: HblData;
  bl_no: string;
  issuer: string;
  originals: number | null;
}

/** The console, as far as the master at this end is concerned. */
export interface ImportConsole {
  console_no: string | null;
  /** Space bought from a co-loader (121): they stand where the line does. */
  coload?: boolean;
  carrier: string;
  mbl_number: string | null;
  mbl_date: string | null;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  eta: string | null;
  igm_no: string;
  igm_date: string | null;
  mbl_copy_at: string | null;
  mbl_release: MasterRelease | null;
  release_in_hand_at: string | null;
  release_in_hand_ref: string;
  line_invoice_no: string;
  line_charges_inr: number | null;
  line_paid_at: string | null;
  line_do_no: string;
  line_do_at: string | null;
  line_do_valid_till: string | null;
  cfs_name: string;
  cfs_nominated_at: string | null;
  cfs_nominated_to: string;
  destuffed_on: string | null;
}

export type ImportStep = "copy" | "cfs" | "release" | "paid" | "do" | "destuffed";

export const IMPORT_STEPS: Array<{ key: ImportStep; label: string }> = [
  { key: "copy", label: "MBL copy" },
  { key: "cfs", label: "CFS nominated" },
  { key: "release", label: "Release in hand" },
  { key: "paid", label: "Line paid" },
  { key: "do", label: "Line's DO" },
  { key: "destuffed", label: "Destuffed" },
];

/** The steps as a co-load names them: the co-loader's B/L, their CFS, their charges, their DO. */
export const COLOAD_STEPS: Array<{ key: ImportStep; label: string }> = [
  { key: "copy", label: "Their B/L copy" },
  { key: "cfs", label: "Their CFS" },
  { key: "release", label: "Release in hand" },
  { key: "paid", label: "Co-loader paid" },
  { key: "do", label: "Their DO" },
  { key: "destuffed", label: "Destuffed" },
];

export const stepsFor = (c: Pick<ImportConsole, "coload">) => (c.coload ? COLOAD_STEPS : IMPORT_STEPS);

/** Who the master is cleared with: the line, or on a co-load the co-loader. */
export const clearedWith = (c: Pick<ImportConsole, "coload">) => (c.coload ? "the co-loader" : "the line");

/** What "in hand" means for each way the master is released, and what proves it. */
export const RELEASE_IN_HAND: Record<MasterRelease, { label: string; ref: string }> = {
  original: { label: "Original master B/Ls received from the origin agent", ref: "Courier and airway bill they came by" },
  telex: { label: "Telex release confirmed by the line", ref: "The line's telex release number" },
  seaway: { label: "Sea waybill: nothing to surrender", ref: "" },
  ebl: { label: "eBL transferred to us", ref: "The eBL platform's transfer reference" },
};

/** The same, said of the co-loader's B/L. */
export function releaseInHand(c: Pick<ImportConsole, "coload">, release: MasterRelease): { label: string; ref: string } {
  if (!c.coload) return RELEASE_IN_HAND[release];
  return {
    original: { label: "The co-loader's original B/Ls received from the origin agent", ref: "Courier and airway bill they came by" },
    telex: { label: "Telex release confirmed by the co-loader", ref: "Their telex release number" },
    seaway: RELEASE_IN_HAND.seaway,
    ebl: RELEASE_IN_HAND.ebl,
  }[release];
}

/** Each step, done or not, and when. The date is the day it was recorded. */
export function importProgress(c: ImportConsole): Record<ImportStep, { done: boolean; on: string | null }> {
  const at = (v: string | null) => ({ done: Boolean(v), on: v });
  return {
    copy: at(c.mbl_copy_at),
    cfs: at(c.cfs_nominated_at),
    // A sea waybill names its consignee: there is no title to hand over.
    release: c.mbl_release === "seaway" ? { done: true, on: null } : at(c.release_in_hand_at),
    paid: at(c.line_paid_at),
    do: at(c.line_do_at),
    destuffed: at(c.destuffed_on),
  };
}

/** The first step not done, or null when the master is cleared and the box opened. */
export function nextImportStep(c: ImportConsole): ImportStep | null {
  const p = importProgress(c);
  return IMPORT_STEPS.find((s) => !p[s.key].done)?.key ?? null;
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const key = (s: string | null | undefined) => up(s).replace(/[^A-Z0-9]/g, "");
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const closeKg = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.005);
const closeCbm = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.max(a, b) * 0.02);

/**
 * The master's copy against what we hold: the console's own particulars, the
 * boxes on its jobs, and the houses' totals. "Theirs" is the copy, "ours" the
 * console and its jobs, in the same rows as any bill checked here.
 *
 * The consignee is the row that matters most: the line gives its delivery
 * order to the master's consignee, and that has to be us.
 */
export function checkMasterCopy(c: ImportConsole, copy: MasterCopy, boxes: ConsoleBox[], houses: CargoTotals, ourName: string): CheckRow[] {
  const rows: CheckRow[] = [];
  const add = (k: string, label: string, theirs: string, ours: string, same: (a: string, b: string) => boolean) => {
    const t = theirs.trim();
    const o = ours.trim();
    if (!t && !o) return;
    rows.push({ key: k, label, theirs: t, ours: o, state: !t ? "missing_on_bill" : !o ? "not_on_job" : same(t, o) ? "same" : "differs" });
  };
  const ident = (a: string, b: string) => key(a) === key(b);
  const figure = (v: number) => (v ? String(v) : "");
  const b = copy.bill;

  add("mbl", "Master B/L no", copy.bl_no, c.mbl_number ?? "", ident);
  add("consignee", "Consignee", b.consignee_name, ourName, sameName);
  add("vessel", "Vessel", b.vessel, c.vessel, sameName);
  add("voyage", "Voyage", b.voyage, c.voyage, ident);
  add("pol", "Port of loading", b.port_of_loading, c.pol, samePlace);
  add("pod", "Port of discharge", b.port_of_discharge, c.pod, samePlace);

  // Every box either side has, and its seal: the CFS checks the seal before it opens the box.
  const theirs = new Map(b.containers.map((x) => [key(x.container_no), x]));
  const ours = new Map(boxes.map((x) => [key(x.container_no), x]));
  for (const k of [...new Set([...theirs.keys(), ...ours.keys()])].filter(Boolean)) {
    const t = theirs.get(k);
    const o = ours.get(k);
    if (!t || !o) {
      rows.push({ key: `box:${k}`, label: `Container ${k}`, theirs: t ? k : "", ours: o ? k : "", state: t ? "not_on_job" : "missing_on_bill" });
      continue;
    }
    add(`seal:${k}`, `Seal on ${k}`, t.seal_no, o.seal_no, ident);
  }

  add("packages", "Total packages", b.packages, figure(houses.packages), (x, y) => n(x) === n(y));
  add("kg", "Total gross weight (kg)", b.gross_weight_kg, figure(houses.grossKg), (x, y) => closeKg(n(x), n(y)));
  add("cbm", "Total measurement (CBM)", b.measurement_cbm, figure(houses.cbm), (x, y) => closeCbm(n(x), n(y)));
  return rows;
}

/** Said beside the copy: what the line or Customs will stop on. */
export function copyIssues(c: ImportConsole, copy: MasterCopy, houseBillNos: string[], ourName: string): string[] {
  const out: string[] = [];
  const consignee = copy.bill.consignee_name.trim();
  const who = clearedWith(c);
  if (!consignee) out.push("The copy shows no consignee");
  else if (/^TO ORDER/i.test(consignee)) out.push(`The master is consigned "${consignee}": ${who} wants it endorsed to us before it gives the DO`);
  else if (!sameName(consignee, ourName)) out.push(`The master names ${consignee} as consignee, not us: ${who} gives its DO only to the consignee`);
  // ICEGATE 2.0 (31 Aug 2026): a house B/L may not carry the master's number.
  const mbl = key(copy.bl_no || c.mbl_number);
  const clash = mbl ? houseBillNos.filter((h) => key(h) === mbl) : [];
  if (clash.length) out.push(`House B/L ${clash.join(", ")} has the master's number: Customs refuses that`);
  if (copy.bill.freight_terms === "collect") out.push(`Freight collect: the freight is paid to ${who} here, with its charges`);
  if (!c.mbl_release) out.push("Say how the master is released: originals, telex, sea waybill or eBL");
  return out;
}

/** The console's blanks the copy can fill. Nothing the console already says is changed. */
export function blanksFromCopy(c: ImportConsole, copy: MasterCopy): { values: Record<string, string>; filled: string[] } {
  const values: Record<string, string> = {};
  const filled: string[] = [];
  const fill = (col: string, label: string, ours: string | null, theirs: string) => {
    if (!(ours ?? "").trim() && theirs.trim()) {
      values[col] = theirs.trim();
      filled.push(label);
    }
  };
  fill("mbl_number", "MBL number", c.mbl_number, copy.bl_no);
  fill("mbl_date", "MBL date", c.mbl_date, copy.bill.date_of_issue ?? "");
  fill("carrier", "carrier", c.carrier, copy.issuer);
  fill("vessel", "vessel", c.vessel, copy.bill.vessel);
  fill("voyage", "voyage", c.voyage, copy.bill.voyage);
  fill("pol", "port of loading", c.pol, copy.bill.port_of_loading);
  fill("pod", "port of discharge", c.pod, copy.bill.port_of_discharge);
  return { values, filled };
}

/** How the line's DO stands: none yet, good for some days, or lapsed with the box still unopened. */
export function lineDoState(c: Pick<ImportConsole, "line_do_at" | "line_do_valid_till" | "destuffed_on">, today: string): { state: "none" | "valid" | "last_day" | "expired" | "used"; days: number | null } {
  if (!c.line_do_at) return { state: "none", days: null };
  if (c.destuffed_on) return { state: "used", days: null };
  if (!c.line_do_valid_till) return { state: "valid", days: null };
  const days = Math.round((Date.parse(`${c.line_do_valid_till.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { state: days < 0 ? "expired" : days === 0 ? "last_day" : "valid", days };
}

// ---------------------------------------------------------------------------
// The CFS nomination to the line
// ---------------------------------------------------------------------------

/** What the letter needs before the line can act on it. Said beside the buttons; it can still go. */
export function cfsIssues(c: ImportConsole, cfs: string, boxes: ConsoleBox[]): string[] {
  const out: string[] = [];
  if (!cfs.trim()) out.push("Name the CFS");
  if (!up(c.mbl_number)) out.push("No master B/L number");
  if (!boxes.length) out.push("No container number on any job yet");
  if (!up(c.igm_no)) out.push("No IGM number yet: the line may ask for it");
  return out;
}

export function cfsSubject(c: ImportConsole): string {
  return [
    `[${c.console_no ?? "CONSOLE"}] CFS NOMINATION`,
    c.mbl_number && `MBL ${up(c.mbl_number)}`,
    [up(c.vessel), up(c.voyage)].filter(Boolean).join(" ") || null,
    c.igm_no && `IGM ${up(c.igm_no)}`,
  ]
    .filter(Boolean)
    .join(" — ");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The nomination as the line reads it: which bill, which boxes, which CFS, and the ask. */
export function cfsHtml(c: ImportConsole, boxes: ConsoleBox[], cfs: string, ourName: string, attached: boolean): string {
  const cell = "padding:4px 10px 4px 0;vertical-align:top;border-bottom:1px solid #e5e7eb";
  const head = "padding:4px 10px 4px 0;text-align:left;color:#555;font-weight:600;border-bottom:1px solid #cbd5e1";
  const facts: Array<[string, string]> = [
    ["Master B/L", [up(c.mbl_number), c.mbl_date ?? ""].filter(Boolean).join(" dated ")],
    ["Vessel / voyage", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" / ")],
    ["IGM", [up(c.igm_no), c.igm_date ?? ""].filter(Boolean).join(" dated ")],
    ["Port of loading", up(c.pol)],
    ["Port of discharge", up(c.pod)],
    ["Nominated CFS", up(cfs)],
  ];
  return (
    `<p>Dear ${esc(c.carrier || "Sir / Madam")} team,</p>` +
    `<p>We, ${esc(ourName)}, consignee of the master B/L below, nominate <strong>${esc(up(cfs) || "—")}</strong> for the movement and destuffing of the container${boxes.length === 1 ? "" : "s"} under it${attached ? ". Our letter is attached" : ""}.</p>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px">` +
    facts.filter(([, v]) => v).map(([k, v]) => `<tr><td style="${cell};color:#555;width:150px">${k}</td><td style="${cell}">${esc(v)}</td></tr>`).join("") +
    `</table>` +
    (boxes.length
      ? `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px"><tr>` +
        ["Container", "Size / type", "Seal"].map((h) => `<th style="${head}">${h}</th>`).join("") +
        `</tr>` +
        boxes.map((b) => `<tr>${[b.container_no, b.size_type, b.seal_no].map((v) => `<td style="${cell}">${esc(v || "—")}</td>`).join("")}</tr>`).join("") +
        `</table>`
      : "") +
    `<p>Kindly move the container${boxes.length === 1 ? "" : "s"} to the above CFS on discharge and issue the delivery order in its favour.</p>`
  );
}
