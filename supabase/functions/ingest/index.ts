/**
 * Scheduled transcript ingestion, triggered by pg_cron.
 *
 * The Express version ran this on a setInterval, which meant it only happened while
 * someone's laptop was awake. Here Postgres calls it on a schedule instead, so calls get
 * captured whether or not anyone is at a machine.
 */
import { ingestRecentCalls } from "../_shared/ingest.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // The function is deployed without JWT verification so pg_cron can reach it, which
  // leaves it publicly callable. Ingestion is idempotent and read-only against SnapServe,
  // so the risk is low, but a shared secret stops anyone burning our rate limit for fun.
  const expected = Deno.env.get("ARAXYS_CRON_SECRET");
  if (expected && req.headers.get("x-cron-secret") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    return json(await ingestRecentCalls(25));
  } catch (e) {
    console.error("[araxys/ingest]", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
