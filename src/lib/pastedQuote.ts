/**
 * A quotation pasted in by the desk and laid out (106).
 *
 * ---------------------------------------------------------------------------
 * WHO DOES WHAT
 *
 * The AI (classify-enquiry, mode paste_quote) reads the pasted text into
 * charges and files each under Freight, Ex works, Destination or Other
 * charges. Everything else is here, and deterministic: which values are
 * allowed, every total, a charge quoted as a share of others, and the plain
 * text the quotation keeps. A model asked to add up a quotation will sooner or
 * later add it up wrong; one asked only to copy figures out is checked line by
 * line on screen before anything is saved.
 * ---------------------------------------------------------------------------
 */
import { formatDate } from "./dates";

export type Section = "freight" | "ex_works" | "destination" | "other";

/** The groups in the order the desk sets them down, with what each is called (115). */
export const SECTIONS: Array<{ key: Section; title: string; totalLabel: string; short: string }> = [
  { key: "freight", title: "Freight Charges", totalLabel: "Freight total", short: "FRT" },
  { key: "ex_works", title: "Ex Works Charges", totalLabel: "Ex works total", short: "EXW" },
  { key: "destination", title: "Destination Charges", totalLabel: "Destination total", short: "DST" },
  { key: "other", title: "Other Charges", totalLabel: "Other charges total", short: "OTH" },
];

export const asSection = (v: unknown): Section => (SECTIONS.some((s) => s.key === v) ? (v as Section) : "other");

export interface PastedLine {
  /** This charge on the paste screen, so a charge quoted as a share of others can name them. */
  id?: string;
  section: Section;
  description: string;
  currency: string;
  unit: string;
  quantity: number;
  rate: number;
  /** A condition on the charge ("at actuals"), or the wording of a share ("3% on OF+EXW"). */
  note: string | null;
  /** GST on the charge in per cent, as quoted (115): 0 is none, null not stated. */
  gst?: number | null;
  /**
   * A charge quoted as a share of others: the per cent, and the charges (by
   * `id`) it is a share of. Its figure is worked out here (`withShares`), in
   * rupees, never read off the paste.
   */
  percent?: number | null;
  percentOf?: string[];
}

export interface PastedQuote {
  lines: PastedLine[];
  terms: string[];
  validUntil: string | null;
  /** Rupees for one unit of each foreign currency, as far as known. */
  roe: Record<string, number>;
  /** What an air rate is for, as the rate gave it (115): HEL - IST - MAA, TK, 2-3 days. */
  routing?: string | null;
  carrier?: string | null;
  transitTime?: string | null;
  /** The weight the rate states it was quoted on (`statedWeight`), over the enquiry's. */
  weightKg?: number | null;
}

export const PASTE_UNITS = ["W/M", "CBM", "Kg", "Container", "B/L", "Shipment", "Trip", "Lumpsum"];
export const PASTE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];
export const GST_RATES = [0, 5, 12, 18, 28];

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null);

