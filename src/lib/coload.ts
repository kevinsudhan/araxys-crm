/**
 * A console on space bought from another consolidator (121): what the space
 * should cost at their rate, what they have billed, and the booking request.
 *
 * ---------------------------------------------------------------------------
 * W/M, AS A CO-LOADER CHARGES IT
 *
 * LCL space is sold "weight or measure": per cubic metre or per tonne,
 * whichever is more, with a minimum. Our houses go to the co-loader as one
 * consignment under one of their bills, so the W/M is the houses' total, and
 * the minimum applies once. Everything else they bill (their B/L fee, THC,
 * CFS) is on their invoice, which is the cost; the rate is what the freight
 * part of it should come to.
 * ---------------------------------------------------------------------------
 */

export interface ColoadTerms {
  coloader: string;
  rate: number | null;
  currency: string;
  minWm: number;
}

export interface ColoadConsole {
  console_no: string | null;
  carrier_booking_no: string;
  pol: string;
  pod: string;
  place_of_delivery: string;
  etd: string | null;
  vessel: string;
  voyage: string;
}

export interface Cargo {
  bills: number;
  packages: number;
  grossKg: number;
  cbm: number;
}

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Weight or measure: the cubic metres or the tonnes, whichever is more. */
export const wmOf = (cbm: number, kg: number) => round(Math.max(cbm || 0, (kg || 0) / 1000), 3);

/** The freight the rate comes to on these houses, or null while there is no rate. */
export function coloadFreight(t: ColoadTerms, cargo: Pick<Cargo, "cbm" | "grossKg">): { wm: number; charged: number; amount: number } | null {
  const wm = wmOf(cargo.cbm, cargo.grossKg);
  if (t.rate === null || !Number.isFinite(t.rate)) return null;
  const charged = Math.max(t.minWm || 0, wm);
  return { wm, charged, amount: round(charged * t.rate, 2) };
}

/** A bill against the console, as far as the co-loader's cost is concerned. */
export interface ConsoleBill {
  partner_id: string;
  kind: string;
  status: string;
  currency: string;
  total_amount: number | string;
  total_inr: number | string;
}

/**
 * What the co-loader has billed on this console: in their currencies, and in
 * rupees. A credit note takes off; a cancelled bill counts for nothing.
 */
export function coloaderBilled(bills: ConsoleBill[], coloaderId: string | null): { count: number; byCurrency: Record<string, number>; inr: number } {
  const mine = bills.filter((b) => coloaderId && b.partner_id === coloaderId && b.status !== "cancelled");
  const byCurrency: Record<string, number> = {};
  let inr = 0;
  for (const b of mine) {
    const sign = b.kind === "agent_credit_note" ? -1 : 1;
    const cur = up(b.currency) || "INR";
    byCurrency[cur] = round((byCurrency[cur] ?? 0) + sign * Number(b.total_amount || 0), 2);
    inr = round(inr + sign * Number(b.total_inr || 0), 2);
  }
  return { count: mine.length, byCurrency, inr };
}

/** What the booking still needs, in words. */
export function coloadIssues(t: ColoadTerms & { coloaderId: string | null; email: string }, c: ColoadConsole, cargo: Cargo): string[] {
  const out: string[] = [];
  if (!t.coloaderId) out.push("Choose the co-loader");
  else if (!t.email) out.push("The co-loader has no email on the partner directory");
  if (t.rate === null) out.push("No rate per W/M");
  if (!up(c.pol) || !up(c.pod)) out.push("No route");
  if (!cargo.bills) out.push("No cargo on the console yet");
  return out;
}

export function bookingSubject(c: ColoadConsole, cargo: Cargo): string {
  return [
    `[${c.console_no ?? "CONSOLE"}] LCL BOOKING REQUEST`,
    [up(c.pol), up(c.place_of_delivery || c.pod)].filter(Boolean).join("-") || null,
    c.etd ? `ETD ${c.etd}` : null,
    cargo.cbm ? `${round(cargo.cbm, 3)} CBM` : null,
  ]
    .filter(Boolean)
    .join(" — ");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const figure = (n: number, dp: number) => n.toLocaleString("en-IN", { maximumFractionDigits: dp });

/**
 * The request to the co-loader: the lane, the sailing wanted, the cargo as one
 * consignment, the rate agreed, and the ask for their booking number.
 */
export function bookingHtml(c: ColoadConsole, t: ColoadTerms, cargo: Cargo, goods: string[], agent: string): string {
  const cell = "padding:4px 10px 4px 0;vertical-align:top;border-bottom:1px solid #e5e7eb";
  const facts: Array<[string, string]> = [
    ["Port of loading", up(c.pol)],
    ["Port of discharge", up(c.pod)],
    ["Place of delivery", up(c.place_of_delivery)],
    ["Sailing", [c.etd ? `ETD ${c.etd}` : "", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" ")].filter(Boolean).join(" · ")],
    ["Packages", cargo.packages ? figure(cargo.packages, 0) : ""],
    ["Gross weight", cargo.grossKg ? `${figure(cargo.grossKg, 3)} KGS` : ""],
    ["Measurement", cargo.cbm ? `${figure(cargo.cbm, 3)} CBM` : ""],
    ["Commodity", goods.map(up).filter(Boolean).join("; ")],
    ["Consignee", up(agent)],
    ["Rate", t.rate !== null ? `${up(t.currency)} ${figure(t.rate, 2)} PER W/M${t.minWm ? `, MINIMUM ${figure(t.minWm, 3)} W/M` : ""}` : ""],
  ];
  return (
    `<p>Dear ${esc(t.coloader || "Sir / Madam")} team,</p>` +
    `<p>Please book LCL space for our console ${esc(c.console_no ?? "")} as below, shipper ourselves and consignee our agent at destination.</p>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px">` +
    facts.filter(([, v]) => v).map(([k, v]) => `<tr><td style="${cell};color:#555;width:150px">${k}</td><td style="${cell}">${esc(v)}</td></tr>`).join("") +
    `</table>` +
    `<p>Kindly confirm with your booking number, the cut-off and the CFS for delivery of the cargo.</p>`
  );
}
