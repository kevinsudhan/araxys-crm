/**
 * Field extraction from a finished call.
 *
 * The regex extractor next door in ingest.ts reads English only, and reads it by
 * pattern — which is fine for a rupee amount and useless for "பருத்தி துணி ரோல்ஸ்".
 * Roughly half these calls are in Tamil, or in Tamil written in Latin letters, and a
 * customer record that is blank whenever the caller was comfortable in their own
 * language is not a CRM, it is an English-speakers-only CRM.
 *
 * Input is always a stored transcript from a call that has already ended — this never
 * touches a live call, and the agent is never asked to invoke a tool mid-conversation.
 *
 * WHY NOT STRUCTURED OUTPUTS. The obvious way to do this is `output_config.format` with a
 * schema, and it was tried first. The API constrains generation against a compiled
 * grammar, and that grammar has hard limits: at most 16 union-typed parameters, at most
 * 24 optional ones, and an overall complexity ceiling. A 38-field catalogue breaches all
 * three. Splitting it in half still returned "Schema is too complex" — after 180 seconds
 * of retries per request, which is what dragged the Edge Function past its timeout.
 *
 * So the field list goes in the prompt and the model returns a plain JSON object. That
 * gives up the generation-time guarantee, and buys back the whole catalogue in one
 * request instead of two, no grammar compilation, and no zod in the worker. The guarantee
 * is replaced by normaliseDetails, which drops unknown keys and coerces every value to
 * its declared type — so a malformed field is discarded rather than stored, and the
 * failure mode is a missing field rather than a wrong one.
 *
 * Two rules make the result safe to put in front of ops staff:
 *
 *   1. "Not discussed" is a real answer, and the prompt says so repeatedly. A field the
 *      call never established is left out rather than filled with a plausible value.
 *   2. The regex pass still runs, and wins on the fields it is definitionally better
 *      at — a figure lifted verbatim beats the same figure recalled through a model.
 *      See mergeExtractions.
 *
 * With no ANTHROPIC_API_KEY set, or on any API failure, this degrades to exactly the
 * behaviour that existed before: the regex fields, and nothing invented to fill the gap.
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";

import {
  REQUEST_FIELDS,
  mergeExtractions,
  normaliseDetails,
  type RequestDetails,
  type RequestDetailsEnvelope,
  type SourceLanguage,
} from "./requestFields.ts";

const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// One client for the process, not one per call: a batch is several extractions, and
// rebuilding the client each time throws away connection reuse for nothing.
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: API_KEY }));

/** The catalogue, rendered for the prompt from the same source the UI renders. */
function fieldList(): string {
  return REQUEST_FIELDS.map((f) => {
    const type =
      f.kind === "enum"
        ? `one of: ${f.options?.join(" | ")}`
        : f.kind === "boolean"
          ? "true or false"
          : f.kind === "number"
            ? f.unit
              ? `number, in ${f.unit}`
              : "number"
            : "text";
    return `- ${f.key} (${type}) — ${f.label}. ${f.hint}`;
  }).join("\n");
}

