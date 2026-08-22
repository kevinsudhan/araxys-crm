/**
 * Derives a customer record from a finished call.
 *
 * The flow is deliberately post-call and pull-based: call happens -> we fetch the
 * transcript -> extract here -> write to the CRM -> knowledge base re-syncs. Nothing
 * depends on the voice agent invoking a tool mid-conversation, which was verified to be
 * unreliable on the Gemini Live stack.
 *
 * The single most important field, the caller's phone number, never comes from the
 * transcript at all — it comes from call metadata, so identity holds even when the ASR
 * mangles everything that was said.
 */

export interface ExtractedCustomer {
  customerName?: string;
  company?: string;
  origin?: string;
  destination?: string;
  cargoDescription?: string;
  volumeCbm?: number;
  containerType?: string;
  quotedAmountInr?: number;
  blNumber?: string;
  status: string;
  notes?: string;
}

const PORTS = [
  "Chennai",
  "Tuticorin",
  "Jebel Ali",
  "Dubai",
  "Colombo",
  "Singapore",
  "Jeddah",
  "Male",
  "Mundra",
  "Cochin",
];

/** Only the caller's own words. The agent's lines describe our side, not theirs. */
function callerText(transcript: string): string {
  return transcript
    .split("\n")
    .filter((l) => /^Caller:/i.test(l))
    .map((l) => l.replace(/^Caller:\s*/i, ""))
    .join("\n");
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * A company name is a couple of words, not the rest of the sentence. Cuts at the first
 * word that signals the speaker has moved on, then caps the length — a plausible-looking
 * but wrong company name is worse than none, because nothing about it looks incomplete.
 */
const STOP_WORDS = new Set([
  "i", "we", "and", "so", "but", "the", "my", "our", "it", "they", "he", "she",
  "need", "want", "would", "will", "have", "am", "is", "are", "was", "please", "actually",
]);

function tidyCompany(raw: string): string | undefined {
  const words: string[] = [];
  for (const w of raw.trim().split(/\s+/)) {
    if (STOP_WORDS.has(w.toLowerCase())) break;
    words.push(w);
    if (words.length >= 4) break;
  }
  if (!words.length) return undefined;
  return titleCase(words.join(" ").replace(/[.,]+$/, ""));
}

/**
 * How people actually introduce themselves on these calls.
 *
 * "my name is" was missing originally, which meant a caller who answered the agent's
 * "can I take your name?" with the most natural possible reply — "my name is Kevin" —
 * had their name silently dropped. Ordered longest-first so "my name is" wins over the
 * bare "name is" and does not leave "name" sitting in the captured value.
 */
const INTRO = [
  "my name is",
  "my name's",
  "name is",
  "this is",
  "i am",
  "i'm",
  "it's",
  "its",
  "myself",
  "speaking is",
  "you can call me",
  "call me",
].join("|");

/**
 * Pulls a name and/or company out of natural self-introductions.
 * Conservative by design: a wrong company name on a customer record is worse than a
 * blank one, because the blank is obviously incomplete while the wrong one looks true.
 */
function extractIdentity(text: string): { customerName?: string; company?: string } {
  const out: { customerName?: string; company?: string } = {};

  // "this is Kevin from Sudhan Exports" / "I'm Kevin of Sudhan Exports".
  // The company class excludes '.' deliberately — including it lets the match run past
  // the sentence and swallow half the call ("Sudhan Exports. I Need To Ship Some Spice").
  const both = text.match(
    new RegExp(`\\b(?:${INTRO})\\s+([A-Za-z][A-Za-z ]{1,30}?)\\s+(?:from|of|at|with)\\s+([A-Za-z][A-Za-z0-9 &]{2,40})`, "i")
  );
  if (both) {
    // Clean immediately, not at the end. A junk capture like "Calling" (from "I'm calling
    // from ...") otherwise sits in customerName just long enough to block the dedicated
    // "my name is X" pattern below from ever running, and the caller's actual name is lost.
    out.customerName = cleanName(titleCase(both[1]));
    out.company = tidyCompany(both[2]);
  }

  // "calling from Sudhan Exports"
  const co = text.match(/\b(?:calling from|from|representing)\s+([A-Z][A-Za-z0-9 &.]{2,40}?(?:Exports?|Imports?|Traders?|Textiles?|Logistics|Industries|Enterprises|Pvt|Limited|Ltd|Co|Company|Foods?|Spices?|Marine))/);
  if (co && !out.company) out.company = tidyCompany(co[1]);

  // "this is Kevin" / "my name is Kevin" with no company
  const nm = text.match(
    new RegExp(`\\b(?:${INTRO})\\s+([A-Za-z][A-Za-z .]{1,25}?)(?:[.,]|\\s+(?:here|speaking)|$)`, "i")
  );
  if (nm && !out.customerName) {
    out.customerName = cleanName(titleCase(nm[1]));
  }

  if (!out.customerName) delete out.customerName;
  return out;
}

/**
 * Rejects filler that happens to sit where a name would.
 * "this is <name> calling from <company>" otherwise yields the name "Calling" — which
 * then gets read out to the customer as if it were theirs.
 */
const NON_NAMES = new Set([
  "calling", "speaking", "here", "just", "actually", "still", "again", "back",
  "the", "a", "an", "my", "your", "our", "sorry", "hello", "hi", "yes", "no", "ok", "okay",
]);

function cleanName(candidate: string): string | undefined {
  let words = candidate.trim().split(/\s+/).filter(Boolean);

  // "this is Kevin calling from ..." lazily captures "Kevin calling" — trim filler off
  // the end, and drop the whole thing if filler is where the name should start.
  while (words.length && NON_NAMES.has(words[words.length - 1].toLowerCase())) words.pop();
  if (!words.length) return undefined;
  if (NON_NAMES.has(words[0].toLowerCase())) return undefined;
  if (words.length > 3) return undefined;
  if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) return undefined;

  return words.join(" ");
}

