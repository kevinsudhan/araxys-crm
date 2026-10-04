import { emptyContainer, emptyHbl, type HblContainer, type HblData } from "./hbl";
import { correctionsText, sameName, samePlace, type CheckRow } from "./receivedHbl";

/**
 * A console's master B/L (119): what the desk instructs the line to print,
 * the line's draft checked against it, and how the bill is released.
 *
 * ---------------------------------------------------------------------------
 * ONE INSTRUCTION, READ FROM THE JOBS
 *
 * A console's master is the line's bill for the box: Aashish as shipper, the
 * destination agent as consignee, the box(es) with their seals, and the cargo
 * said to be "consolidated cargo as per attached list" — the attached list
 * being the console's cargo manifest (lib/consoleManifest.ts). The boxes and
 * the totals are added up from the jobs on the console every time; only what
 * the desk chose — the parties, the freight terms, the wording — is kept
 * (`SiTerms`), so a house added after the instruction was written is on the
 * next one without anybody retyping it.
 *
 * THE DRAFT IS CHECKED, NOT TRUSTED
 *
 * The line's draft is read by the same reader as an agent's house B/L
 * (classify-enquiry, mode "hbl") and compared box by box: the parties, the
 * ports, every container and seal, the packages, the weight, the measure and
 * the freight. What differs becomes the mail of corrections; nothing is
 * approved while it differs unless a person says so.
 * ---------------------------------------------------------------------------
 */

export type MasterStage = "none" | "si_sent" | "draft_received" | "draft_approved" | "issued" | "released";
export type MasterRelease = "original" | "telex" | "seaway" | "ebl";

/** The stages in the order a master moves through them. */
export const MASTER_STAGES: Array<{ key: MasterStage; label: string }> = [
  { key: "none", label: "Not started" },
  { key: "si_sent", label: "SI sent" },
  { key: "draft_received", label: "Draft received" },
  { key: "draft_approved", label: "Draft approved" },
  { key: "issued", label: "Issued" },
  { key: "released", label: "Released" },
];

export const RELEASE_LABEL: Record<MasterRelease, string> = {
  original: "Original B/Ls",
  telex: "Telex release",
  seaway: "Sea waybill",
  ebl: "Electronic B/L",
};

/** What each release is evidenced by, for the reference box. */
export const RELEASE_REF_HINT: Record<MasterRelease, string> = {
  original: "Courier and airway bill the originals went by",
  telex: "The line's telex release number",
  seaway: "Nothing to send: the agent takes delivery as named consignee",
  ebl: "The eBL platform's transfer reference",
};

export const stageIndex = (s: MasterStage) => MASTER_STAGES.findIndex((x) => x.key === s);

/** What the desk chose for the instruction. Everything else is read from the console and its jobs. */
export interface SiTerms {
  shipper_name: string;
  shipper_address: string;
  consignee_name: string;
  consignee_address: string;
  notify_name: string;
  notify_address: string;
  freight_terms: "prepaid" | "collect";
  freight_payable_at: string;
  description: string;
  marks_numbers: string;
  /** Anything else for the line: "Please show the HS codes", "Clean on board". */
  remarks: string;
}

/** The console, as far as its master is concerned. */
export interface MasterConsole {
  console_no: string | null;
  direction: "export" | "import" | "cross_trade";
  carrier: string;
  carrier_booking_no: string;
  mbl_number: string | null;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  place_of_delivery: string;
  etd: string | null;
  cutoff_date: string | null;
}

/** One box on the console, added up from the jobs' container lines. */
export interface ConsoleBox {
  container_no: string;
  size_type: string;
  seal_no: string;
  packages: number;
  gross_kg: number;
  cbm: number;
  /** How many jobs have cargo in it. */
  houses: number;
}

