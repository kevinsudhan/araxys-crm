/**
 * The outturn of an import console (126): what came out of the box for each
 * house at destuffing, against what its B/L said — the report the origin
 * agent gets, because a carton short or wet at destination is a claim on
 * whoever packed or carried it.
 *
 * ---------------------------------------------------------------------------
 * What landed is the house's warehouse receipt (068), recorded at the CFS on
 * the day the box was opened; what was manifested is the agent's house B/L
 * (088), else the job's own figures. Pieces are compared exactly. A house
 * with nothing recorded is "not tallied", not short.
 * ---------------------------------------------------------------------------
 */

export type OutturnState = "not_tallied" | "clean" | "short" | "excess" | "damaged";

export interface OutturnHouse {
  shipmentId: string;
  ref: string;
  hblNo: string;
  consignee: string;
  manifestedPkgs: number | null;
  packageType: string;
  landedPkgs: number | null;
  landedKg: number | null;
  /** good, damaged, short, wet — from the receipts. */
  conditions: string[];
  remarks: string;
}

export function outturnState(h: OutturnHouse): OutturnState {
  if (h.landedPkgs === null) return "not_tallied";
  if (h.conditions.some((x) => x === "damaged" || x === "wet")) return "damaged";
  if (h.manifestedPkgs !== null && h.landedPkgs < h.manifestedPkgs) return "short";
  if (h.manifestedPkgs !== null && h.landedPkgs > h.manifestedPkgs) return "excess";
  if (h.conditions.includes("short")) return "short";
  return "clean";
}

export const OUTTURN_LABEL: Record<OutturnState, string> = {
  not_tallied: "Not tallied",
  clean: "Clean",
  short: "Short",
  excess: "Excess",
  damaged: "Damaged",
};

export function outturnSummary(houses: OutturnHouse[]): { tallied: number; clean: boolean; exceptions: number } {
  const states = houses.map(outturnState);
  const tallied = states.filter((s) => s !== "not_tallied").length;
  const exceptions = states.filter((s) => s === "short" || s === "excess" || s === "damaged").length;
  return { tallied, clean: tallied === houses.length && houses.length > 0 && exceptions === 0, exceptions };
}

export interface OutturnConsole {
  console_no: string | null;
  mbl_number: string | null;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  cfs_name: string;
  destuffed_on: string | null;
  containers: string[];
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function outturnSubject(c: OutturnConsole, houses: OutturnHouse[]): string {
  const s = outturnSummary(houses);
  return [`[${c.console_no ?? "CONSOLE"}] OUTTURN REPORT`, c.mbl_number && `MBL ${up(c.mbl_number)}`, s.clean ? "CLEAN" : s.exceptions ? `${s.exceptions} EXCEPTION${s.exceptions === 1 ? "" : "S"}` : null]
    .filter(Boolean)
    .join(" — ");
}

/** What the outturn still lacks, in words. */
export function outturnIssues(c: OutturnConsole, houses: OutturnHouse[]): string[] {
  const out: string[] = [];
  if (!c.destuffed_on) out.push("The box is not recorded as destuffed");
  const untallied = houses.filter((h) => outturnState(h) === "not_tallied").map((h) => h.ref);
  if (untallied.length) out.push(`Not tallied: ${untallied.join(", ")}`);
  return out;
}

export function outturnHtml(c: OutturnConsole, houses: OutturnHouse[], agent: string, attached: boolean): string {
  const cell = "padding:4px 8px 4px 0;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:12.5px";
  const head = "padding:4px 8px 4px 0;text-align:left;color:#555;font-weight:600;border-bottom:1px solid #cbd5e1;font-size:12px";
  const s = outturnSummary(houses);
  const facts = [
    ["Console", up(c.console_no)],
    ["Master B/L", up(c.mbl_number)],
    ["Vessel / voyage", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" / ")],
    ["Container", c.containers.map(up).join(", ")],
    ["Destuffed", [c.destuffed_on ?? "", up(c.cfs_name) && `at ${up(c.cfs_name)}`].filter(Boolean).join(" ")],
  ].filter(([, v]) => v);
  const rows = houses
    .map((h) => {
      const st = outturnState(h);
      const tone = st === "clean" ? "" : st === "not_tallied" ? "color:#64748b;" : "color:#b45309;font-weight:600;";
      return `<tr>${[h.hblNo || h.ref, up(h.consignee), h.manifestedPkgs === null ? "" : `${h.manifestedPkgs} ${up(h.packageType)}`.trim(), h.landedPkgs === null ? "" : String(h.landedPkgs), h.remarks]
        .map((v) => `<td style="${cell}">${esc(v || "—")}</td>`)
        .join("")}<td style="${cell};${tone}">${OUTTURN_LABEL[st]}${h.conditions.filter((x) => x !== "good").length ? ` (${esc(h.conditions.filter((x) => x !== "good").join(", "))})` : ""}</td></tr>`;
    })
    .join("");
  return (
    `<p>Dear ${esc(agent || "Partner")},</p>` +
    `<p>Please find below the outturn of our console ${esc(up(c.console_no))}${attached ? ", also attached as PDF" : ""}: ${s.clean ? "<strong>clean outturn</strong>, every house landed as manifested." : s.exceptions ? `<strong>${s.exceptions} exception${s.exceptions === 1 ? "" : "s"}</strong>, marked below.` : "the tally is not complete yet."}</p>` +
    `<table style="border-collapse:collapse;margin:6px 0 10px">${facts.map(([k, v]) => `<tr><td style="${cell};color:#555;width:130px">${k}</td><td style="${cell}">${esc(v)}</td></tr>`).join("")}</table>` +
    `<table style="border-collapse:collapse;margin:6px 0 10px"><tr>${["House B/L", "Consignee", "Manifested", "Landed", "Remarks", "Outturn"].map((x) => `<th style="${head}">${x}</th>`).join("")}</tr>${rows}</table>` +
    (s.exceptions ? `<p>Kindly take up the exceptions with the shipper and the line as needed; photographs and the CFS survey are available on request.</p>` : "")
  );
}
