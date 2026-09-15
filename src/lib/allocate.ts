/**
 * Spreading a receipt over what is owed.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS IN lib/
 *
 * `services/receipts.ts` builds the Supabase client at import time and cannot
 * load under plain Node, and this is arithmetic on money — the one thing in the
 * receipt screen most worth a test. Same split as containerNo.ts and
 * applyPlan.ts.
 * ---------------------------------------------------------------------------
 */

/** Only what the spread needs: which invoice, and how much is left on it. */
export interface Owed {
  invoice_id: string;
  outstanding: number;
}

/**
 * Apply an amount to invoices, oldest first, never more than each one is short.
 *
 * The reference system has this as an "Autofill" button you must notice and
 * press. It is the right idea badly placed: oldest-first is what happens ninety
 * nine times in a hundred, and typing it line by line is a way of making
 * arithmetic mistakes on somebody's ledger.
 *
 * Rounds each line to paise. Rounding per line rather than at the end is what
 * keeps the printed lines adding up to the printed total — and because each
 * line is capped at what that invoice is short, rounding can never push a line
 * past the debt it settles.
 *
 * Anything left when the invoices run out is not returned anywhere: it stays on
 * the receipt as an advance, which is a position rather than a remainder.
 */
export function spreadOldestFirst(
  amount: number,
  invoices: Owed[]
): { invoice_id: string; amount: number }[] {
  let left = Math.round(amount * 100) / 100;
  const out: { invoice_id: string; amount: number }[] = [];

  for (const inv of invoices) {
    if (left <= 0) break;
    const short = Math.round(Math.max(inv.outstanding, 0) * 100) / 100;
    if (short <= 0) continue;

    const take = Math.round(Math.min(left, short) * 100) / 100;
    out.push({ invoice_id: inv.invoice_id, amount: take });
    left = Math.round((left - take) * 100) / 100;
  }

  return out;
}

/** What would be left sitting on account after that spread. */
export function remainderAfter(amount: number, invoices: Owed[]): number {
  const used = spreadOldestFirst(amount, invoices).reduce((t, a) => t + a.amount, 0);
  return Math.round((amount - used) * 100) / 100;
}