/** A job's line for one box (shipment_containers). */
export interface JobBoxLine {
  shipment_id: string;
  container_no: string | null;
  size_type: string | null;
  seal_no: string | null;
  package_count: number | null;
  weight_kg: number | string | null;
  volume_cbm: number | string | null;
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const boxKey = (s: string | null | undefined) => up(s).replace(/[^A-Z0-9]/g, "");
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;

/**
 * The console's boxes from its jobs' container lines: one per container
 * number, its cargo added up, its size and seal from whichever job recorded
 * them. A line with no container number yet is not a box.
 */
export function boxesFrom(lines: JobBoxLine[]): ConsoleBox[] {
  const by = new Map<string, ConsoleBox & { jobs: Set<string> }>();
  for (const l of lines) {
    const key = boxKey(l.container_no);
    if (!key) continue;
    const b = by.get(key) ?? { container_no: key, size_type: "", seal_no: "", packages: 0, gross_kg: 0, cbm: 0, houses: 0, jobs: new Set<string>() };
    b.size_type ||= up(l.size_type);
    b.seal_no ||= up(l.seal_no);
    b.packages += n(l.package_count);
    b.gross_kg += n(l.weight_kg);
    b.cbm += n(l.volume_cbm);
    b.jobs.add(l.shipment_id);
    by.set(key, b);
  }
  return [...by.values()].map(({ jobs, ...b }) => ({ ...b, gross_kg: round(b.gross_kg, 3), cbm: round(b.cbm, 3), houses: jobs.size }));
}

/**
 * The instruction's starting terms for an export console: Aashish ships, the
 * destination agent receives, the agent is notified, freight prepaid at the
 * port of loading, and the cargo described as the line describes any
 * consolidator's box.
 */
export function defaultTerms(
  c: Pick<MasterConsole, "pol">,
  agent: { name: string; address: string } | null,
  company: { legalName: string; address: string[] }
): SiTerms {
  return {
    shipper_name: up(company.legalName),
    shipper_address: up(company.address.join(", ")),
    consignee_name: up(agent?.name),
    consignee_address: up(agent?.address),
    notify_name: "SAME AS CONSIGNEE",
    notify_address: "",
    freight_terms: "prepaid",
    freight_payable_at: up(c.pol),
    description: "CONSOLIDATED CARGO AS PER ATTACHED LIST",
    marks_numbers: "AS PER ATTACHED LIST",
    remarks: "",
  };
}

/** The desk's saved terms over the defaults: a term the desk never touched follows the console. */
export function termsFrom(saved: Partial<SiTerms> | null | undefined, defaults: SiTerms): SiTerms {
  const out = { ...defaults };
  for (const k of Object.keys(defaults) as Array<keyof SiTerms>) {
    const v = saved?.[k];
    if (typeof v === "string" && (k === "remarks" || v.trim())) (out as Record<string, string>)[k] = v;
  }
  return out;
}

/** The totals the instruction states: the boxes', or the houses' where no box is recorded yet. */
export interface CargoTotals {
  packages: number;
  grossKg: number;
  cbm: number;
}

/** The master B/L the desk instructs the line to issue, in the B/L's own boxes. */
export function siData(c: MasterConsole, terms: SiTerms, boxes: ConsoleBox[], houses: CargoTotals): HblData {
  const d = emptyHbl();
  d.booking_ref = up(c.carrier_booking_no);
  d.shipper_name = up(terms.shipper_name);
  d.shipper_address = up(terms.shipper_address);
  d.consignee_name = up(terms.consignee_name);
  d.consignee_address = up(terms.consignee_address);
  d.notify_name = up(terms.notify_name);
  d.notify_address = up(terms.notify_address);
  d.place_of_receipt = up(c.pol);
  d.vessel = up(c.vessel);
  d.voyage = up(c.voyage);
  d.port_of_loading = up(c.pol);
  d.port_of_discharge = up(c.pod);
  d.place_of_delivery = up(c.place_of_delivery || c.pod);
  // The line carries a full box for us: FCL to them, whatever it is to our shippers.
  d.service_type = "FCL/FCL";
  d.containers = boxes.map(
    (b): HblContainer => ({
      ...emptyContainer(),
      container_no: b.container_no,
      seal_no: b.seal_no,
      size_type: b.size_type,
      packages: b.packages ? String(b.packages) : "",
      package_type: "PACKAGES",
      gross_kg: b.gross_kg ? String(b.gross_kg) : "",
      cbm: b.cbm ? String(b.cbm) : "",
    })
  );
  const fromBoxes = boxes.length > 0 && boxes.some((b) => b.packages || b.gross_kg);
  const pkgs = fromBoxes ? boxes.reduce((s, b) => s + b.packages, 0) : houses.packages;
  const kg = fromBoxes ? round(boxes.reduce((s, b) => s + b.gross_kg, 0), 3) : houses.grossKg;
  const cbm = fromBoxes ? round(boxes.reduce((s, b) => s + b.cbm, 0), 3) : houses.cbm;
  d.marks_numbers = up(terms.marks_numbers);
  d.packages = pkgs ? String(pkgs) : "";
  d.package_type = "PACKAGES";
  d.description = up(terms.description);
  d.said_to_contain = true;
  // We stuffed and sealed it at the CFS: the line counted nothing.
  d.shippers_load = true;
  d.gross_weight_kg = kg ? String(kg) : "";
  d.measurement_cbm = cbm ? String(cbm) : "";
  d.freight_terms = terms.freight_terms;
  d.freight_payable_at = up(terms.freight_payable_at);
  return d;
}

/**
 * What stops the instruction going, in words. Said beside the button; it can
 * still be sent, because the line wants the booking's SI by its cut-off even
 * while a seal is being chased.
 */
export function siIssues(c: MasterConsole, si: HblData, boxes: ConsoleBox[], houseBillNos: string[]): string[] {
  const out: string[] = [];
  if (!up(c.carrier_booking_no)) out.push("No booking number from the line");
  if (!si.consignee_name.trim()) out.push("No consignee: appoint the overseas agent, or name one");
  if (!up(c.vessel)) out.push("No vessel");
  if (!boxes.length) out.push("No container number on any job yet");
  const noSeal = boxes.filter((b) => !b.seal_no);
  if (noSeal.length) out.push(`No seal on ${noSeal.map((b) => b.container_no).join(", ")}`);
  if (!n(si.packages)) out.push("No packages");
  if (!n(si.gross_weight_kg)) out.push("No gross weight");
  // ICEGATE 2.0 (31 Aug 2026): a house B/L may not carry the master's number.
  const mbl = boxKey(c.mbl_number);
  const clash = mbl ? houseBillNos.filter((h) => boxKey(h) === mbl) : [];
  if (clash.length) out.push(`House B/L ${clash.join(", ")} has the master's number: Customs refuses that`);
  return out;
}

/** Within half a per cent, or a kilo; within two per cent, or 0.01 CBM: a rounding is not a discrepancy. */
const closeKg = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.005);
const closeCbm = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.max(a, b) * 0.02);

