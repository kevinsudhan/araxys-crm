/**
 * Reads a call transcript into the enquiry fields.
 *
 * ---------------------------------------------------------------------------
 * WHY A MODEL AND NOT PATTERNS
 *
 * The transcripts are bilingual, half-transcribed and full of the way people
 * actually talk. A real one from this desk contains "anju adi" for five feet,
 * "September 8th-ku book panna paakuren", and a caller saying "ama" to mean yes.
 * No pattern set survives that. What a model is good at is exactly this: taking
 * a messy conversation and saying what was established.
 *
 * WHAT IT IS NOT ALLOWED TO DO
 *
 * Infer. If the caller never said how many boxes, piece_count is null -- not a
 * guess from context, not a plausible default. A wrong number here reaches a
 * quote and then a container, and a null is trivially fixed by asking. This is
 * the whole reason the prompt keeps repeating it: the model's instinct is to be
 * helpful, and helpful is the failure mode.
 *
 * Everything comes back in English regardless of what was spoken, because the
 * CRM is one language and a Tamil cargo description in a database column is a
 * problem for whoever reads it next.
 * ---------------------------------------------------------------------------
 */

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

export interface Extracted {
  customer_name: string | null;
  company: string | null;
  email: string | null;
  origin: string | null;
  destination: string | null;
  cargo: string | null;
  incoterm: string | null;
  piece_count: number | null;
  piece_length_cm: number | null;
  piece_width_cm: number | null;
  piece_height_cm: number | null;
  weight_per_piece_kg: number | null;
  /**
   * Did the caller give three separate measurements?
   *
   * Asked as its own question because the instruction not to assume a cube was
   * not enough on its own: told "five feet boxes", the model returned
   * 152 x 152 x 152 and a volume was derived from it. A yes/no is far harder to
   * get wrong than a rule buried in a paragraph, and it can be checked in code.
   */
  dimensions_stated_separately: boolean;
  ready_date: string | null;
  pickup_location: string | null;
  consignee_name: string | null;
  consignee_country: string | null;
  special_handling: string | null;
  /** What the agent actually named as a figure, if anything. */
  quoted_amount_inr: number | null;
  /**
   * How that figure was expressed.
   *
   * "4,200 per CBM" and "4,200 all-in" are different offers, and storing the
   * number without the basis makes a rate look like a total. On the real call
   * the agent named a per-CBM rate before she had a piece count, so the total
   * did not exist yet -- and a quote row saying "₹4,200" would have been a lie
   * about what was agreed.
   */
  quoted_basis: string | null;
  /** A sailing the caller settled on, not one merely mentioned. */
  agreed_sailing_date: string | null;
  /** Only true for an unambiguous yes to a specific price. */
  quote_accepted: boolean;
  language: string | null;
  summary: string | null;
}

const EMPTY: Extracted = {
  customer_name: null,
  company: null,
  email: null,
  origin: null,
  destination: null,
  cargo: null,
  incoterm: null,
  piece_count: null,
  piece_length_cm: null,
  piece_width_cm: null,
  piece_height_cm: null,
  weight_per_piece_kg: null,
  dimensions_stated_separately: false,
  ready_date: null,
  pickup_location: null,
  consignee_name: null,
  consignee_country: null,
  special_handling: null,
  quoted_amount_inr: null,
  quoted_basis: null,
  agreed_sailing_date: null,
  quote_accepted: false,
  language: null,
  summary: null,
};

const SYSTEM = `You read freight enquiry phone calls and record what was established. You are not a participant and you do not help — you report.

THE ONE RULE THAT MATTERS: if the caller did not say it, it is null.
Not a sensible default, not an inference from context, not a figure implied by something else. A null costs one follow-up question. A guess reaches a quotation, then a container booking, and by the time it is caught the cargo is at the port.

Specifically:
- Never derive a piece count from a weight, a volume from dimensions, or a total from a rate. If they gave dimensions but no count, the count is null.
- Never fill an origin because the desk is in Chennai. Only if it was said.
- A sailing date the AGENT offered is not agreed. Only a date the CALLER settled on goes in agreed_sailing_date.
- quoted_basis records HOW the price was expressed, in the agent's own terms: "per CBM", "all-in", "per CBM plus THC and documentation". A rate and a total are different offers and must not be confused.
- quote_accepted is true only for an unambiguous yes to a specific figure. "Okay" straight after a named price is a yes. "Okay" after "let me check and call you back" is not. Hesitation, "I'll think about it", or silence is not.

MEASUREMENTS. Callers speak in mixed units and Indian idiom:
- "anju adi" / "five feet" = 152 cm. "oru meter" = 100 cm. Convert everything to CENTIMETRES.
- Weight is per piece unless they clearly say it is the total. If it is a total and you know the count, still record the per-piece figure only when the division is exact and they said the count.
- If a dimension is given as ONE number ("five feet boxes", "one metre cartons") you do not know length, width and height. Set dimensions_stated_separately to false. Never assume a cube — a box described by a single figure is almost never one.
- Set dimensions_stated_separately to true ONLY when the caller gave three distinct measurements, or explicitly said the piece is a cube.

LANGUAGE. The transcript may be Tamil, Hindi, English or a mixture, and the ASR mangles it. Return every value in English. Set "language" to what the CALLER mostly used: "English", "Tamil", "Hindi", or "Tamil / English" for genuine code-switching.

TRANSCRIPTS ARE BROKEN. Words run together, fragments repeat, corrections arrive garbled. When a caller corrects something, the correction is what counts. When you cannot tell, that is a null.

SUMMARY: two or three sentences a desk operator can read at a glance. What they want, what was agreed, and what is still outstanding. No preamble.

Reply with JSON only. No markdown fence, no commentary.`;