/** What the AI sent back, held to the values the quotation accepts. */
export function normalisePasted(raw: unknown): PastedQuote {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawLines = (Array.isArray(r.lines) ? r.lines : []).map((x) => x as Record<string, unknown>);
  // Keyed by where the AI put them, so a share can name them before any is dropped.
  const idAt = (i: number) => `l${i + 1}`;
  const lines = rawLines
    .map((l, i): PastedLine => {
      const currency = String(l.currency ?? "INR").trim().toUpperCase().replace(/^RS\.?$/, "INR");
      const unit = PASTE_UNITS.find((u) => u.toLowerCase() === String(l.unit ?? "").trim().toLowerCase()) ?? "Lumpsum";
      const quantity = num(l.quantity);
      const gst = l.gst_rate == null || l.gst_rate === "" ? null : num(l.gst_rate);
      const percent = num(l.percent);
      const share = percent > 0 && percent <= 100;
      return {
        id: idAt(i),
        section: asSection(l.section),
        description: String(l.description ?? "").trim(),
        currency: share ? "INR" : PASTE_CURRENCIES.includes(currency) ? currency : "INR",
        unit: share && unit === "Lumpsum" ? "Shipment" : unit,
        quantity: share ? 1 : quantity > 0 ? quantity : 1,
        rate: share ? 0 : num(l.rate),
        note: (share ? text(l.rate_text) : null) ?? text(l.note),
        gst: gst !== null && gst >= 0 && gst <= 28 ? gst : null,
        percent: share ? percent : null,
        percentOf: share
          ? (Array.isArray(l.percent_of) ? l.percent_of : [])
              .map((k) => Number(k))
              .filter((k) => Number.isInteger(k) && k >= 0 && k < rawLines.length && k !== i)
              .map(idAt)
          : [],
      };
    })
    .filter((l) => l.description);
  const kept = new Set(lines.map((l) => l.id));
  for (const l of lines) if (l.percentOf?.length) l.percentOf = l.percentOf.filter((k) => kept.has(k));

  const roe: Record<string, number> = {};
  for (const x of Array.isArray(r.exchange_rates) ? r.exchange_rates : []) {
    const e = x as Record<string, unknown>;
    const c = String(e.currency ?? "").trim().toUpperCase();
    const v = num(e.inr);
    if (c && c !== "INR" && v > 0) roe[c] = v;
  }
  const valid = typeof r.valid_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.valid_until) ? r.valid_until : null;
  const terms = (Array.isArray(r.terms) ? r.terms : []).map((t) => String(t).trim()).filter(Boolean);
  return { lines, terms, validUntil: valid, roe, routing: text(r.routing), carrier: text(r.carrier), transitTime: text(r.transit_time) };
}

/** What a heading line in a pasted rate names, by its first words. */
const HEADINGS: Array<[RegExp, Section]> = [
  [/^freight$/i, "freight"],
  [/^(ex[\s.-]*works?|exw|origin|pick[\s-]*up)$/i, "ex_works"],
  [/^(destination|delivery|import)$/i, "destination"],
  [/^other$/i, "other"],
];

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A charge sits under the heading the desk put it under. Where the paste has
 * group headings of its own ("FREIGHT CHARGES :", "EX- WORKS CHARGES", on a
 * line by themselves), each charge takes the last one above it — even "EXW
 * charges" under FREIGHT CHARGES, which a model filing by the name puts back
 * under Ex works. A charge not found in the text keeps the group it was read
 * into; a paste with no headings is left as read.
 */
export function sectionsByHeading(text: string, lines: PastedLine[]): PastedLine[] {
  const rows = text.split(/\r?\n/).map((r) => r.replace(/\t+/g, " ").trim());
  // A line that is a charge's own name is that charge — "EXW CHARGES" alone on
  // a line, as a table copied as plain text puts every cell — not a heading.
  const names = new Set(lines.map((l) => words(l.description)));
  const headings = new Map<number, Section>();
  rows.forEach((r, i) => {
    const m = r.match(/^([a-z][a-z .-]*?)\s*charges?\s*:?$/i);
    const hit = m && !names.has(words(r)) && HEADINGS.find(([re]) => re.test(m[1].trim()));
    if (hit) headings.set(i, hit[1]);
  });
  if (!headings.size) return lines;
  const plain = rows.map(words);
  return lines.map((l) => {
    const name = words(l.description);
    if (!name) return l;
    const at = plain.findIndex((r, i) => !headings.has(i) && (r === name || r.startsWith(`${name} `)));
    if (at < 0) return l;
    for (let i = at - 1; i >= 0; i--) {
      const s = headings.get(i);
      if (s) return { ...l, section: s };
    }
    return l;
  });
}

/**
 * The weight a rate states it was quoted on — "GWT:578 KGS", "CHWT 600 kg",
 * "gross weight 578 kg" — the chargeable weight when both are given; null
 * when it states none.
 */
