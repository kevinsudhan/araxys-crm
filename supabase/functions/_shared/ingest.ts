/**
 * Transcript ingestion — pulls finished calls from SnapServe into Postgres.
 *
 * Port of server/transcripts.ts + summarise.ts + extractCustomer.ts. Runs on a schedule
 * (pg_cron) rather than as an in-process loop, because Edge Functions cannot hold a timer.
 *
 * This is the whole customer-capture path: call happens -> transcript pulled -> details
 * extracted -> CRM row written -> knowledge base re-synced. Nothing depends on the voice
 * agent invoking a tool mid-conversation, which proved unreliable on the Gemini Live stack.
 */
import { upsertRecord, syncKb, syncCallerMemory, syncSpaceKb, phoneKey } from "./records.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SNAPSERVE_KEY = Deno.env.get("SNAPSERVE_API_KEY") ?? "";
const SNAPSERVE_BASE = Deno.env.get("SNAPSERVE_BASE_URL") ?? "https://app.snapserve.ai/api";

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${t}`);
  return t ? JSON.parse(t) : null;
}

/**
 * Gemini Live repeats every agent line — once as generated text, once as transcribed
 * audio with mangled spacing ("How canI helpyou today?"). Stored raw, every transcript
 * is doubled and unreadable.
 */
/**
 * Gemini Live's transcripts arrive with words run together ("desk.How canI helpyou") and
 * with agent lines sometimes emitted twice — once as generated text, once as transcribed
 * audio. Both make stored transcripts hard to read.
 *
 * Spacing is only repaired where it is unambiguous (after sentence punctuation, and at a
 * lowercase-to-uppercase boundary). Splitting genuinely run-together words like "thisis"
 * would need dictionary segmentation, and guessing wrong would corrupt what the customer
 * actually said — so those are left alone.
 */
function tidySpacing(text: string): string {
  return text
    .replace(/([.!?,])([A-Za-z])/g, "$1 $2")   // "desk.How" -> "desk. How"
    .replace(/([a-z])([A-Z])/g, "$1 $2")        // "canI" -> "can I"
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Drops repeated sentences within a line, comparing on letters only. */
function dedupeSentences(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(p);
  }
  return kept.join(" ");
}

export function cleanTranscript(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const m = line.match(/^(Agent|Caller):\s*(.*)$/);
      if (!m) return line;
      const [, who, text] = m;
      const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const half = Math.floor(text.length / 2);
      for (let split = half - 12; split <= half + 12; split++) {
        if (split <= 0 || split >= text.length) continue;
        const a = text.slice(0, split);
        const b = text.slice(split);
        if (letters(a) && letters(a) === letters(b)) return `${who}: ${dedupeSentences(tidySpacing(a))}`;
      }
      return `${who}: ${dedupeSentences(tidySpacing(text))}`;
    })
    .join("\n");
}

const PORTS = ["Chennai", "Tuticorin", "Jebel Ali", "Dubai", "Colombo", "Singapore", "Jeddah", "Male", "Mundra", "Cochin"];

/** Phrasings people actually use. "my name is" first — it is the commonest reply. */
const INTRO = [
  "my name is", "my name's", "name is", "this is", "i am", "i'm", "it's", "its",
  "myself", "speaking is", "you can call me", "call me",
].join("|");

const NON_NAMES = new Set([
  "calling", "speaking", "here", "just", "actually", "still", "again", "back",
  "the", "a", "an", "my", "your", "our", "sorry", "hello", "hi", "yes", "no", "ok", "okay",
]);

const STOP_WORDS = new Set([
  "i", "we", "and", "so", "but", "the", "my", "our", "it", "they", "he", "she",
  "need", "want", "would", "will", "have", "am", "is", "are", "was", "please", "actually",
]);

const titleCase = (s: string) =>
  s.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function cleanName(candidate: string): string | undefined {
  let words = candidate.trim().split(/\s+/).filter(Boolean);
  while (words.length && NON_NAMES.has(words[words.length - 1].toLowerCase())) words.pop();
  if (!words.length) return undefined;
  if (NON_NAMES.has(words[0].toLowerCase())) return undefined;
  if (words.length > 3) return undefined;
  if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) return undefined;
  return words.join(" ");
}

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

const callerText = (t: string) =>
  t.split("\n").filter((l) => /^Caller:/i.test(l)).map((l) => l.replace(/^Caller:\s*/i, "")).join("\n");

export interface Extracted {
  customer_name?: string;
  company?: string;
  origin?: string;
  destination?: string;
  cargo_description?: string;
  volume_cbm?: number;
  container_type?: string;
  quoted_amount_inr?: number;
  bl_number?: string;
  status: string;
}

export function extractCustomer(transcript: string): Extracted {
  const caller = callerText(transcript);
  const out: Extracted = { status: "enquiry received" };

  // Name + company together. Clean immediately: a junk capture like "Calling" would
  // otherwise block the dedicated "my name is X" pattern below from ever running.
  const both = caller.match(
    new RegExp(`\\b(?:${INTRO})\\s+([A-Za-z][A-Za-z ]{1,30}?)\\s+(?:from|of|at|with)\\s+([A-Za-z][A-Za-z0-9 &]{2,40})`, "i")
  );
  if (both) {
    out.customer_name = cleanName(titleCase(both[1]));
    out.company = tidyCompany(both[2]);
  }

  if (!out.company) {
    const co = caller.match(
      /\b(?:calling from|from|representing)\s+([A-Z][A-Za-z0-9 &.]{2,40}?(?:Exports?|Imports?|Traders?|Textiles?|Logistics|Industries|Enterprises|Pvt|Limited|Ltd|Co|Company|Foods?|Spices?|Marine))/
    );
    if (co) out.company = tidyCompany(co[1]);
  }

  if (!out.customer_name) {
    const nm = caller.match(new RegExp(`\\b(?:${INTRO})\\s+([A-Za-z][A-Za-z .]{1,25}?)(?:[.,]|\\s+(?:here|speaking)|$)`, "i"));
    if (nm) out.customer_name = cleanName(titleCase(nm[1]));
  }
  if (!out.customer_name) delete out.customer_name;

  // Route, with direction preserved — "Chennai to Colombo" must not come back reversed.
  const alt = PORTS.join("|");
  const pair = caller.match(new RegExp(`\\b(${alt})\\b[^.]{0,25}?\\b(?:to|until|till)\\b[^.]{0,15}?\\b(${alt})\\b`, "i"));
  if (pair) {
    const a = PORTS.find((p) => p.toLowerCase() === pair[1].toLowerCase());
    const b = PORTS.find((p) => p.toLowerCase() === pair[2].toLowerCase());
    if (a && b && a !== b) { out.origin = a; out.destination = b; }
  }
  if (!out.destination) {
    const from = caller.match(new RegExp(`\\bfrom\\s+(${alt})\\b`, "i"));
    const to = caller.match(new RegExp(`\\b(?:to|for)\\s+(${alt})\\b`, "i"));
    if (from) out.origin = PORTS.find((p) => p.toLowerCase() === from[1].toLowerCase());
    if (to) out.destination = PORTS.find((p) => p.toLowerCase() === to[1].toLowerCase());
    if (out.origin && out.origin === out.destination) delete out.destination;
  }

  const cbm = caller.match(/(\d+(?:\.\d+)?)\s*(?:CBM|cbm|cubic)/);
  if (cbm) out.volume_cbm = Number(cbm[1]);

  const cont = caller.match(/\b(LCL|FCL|20GP|40GP|40HC|20RF|40RF)\b/i);
  if (cont) out.container_type = cont[1].toUpperCase();

  // Quotes are spoken by the agent, so read the whole transcript for amounts.
  const amounts = [...transcript.matchAll(/(?:Rs\.?|₹|rupees?)\s*([\d,]{3,})/gi)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 500);
  if (amounts.length) out.quoted_amount_inr = Math.max(...amounts);

  const bl = transcript.match(/\b([A-Z]{4}\s?\d{6,8})\b/);
  if (bl) out.bl_number = bl[1].replace(/\s/g, "");

  const cargo = caller.match(
    /\b(garments?|textiles?|spices?|rice|tiles?|granite|machinery|electronics|seafood|frozen|furniture|chemicals?|cartons?|pallets?|drums?)\b/gi
  );
  if (cargo?.length) out.cargo_description = [...new Set(cargo.map((w) => w.toLowerCase()))].join(", ");

  return out;
}

/** Filters wrong numbers, hang-ups and our own outbound tests. */
export function isWorthRecording(c: { direction?: string; durationSecs?: number; transcript?: string }): boolean {
  if (c.direction !== "inbound") return false;
  if ((c.durationSecs ?? 0) < 20) return false;
  const turns = (c.transcript ?? "").split("\n").filter((l) => /^Caller:/i.test(l));
  if (turns.length < 2) return false;
  return turns.join(" ").split(/\s+/).filter(Boolean).length >= 8;
}

/**
 * Extractive summary. SnapServe's own callSummary is null on every call, and a generated
 * summary would invent plausible detail — which is worse, because ops staff act on it.
 */
export function summarise(transcript: string, durationSecs?: number): string {
  const caller = callerText(transcript);
  const ex = extractCustomer(transcript);
  const agents = transcript.split("\n").filter((l) => /^Agent:/i.test(l));

  const t = caller.toLowerCase();
  const intent =
    /\b(status|where is|track|arrived|delivered|eta)\b/.test(t) ? "Checking shipment status" :
    /\b(quote|rate|price|cost|charge|how much)\b/.test(t) ? "Asking for a rate" :
    /\b(document|paperwork|invoice|packing list|certificate)\b/.test(t) ? "Documentation query" :
    /\b(space|availability|available|book|booking|sailing)\b/.test(t) ? "Checking space or booking" :
    /\b(complain|wrong|damage|late|delay|issue|problem)\b/.test(t) ? "Raising a problem" :
    "General enquiry";

  const who = ex.customer_name ?? ex.company ?? "Unidentified caller";
  const lines = [`${who} — ${intent} (${durationSecs ? durationSecs + "s" : "unknown length"})`];

  if (ex.customer_name && ex.company) lines.push(`• Identified as ${ex.customer_name} from ${ex.company}`);
  else if (ex.customer_name) lines.push(`• Name given: ${ex.customer_name}`);
  else if (ex.company) lines.push(`• Company: ${ex.company}`);
  else lines.push("• Caller did not identify themselves clearly");

  if (ex.origin && ex.destination) lines.push(`• Route discussed: ${ex.origin} to ${ex.destination}`);
  else if (ex.destination) lines.push(`• Destination mentioned: ${ex.destination}`);
  else lines.push("• Route not discussed");

  if (ex.cargo_description) lines.push(`• Cargo: ${ex.cargo_description}`);
  if (ex.volume_cbm !== undefined) lines.push(`• Volume: ${ex.volume_cbm} CBM`);
  if (ex.container_type) lines.push(`• Container: ${ex.container_type}`);
  if (ex.quoted_amount_inr) lines.push(`• Amount discussed: Rs. ${ex.quoted_amount_inr.toLocaleString("en-IN")}`);
  else lines.push("• No price discussed");
  if (ex.bl_number) lines.push(`• BL number referenced: ${ex.bl_number}`);

  // A promise to call back is a real commitment to a customer, and the thing most
  // likely to be quietly dropped — so it gets surfaced explicitly.
  if (agents.some((l) => /call (you )?back|check with the desk|confirm with/i.test(l)))
    lines.push("• Agent promised to check and call back — follow-up owed");

  const tail = transcript.toLowerCase().slice(-400);
  const outcome =
    /\b(call ?back|callback|call you back|check with the desk)\b/.test(tail) ? "Callback promised" :
    /\b(book it|go ahead|confirm|that works)\b/.test(tail) ? "Customer agreed to proceed" :
    /\b(think about|get back to you|let you know)\b/.test(tail) ? "Customer will revert" :
    /\b(not interested|too expensive|leave it)\b/.test(tail) ? "Not proceeding" :
    /\b(thank you|thanks|bye|goodbye)\b/.test(tail) ? "Call ended normally" :
    "No clear outcome";

  lines.push(`Outcome: ${outcome}`);
  return lines.join("\n");
}

interface SnapCall {
  id: number;
  agentName?: string;
  direction?: string;
  status?: string;
  fromNumber?: string;
  toNumber?: string;
  durationSeconds?: number | null;
  transcript?: string | null;
  callSummary?: string | null;
  createdAt?: string;
  endedAt?: string | null;
}

export async function ingestRecentCalls(limit = 25) {
  if (!SNAPSERVE_KEY) return { ok: false, error: "SNAPSERVE_API_KEY not set" };

  const r = await fetch(`${SNAPSERVE_BASE}/calls?limit=${limit}`, {
    headers: { Authorization: `Bearer ${SNAPSERVE_KEY}` },
  });
  if (!r.ok) return { ok: false, error: `SnapServe /calls returned ${r.status}` };

  const calls = (await r.json()) as SnapCall[];
  let stored = 0;
  let recordsTouched = 0;

  for (const c of calls) {
    if (!c.transcript) continue;
    const transcript = cleanTranscript(c.transcript);
    const linkPhone = c.direction === "inbound" ? c.fromNumber : c.toNumber;

    try {
      await db("call_logs", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          call_id: String(c.id),
          agent_name: c.agentName ?? null,
          direction: c.direction ?? null,
          from_number: c.fromNumber ?? null,
          to_number: c.toNumber ?? null,
          phone_key: linkPhone ? phoneKey(linkPhone) : null,
          status: c.status ?? null,
          duration_secs: c.durationSeconds ?? null,
          transcript,
          summary: c.callSummary ?? summarise(transcript, c.durationSeconds ?? undefined),
          started_at: c.createdAt ?? null,
          ended_at: c.endedAt ?? null,
        }),
      });
      stored++;

      if (isWorthRecording({ direction: c.direction, durationSecs: c.durationSeconds ?? undefined, transcript })) {
        const phone = c.fromNumber ?? "";
        if (phone && !/^webcall/i.test(phone)) {
          await upsertRecord({ phone, source_call_id: String(c.id), ...extractCustomer(transcript) });
          recordsTouched++;
        }
      }
    } catch (e) {
      console.error(`[araxys] call ${c.id}:`, e);
    }
  }

  // Only re-sync when something actually changed — the KB rewrite is delete-and-recreate.
  // Caller memory refreshes alongside it: that is what lets the agent greet a returning
  // caller by name instead of asking who they are.
  if (recordsTouched > 0) {
    await syncKb();
    await syncCallerMemory();
  }

  // Space availability is refreshed every run regardless: cutoff dates pass and sailings
  // close with time alone, not only when someone books.
  await syncSpaceKb();

  console.log(`[araxys] ingest: ${stored} stored, ${recordsTouched} records touched`);
  return { ok: true, stored, recordsTouched, seen: calls.length };
}
