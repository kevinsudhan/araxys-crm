import type { Enquiry } from "../services/enquiries";
import { SECTIONS, figure, inRupees, isShareNote, type PastedLine, type PastedQuote } from "./pastedQuote";

/**
 * A pasted air quotation, as the desk's own rate table (115).
 *
 * ---------------------------------------------------------------------------
 * The desk has always sent an air rate as one table: a line of what it is for
 *
 *   EX HEL - IST - MAA // EXW // NO OF PKGS: 1 // GWT: 578 KGS // CARRIER: TK // TT: 2-3 DAYS
 *
 * then CHARGES | CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE IN INR,
 * grouped under Freight and Destination charges, a TOTAL row, and the rate of
 * exchange. However the rate was pasted — a table, a mail, a WhatsApp line —
 * it goes out as that table.
 *
 * Every figure in it is worked out here from the charges: the rupee value at
 * the rate of exchange, the GST at the rate quoted on the charge, and the
 * totals. A charge with no figure ("at receipted") carries its wording across
 * the figure columns and counts for nothing.
 * ---------------------------------------------------------------------------
 */

export interface AirRow {
  name: string;
  /** "EUR/KG", "INR/SHPT". */
  basis: string;
  /** "3.20 × 578", "795", "3% ON OF+EXW". */
  rate: string;
  inr: number | null;
  /** The GST on it in rupees; null for none (shown as "-"). */
  gst: number | null;
  value: number | null;
  /** A charge with no figure: its wording, across the figure columns ("AT RECEIPTED"). */
  instead: string | null;
  /** A condition beside the name. */
  note: string | null;
}

export interface AirTable {
  title: string;
  groups: Array<{ title: string; rows: AirRow[] }>;
  inr: number;
  gst: number;
  value: number;
  /** The rates of exchange the rupee column was worked at. */
  roe: Array<{ currency: string; inr: number }>;
}

type JobFacts = Pick<Enquiry, "origin" | "destination" | "incoterm" | "piece_count" | "gross_weight_kg">;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2,06,600.32" — every rupee figure in the table to the paisa, so the column lines up. */
export const rupees = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const QUANTUM: Record<string, string> = {
  "W/M": "W/M",
  CBM: "CBM",
  Kg: "KG",
  Container: "CNTR",
  "B/L": "BL",
  Shipment: "SHPT",
  Trip: "TRIP",
  Lumpsum: "",
};

/** The table's first line: what the rate is for, from the paste and the enquiry. */
export function airTitle(e: JobFacts, q: Pick<PastedQuote, "lines" | "routing" | "carrier" | "transitTime" | "weightKg">): string {
  const parts: string[] = [];
  const route = q.routing
    ? q.routing.split(/\s*(?:->|→|–|—|-|>)\s*/).filter(Boolean).join(" - ")
    : [e.origin, e.destination].filter(Boolean).join(" - ");
  if (route) parts.push(`EX ${route}`);
  if (e.incoterm) parts.push(e.incoterm);
  if (e.piece_count) parts.push(`NO OF PKGS: ${e.piece_count}`);
  // The weight the rate was quoted on, where it says; the enquiry's otherwise.
  const gross = Number(q.weightKg) || Number(e.gross_weight_kg) || 0;
  if (gross) parts.push(`GWT: ${figure(gross)} KGS`);
  // The weight the freight is charged on, where it is not the gross weight.
  const kg = q.lines.find((l) => l.section === "freight" && l.unit === "Kg" && l.quantity > 1) ?? q.lines.find((l) => l.unit === "Kg" && l.quantity > 1);
  if (kg && Math.abs(kg.quantity - gross) > 0.001) parts.push(`CHWT: ${figure(kg.quantity)} KGS`);
  if (q.carrier) parts.push(`CARRIER: ${q.carrier}`);
  if (q.transitTime) parts.push(`TT: ${q.transitTime}`);
  return parts.join(" // ").toUpperCase();
}

function row(l: PastedLine, roe: Record<string, number>): AirRow {
  const name = l.description.toUpperCase();
  const basis = [l.currency, QUANTUM[l.unit] ?? ""].filter(Boolean).join("/");
  const share = isShareNote(l.note);
  if (!l.rate && l.note && !share) {
    return { name, basis, rate: "", inr: null, gst: null, value: null, instead: l.note.toUpperCase(), note: null };
  }
  const inr = inRupees(l, roe);
  const gst = inr !== null && l.gst ? round2((inr * l.gst) / 100) : null;
  const count = l.quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return {
    name,
    basis,
    rate: share ? l.note!.toUpperCase() : `${figure(l.rate)}${l.quantity !== 1 ? ` × ${count}` : ""}`,
    inr,
    gst,
    value: inr === null ? null : round2(inr + (gst ?? 0)),
    instead: null,
    note: share || !l.note ? null : l.note.toUpperCase(),
  };
}

export function airTable(q: PastedQuote, e: JobFacts): AirTable {
  const groups = SECTIONS.map((s) => ({
    title: s.title.toUpperCase(),
    rows: q.lines.filter((l) => l.section === s.key).map((l) => row(l, q.roe)),
  })).filter((g) => g.rows.length);
  const rows = groups.flatMap((g) => g.rows);
  const sum = (pick: (r: AirRow) => number | null) => round2(rows.reduce((n, r) => n + (pick(r) ?? 0), 0));
  const used = [...new Set(q.lines.filter((l) => l.rate && l.currency !== "INR").map((l) => l.currency))];
  return {
    title: airTitle(e, q),
    groups,
    inr: sum((r) => r.inr),
    gst: sum((r) => r.gst),
    value: sum((r) => r.value),
    roe: used.filter((c) => q.roe[c] > 0).map((c) => ({ currency: c, inr: q.roe[c] })),
  };
}

/** "1 EUR = INR 111.70". */
export const roeText = (r: { currency: string; inr: number }) => `1 ${r.currency} = INR ${rupees(r.inr)}`;

/** The table as text, kept on the quotation as the record of what the paste became. */
export function airText(t: AirTable): string {
  const cell = (v: number | null) => (v === null ? "-" : rupees(v));
  const out = [t.title, "", "CHARGES | CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE IN INR"];
  for (const g of t.groups) {
    out.push(g.title);
    for (const r of g.rows) {
      const name = r.note ? `${r.name} (${r.note})` : r.name;
      out.push(r.instead ? `${name} | ${r.basis} | ${r.instead}` : `${name} | ${r.basis} | ${r.rate} | ${cell(r.inr)} | ${cell(r.gst)} | ${cell(r.value)}`);
    }
  }
  out.push(`TOTAL | | | ${rupees(t.inr)} | ${rupees(t.gst)} | ${rupees(t.value)}`);
  if (t.roe.length) out.push("", t.roe.map(roeText).join(", "));
  return out.join("\n");
}
