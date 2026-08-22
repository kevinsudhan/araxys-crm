/**
 * End-to-end check of the hosted stack.
 *
 * Exists because "it deployed" and "it works" are different claims, and this project has
 * repeatedly looked healthy while something behind it was silently broken (a dead tunnel,
 * a stale process on the port, a knowledge source stuck at status "failed").
 *
 *   node scripts/verify-hosted.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, "..", "snapserve-setup", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const API = `${process.env.SUPABASE_URL}/functions/v1/api`;
const SNAP = process.env.SNAPSERVE_BASE_URL;
const SNAP_KEY = process.env.SNAPSERVE_API_KEY;

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = "") => {
  console.log(cond ? `  PASS  ${label}` : `  FAIL  ${label} ${detail}`);
  cond ? pass++ : fail++;
};

async function jget(path) {
  const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(45000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

console.log("\n── Hosted API ──────────────────────────────");
{
  const h = await jget("/health");
  ok("/health responds", h.status === 200 && h.body?.ok === true);
  ok("running on edge runtime", h.body?.runtime === "edge", JSON.stringify(h.body));
  ok("SnapServe key present server-side", h.body?.snapserveConfigured === true);
  ok("space slots loaded from Postgres", (h.body?.slots ?? 0) === 12, `got ${h.body?.slots}`);
}

console.log("\n── Customer records ────────────────────────");
{
  const r = await jget("/records");
  const recs = r.body?.records ?? [];
  ok("/records returns rows", recs.length > 0, `${recs.length} records`);

  // Derived rather than hardcoded: keeps a real personal number out of the repo, and the
  // check stays meaningful as the data changes instead of pinning to one caller.
  const named = recs.find((x) => x.customerName);
  ok("a caller's name was extracted from a transcript", Boolean(named), "no record has a name yet");
  ok("route extracted for that caller", Boolean(named?.origin || named?.destination), JSON.stringify([named?.origin, named?.destination]));
  ok("recognisable without a BL number", recs.some((x) => !x.blNumber));

  if (named?.customerName) {
    const f = await jget(`/records/find?q=${encodeURIComponent(named.customerName)}`);
    ok("lookup by name works", f.body?.found === true);
  }
  if (named?.phone) {
    const f2 = await jget(`/records/find?q=${encodeURIComponent(named.phone)}`);
    ok("lookup by phone works", f2.body?.found === true);
  }
}

console.log("\n── Call transcripts & summaries ────────────");
{
  const r = await jget("/calls/logs");
  const logs = r.body?.logs ?? [];
  ok("transcripts stored", logs.length > 0, `${logs.length} logs`);
  const withSummary = logs.filter((l) => l.summary);
  ok("summaries generated", withSummary.length > 0, `${withSummary.length} with summary`);
  // Real duplication is the same sentence appearing twice in one line — not merely
  // run-together words, which are an ASR artefact we deliberately do not try to split.
  const dup = logs.find((l) =>
    (l.transcript ?? "").split("\n").some((line) => {
      const body = line.replace(/^(Agent|Caller):\s*/, "");
      const sentences = body.split(/(?<=[.!?])\s+/).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
      return new Set(sentences).size < sentences.length;
    })
  );
  ok("no repeated sentences in transcripts", !dup, dup ? `call ${dup.call_id}` : "");
  const spaced = logs.find((l) => /\.[A-Z]/.test(l.transcript ?? ""));
  ok("spacing repaired after punctuation", !spaced, spaced ? `call ${spaced.call_id}` : "");
  const anyPhone = logs.find((l) => l.phone_key)?.phone_key;
  if (anyPhone) {
    const linked = await jget(`/calls/logs?phone=${encodeURIComponent(anyPhone)}`);
    ok("calls linked to a customer by phone", (linked.body?.logs ?? []).length > 0);
  }
}

console.log("\n── Container space (3D engine) ─────────────");
{
  const s = await jget("/space/slots");
  const slots = s.body?.slots ?? [];
  ok("slots served", slots.length === 12, `${slots.length}`);
  ok("occupancy derived from placements", slots.some((x) => x.usedLengthM > 0));

  const withCargo = slots.find((x) => x.consignmentCount > 0);
  const plan = await jget(`/space/slots/${withCargo.id}/plan`);
  ok("load plan returns consignments", (plan.body?.consignments ?? []).length > 0);
  ok("consignments have client names", Boolean(plan.body?.consignments?.[0]?.clientName));

  const fit = await fetch(`${API}/tools/check-space`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      args: { route: "Chennai to Singapore", length_cm: 120, width_cm: 100, height_cm: 110, quantity: 10, weight_kg_each: 180 },
    }),
    signal: AbortSignal.timeout(45000),
  }).then((r) => r.json());
  ok("space tool answers", fit.available === true, JSON.stringify(fit).slice(0, 80));

  const tall = await fetch(`${API}/tools/check-space`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      args: { route: "Chennai to Singapore", length_cm: 120, width_cm: 90, height_cm: 300, quantity: 1, weight_kg_each: 300, upright_only: true },
    }),
    signal: AbortSignal.timeout(45000),
  }).then((r) => r.json());
  ok("rejects cargo that cannot physically fit", tall.available === false);
}

console.log("\n── SnapServe wiring ────────────────────────");
{
  const a = await fetch(`${SNAP}/agents/717`, { headers: { Authorization: `Bearer ${SNAP_KEY}` } }).then((r) => r.json());
  ok("Priya is active", a.status === "active");
  ok("phone number bound for inbound", a.inboundPhoneNumberId === 24);
  ok("bilingual configured", a.agentConfig?.isMultilingual === true);
  ok("asks for caller name", /GET THE CALLER'S NAME EARLY/.test(a.systemPrompt ?? ""));
  ok("anti-fabrication rule present", /SHIPMENT FACTS -- ABSOLUTE RULE/.test(a.systemPrompt ?? ""));

  const toolUrls = (a.tools ?? []).filter((t) => t.url);
  ok("no tool points at a dead tunnel", !toolUrls.some((t) => t.url.includes("trycloudflare")));
  ok("space tool points at hosted API", toolUrls.some((t) => t.url.includes("functions/v1/api")));

  const ks = await fetch(`${SNAP}/knowledge-sources`, { headers: { Authorization: `Bearer ${SNAP_KEY}` } }).then((r) => r.json());
  const live = ks.find((s) => s.name === "Araxys real customer records");
  ok("customer KB source exists", Boolean(live));
  ok("KB source is ready (attachable)", live?.status === "ready", `status ${live?.status}`);
  ok("KB attached to agents", (live?.attachedAgentCount ?? 0) >= 1, `${live?.attachedAgentCount} agents`);
  ok("all KB sources ready", ks.every((s) => s.status === "ready"), ks.filter((s) => s.status !== "ready").map((s) => s.name).join(","));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
