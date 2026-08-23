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
 * The work itself lives in _shared/extractQueue.ts, because the call webhook runs exactly
 * the same thing the moment a call ends — this endpoint is the scheduled safety net.
 *
 *   POST /functions/v1/extract-fields              # default batch
 *   POST /functions/v1/extract-fields?batch=3      # explicit size
 *   POST /functions/v1/extract-fields?refresh=0    # skip the knowledge republish
 */
import { extractPending } from "../_shared/extractQueue.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/**
 * Four at a time.
 *
 * Each transcript is one model request at roughly five seconds, so a batch of four lands
 * well inside the 150s ceiling with room for a slow call, and small enough that the
 * worker's memory stays flat.
 */
const DEFAULT_BATCH = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const expected = Deno.env.get("ARAXYS_CRON_SECRET");
  if (expected && req.headers.get("x-cron-secret") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const batch = Math.min(Number(url.searchParams.get("batch")) || DEFAULT_BATCH, 10);
  const refresh = url.searchParams.get("refresh") !== "0";

  try {
    return json({ ok: true, ...(await extractPending(batch, refresh)) });
  } catch (e) {
    console.error("[araxys/extract-fields]", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