/** Direction matters: "Chennai to Colombo" must not come back reversed. */
function extractRoute(text: string): { origin?: string; destination?: string } {
  const portAlt = PORTS.join("|");
  const pair = text.match(new RegExp(`\\b(${portAlt})\\b[^.]{0,25}?\\b(?:to|until|till|and then)\\b[^.]{0,15}?\\b(${portAlt})\\b`, "i"));
  if (pair) {
    const a = PORTS.find((p) => p.toLowerCase() === pair[1].toLowerCase());
    const b = PORTS.find((p) => p.toLowerCase() === pair[2].toLowerCase());
    if (a && b && a !== b) return { origin: a, destination: b };
  }

  const from = text.match(new RegExp(`\\bfrom\\s+(${portAlt})\\b`, "i"));
  const to = text.match(new RegExp(`\\b(?:to|for)\\s+(${portAlt})\\b`, "i"));
  const o = from ? PORTS.find((p) => p.toLowerCase() === from[1].toLowerCase()) : undefined;
  const d = to ? PORTS.find((p) => p.toLowerCase() === to[1].toLowerCase()) : undefined;
  if (o || d) return { origin: o, destination: o === d ? undefined : d };

  // A single port mentioned is more often the destination than the origin.
  const solo = text.match(new RegExp(`\\b(${portAlt})\\b`, "i"));
  if (solo) return { destination: PORTS.find((p) => p.toLowerCase() === solo[1].toLowerCase()) };
  return {};
}

export function extractCustomerFromTranscript(transcript: string): ExtractedCustomer {
  const caller = callerText(transcript);
  const all = transcript;

  const id = extractIdentity(caller);
  const route = extractRoute(caller);

  const out: ExtractedCustomer = { ...id, ...route, status: "enquiry received" };

  const cbm = caller.match(/(\d+(?:\.\d+)?)\s*(?:CBM|cbm|cubic)/);
  if (cbm) out.volumeCbm = Number(cbm[1]);

  const cont = caller.match(/\b(LCL|FCL|20GP|40GP|40HC|20RF|40RF|20\s*(?:ft|foot)|40\s*(?:ft|foot))\b/i);
  if (cont) {
    const c = cont[1].toUpperCase().replace(/\s|FT|FOOT/g, "");
    out.containerType = c === "20" ? "20GP" : c === "40" ? "40GP" : c;
  }

  // Quotes are spoken by the agent, so this one reads the whole transcript.
  const amounts = [...all.matchAll(/(?:Rs\.?|₹|rupees?)\s*([\d,]{3,})/gi)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 500);
  if (amounts.length) out.quotedAmountInr = Math.max(...amounts);

  const bl = all.match(/\b([A-Z]{4}\s?\d{6,8})\b/);
  if (bl) out.blNumber = bl[1].replace(/\s/g, "");

  const cargoWords = caller.match(
    /\b(garments?|textiles?|spices?|rice|tiles?|granite|machinery|electronics|seafood|frozen|furniture|chemicals?|cartons?|pallets?|drums?)\b/gi
  );
  if (cargoWords?.length) {
    out.cargoDescription = [...new Set(cargoWords.map((w) => w.toLowerCase()))].join(", ");
  }

  const known = [out.customerName, out.company, out.origin, out.destination, out.cargoDescription].filter(Boolean).length;
  out.notes = `Auto-extracted from call transcript (${known} field${known === 1 ? "" : "s"} identified). Review before relying on it.`;

  return out;
}

/**
 * Whether a call is worth creating a customer record from.
 *
 * Filters out wrong numbers, hang-ups and our own outbound tests. Creating a record for
 * a 9-second call where nobody said anything produces a contact the agent will later
 * greet by name with nothing to say.
 */
export function isWorthRecording(call: {
  direction?: string;
  durationSecs?: number;
  transcript?: string;
}): boolean {
  if (call.direction !== "inbound") return false;
  if ((call.durationSecs ?? 0) < 20) return false;
  const turns = (call.transcript ?? "").split("\n").filter((l) => /^Caller:/i.test(l));
  if (turns.length < 2) return false;
  const words = turns.join(" ").split(/\s+/).filter(Boolean).length;
  return words >= 8;
}