const SYSTEM = `You extract structured booking details from freight-forwarding phone calls for Araxys Logistics, a Chennai freight forwarder.

You are given the transcript of a call that has already ended. Calls are in English, in Tamil, in Tamil written with Latin letters, or in a mix. Whatever was spoken, every value you return must be in English.

The transcript comes from automatic speech recognition on a phone line. It contains mis-hearings, run-together words and dropped syllables. Extract only what the words actually support.

OUTPUT FORMAT
Return a single JSON object and nothing else — no explanation, no markdown fence.
Include a key ONLY for a field the call actually established. Always include "source_language".

OMITTING A FIELD IS THE CORRECT ANSWER FOR MOST FIELDS ON MOST CALLS.
A ten-minute call about a rate for textiles to Dubai establishes maybe eight of these. The other thirty were never discussed, and every one of those must be absent from your JSON. This is the single most important thing about this task. An object with six keys is a good answer. An object with thirty-eight keys is a fabrication.

Specifically:
- Omit the field when it was never raised.
- Omit it when it was raised but left unresolved ("I'll check the exact weight and call you back").
- Omit it when the ASR is too garbled to be sure what was said.
- Never infer one field from another. Do not compute volume from dimensions, do not divide a total weight by a piece count, do not classify an HS code from a cargo description, do not guess an Incoterm from who pays freight.
- Never take a value from the agent's side of the call unless the customer confirmed it. The agent quoting a rate is not the customer's target price. The agent suggesting a 40HC is not the customer's container preference.
- A number half-heard is worse than no number. If a GSTIN or an HS code was read out and the transcript shows it only partially, omit it.

TRANSLATION
- Translate descriptive text into English: cargo descriptions, package types, payment terms.
- Transliterate names of people and companies into Latin script; never translate what a name means.
- Use standard English port and country names.
- Tamil and Tanglish numerals are numbers: 'naapadhu' / 'நாற்பது' is 40, 'rendu' is 2, 'onnu' is 1. 'lakh' is 100000, 'crore' is 10000000.
- Convert units to the unit named in the field: feet, inches and metres become centimetres; tonnes become kilograms.

FIELDS
${fieldList()}
- source_language (one of: en | ta | mixed | unknown) — The language the CALLER spoke. 'ta' covers both Tamil script and Tamil written in Latin letters ('enakku Colombo ku ship pannanum'). 'mixed' when they moved between Tamil and English.

You are reading a transcript to record what was said. You are not helping the customer, and you are not filling in a form that would be more useful if it were complete.`;

/**
 * Pulls the JSON object out of the reply.
 *
 * The prompt asks for bare JSON and that is what comes back, but a stray fence or a
 * leading sentence should cost nothing — so the first balanced object in the text is
 * taken rather than assuming the whole reply parses. String-aware, because a brace
 * inside a cargo description would otherwise end the object early.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface LlmResult {
  fields: RequestDetails;
  sourceLanguage: SourceLanguage;
}

/**
 * Why the most recent extraction failed, surfaced so the caller can see it in a response.
 *
 * Edge Function logs are shared with every other function on the project and a chatty
 * neighbour buries them — which is exactly what happened here while chasing the schema
 * limits above. A failure the caller can read off the response beats one it has to go
 * hunting for.
 */
let lastError: string | null = null;
export const lastExtractionError = () => lastError;

async function extractWithClaude(transcript: string): Promise<LlmResult | null> {
  if (!API_KEY) {
    lastError = "ANTHROPIC_API_KEY not set";
    return null;
  }

  try {
    const response = await anthropic().messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      // Identical on every call in a batch, and long enough to be worth caching.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      // Extraction is a read, not a reasoning problem — low keeps latency and cost down
      // on a task this bounded, and the per-field hints carry the judgement.
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: `Extract the fields from this call transcript.\n\n<transcript>\n${transcript}\n</transcript>`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      lastError = "model declined the request";
      return null;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const raw = parseJsonObject(text);
    if (!raw) {
      lastError = `could not parse JSON from reply: ${text.slice(0, 120)}`;
      return null;
    }

    const lang = raw.source_language;
    return {
      fields: normaliseDetails(raw),
      sourceLanguage:
        lang === "en" || lang === "ta" || lang === "mixed" ? (lang as SourceLanguage) : "unknown",
    };
  } catch (e) {
    // A failed extraction must never fail the batch — the transcript and the regex fields
    // are still worth storing, and the call is already over either way.
    lastError = e instanceof Error ? e.message : String(e);
    console.error("[araxys] Claude extraction failed:", lastError);
    return null;
  }
}

/**
 * The whole extraction for one call.
 *
 * `regexFields` is what the pattern extractor already derived, mapped onto catalogue
 * keys. Passing it in rather than re-deriving it here keeps that extractor as the one
 * place that owns the English pattern rules.
 */
export async function extractRequestDetails(
  transcript: string,
  regexFields: RequestDetails,
): Promise<RequestDetailsEnvelope> {
  const llm = await extractWithClaude(transcript);

  const fields = llm ? mergeExtractions(llm.fields, regexFields) : normaliseDetails(regexFields);
  const sourceLanguage: SourceLanguage = llm?.sourceLanguage ?? "unknown";

  return {
    fields,
    source_language: sourceLanguage,
    translated: sourceLanguage === "ta" || sourceLanguage === "mixed",
    extracted_by: llm ? "llm+regex" : "regex",
    extracted_at: new Date().toISOString(),
  };
}
