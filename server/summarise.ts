/**
 * Call summaries, generated here rather than taken from SnapServe.
 *
 * SnapServe's own callSummary field is null on every call we have inspected, so waiting
 * for it would mean shipping a CRM where every call reads "(no summary)". This builds one
 * from what was actually said.
 *
 * Deliberately extractive, not generative: it reports what appears in the transcript and
 * says "not discussed" when something is absent. An invented summary of a customer call
 * is worse than a terse one, because ops staff act on it.
 */
import { extractCustomerFromTranscript } from "./extractCustomer";

export interface CallSummary {
  headline: string;
  bullets: string[];
  outcome: string;
  callerTurns: number;
}

function callerLines(transcript: string): string[] {
  return transcript
    .split("\n")
    .filter((l) => /^Caller:/i.test(l))
    .map((l) => l.replace(/^Caller:\s*/i, "").trim())
    .filter(Boolean);
}

function agentLines(transcript: string): string[] {
  return transcript
    .split("\n")
    .filter((l) => /^Agent:/i.test(l))
    .map((l) => l.replace(/^Agent:\s*/i, "").trim())
    .filter(Boolean);
}

/** What the caller wanted, inferred from the words they actually used. */
function detectIntent(caller: string): string | null {
  const t = caller.toLowerCase();
  if (/\b(status|where is|track|arrived|delivered|eta)\b/.test(t)) return "Checking shipment status";
  if (/\b(quote|rate|price|cost|charge|how much)\b/.test(t)) return "Asking for a rate";
  if (/\b(document|paperwork|invoice|packing list|certificate|bill of lading)\b/.test(t))
    return "Documentation query";
  if (/\b(space|availability|available|book|booking|sailing)\b/.test(t)) return "Checking space or booking";
  if (/\b(complain|wrong|damage|late|delay|issue|problem)\b/.test(t)) return "Raising a problem";
  return null;
}

/** How the call ended, judged from the closing exchange. */
function detectOutcome(transcript: string): string {
  const t = transcript.toLowerCase();
  const tail = t.slice(-400);

  if (/\b(call ?back|callback|call you back|check with the desk|confirm with)\b/.test(tail))
    return "Callback promised";
  if (/\b(book it|go ahead|confirm|that works|okay done|deal)\b/.test(tail)) return "Customer agreed to proceed";
  if (/\b(think about|get back to you|let you know|discuss internally)\b/.test(tail))
    return "Customer will revert";
  if (/\b(not interested|too expensive|leave it|no thanks)\b/.test(tail)) return "Not proceeding";
  if (/\b(thank you|thanks|bye|goodbye)\b/.test(tail)) return "Call ended normally";
  return "No clear outcome";
}

export function summariseCall(input: {
  transcript: string;
  durationSecs?: number;
  direction?: string;
  fromNumber?: string;
}): CallSummary {
  const { transcript } = input;
  const callers = callerLines(transcript);
  const agents = agentLines(transcript);
  const callerText = callers.join(" ");
  const ex = extractCustomerFromTranscript(transcript);

  const who = ex.customerName ?? ex.company ?? "Unidentified caller";
  const dur = input.durationSecs ? `${input.durationSecs}s` : "unknown length";
  const intent = detectIntent(callerText);

  const headline = `${who} — ${intent ?? "General enquiry"} (${dur})`;

  const bullets: string[] = [];
  if (ex.company && ex.customerName) bullets.push(`Identified as ${ex.customerName} from ${ex.company}`);
  else if (ex.company) bullets.push(`Company: ${ex.company}`);
  else if (ex.customerName) bullets.push(`Name given: ${ex.customerName}`);
  else bullets.push("Caller did not identify themselves clearly");

  if (ex.origin && ex.destination) bullets.push(`Route discussed: ${ex.origin} to ${ex.destination}`);
  else if (ex.destination) bullets.push(`Destination mentioned: ${ex.destination}`);
  else bullets.push("Route not discussed");

  if (ex.cargoDescription) bullets.push(`Cargo: ${ex.cargoDescription}`);
  if (ex.volumeCbm !== undefined) bullets.push(`Volume: ${ex.volumeCbm} CBM`);
  if (ex.containerType) bullets.push(`Container: ${ex.containerType}`);
  if (ex.quotedAmountInr) bullets.push(`Amount discussed: Rs. ${ex.quotedAmountInr.toLocaleString("en-IN")}`);
  if (ex.blNumber) bullets.push(`BL number referenced: ${ex.blNumber}`);

  if (!ex.quotedAmountInr) bullets.push("No price discussed");

  // Surfacing this matters: an agent promising to check and call back is a real
  // commitment to a customer, and it is the thing most likely to be dropped.
  const promisedCallback = agents.some((l) => /call (you )?back|check with the desk|confirm with/i.test(l));
  if (promisedCallback) bullets.push("Agent promised to check and call back — follow-up owed");

  return {
    headline,
    bullets,
    outcome: detectOutcome(transcript),
    callerTurns: callers.length,
  };
}

/** Flattened to a single string for the call_logs.summary column. */
export function summaryToText(s: CallSummary): string {
  return [s.headline, ...s.bullets.map((b) => `• ${b}`), `Outcome: ${s.outcome}`].join("\n");
}
