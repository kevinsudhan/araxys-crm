/**
 * A quotation pasted in by the desk and laid out (106).
 *
 * ---------------------------------------------------------------------------
 * WHO DOES WHAT
 *
 * The AI (classify-enquiry, mode paste_quote) reads the pasted text into
 * charges and files each under Ex works or Other charges. Everything else is
 * here, and deterministic: which values are allowed, every total, and the
 * plain-text layout the mail carries. A model asked to add up a quotation will
 * sooner or later add it up wrong; one asked only to copy figures out is
 * checked line by line on screen before anything is saved.
 * ---------------------------------------------------------------------------
 */
export type Section = "ex_works" | "other";

export interface PastedLine {
  section: Section;
  description: string;
  currency: string;
  unit: string;
  quantity: number;
  rate: number;
  note: string | null;
}

export interface PastedQuote {
  lines: PastedLine[];
  terms: string[];
  validUntil: string | null;
  /** Rupees for one unit of each foreign currency, as far as known. */
  roe: Record<string, number>;
}

export const PASTE_UNITS = ["W/M", "CBM", "Kg", "Container", "B/L", "Shipment", "Trip", "Lumpsum"];
export const PASTE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** What the AI sent back, held to the values the quotation accepts. */
export function normalisePasted(raw: unknown): PastedQuote {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lines = (Array.isArray(r.lines) ? r.lines : [])
    .map((x) => x as Record<string, unknown>)
    .map((l): PastedLine => {
      const currency = String(l.currency ?? "INR").trim().toUpperCase().replace(/^RS\.?$/, "INR");
      const unit = PASTE_UNITS.find((u) => u.toLowerCase() === String(l.unit ?? "").trim().toLowerCase()) ?? "Lumpsum";
      const quantity = num(l.quantity);
      return {
        section: l.section === "ex_works" ? "ex_works" : "other",
        description: String(l.description ?? "").trim(),
        currency: PASTE_CURRENCIES.includes(currency) ? currency : "INR",
        unit,
        quantity: quantity > 0 ? quantity : 1,
        rate: num(l.rate),
        note: typeof l.note === "string" && l.note.trim() ? l.note.trim() : null,
      };
    })
    .filter((l) => l.description);
  const roe: Record<string, number> = {};
  for (const x of Array.isArray(r.exchange_rates) ? r.exchange_rates : []) {
    const e = x as Record<string, unknown>;
    const c = String(e.currency ?? "").trim().toUpperCase();
    const v = num(e.inr);
    if (c && c !== "INR" && v > 0) roe[c] = v;
  }
  const valid = typeof r.valid_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.valid_until) ? r.valid_until : null;
  const terms = (Array.isArray(r.terms) ? r.terms : []).map((t) => String(t).trim()).filter(Boolean);
  return { lines, terms, validUntil: valid, roe };
}

/** "4,500" or "1,150.50" — as the desk writes money, Indian grouping. */
export function figure(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

const UNIT_WORD: Record<string, string | null> = {
  "W/M": "W/M",
  CBM: "CBM",
  Kg: "kg",
  Container: "container",
  "B/L": "B/L",
  Shipment: null,
  Trip: "trip",
  Lumpsum: null,
};

/** One charge as a line of the mail. */
export function lineText(l: PastedLine): string {
  const per = UNIT_WORD[l.unit] ?? null;
  let s = `${l.description}: ${l.currency} ${figure(l.rate)}${per ? ` per ${per}` : ""}`;
  // A count is a count: "× 6.5", not "× 6.50" as money would be written.
  if (l.quantity !== 1) s += ` × ${l.quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 })} = ${l.currency} ${figure(l.rate * l.quantity)}`;
  if (l.note) s += ` (${l.note})`;
  return s;
}

/** A group's total, currency by currency: "USD 2,300 + INR 1,500". */
export function sumByCurrency(lines: PastedLine[]): Array<{ currency: string; amount: number }> {
  const by = new Map<string, number>();
  for (const l of lines) by.set(l.currency, (by.get(l.currency) ?? 0) + l.rate * l.quantity);
  // Rupees first, then the rest as they first appear.
  return [...by.entries()]
    .sort(([a], [b]) => (a === "INR" ? -1 : b === "INR" ? 1 : 0))
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
}

const sumText = (parts: Array<{ currency: string; amount: number }>) =>
  parts.map((p) => `${p.currency} ${figure(p.amount)}`).join(" + ");

/** The whole in rupees, when every foreign currency has a rate; null when one does not. */
export function totalInInr(lines: PastedLine[], roe: Record<string, number>): number | null {
  let t = 0;
  for (const l of lines) {
    const r = l.currency === "INR" ? 1 : roe[l.currency];
    if (!r) return null;
    t += l.rate * l.quantity * r;
  }
  return Math.round(t * 100) / 100;
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The charges as text — what the quotation letter carries in place of its
 * table for a pasted quotation: the Ex works charges under their heading with
 * their total, the other charges and theirs, then the whole in rupees with the
 * rates it was converted at. Headings and totals are set in bold
 * (`isStrongLine`); the charges are a bulleted list.
 */
export function chargesText(q: PastedQuote): string {
  const out: string[] = [];
  const group = (title: string, totalLabel: string, lines: PastedLine[]) => {
    if (!lines.length) return;
    out.push(title);
    for (const l of lines) out.push(`${BULLET}${lineText(l)}`);
    out.push(`${totalLabel}: ${sumText(sumByCurrency(lines))}`, "");
  };
  group("Ex Works Charges", "Ex works total", q.lines.filter((l) => l.section === "ex_works"));
  group("Other Charges", "Other charges total", q.lines.filter((l) => l.section === "other"));

  const inr = totalInInr(q.lines, q.roe);
  const foreign = [...new Set(q.lines.map((l) => l.currency).filter((c) => c !== "INR"))];
  if (inr !== null) {
    const at = foreign.map((c) => `${c} at ${figure(q.roe[c])}`).join(", ");
    out.push(`Total: INR ${figure(inr)}${at ? ` (${at})` : ""}`);
  } else {
    out.push(`Total: ${sumText(sumByCurrency(q.lines))}`);
  }
  return out.join("\n").trim();
}

/**
 * The whole quotation as laid out when it was pasted — title, charges,
 * validity, terms — kept on the quotation (`quotes.mail_text`) as the record
 * of what the paste became.
 */
export function quoteText(q: PastedQuote, heading: string): string {
  const out: string[] = [heading, "", chargesText(q)];
  if (q.validUntil) out.push("", `Valid until ${longDate(q.validUntil)}.`);
  if (q.terms.length) {
    out.push("", "Terms");
    for (const t of q.terms) out.push(`${BULLET}${t}`);
  }
  return out.join("\n").trim();
}

const BULLET = "• ";

/**
 * The lines of the charges text set in bold: the two headings and the totals.
 * Charges are bulleted, so none of them can be taken for one.
 */
export function isStrongLine(line: string): boolean {
  return /^(Ex Works Charges$|Other Charges$|Terms$|Ex works total:|Other charges total:|Total:)/.test(line.trim());
}
