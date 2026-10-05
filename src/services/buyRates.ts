import { supabase } from "../lib/supabase";
import { mergeBuyLines, pasteSummary, type PasteEntry, type StoredBuyLine } from "../lib/buyRate";
import { asSection, totalInInr, type PastedLine, type PastedQuote } from "../lib/pastedQuote";
import { logEvent, type Enquiry, type Quote } from "./enquiries";
import { applyPastedQuote } from "./pasteQuote";

/**
 * The partner's original rate on an enquiry (128, 129): built up from every
 * paste — a revised charge updated, a new one added — and kept apart from
 * the quotation. The merging is lib/buyRate.ts; the profit against the
 * quotation is lib/jobProfit.ts.
 */

export interface BuyRate {
  enquiry_ref: string;
  partner_id: string | null;
  /** Who the last paste was from. Each charge says its own (`from`). */
  partner_label: string;
  pasted_text: string;
  lines: StoredBuyLine[];
  roe: Record<string, number>;
  total_inr: number | null;
  /** Every paste, oldest first. */
  history: PasteEntry[];
  updated_at: string;
}

const shape = (r: Record<string, unknown>): BuyRate => ({
  enquiry_ref: String(r.enquiry_ref),
  partner_id: (r.partner_id as string) ?? null,
  partner_label: String(r.partner_label ?? ""),
  pasted_text: String(r.pasted_text ?? ""),
  lines: Array.isArray(r.lines) ? (r.lines as StoredBuyLine[]) : [],
  roe: (r.roe as Record<string, number>) ?? {},
  total_inr: r.total_inr === null || r.total_inr === undefined ? null : Number(r.total_inr),
  history: Array.isArray(r.history) ? (r.history as PasteEntry[]) : [],
  updated_at: String(r.updated_at ?? ""),
});

export async function getBuyRate(ref: string): Promise<BuyRate | null> {
  const { data, error } = await supabase.from("enquiry_buy_rates").select("*").eq("enquiry_ref", ref.toUpperCase()).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? shape(data as Record<string, unknown>) : null;
}

async function write(ref: string, values: Record<string, unknown>): Promise<BuyRate> {
  const { data, error } = await supabase
    .from("enquiry_buy_rates")
    .upsert({ enquiry_ref: ref.toUpperCase(), ...values }, { onConflict: "enquiry_ref" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return shape(data as Record<string, unknown>);
}

/**
 * A paste from a partner, added to the original rate: a charge already there
 * updated, a new one added, the rest as it was — or, when said, the whole
 * rate replaced. Said on the timeline.
 */
export async function addToBuyRate(input: {
  enquiry: Enquiry;
  pasted: PastedQuote;
  pastedText: string;
  partnerId: string | null;
  partnerLabel: string;
  replaceAll?: boolean;
}): Promise<BuyRate> {
  const before = await getBuyRate(input.enquiry.ref);
  const incoming = input.pasted.lines.map((l) => ({
    section: l.section,
    description: l.description.trim(),
    currency: l.currency,
    unit: l.unit,
    quantity: l.quantity,
    rate: l.rate,
    note: l.note ?? null,
    gst: l.gst ?? null,
  }));
  const from = input.partnerLabel.trim();
  const { lines, entry } = mergeBuyLines(before?.lines ?? [], incoming, { from, at: new Date().toISOString(), pastedText: input.pastedText.slice(0, 8000) }, Boolean(input.replaceAll));
  const roe = input.replaceAll ? input.pasted.roe : { ...(before?.roe ?? {}), ...input.pasted.roe };
  const total = totalInInr(lines as PastedLine[], roe);
  const saved = await write(input.enquiry.ref, {
    partner_id: input.partnerId,
    partner_label: from,
    pasted_text: input.pastedText,
    lines,
    roe,
    total_inr: total,
    history: [...(before?.history ?? []), entry],
  });
  await logEvent(input.enquiry.ref, "partner_rate", `Partner's rate${from ? ` from ${from}` : ""}: ${pasteSummary(entry)}${total !== null ? ` — the original rate is now ₹${total.toLocaleString("en-IN")}` : ""}`, {
    partner_id: input.partnerId,
    total_inr: total,
  }).catch(() => {});
  return saved;
}

/** One charge taken off the original rate. */
export async function removeBuyLine(buy: BuyRate, index: number): Promise<BuyRate> {
  const gone = buy.lines[index];
  const lines = buy.lines.filter((_, i) => i !== index);
  const saved = await write(buy.enquiry_ref, { lines, total_inr: totalInInr(lines as PastedLine[], buy.roe) });
  if (gone) await logEvent(buy.enquiry_ref, "partner_rate", `Removed from the original rate: ${gone.description}`).catch(() => {});
  return saved;
}

/** The whole original rate cleared. */
export async function removeBuyRate(ref: string): Promise<void> {
  const { error } = await supabase.from("enquiry_buy_rates").delete().eq("enquiry_ref", ref.toUpperCase());
  if (error) throw new Error(error.message);
  await logEvent(ref, "partner_rate", "Original rate cleared").catch(() => {});
}

/**
 * The quotation started from the original rate: the same charges at the same
 * figures, for the desk to put its commission on, charge by charge, in the
 * grid. A draft in hand has its charges replaced; otherwise a new version.
 */
export const quoteFromBuyRate = (enquiry: Enquiry, live: Quote | null, buy: BuyRate) =>
  applyPastedQuote({
    enquiry,
    live,
    pasted: {
      lines: buy.lines.map((l): PastedLine => ({ section: asSection(l.section), description: l.description, currency: l.currency, unit: l.unit, quantity: l.quantity, rate: l.rate, note: l.note ?? null, gst: l.gst ?? null })),
      roe: buy.roe,
      terms: [],
      validUntil: null,
    },
    pastedText: buy.pasted_text,
  });
