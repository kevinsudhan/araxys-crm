import { supabase } from "../lib/supabase";
import { totalInInr, type PastedLine, type PastedQuote } from "../lib/pastedQuote";
import { logEvent, type Enquiry, type Quote } from "./enquiries";
import { applyPastedQuote } from "./pasteQuote";

/**
 * The partner's original rate on an enquiry (128): pasted as it came, checked,
 * kept apart from the quotation. The profit against the quotation is
 * lib/jobProfit.ts.
 */

export interface BuyRate {
  enquiry_ref: string;
  partner_id: string | null;
  partner_label: string;
  pasted_text: string;
  lines: PastedLine[];
  roe: Record<string, number>;
  total_inr: number | null;
  updated_at: string;
}

const shape = (r: Record<string, unknown>): BuyRate => ({
  enquiry_ref: String(r.enquiry_ref),
  partner_id: (r.partner_id as string) ?? null,
  partner_label: String(r.partner_label ?? ""),
  pasted_text: String(r.pasted_text ?? ""),
  lines: Array.isArray(r.lines) ? (r.lines as PastedLine[]) : [],
  roe: (r.roe as Record<string, number>) ?? {},
  total_inr: r.total_inr === null || r.total_inr === undefined ? null : Number(r.total_inr),
  updated_at: String(r.updated_at ?? ""),
});

export async function getBuyRate(ref: string): Promise<BuyRate | null> {
  const { data, error } = await supabase.from("enquiry_buy_rates").select("*").eq("enquiry_ref", ref.toUpperCase()).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? shape(data as Record<string, unknown>) : null;
}

/** The partner's rate as checked in the paste dialog: kept, replacing the one before, and said on the timeline. */
export async function saveBuyRate(input: { enquiry: Enquiry; pasted: PastedQuote; pastedText: string; partnerId: string | null; partnerLabel: string }): Promise<BuyRate> {
  const lines = input.pasted.lines.map((l) => ({
    section: l.section,
    description: l.description.trim(),
    currency: l.currency,
    unit: l.unit,
    quantity: l.quantity,
    rate: l.rate,
    note: l.note ?? null,
    gst: l.gst ?? null,
  }));
  const total = totalInInr(lines as PastedLine[], input.pasted.roe);
  const { data, error } = await supabase
    .from("enquiry_buy_rates")
    .upsert(
      {
        enquiry_ref: input.enquiry.ref.toUpperCase(),
        partner_id: input.partnerId,
        partner_label: input.partnerLabel.trim(),
        pasted_text: input.pastedText,
        lines,
        roe: input.pasted.roe,
        total_inr: total,
      },
      { onConflict: "enquiry_ref" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await logEvent(
    input.enquiry.ref,
    "partner_rate",
    `Partner's rate pasted${input.partnerLabel.trim() ? ` from ${input.partnerLabel.trim()}` : ""}: ${lines.length} charge${lines.length === 1 ? "" : "s"}${total !== null ? `, ₹${total.toLocaleString("en-IN")}` : ""}`,
    { partner_id: input.partnerId, total_inr: total }
  ).catch(() => {});
  return shape(data as Record<string, unknown>);
}

export async function removeBuyRate(ref: string): Promise<void> {
  const { error } = await supabase.from("enquiry_buy_rates").delete().eq("enquiry_ref", ref.toUpperCase());
  if (error) throw new Error(error.message);
  await logEvent(ref, "partner_rate", "Partner's rate removed").catch(() => {});
}

/**
 * The quotation started from the partner's rate: the same charges at the same
 * figures, for the desk to put its commission on, charge by charge, in the
 * grid. A draft in hand has its charges replaced; otherwise a new version.
 */
export const quoteFromBuyRate = (enquiry: Enquiry, live: Quote | null, buy: BuyRate) =>
  applyPastedQuote({ enquiry, live, pasted: { lines: buy.lines, roe: buy.roe, terms: [], validUntil: null }, pastedText: buy.pasted_text });
