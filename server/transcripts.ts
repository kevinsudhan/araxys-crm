/**
 * Pulls completed calls from SnapServe into call_logs.
 *
 * Two reasons this is a poller rather than a webhook: webhooks need a permanently
 * reachable URL (the thing that kept breaking), and SnapServe's own post-call extraction
 * never fires — dispositionResult is null on every call we have inspected — so we would
 * still have to derive structured fields ourselves from the transcript.
 *
 * Ingestion is idempotent: re-running merges on call_id rather than duplicating.
 */
import { saveCallLog, supabaseConfigured } from "./supabase";
import { upsertFromCall } from "./records";
import { extractCustomerFromTranscript, isWorthRecording } from "./extractCustomer";
import { summariseCall, summaryToText } from "./summarise";

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
  dispositionResult?: unknown;
  createdAt?: string;
  endedAt?: string | null;
}

/**
 * Gemini Live's native-audio transcripts repeat each agent line — once as generated text
 * and again as transcribed audio, the second copy with mangled spacing
 * ("How canI helpyou today?"). Left in, every stored transcript is doubled and unreadable.
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

      // A duplicated line is the same words twice; compare on letters only, since the
      // second copy differs mainly in spacing.
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

/** Best-effort structured extraction. Absent fields stay absent — never guessed. */
export function extractFromTranscript(transcript: string) {
  const out: Record<string, unknown> = {};
  const bl = transcript.match(/\b([A-Z]{4}\s?\d{6,8})\b/);
  if (bl) out.bl_number_mentioned = bl[1].replace(/\s/g, "");

  const cbm = transcript.match(/(\d+(?:\.\d+)?)\s*(?:CBM|cbm|cubic met)/);
  if (cbm) out.volume_cbm = Number(cbm[1]);

  const amounts = [...transcript.matchAll(/(?:Rs\.?|₹|rupees?)\s*([\d,]{3,})/gi)].map((m) =>
    Number(m[1].replace(/,/g, ""))
  );
  if (amounts.length) {
    out.amounts_mentioned = amounts;
    out.highest_amount = Math.max(...amounts);
  }

  const ports = ["Chennai", "Tuticorin", "Jebel Ali", "Dubai", "Colombo", "Singapore", "Jeddah", "Male"];
  const found = ports.filter((p) => new RegExp(`\\b${p}\\b`, "i").test(transcript));
  if (found.length) out.ports_mentioned = found;

  out.turn_count = transcript.split("\n").filter((l) => /^(Agent|Caller):/.test(l)).length;
  return out;
}

export async function ingestRecentCalls(opts: {
  baseUrl: string;
  apiKey: string;
  limit?: number;
  /** When true, derive/refresh a CRM customer record from each qualifying inbound call. */
  createRecords?: boolean;
}) {
  if (!opts.apiKey) return { ok: false, error: "no SnapServe key" };
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };

  const r = await fetch(`${opts.baseUrl}/calls?limit=${opts.limit ?? 25}`, {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (!r.ok) return { ok: false, error: `SnapServe /calls returned ${r.status}` };

  const calls = (await r.json()) as SnapCall[];
  let stored = 0;
  let recordsTouched = 0;
  const skipped: string[] = [];

  for (const c of calls) {
    // A call with no transcript has nothing worth recording yet; it may still be running.
    if (!c.transcript) {
      skipped.push(String(c.id));
      continue;
    }
    const transcript = cleanTranscript(c.transcript);
    try {
      await saveCallLog({
        callId: String(c.id),
        agentName: c.agentName,
        direction: c.direction,
        fromNumber: c.fromNumber,
        toNumber: c.toNumber,
        status: c.status,
        durationSecs: c.durationSeconds ?? undefined,
        transcript,
        // SnapServe's callSummary is null on every call we have seen, so generate our own.
        summary: c.callSummary ?? summaryToText(summariseCall({
          transcript,
          durationSecs: c.durationSeconds ?? undefined,
          direction: c.direction,
          fromNumber: c.fromNumber,
        })),
        extracted: extractFromTranscript(transcript),
        startedAt: c.createdAt,
        endedAt: c.endedAt ?? undefined,
      });
      stored++;

      // Post-call is where customer records come from. The agent is not asked to record
      // anything mid-conversation — that depended on the model invoking a tool, which is
      // not reliable on this voice stack. The caller's number comes from call metadata,
      // so identity survives even when the transcript itself is badly transcribed.
      if (opts.createRecords !== false && isWorthRecording({
        direction: c.direction,
        durationSecs: c.durationSeconds ?? undefined,
        transcript,
      })) {
        const phone = c.fromNumber ?? "";
        if (phone && !/^webcall/i.test(phone)) {
          try {
            const ex = extractCustomerFromTranscript(transcript);
            await upsertFromCall({ phone, sourceCallId: String(c.id), ...ex });
            recordsTouched++;
          } catch (e) {
            console.error(`[araxys] record upsert failed for call ${c.id}:`, e);
          }
        }
      }
    } catch (e) {
      console.error(`[araxys] failed to store call ${c.id}:`, e);
    }
  }

  console.log(
    `[araxys] transcript ingest: ${stored} stored, ${recordsTouched} customer records created/updated, ` +
      `${skipped.length} without transcript`
  );
  return { ok: true, stored, recordsTouched, withoutTranscript: skipped.length, seen: calls.length };
}