/**
 * The line's draft against the instruction, box by box, every container and
 * seal among them. The same rows and states as an agent's house B/L checked
 * against a job (lib/receivedHbl.ts), so the corrections read the same way:
 * "theirs" is the draft, "ours" the instruction.
 */
export function checkMasterDraft(si: HblData, draft: HblData): CheckRow[] {
  const rows: CheckRow[] = [];
  const add = (key: string, label: string, theirs: string, ours: string, same: (a: string, b: string) => boolean) => {
    const t = theirs.trim();
    const o = ours.trim();
    if (!t && !o) return;
    rows.push({ key, label, theirs: t, ours: o, state: !t ? "missing_on_bill" : !o ? "not_on_job" : same(t, o) ? "same" : "differs" });
  };
  const ident = (a: string, b: string) => boxKey(a) === boxKey(b);
  const numeric = (close: (a: number, b: number) => boolean) => (a: string, b: string) => close(n(a), n(b));
  const notifyOf = (d: HblData) => (/^SAME AS CONSIGNEE/i.test(d.notify_name.trim()) ? d.consignee_name : d.notify_name);

  add("shipper_name", "Shipper", draft.shipper_name, si.shipper_name, sameName);
  add("consignee_name", "Consignee", draft.consignee_name, si.consignee_name, sameName);
  add("notify_name", "Notify party", notifyOf(draft), notifyOf(si), sameName);
  add("vessel", "Vessel", draft.vessel, si.vessel, sameName);
  add("voyage", "Voyage", draft.voyage, si.voyage, ident);
  add("port_of_loading", "Port of loading", draft.port_of_loading, si.port_of_loading, samePlace);
  add("port_of_discharge", "Port of discharge", draft.port_of_discharge, si.port_of_discharge, samePlace);
  add("place_of_delivery", "Place of delivery", draft.place_of_delivery, si.place_of_delivery, samePlace);

  // Every box either side has, by its number.
  const theirs = new Map(draft.containers.map((x) => [boxKey(x.container_no), x]));
  const ours = new Map(si.containers.map((x) => [boxKey(x.container_no), x]));
  for (const key of [...new Set([...ours.keys(), ...theirs.keys()])].filter(Boolean)) {
    const t = theirs.get(key);
    const o = ours.get(key);
    if (!t || !o) {
      rows.push({ key: `box:${key}`, label: `Container ${key}`, theirs: t ? key : "", ours: o ? key : "", state: t ? "not_on_job" : "missing_on_bill" });
      continue;
    }
    add(`seal:${key}`, `Seal on ${key}`, t.seal_no, o.seal_no, ident);
    add(`pkgs:${key}`, `Packages in ${key}`, t.packages, o.packages, numeric((a, b) => a === b));
    add(`kg:${key}`, `Gross kg in ${key}`, t.gross_kg, o.gross_kg, numeric(closeKg));
  }

  add("packages", "Total packages", draft.packages, si.packages, numeric((a, b) => a === b));
  add("gross_weight_kg", "Total gross weight (kg)", draft.gross_weight_kg, si.gross_weight_kg, numeric(closeKg));
  add("measurement_cbm", "Total measurement (CBM)", draft.measurement_cbm, si.measurement_cbm, numeric(closeCbm));
  add("freight_terms", "Freight", draft.freight_terms.toUpperCase(), si.freight_terms.toUpperCase(), (a, b) => a === b);
  return rows;
}