export function statedWeight(text: string): number | null {
  const find = (label: string) => {
    const m = text.match(new RegExp(`\\b(?:${label})\\s*[:.=-]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:kgs?|kilos?)\\b`, "i"));
    const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return find("ch\\.?\\s*wt|chargeable\\s*weight|c\\.?w\\.?") ?? find("g\\.?\\s*wt|gross\\s*weight|g\\.?w\\.?");
}

/**
 * A per-kg charge is charged on the weight the rate states, not the
 * enquiry's: the AI, given both, took the enquiry's 2,520 kg over the
 * sheet's "GWT:578 KGS" (1 Oct). Only a quantity that is the enquiry's own
 * weight, or a bare 1, is replaced — a count the rate gives against the
 * charge itself is left as it is.
 */
export function withStatedWeight(lines: PastedLine[], text: string, enquiryWeights: Array<number | null | undefined>): PastedLine[] {
  const kg = statedWeight(text);
  if (kg === null) return lines;
  const theirs = enquiryWeights.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return lines.map((l) =>
    l.unit === "Kg" && l.percent == null && l.quantity !== kg && (l.quantity === 1 || theirs.some((w) => Math.abs(w - l.quantity) < 0.5)) ? { ...l, quantity: kg } : l
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A charge in rupees, or null when its currency has no rate of exchange. */
export function inRupees(l: PastedLine, roe: Record<string, number>): number | null {
  const r = l.currency === "INR" ? 1 : roe[l.currency];
  return r && r > 0 ? round2(l.rate * l.quantity * r) : null;
}

/** "3% on AF charges + EXW charges" — a share's wording when the desk has changed what it is on. */
export function shareWording(l: PastedLine, lines: PastedLine[]): string {
  const names = lines.filter((x) => x.id && l.percentOf?.includes(x.id)).map((x) => x.description || "a charge");
  return `${figure(l.percent ?? 0)}% on ${names.length ? names.join(" + ") : "—"}`;
}

/**
 * The quotation with every share worked out: 3% of the rupee value of the
 * charges it names, in rupees, as one figure. A share of a share is not
 * counted (the circle has no answer), and a share of a charge with no rate of
 * exchange is left at nothing until there is one.
 */
export function withShares(q: PastedQuote): PastedQuote {
  if (!q.lines.some((l) => l.percent != null)) return q;
  return {
    ...q,
    lines: q.lines.map((l) => {
      if (l.percent == null) return l;
      const base = q.lines.filter((x) => x.percent == null && x.id && l.percentOf?.includes(x.id)).map((x) => inRupees(x, q.roe));
      const rate = base.some((v) => v === null) ? 0 : round2((base as number[]).reduce((n, v) => n + v, 0) * (l.percent ?? 0) / 100);
      return { ...l, currency: "INR", quantity: 1, rate };
    }),
  };
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

/** A share's wording, which says what its figure is ("3% on OF+EXW"). */
export const isShareNote = (note: string | null | undefined) => !!note && /^\s*\d+(\.\d+)?\s*%/.test(note);

/**
 * One charge's figure: "USD 42 per W/M × 8 = USD 336", "INR 3,500". A charge
 * with no figure and a condition ("at actuals") is the condition.
 */
export function lineValue(l: PastedLine): string {
  if (!l.rate && l.note && !isShareNote(l.note)) return l.note;
  const per = UNIT_WORD[l.unit] ?? null;
  let s = `${l.currency} ${figure(l.rate)}${per ? ` per ${per}` : ""}`;
  // A count is a count: "× 6.5", not "× 6.50" as money would be written.
  if (l.quantity !== 1) s += ` × ${l.quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 })} = ${l.currency} ${figure(l.rate * l.quantity)}`;
  return s;
}

/** The condition shown beside a charge's figure, unless the figure already is the condition. */
const noteBeside = (l: PastedLine) => (!l.rate && l.note && !isShareNote(l.note) ? null : l.note);

/** One charge as a line of the mail. */
export function lineText(l: PastedLine): string {
  const note = noteBeside(l);
  return `${l.description}: ${lineValue(l)}${note ? ` (${note})` : ""}`;
}

/** A group's total, currency by currency: "USD 2,300 + INR 1,500". */
export function sumByCurrency(lines: PastedLine[]): Array<{ currency: string; amount: number }> {
  const by = new Map<string, number>();
  for (const l of lines) by.set(l.currency, (by.get(l.currency) ?? 0) + l.rate * l.quantity);
  // Rupees first, then the rest as they first appear.
  return [...by.entries()]
    .sort(([a], [b]) => (a === "INR" ? -1 : b === "INR" ? 1 : 0))
    .map(([currency, amount]) => ({ currency, amount: round2(amount) }));
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
  return round2(t);
}

/** formatDate, not toLocaleDateString: the locale writes September as "Sept". */
function longDate(iso: string): string {
  return formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) || iso;
}

/**
 * The charges as text — kept on the quotation as the record of what the paste
 * became: each group under its heading with its total, then the whole in
 * rupees with the rates it was converted at.
 */
export function chargesText(q: PastedQuote): string {
  const c = chargesLayout(q);
  const out: string[] = [];
  for (const g of c.groups) {
    out.push(g.title);
    for (const r of g.rows) out.push(`${BULLET}${r.name}: ${r.value}${r.note ? ` (${r.note})` : ""}`);
    out.push(`${g.totalLabel}: ${g.total}`, "");
  }
  out.push(`Total: ${c.total}${c.rates ? ` (${c.rates})` : ""}`);
  return out.join("\n").trim();
}

/** One charge in the layout: its name, its figure, and a condition on it ("at actuals"). */
export interface ChargeRow {
  name: string;
  value: string;
  note: string | null;
}

export interface ChargeGroup {
  title: string;
  totalLabel: string;
  rows: ChargeRow[];
  total: string;
}

/**
 * The charges laid out once — groups, rows, totals — for both renderings:
 * the plain text above (kept on the quotation) and the mail's
 * (lib/quotationMail.ts `chargesHtml`, in the desk's own style).
 */
export interface ChargesLayout {
  groups: ChargeGroup[];
  /** "INR 2,12,005", or by currency when a rate of exchange is missing. */
  total: string;
  /** "USD at 84, AED at 22.90", when the total was converted. */
  rates: string | null;
}

export function chargesLayout(q: PastedQuote): ChargesLayout {
  const groups: ChargeGroup[] = [];
  for (const s of SECTIONS) {
    const lines = q.lines.filter((l) => l.section === s.key);
    if (!lines.length) continue;
    groups.push({
      title: s.title,
      totalLabel: s.totalLabel,
      rows: lines.map((l) => ({ name: l.description, value: lineValue(l), note: noteBeside(l) })),
      total: sumText(sumByCurrency(lines)),
    });
  }

  const inr = totalInInr(q.lines, q.roe);
  const foreign = [...new Set(q.lines.map((l) => l.currency).filter((c) => c !== "INR"))];
  if (inr !== null) {
    const at = foreign.map((c) => `${c} at ${figure(q.roe[c])}`).join(", ");
    return { groups, total: `INR ${figure(inr)}`, rates: at || null };
  }
  return { groups, total: sumText(sumByCurrency(q.lines)), rates: null };
}

/**
 * The whole quotation as laid out when it was pasted — title, charges,
 * validity, terms — kept on the quotation (`quotes.mail_text`) as the record
 * of what the paste became. An air quotation passes its table as text
 * (lib/airQuote.ts `airText`) for the charges.
 */
export function quoteText(q: PastedQuote, heading: string, charges = chargesText(q)): string {
  const out: string[] = [heading, "", charges];
  if (q.validUntil) out.push("", `Valid until ${longDate(q.validUntil)}.`);
  if (q.terms.length) {
    out.push("", "Terms");
    for (const t of q.terms) out.push(`${BULLET}${t}`);
  }
  return out.join("\n").trim();
}

const BULLET = "• ";
