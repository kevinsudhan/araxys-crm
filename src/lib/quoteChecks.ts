/**
 * What stops a quotation going to the customer (109) — the same list the
 * database refuses with (`quote_problems`), shown before anybody presses
 * Send for approval, Approve it myself or Email the quotation.
 *
 * A charge priced at nothing is allowed on its own ("at actuals",
 * "included"), as long as the quotation adds up to something. A foreign
 * charge left at a rate of exchange of 1 is not: that is the rate a line
 * keeps when it is switched from rupees, and it counts USD 15 as Rs 15.
 */

export interface CheckLine {
  position?: number | null;
  description: string | null;
  currency: string | null;
  fx_rate: number | string | null;
  amount_inr: number | string | null;
}

const noRate = (currency: string | null, fx: number | string | null) => {
  if ((currency || "INR") === "INR") return false;
  const r = Number(fx);
  return !Number.isFinite(r) || r <= 0 || r === 1;
};

/** A foreign line whose rate of exchange has not been given. */
export const missingRate = (l: Pick<CheckLine, "currency" | "fx_rate">) => noRate(l.currency, l.fx_rate);

export function quoteProblems(quote: { currency: string | null; fx_rate: number | string | null }, lines: CheckLine[]): string[] {
  const out: string[] = [];
  const sorted = [...lines].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  if (!sorted.length) out.push("It has no charges.");
  else if (sorted.reduce((n, l) => n + (Number(l.amount_inr) || 0), 0) <= 0) out.push("It adds up to nothing (Rs 0).");
  sorted.forEach((l, i) => {
    if (!(l.description ?? "").trim()) out.push(`Charge ${i + 1} has no name.`);
  });
  sorted.forEach((l, i) => {
    if (noRate(l.currency, l.fx_rate)) out.push(`${(l.description ?? "").trim() || `Charge ${i + 1}`} is in ${l.currency} with no rate of exchange.`);
  });
  if (noRate(quote.currency, quote.fx_rate)) out.push(`The quotation is in ${quote.currency} with no rate of exchange.`);
  return out;
}

/**
 * The rate to start a line on when it is switched to a foreign currency: the
 * one another charge on the same quotation already uses for it, so one
 * quotation does not carry two dollar rates. None known, none guessed.
 */
export function rateInUse(lines: Array<Pick<CheckLine, "currency" | "fx_rate">>, currency: string): number | null {
  for (const l of lines) if (l.currency === currency && !noRate(l.currency, l.fx_rate)) return Number(l.fx_rate);
  return null;
}