/** What a draft needs before it can be approved: nothing differing, nothing of ours missing from it. */
export const draftProblems = (rows: CheckRow[]) => rows.filter((r) => r.state === "differs" || r.state === "missing_on_bill");

/** The corrections to send the line, one line per box that is wrong or missing. Empty when the draft is right. */
export const masterCorrections = (rows: CheckRow[], mblNo: string | null) => correctionsText(rows, mblNo ?? "");

// ---------------------------------------------------------------------------
// The mail to the line
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function siSubject(c: MasterConsole): string {
  return [
    `[${c.console_no ?? "CONSOLE"}] SHIPPING INSTRUCTIONS`,
    c.carrier_booking_no && `BKG ${up(c.carrier_booking_no)}`,
    [up(c.vessel), up(c.voyage)].filter(Boolean).join(" ") || null,
    [up(c.pol), up(c.pod)].filter(Boolean).join("-") || null,
  ]
    .filter(Boolean)
    .join(" — ");
}

/** The instruction as a mail to the line: the particulars to print, the boxes, and the ask for the draft. */
export function siHtml(c: MasterConsole, si: HblData, terms: SiTerms, attached: string[]): string {
  const cell = "padding:4px 10px 4px 0;vertical-align:top;border-bottom:1px solid #e5e7eb";
  const head = "padding:4px 10px 4px 0;text-align:left;color:#555;font-weight:600;border-bottom:1px solid #cbd5e1";
  const party = (name: string, address: string) => [name, address].filter(Boolean).map(esc).join("<br>");
  const facts: Array<[string, string]> = [
    ["Booking", esc(up(c.carrier_booking_no))],
    ["Shipper", party(si.shipper_name, si.shipper_address)],
    ["Consignee", party(si.consignee_name, si.consignee_address)],
    ["Notify party", party(si.notify_name, si.notify_address)],
    ["Vessel / voyage", esc([si.vessel, si.voyage].filter(Boolean).join(" / "))],
    ["Port of loading", esc(si.port_of_loading)],
    ["Port of discharge", esc(si.port_of_discharge)],
    ["Place of delivery", esc(si.place_of_delivery)],
    ["Marks and numbers", esc(si.marks_numbers)],
    ["Description", esc(`SAID TO CONTAIN ${si.packages} ${si.package_type} ${si.description}`.replace(/\s+/g, " ").trim())],
    ["Gross weight", esc(si.gross_weight_kg ? `${si.gross_weight_kg} KGS` : "")],
    ["Measurement", esc(si.measurement_cbm ? `${si.measurement_cbm} CBM` : "")],
    ["Freight", esc(`${si.freight_terms.toUpperCase()}${si.freight_payable_at ? ` AT ${si.freight_payable_at}` : ""}`)],
    ["Clause", "SHIPPER'S LOAD, STOW, COUNT AND SEAL"],
  ];
  return (
    `<p>Dear ${esc(c.carrier || "Sir / Madam")} team,</p>` +
    `<p>Please find below our shipping instructions for booking <strong>${esc(up(c.carrier_booking_no) || "—")}</strong>, our console ${esc(c.console_no ?? "")}` +
    `${attached.length ? `, with ${attached.map(esc).join(" and ")} attached` : ""}.</p>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px">` +
    facts.filter(([, v]) => v).map(([k, v]) => `<tr><td style="${cell};color:#555;width:150px">${k}</td><td style="${cell}">${v}</td></tr>`).join("") +
    `</table>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px"><tr>` +
    ["Container", "Size / type", "Seal", "Packages", "Gross kg", "CBM"].map((h) => `<th style="${head}">${h}</th>`).join("") +
    `</tr>` +
    si.containers
      .map((b) => `<tr>${[b.container_no, b.size_type, b.seal_no, b.packages, b.gross_kg, b.cbm].map((v) => `<td style="${cell}">${esc(v)}</td>`).join("")}</tr>`)
      .join("") +
    `</table>` +
    (terms.remarks.trim() ? `<p>${esc(terms.remarks.trim())}</p>` : "") +
    `<p>Kindly send the draft master B/L for our approval before issuing.</p>`
  );
}
