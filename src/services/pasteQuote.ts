import { supabase } from "../lib/supabase";
import { SECTIONS, asSection, chargesLayout, normalisePasted, quoteText, sectionsByHeading, statedWeight, withShares, withStatedWeight, type ChargesLayout, type PastedLine, type PastedQuote } from "../lib/pastedQuote";
import { airTable, airText, type AirTable } from "../lib/airQuote";
import { chargeableWeight } from "../lib/chargeableWeight";
import { tableRows } from "../lib/pastedTable";
import { addQuote, logEvent, type Enquiry, type Quote } from "./enquiries";
import { addLines, type QuoteLine } from "./quoteLines";

/**
 * "Paste a quotation" (106): the rate as the desk has it, read by the AI into
 * charges under Freight, Ex works, Destination and Other charges, checked on
 * screen, then saved as the quotation's ordinary lines. An air quotation goes
 * to the customer as the desk's rate table, with GST (115, lib/airQuote.ts).
 */

/** An air enquiry. */
export const isAirQuote = (e: Pick<Enquiry, "transport_mode">) => e.transport_mode === "air";

/**
 * Whether a pasted quotation goes out as the desk's rate table (CHARGES |
 * CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE IN INR, lib/airQuote)
 * rather than as text under red headings: for an air enquiry, and for any
 * rate pasted as a table, whatever the enquiry's mode (1 Oct) — a table
 * pasted goes out as a table. Read from the paste the quotation keeps
 * (`quotes.pasted_text`), so the choice holds at sending as it did at pasting.
 */
export const tableLayout = (e: Pick<Enquiry, "transport_mode">, pasted: string | null | undefined): boolean =>
  isAirQuote(e) || !!tableRows(pasted ?? "");

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
    // What a per-kg air rate is charged on, when the rate itself does not say.
    isAirQuote(e) ? chargeableLine(e) : "",
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
  q.lines = sectionsByHeading(text, q.lines);
  // Per kg, on the weight the rate states rather than the enquiry's (lib/pastedQuote `withStatedWeight`).
  const chargeable = chargeableWeight(e.gross_weight_kg, e.volume_cbm, "air")?.value;
  q.lines = withStatedWeight(q.lines, text, [e.gross_weight_kg, chargeable]);
  q.weightKg = statedWeight(text);
  if (!q.lines.length) throw new Error("No charges could be read from that. Paste the rate with its figures — a line per charge is enough.");
  // GST is shown and kept only where the mail shows it: the rate table. A
  // quotation set out as text is invoiced at GST as it always has been.
  if (!tableLayout(e, text)) for (const l of q.lines) l.gst = null;
  else for (const l of q.lines) if (l.gst == null) l.gst = 18;
  return q;
}

function chargeableLine(e: Enquiry): string {
  const c = chargeableWeight(e.gross_weight_kg, e.volume_cbm, "air");
  return c ? `Chargeable weight ${c.value} kg` : "";
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
  const { enquiry, live } = input;
  const pasted = withShares(input.pasted);
  const air = tableLayout(enquiry, input.pastedText);
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
      gst_rate: air ? l.gst ?? null : null,
    }))
  );

  const existing = (live && live.status === "draft" ? live.terms : []) ?? [];
  const known = new Set(existing.map((t) => t.text.trim().toLowerCase()));
  const terms = [...existing, ...pasted.terms.filter((t) => !known.has(t.toLowerCase())).map((text) => ({ scope: "general", text }))];

  const { error } = await supabase
    .from("quotes")
    .update({
      mail_text: quoteText(pasted, quoteHeading(enquiry, version), air ? airText(airTable(pasted, enquiry)) : undefined),
      pasted_text: input.pastedText,
      routing: pasted.routing ?? null,
      carrier: pasted.carrier ?? null,
      transit_time: pasted.transitTime ?? null,
      terms,
      ...(pasted.validUntil ? { valid_until: pasted.validUntil } : {}),
    })
    .eq("id", quoteId);
  if (error) throw new Error(error.message);

  const counts = SECTIONS.map((s) => [pasted.lines.filter((l) => l.section === s.key).length, s.title.toLowerCase()] as const)
    .filter(([n]) => n)
    .map(([n, t]) => `${n} ${t.replace(/ charges$/, "")}`);
  await logEvent(enquiry.ref, "quote_pasted", `Quotation pasted and laid out: ${counts.join(", ")} charge${pasted.lines.length === 1 ? "" : "s"}`);
}

/**
 * A pasted quotation read back from its charges as they are now — rebuilt at
 * sending, so an edit in the charges grid after the paste is what the
 * customer reads. A condition the paste kept on a charge ("Destination THC
 * (at actuals)", "CC charges (3% on OF+EXW)") is read back off its name.
 */
export function pastedFromLines(lines: QuoteLine[], quote?: Pick<Quote, "routing" | "carrier" | "transit_time" | "pasted_text"> | null): PastedQuote {
  const roe: Record<string, number> = {};
  for (const l of lines) if (l.currency !== "INR" && Number(l.fx_rate) > 0) roe[l.currency] = Number(l.fx_rate);
  return {
    lines: lines.map((l): PastedLine => {
      const m = l.description.match(/^(.*\S)\s*\(([^()]+)\)$/);
      return {
        section: asSection(l.section),
        description: m ? m[1] : l.description,
        currency: l.currency,
        unit: l.unit,
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        note: m ? m[2] : null,
        gst: l.gst_rate == null ? null : Number(l.gst_rate),
      };
    }),
    terms: [],
    validUntil: null,
    roe,
    routing: quote?.routing ?? null,
    carrier: quote?.carrier ?? null,
    transitTime: quote?.transit_time ?? null,
    weightKg: statedWeight(quote?.pasted_text ?? ""),
  };
}

/** A pasted quotation's charges for the letter, in the desk's style. */
export function chargesLayoutFor(lines: QuoteLine[]): ChargesLayout {
  return chargesLayout(pastedFromLines(lines));
}

/** A pasted quotation's charges for the letter, as the desk's rate table (see `tableLayout`). */
export function airTableFor(lines: QuoteLine[], enquiry: Enquiry, quote: Quote): AirTable {
  return airTable(pastedFromLines(lines, quote), enquiry);
}
