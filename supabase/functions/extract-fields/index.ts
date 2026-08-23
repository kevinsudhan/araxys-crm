/**
 * Field extraction, as its own job.
 *
 * This started out inside the ingest run and did not survive contact with the Edge
 * Function limits. Ingest sees every call SnapServe has ever recorded — it ignores the
 * `limit` parameter — so extraction there meant dozens of model calls in one worker, and
 * the run died first at the 150s idle timeout and then at the memory ceiling, taking the
 * whole ingest with it.
 *
 * Splitting it out fixes the actual problem rather than tuning around it. Ingest goes
 * back to being fast and dependency-free; this function does one small batch per
 * invocation, well inside every limit, and cron drains the backlog over successive runs.
 * A batch that fails costs one batch, not the customer-capture pipeline.
 *
 *   POST /functions/v1/extract-fields          # default batch
 *   POST /functions/v1/extract-fields?batch=3  # explicit size
 */
import { extractRequestDetails, lastExtractionError } from "../_shared/extractFields.ts";
import { regexFieldsFor } from "../_shared/ingest.ts";
import { upsertRecord } from "../_shared/records.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
 * Four at a time.
 *
 * Each transcript is two parallel model requests at roughly eight seconds, so a batch of
 * four lands around forty seconds of wall clock — comfortably inside the 150s ceiling
 * with room for a slow call, and small enough that the worker's memory stays flat.
 */
const DEFAULT_BATCH = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const expected = Deno.env.get("ARAXYS_CRON_SECRET");
  if (expected && req.headers.get("x-cron-secret") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const batch = Math.min(Number(new URL(req.url).searchParams.get("batch")) || DEFAULT_BATCH, 10);

  try {
    // Rows the model has not read yet. `extracted_by=llm*` marks a finished one; a row
    // still on the regex fallback failed rather than completed, so it stays in the queue
    // and gets retried here.
    const pending = await db(
      "call_logs?select=call_id,from_number,transcript,duration_secs,direction" +
        "&direction=eq.inbound&transcript=not.is.null&duration_secs=gte.20" +
        "&or=(extracted.is.null,extracted->>extracted_by.not.like.llm*)" +
        `&order=started_at.desc&limit=${batch}`,
    );

    let extracted = 0;
    let recordsTouched = 0;

    for (const row of pending ?? []) {
      const transcript = row.transcript as string;
      const details = await extractRequestDetails(transcript, regexFieldsFor(transcript));

      await db(`call_logs?call_id=eq.${encodeURIComponent(row.call_id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ extracted: details }),
      });
      extracted++;

      const phone = row.from_number ?? "";
      if (phone && !/^webcall/i.test(phone) && Object.keys(details.fields).length) {
        await upsertRecord({
          phone,
          source_call_id: String(row.call_id),
          request_details: details.fields,
          source_language: details.source_language,
        });
        recordsTouched++;
      }
    }

    // How many are still queued, so a caller knows whether to run it again.
    const remaining = await db(
      "call_logs?select=call_id&direction=eq.inbound&transcript=not.is.null&duration_secs=gte.20" +
        "&or=(extracted.is.null,extracted->>extracted_by.not.like.llm*)&limit=200",
    );

    return json({
      ok: true,
      extracted,
      recordsTouched,
      remaining: (remaining ?? []).length,
      extractionError: lastExtractionError(),
    });
  } catch (e) {
    console.error("[araxys/extract-fields]", e);
    return json({ ok: false, error: String(e), extractionError: lastExtractionError() }, 500);
  }
});
