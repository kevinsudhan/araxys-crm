/**
 * SnapServe call webhook — ingests a call the moment it ends.
 *
 * The pg_cron schedule polls every two minutes, which meant a customer could hang up and
 * not appear in the CRM for that long. This closes the gap: SnapServe posts here on
 * call.completed and the record lands within seconds.
 *
 * The cron job stays in place as a safety net. Webhooks get missed — a deploy mid-flight,
 * a transient 500, an event SnapServe never sends — and a missed webhook would otherwise
 * mean a customer who called and was never recorded. Ingestion is idempotent (call_logs
 * merges on call_id, records merge on phone), so the two running together is harmless.
 *
 * The whole chain runs here, not just the ingest: pull the transcript, read the fields off
 * it, promote the record if the call closed a booking, and republish every knowledge pack
 * the agent reads. Extraction used to wait for its own five-minute cron, which meant a
 * customer could ring back inside that window and be greeted from a knowledge base that
 * predated the conversation they had just finished.
 */
import { ingestRecentCalls } from "../_shared/ingest.ts";
import { extractPending } from "../_shared/extractQueue.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-webhook-secret, x-snapserve-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // A malformed body is not worth failing over — the ingest below re-reads the call
    // from SnapServe anyway, so the payload is really just a trigger.
  }

  const event = String(body.event ?? body.type ?? "unknown");
  const callId = body.callId ?? (body.call as Record<string, unknown>)?.id ?? body.id;
  console.log(`[araxys/webhook] ${event} call=${callId ?? "?"}`);

  // Deliberately ignore the payload's own call data and re-fetch from SnapServe. The
  // webhook can fire before the transcript is finalised, and the authoritative record is
  // the one the API returns, not whatever was attached to the event.
  try {
    const ingested = await ingestRecentCalls(10);

    // Just this call, normally: the batch is small because the backlog is the cron's job,
    // and a webhook that tries to drain everything is the one that hits the timeout.
    const extraction = await extractPending(2);

    return json({ received: true, event, ...ingested, extraction });
  } catch (e) {
    console.error("[araxys/webhook] ingest failed:", e);
    // Return 200 so SnapServe does not retry into a loop; the cron will catch it.
    return json({ received: true, ingested: false, error: String(e) });
  }
});