const SHAPE = `{
  "customer_name": string|null, "company": string|null, "email": string|null,
  "origin": string|null, "destination": string|null, "cargo": string|null,
  "incoterm": string|null,
  "piece_count": number|null,
  "piece_length_cm": number|null, "piece_width_cm": number|null, "piece_height_cm": number|null,
  "weight_per_piece_kg": number|null,
  "dimensions_stated_separately": boolean,
  "ready_date": "YYYY-MM-DD"|null, "pickup_location": string|null,
  "consignee_name": string|null, "consignee_country": string|null,
  "special_handling": string|null,
  "quoted_amount_inr": number|null, "quoted_basis": string|null, "agreed_sailing_date": "YYYY-MM-DD"|null,
  "quote_accepted": boolean,
  "language": string|null, "summary": string|null
}`;

let lastError: string | null = null;
export const lastExtractionError = () => lastError;

export async function extractFromTranscript(
  transcript: string,
  callDate?: string
): Promise<Extracted> {
  lastError = null;
  if (!ANTHROPIC_KEY || transcript.trim().length < 40) return EMPTY;

  const today = (callDate ?? new Date().toISOString()).slice(0, 10);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5-20251101",
        max_tokens: 1500,
        system: [
          {
            type: "text",
            text: SYSTEM,
            // The instructions are identical on every call and dwarf the
            // transcript, so caching them is most of the cost.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content:
              `This call took place on ${today}. Resolve any relative date ` +
              `("the 8th", "next Monday") against that, choosing the reading ` +
              `that puts the sailing in the future.\n\n` +
              `Return exactly this shape:\n${SHAPE}\n\n` +
              `TRANSCRIPT:\n${transcript.slice(0, 24000)}`,
          },
        ],
      }),
    });

    if (!r.ok) {
      lastError = `anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`;
      return EMPTY;
    }

    const body = await r.json();
    const text = (body.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    // The model is told not to fence it, but a stray fence should not lose the
    // whole extraction.
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(json);

    return normalise({ ...EMPTY, ...parsed });
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return EMPTY;
  }
}

/**
 * Guards against the two things a model does even when told not to.
 *
 * Zero is not a measurement -- it is the model filling a slot it could not
 * leave empty -- and a negative one is nonsense. Both become null, which is
 * what "I do not know" is supposed to look like.
 */
function normalise(e: Extracted): Extracted {
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t && !/^(null|n\/a|unknown|not (given|mentioned|stated))$/i.test(t) ? t : null;
  };
  const date = (v: unknown): string | null => {
    const s = str(v);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  /**
   * Dimensions the caller never separated are not dimensions.
   *
   * Belt and braces over the prompt, because this one has already gone wrong
   * once: "anju adi" came back as 152 x 152 x 152 and a volume was computed
   * from it. A volume nobody stated reaches a quotation and then a container.
   */
  const separated = e.dimensions_stated_separately === true;
  const l = separated ? num(e.piece_length_cm) : null;
  const w = separated ? num(e.piece_width_cm) : null;
  const h = separated ? num(e.piece_height_cm) : null;

  return {
    customer_name: str(e.customer_name),
    company: str(e.company),
    email: str(e.email)?.toLowerCase() ?? null,
    origin: str(e.origin),
    destination: str(e.destination),
    cargo: str(e.cargo),
    incoterm: str(e.incoterm)?.toUpperCase() ?? null,
    piece_count: num(e.piece_count),
    piece_length_cm: l,
    piece_width_cm: w,
    piece_height_cm: h,
    weight_per_piece_kg: num(e.weight_per_piece_kg),
    dimensions_stated_separately: e.dimensions_stated_separately === true,
    ready_date: date(e.ready_date),
    pickup_location: str(e.pickup_location),
    consignee_name: str(e.consignee_name),
    consignee_country: str(e.consignee_country),
    special_handling: str(e.special_handling),
    quoted_amount_inr: num(e.quoted_amount_inr),
    quoted_basis: str(e.quoted_basis),
    agreed_sailing_date: date(e.agreed_sailing_date),
    quote_accepted: e.quote_accepted === true,
    language: str(e.language),
    summary: str(e.summary),
  };
}

/**
 * Merges an extraction onto an enquiry without overwriting what is already known.
 *
 * A later call that mentions the destination in passing must not blank the
 * dimensions a previous one established. Only fields the enquiry does not yet
 * hold are filled, so the record accumulates across conversations rather than
 * being rewritten by whichever call ran last.
 */
export function fillBlanks<T extends Record<string, unknown>>(
  existing: T,
  extracted: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    const has = existing[f];
    const found = extracted[f];
    if (found !== null && found !== undefined && (has === null || has === undefined || has === "")) {
      patch[f] = found;
    }
  }
  return patch;
}
