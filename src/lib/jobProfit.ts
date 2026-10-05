/**
 * The profit on a job (128): the partner's original rate against the rate the
 * customer was quoted, charge by charge.
 *
 * ---------------------------------------------------------------------------
 * HOW A CHARGE IS MATCHED
 *
 * The partner writes "O/F" and the desk writes "Ocean freight"; "THC" and
 * "Terminal handling charges" are one charge; a condition in brackets ("at
 * actuals") is not part of the name. So names are compared on a key: lower
 * case, the brackets and the words "charge(s)" and "fee(s)" dropped, and the
 * trade's usual abbreviations read as what they stand for. A charge is matched
 * first within its group (freight, ex works, destination, other), then
 * anywhere; each of the partner's charges is used once.
 *
 * HOW MUCH, ON WHAT
 *
 * Matched, both sides are counted on the quotation's quantity — the same 578
 * kilos, the same 2 containers — so the difference is the commission on what
 * the customer is charged for, not an artefact of two readings of the cargo.
 * Where the two are charged on different units (the partner per shipment, the
 * desk per kilo), each side keeps its own quantity. Everything is in rupees
 * at the rates of exchange, before GST.
 *
 * A charge only the partner has is a cost the desk carries itself; a charge
 * only the desk has is its own, all margin. A charge "at actuals" has no
 * figure on either side and counts for nothing.
 * ---------------------------------------------------------------------------
 */

export interface BuyLine {
  section?: string | null;
  description: string;
  currency: string;
  unit: string;
  quantity: number;
  rate: number;
  note?: string | null;
}

export interface SellLine {
  section?: string | null;
  description: string;
  currency: string;
  unit: string;
  quantity: number | string;
  rate: number | string;
  fx_rate: number | string;
  amount_inr: number | string;
}

export interface ProfitRow {
  name: string;
  section: string | null;
  buy: { currency: string; rate: number; unit: string; note: string | null } | null;
  sell: { currency: string; rate: number; unit: string } | null;
  quantity: number | null;
  /** In rupees before GST; null when a rate of exchange is missing. */
  buyInr: number | null;
  sellInr: number | null;
  profitInr: number | null;
  kind: "both" | "buy_only" | "sell_only";
}

export interface JobProfit {
  rows: ProfitRow[];
  buyInr: number;
  sellInr: number;
  profitInr: number;
  /** Profit over what the customer is charged; null with nothing charged. */
  margin: number | null;
  /** A partner's charge in a currency with no rate of exchange: the totals leave it out. */
  missingRoe: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** The trade's abbreviations, read as what they stand for. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\b(o\s*\/\s*f|o\.f\.?|ocean\s+freight|sea\s+freight|ocean\s+frt|sea\s+frt)\b/g, "ocean freight"],
  [/\b(a\s*\/\s*f|a\.f\.?|air\s+freight|air\s+frt)\b/g, "air freight"],
  [/\b(t\.?h\.?c|terminal\s+handling)\b/g, "thc"],
  [/\b(d\s*\/\s*o|d\.o\.?|delivery\s+order)\b/g, "do"],
  [/\b(b\s*\/\s*l|bl|bill\s+of\s+lading|documentation|docs?)\b/g, "bl"],
  [/\b(ex\s*-?\s*works|exw)\b/g, "exw"],
  [/\b(c\s*\/\s*c|customs\s+clearance|clearance)\b/g, "cc"],
  [/\b(fsc|fuel\s+surcharge)\b/g, "fsc"],
  [/\b(ssc|security\s+surcharge)\b/g, "ssc"],
  [/\b(baf|bunker(\s+adjustment(\s+factor)?)?)\b/g, "baf"],
];
const DROP = new Set(["charge", "charges", "fee", "fees", "the", "of", "per", "and"]);

