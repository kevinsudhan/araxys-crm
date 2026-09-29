import { supabase } from "../lib/supabase";
import { normalisePasted, quoteText, type PastedLine, type PastedQuote } from "../lib/pastedQuote";
import { addQuote, logEvent, type Enquiry, type Quote } from "./enquiries";
import { addLines, type QuoteLine } from "./quoteLines";

/**
 * "Paste a quotation" (106): the rate as the desk has it, read by the AI into
 * charges under Ex works and Other charges, checked on screen, then saved as
 * the quotation's ordinary lines.
 */

/** What the quotation is for, in one line, for the AI and for the mail's heading. */
export function jobLine(e: Enquiry): string {
  const mode: Record<string, string> = { air: "air", sea_fcl: "sea FCL", sea_lcl: "sea LCL", road: "road" };
  const lane = e.origin && e.destination ? `${e.origin} to ${e.destination}` : e.origin || e.destination || "";
  return [lane, e.transport_mode ? mode[e.transport_mode] ?? e.transport_mode : "", e.incoterm ? `terms ${e.incoterm}` : ""].filter(Boolean).join(", ");
}

export function quoteHeading(e: Enquiry, version?: number): string {
  const job = jobLine(e);
  return `Quotation ${e.ref}${version && version > 1 ? `/${version}` : ""}${job ? ` — ${job}` : ""}`;
}

/** The pasted text, read by the AI. Nothing is saved. */
export async function readPastedQuote(e: Enquiry, text: string): Promise<PastedQuote> {
  const context = [
    jobLine(e),
    e.cargo ? `Cargo: ${e.cargo}` : "",
    e.piece_count ? `${e.piece_count} pieces` : "",
    e.gross_weight_kg ? `${e.gross_weight_kg} kg` : "",
    e.volume_cbm ? `${e.volume_cbm} CBM` : "",
  ]
    .filter(Boolean)
    .join(". ");
  const { data, error } = await supabase.functions.invoke("classify-enquiry", {
    body: { mode: "paste_quote", subject: e.ref, body: text, context },
  });
  if (error) throw new Error(error.message);
  const d = data as { error?: string; detail?: string };
  if (d?.error) throw new Error(d.detail ? `${d.error} ${d.detail}` : d.error);
  const q = normalisePasted(data);
  if (!q.lines.length) throw new Error("No charges could be read from that. Paste the rate with its figures — a line per charge is enough.");
  return q;
}

/**
 * Saves it: into the draft quotation when there is one (its charges replaced),
 * or as a new version. The lines carry their group; the quotation keeps the
 * pasted text and the mail text as laid out now, and is marked to go out as
 * plain text.
 */
export async function applyPastedQuote(input: {
  enquiry: Enquiry;
  live: Quote | null;
  pasted: PastedQuote;
  pastedText: string;
}): Promise<void> {
  const { enquiry, live, pasted } = input;
  let quoteId: string;
  let version: number;
  if (live && live.status === "draft") {
    quoteId = live.id;
    version = live.version;
    const { error } = await supabase.from("quote_lines").delete().eq("quote_id", quoteId);
    if (error) throw new Error(error.message);
  } else {
    const q = await addQuote({ ref: enquiry.ref, amountInr: 0, basis: "", validUntil: pasted.validUntil ?? undefined, currency: "INR", fxRate: 1 });
    quoteId = q.id;
    version = q.version;
  }

  await addLines(
    quoteId,
    pasted.lines.map((l, i) => ({
      position: i + 1,
      // A condition on a charge ("at actuals") stays with it on every document.
      description: l.note ? `${l.description} (${l.note})` : l.description,
      currency: l.currency,
      fx_rate: l.currency === "INR" ? 1 : pasted.roe[l.currency] ?? 1,
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      section: l.section,
    }))
  );

  const existing = (live && live.status === "draft" ? live.terms : []) ?? [];
  const known = new Set(existing.map((t) => t.text.trim().toLowerCase()));
  const terms = [...existing, ...pasted.terms.filter((t) => !known.has(t.toLowerCase())).map((text) => ({ scope: "general", text }))];

  const { error } = await supabase
    .from("quotes")
    .update({
      mail_text: quoteText(pasted, quoteHeading(enquiry, version)),
      pasted_text: input.pastedText,
      terms,
      ...(pasted.validUntil ? { valid_until: pasted.validUntil } : {}),
    })
    .eq("id", quoteId);
  if (error) throw new Error(error.message);

  const ex = pasted.lines.filter((l) => l.section === "ex_works").length;
  await logEvent(enquiry.ref, "quote_pasted", `Quotation pasted and laid out: ${ex} ex works and ${pasted.lines.length - ex} other charges`);
}

/**
 * The mail text for a quotation that goes as plain text, from its charges as
 * they are now — rebuilt at sending, so an edit in the charges grid after the
 * paste is what the customer reads.
 */
export function mailTextFor(enquiry: Enquiry, quote: Quote, lines: QuoteLine[]): string {
  const roe: Record<string, number> = {};
  for (const l of lines) if (l.currency !== "INR" && Number(l.fx_rate) > 0) roe[l.currency] = Number(l.fx_rate);
  const pasted: PastedQuote = {
    lines: lines.map(
      (l): PastedLine => ({
        section: l.section === "ex_works" ? "ex_works" : "other",
        description: l.description,
        currency: l.currency,
        unit: l.unit,
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        note: null,
      })
    ),
    terms: (quote.terms ?? []).map((t) => t.text).filter(Boolean),
    validUntil: quote.valid_until ?? null,
    roe,
  };
  return quoteText(pasted, quoteHeading(enquiry, quote.version));
}
