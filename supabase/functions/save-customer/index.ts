/**
 * save_customer_enquiry — the agent tool SnapServe calls mid-conversation.
 *
 * Runs on Supabase Edge Functions so it has a permanent URL. The previous cloudflare
 * quick tunnel died with every session and issued a new hostname each restart, which
 * meant the agent silently lost its tools and fell back to guessing on live calls.
 *
 * This endpoint is write-only by design. Tool RESULTS were verified not to reach the
 * model on SnapServe's Gemini Live stack, but tool ARGUMENTS arrive intact — so the agent
 * records information here, and reads what it needs to know from the knowledge base,
 * which this function refreshes on every write.
 */
import { upsertRecord, syncKb, type RecordInput } from "../_shared/records.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
const num = (v: unknown) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Optional shared secret. When ARAXYS_WEBHOOK_SECRET is set, callers must present it —
  // this endpoint is public, and without a check anyone with the URL could write customer
  // records. Left unset it stays open, which is fine for testing but not for production.
  const expected = Deno.env.get("ARAXYS_WEBHOOK_SECRET");
  if (expected && req.headers.get("x-webhook-secret") !== expected) {
    return json({ saved: false, result: "Unauthorized." }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ saved: false, result: "Body was not valid JSON." }, 400);
  }

  // SnapServe nests tool arguments under `args`; accept the common variants so a change
  // in their envelope does not silently produce empty writes.
  const nested = (body.args ?? body.arguments ?? body.parameters ?? {}) as Record<string, unknown>;
  const src = { ...nested, ...body };

  const phone = str(src.phone ?? src.phone_number ?? src.caller_phone);
  if (!phone) {
    return json({
      saved: false,
      result: "No phone number was supplied, so nothing was saved. Ask the caller for their number.",
    });
  }

  const input: RecordInput = {
    phone,
    customer_name: str(src.customer_name),
    company: str(src.company),
    bl_number: str(src.bl_number),
    origin: str(src.origin),
    destination: str(src.destination),
    cargo_description: str(src.cargo_description),
    volume_cbm: num(src.volume_cbm),
    container_type: str(src.container_type),
    quoted_amount_inr: num(src.quoted_amount_inr),
    agreed_amount_inr: num(src.agreed_amount_inr),
    sailing_date: str(src.sailing_date),
    status: str(src.status),
    notes: str(src.notes),
    source_call_id: str(body.callId ?? src.call_id),
  };

  try {
    const rec = await upsertRecord(input);

    // Refresh the knowledge base so the next call can recognise this caller. Awaited
    // rather than fired-and-forgotten: an Edge Function may be torn down the moment it
    // responds, so a detached promise is not guaranteed to finish.
    const kb = await syncKb();
    if (!kb.ok) console.error("[araxys] KB sync failed:", kb);

    return json({
      saved: true,
      reference: rec.ref,
      kb_synced: kb.ok,
      result: `Saved. The customer's reference number is ${rec.ref}.`,
    });
  } catch (e) {
    console.error("[araxys] save-customer failed:", e);
    return json({ saved: false, result: "Could not save the customer record.", error: String(e) }, 500);
  }
});