/** A charge's name as compared: "O/F (at actuals)" → "ocean freight". */
export function chargeKey(description: string): string {
  let s = description.toLowerCase().replace(/\([^()]*\)/g, " ").replace(/&/g, " and ");
  for (const [re, to] of SYNONYMS) s = s.replace(re, ` ${to} `);
  const words = s.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  // "OF" and "AF" alone are the freight, as the trade writes them ("OF + EXW"); inside a name "of" is just a word.
  const bare = words.filter((w) => !["charge", "charges", "fee", "fees"].includes(w));
  if (bare.length === 1 && bare[0] === "of") return "ocean freight";
  if (bare.length === 1 && bare[0] === "af") return "air freight";
  return words.filter((w) => !DROP.has(w)).join(" ");
}

const within = (a: string, b: string) => {
  const ta = a.split(" ");
  const tb = new Set(b.split(" "));
  return ta.length > 0 && ta.every((w) => tb.has(w));
};

export function jobProfit(buy: BuyLine[], roe: Record<string, number>, sell: SellLine[]): JobProfit {
  const missing = new Set<string>();
  const inr = (currency: string, amount: number): number | null => {
    if (!amount) return 0;
    const cur = (currency || "INR").toUpperCase();
    if (cur === "INR") return round2(amount);
    const r = roe[cur];
    if (!(r > 0)) {
      missing.add(cur);
      return null;
    }
    return round2(amount * r);
  };

  const bk = buy.map((b) => ({ b, key: chargeKey(b.description), used: false }));
  const take = (pick: (x: (typeof bk)[number]) => boolean) => {
    const hit = bk.find((x) => !x.used && pick(x));
    if (hit) hit.used = true;
    return hit?.b ?? null;
  };

  const rows: ProfitRow[] = [];
  for (const s of sell) {
    const key = chargeKey(s.description);
    const sec = s.section ?? null;
    const b =
      take((x) => x.key === key && (x.b.section ?? null) === sec) ??
      take((x) => x.key === key) ??
      (key ? take((x) => !!x.key && (x.b.section ?? null) === sec && (within(x.key, key) || within(key, x.key))) : null);
    const qty = n(s.quantity);
    const sellInr = round2(n(s.amount_inr));
    let buyInr: number | null = null;
    if (b) {
      const sameUnit = (b.unit || "").toLowerCase() === (s.unit || "").toLowerCase();
      buyInr = inr(b.currency, b.rate * (sameUnit ? qty : b.quantity));
    }
    rows.push({
      name: s.description,
      section: sec,
      buy: b ? { currency: b.currency, rate: b.rate, unit: b.unit, note: b.note ?? null } : null,
      sell: { currency: s.currency, rate: n(s.rate), unit: s.unit },
      quantity: qty,
      buyInr: b ? buyInr : 0,
      sellInr,
      profitInr: b && buyInr === null ? null : round2(sellInr - (buyInr ?? 0)),
      kind: b ? "both" : "sell_only",
    });
  }
  for (const x of bk.filter((y) => !y.used)) {
    const buyInr = inr(x.b.currency, x.b.rate * x.b.quantity);
    rows.push({
      name: x.b.description,
      section: x.b.section ?? null,
      buy: { currency: x.b.currency, rate: x.b.rate, unit: x.b.unit, note: x.b.note ?? null },
      sell: null,
      quantity: x.b.quantity,
      buyInr,
      sellInr: 0,
      profitInr: buyInr === null ? null : round2(-buyInr),
      kind: "buy_only",
    });
  }

  const buyInr = round2(rows.reduce((t, r) => t + (r.buyInr ?? 0), 0));
  const sellInr = round2(rows.reduce((t, r) => t + (r.sellInr ?? 0), 0));
  const profitInr = round2(sellInr - buyInr);
  return { rows, buyInr, sellInr, profitInr, margin: sellInr > 0.005 ? profitInr / sellInr : null, missingRoe: [...missing] };
}

/** The quotation the profit is on: the accepted one, else the latest still in play (a draft or sent). */
export function profitQuoteOf<Q extends { status: string; version: number }>(quotes: Q[]): Q | null {
  return quotes.find((q) => q.status === "accepted") ?? [...quotes].filter((q) => q.status === "draft" || q.status === "sent").sort((a, b) => b.version - a.version)[0] ?? null;
}
