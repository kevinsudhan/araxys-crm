import { supabase } from "../lib/supabase";
import { shared } from "../lib/queryCache";

/**
 * The charges a quotation is built from.
 *
 * ---------------------------------------------------------------------------
 * WHY A QUOTE HAS LINES AT ALL
 *
 * Because it becomes an invoice, and an invoice has lines. Typing one figure
 * into the quote and then typing the breakdown again at billing is how the two
 * end up disagreeing — and it is why "what is the 62,000 made of" had no answer
 * anywhere in this system.
 *
 * THE COST SITS BESIDE THE SELL, NOT INSTEAD OF IT
 *
 * `cost_inr` is what a partner quoted us for that charge. It is recorded on the
 * line so the margin is visible while the quotation is being built, which is
 * the only moment anybody can do anything about it. It is never copied into
 * `rate`: a partner's figure is a buying price, and putting one in front of a
 * customer sends the agent's cost to the shipper.
 * ---------------------------------------------------------------------------
 */

export interface QuoteLine {
  id: string;
  quote_id: string;
  position: number;
  description: string;
  sac_code: string | null;
  quantity: number;
  unit: string;
  rate: number;
  currency: string;
  fx_rate: number;
  amount: number;
  amount_inr: number;
  /** The code the desk quotes against — ADO, CDO, ASFRT. */
  charge_code: string | null;
  /** The floor for this charge, in the line's own currency. */
  min_amount: number | null;

  /* The buying side, in the currency it was bought in (055). */
  cost_currency: string;
  cost_fx_rate: number;
  /** Cost per unit in `cost_currency`. `cost_inr` is derived from it. */
  cost_rate: number | null;
  /** Who the cost is with. Free text: not every vendor is in the partner book. */
  vendor: string | null;

  /** What this charge costs us in rupees. Derived when a cost rate is given. */
  cost_inr: number | null;
  partner_quote_id: string | null;
  /** Its group on a pasted quotation (106, 115); the PDF and the mail group by it. */
  section?: "freight" | "ex_works" | "destination" | "other" | null;
  /** GST in per cent as quoted (115): 0 none, null not stated (an invoice then charges 18). */
  gst_rate?: number | null;
  created_at: string;
}

export async function linesFor(quoteId: string): Promise<QuoteLine[]> {
  // The quotation panel, its grid, its send and the profit card read it at once: one trip (lib/queryCache).
  return shared(`quote_lines:${quoteId}`, async () => {
    const { data, error } = await supabase
      .from("quote_lines")
      .select("*")
      .eq("quote_id", quoteId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as QuoteLine[];
  });
}

export async function addLine(
  quoteId: string,
  line: Partial<Omit<QuoteLine, "id" | "quote_id" | "amount" | "amount_inr" | "created_at">>
): Promise<void> {
  const { error } = await supabase.from("quote_lines").insert({ quote_id: quoteId, ...line });
  if (error) throw new Error(error.message);
}

/** Several lines in one request, in the order given. */
export async function addLines(
  quoteId: string,
  lines: Array<Partial<Omit<QuoteLine, "id" | "quote_id" | "amount" | "amount_inr" | "created_at">>>
): Promise<void> {
  if (!lines.length) return;
  const { error } = await supabase.from("quote_lines").insert(lines.map((line) => ({ quote_id: quoteId, ...line })));
  if (error) throw new Error(error.message);
}

export async function updateLine(
  id: string,
  patch: Partial<Omit<QuoteLine, "id" | "quote_id" | "amount" | "amount_inr" | "created_at">>
): Promise<void> {
  const { error } = await supabase.from("quote_lines").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeLine(id: string): Promise<void> {
  const { error } = await supabase.from("quote_lines").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Sell, cost and what is left — computed here so the panel can show it live. */
export function summarise(lines: QuoteLine[]) {
  const sell = lines.reduce((t, l) => t + Number(l.amount_inr || 0), 0);
  const cost = lines.reduce((t, l) => t + Number(l.cost_inr ?? 0), 0);
  const costed = lines.filter((l) => l.cost_inr !== null).length;
  return {
    sell,
    cost,
    margin: sell - cost,
    /** Null until at least one line has a cost against it. */
    pct: costed === 0 || sell === 0 ? null : Math.round(((sell - cost) / sell) * 1000) / 10,
    costed,
    uncosted: lines.length - costed,
  };
}

/**
 * A sent quotation's next revision (118): the same charges, terms and
 * settings as a draft, the sent one superseded — made by the first change to
 * its charges. `lines` maps each sent charge's id to its copy's, so that
 * change lands on the copy. Asked again, it answers the draft already made.
 */
export async function reviseQuote(quoteId: string): Promise<{ quoteId: string; lines: Record<string, string> }> {
  const { data, error } = await supabase.rpc("revise_quote", { p_quote: quoteId });
  if (error) throw new Error(error.message);
  const d = data as { quote_id: string; lines: Record<string, string> | null };
  return { quoteId: d.quote_id, lines: d.lines ?? {} };
}
