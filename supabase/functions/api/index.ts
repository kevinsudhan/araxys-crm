/**
 * The Araxys backend, as a single Edge Function.
 *
 * Replaces the Express server that had to run on someone's laptop behind a tunnel. Two
 * things that kept breaking are gone as a result: the tunnel dying (taking the agent's
 * tools with it, silently, mid-call) and space bookings resetting on every restart.
 *
 * The SnapServe key lives in function secrets and is never sent to the browser, which is
 * the same reason the Express version existed at all.
 */
import { listRecords, findByAnything, upsertRecord, syncKb, syncCallerMemory, syncSpaceKb, phoneKey } from "../_shared/records.ts";
import {
  listSlots,
  getSlot,
  remainingFor,
  placementsFor,
  containerDimsFor,
  resolveRoute,
  commitBooking,
  checkFit,
  type CargoPiece,
} from "../_shared/space.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SNAPSERVE_KEY = Deno.env.get("SNAPSERVE_API_KEY") ?? "";
const SNAPSERVE_BASE = Deno.env.get("SNAPSERVE_BASE_URL") ?? "https://app.snapserve.ai/api";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
  return t ? JSON.parse(t) : null;
}

async function slotView(slot: Awaited<ReturnType<typeof getSlot>>) {
  if (!slot) return null;
  const rem = await remainingFor(slot);
  return {
    id: slot.id,
    route: slot.route,
    carrier: slot.carrier,
    sailingDate: slot.sailing_date,
    cutoffDate: slot.cutoff_date,
    containerCode: slot.container_code,
    mode: slot.mode,
    status: slot.status,
    usedLengthM: rem?.used.lengthM ?? 0,
    usedWeightKg: rem?.used.weightKg ?? 0,
    consignmentCount: rem?.placements.length ?? 0,
    internal: rem
      ? {
          lengthM: rem.dims.internalLengthM,
          widthM: rem.dims.internalWidthM,
          heightM: rem.dims.internalHeightM,
          maxPayloadKg: rem.dims.maxPayloadKg,
        }
      : null,
    remaining: rem ? { lengthM: rem.lengthM, payloadKg: rem.payloadKg, cbm: rem.cbm } : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);

  // Strip the function mount point so routes read the same as they did under Express.
  //
  // This has to tolerate several shapes. Supabase hands the function a pathname of
  // "/api/<route>" (function name + route), while a client whose base URL already ends in
  // "/api" produces "/api/api/<route>". Stripping only once left "/api/records" unrouted
  // and 404ing — which looked exactly like the backend being down.
  let path = url.pathname.replace(/^\/functions\/v1/, "");
  while (path === "/api" || path.startsWith("/api/")) path = path.slice(4);
  path = path || "/";
  const q = url.searchParams;

  try {
    if (path === "/health" || path === "/") {
      const slots = await listSlots();
      return json({ ok: true, snapserveConfigured: Boolean(SNAPSERVE_KEY), slots: slots.length, runtime: "edge" });
    }

    // -------------------------------------------------------------- records

    if (path === "/records" && req.method === "GET") {
      return json({ records: await listRecords(), backend: "supabase" });
    }

    if (path === "/records/find" && req.method === "GET") {
      const hit = await findByAnything(q.get("q") ?? "");
      return json({ found: Boolean(hit), record: hit ?? null });
    }

    if (path === "/records" && req.method === "POST") {
      const body = await req.json();
      if (!body?.phone) return json({ error: "phone required" }, 400);
      const rec = await upsertRecord(body);
      await syncKb();
      return json({ record: rec });
    }

    if (path.startsWith("/records/") && req.method === "DELETE") {
      const ref = decodeURIComponent(path.split("/")[2]);
      await db(`real_records?ref=eq.${encodeURIComponent(ref)}`, { method: "DELETE" });
      await syncKb();
      return json({ deleted: true });
    }

    // -------------------------------------------------------------- knowledge base

    if (path === "/kb/sync" && req.method === "POST") return json(await syncKb());

    if (path === "/caller-memory/sync" && req.method === "POST") return json(await syncCallerMemory());

    if (path === "/space/sync-kb" && req.method === "POST") return json(await syncSpaceKb());

    // -------------------------------------------------------------- call logs

    if (path === "/calls/logs" && req.method === "GET") {
      const phone = q.get("phone");
      const filter = phone ? `&phone_key=eq.${encodeURIComponent(phoneKey(phone))}` : "";
      const logs = await db(`call_logs?select=*${filter}&order=started_at.desc.nullslast&limit=50`);
      return json({ logs: logs ?? [] });
    }

    // -------------------------------------------------------------- space

    if (path === "/space/slots" && req.method === "GET") {
      let slots = await listSlots();
      const route = q.get("route");
      if (route) {
        const resolved = await resolveRoute(route);
        if (resolved) slots = slots.filter((s) => s.route === resolved);
      }
      const date = q.get("date");
      if (date) slots = slots.filter((s) => s.sailing_date === date);
      return json({ slots: await Promise.all(slots.map(slotView)) });
    }

    if (path.match(/^\/space\/slots\/[^/]+\/plan$/) && req.method === "GET") {
      const id = path.split("/")[3];
      const slot = await getSlot(id);
      if (!slot) return json({ error: "unknown slot" }, 404);
      const rem = await remainingFor(slot);
      if (!rem) return json({ error: "slot has no container dimensions" }, 400);
      return json({
        slot: await slotView(slot),
        container: {
          code: rem.dims.code,
          lengthM: rem.dims.internalLengthM,
          widthM: rem.dims.internalWidthM,
          heightM: rem.dims.internalHeightM,
          maxPayloadKg: rem.dims.maxPayloadKg,
        },
        // Re-shaped to the camelCase the CRM already expects.
        consignments: rem.placements.map((p) => ({
          id: p.id,
          slotId: p.slot_id,
          clientName: p.client_name,
          reference: p.reference,
          xM: Number(p.x_m),
          lengthM: Number(p.length_m),
          piecesAcross: p.pieces_across,
          piecesHigh: p.pieces_high,
          rows: p.rows_count,
          quantity: p.quantity,
          pieceLengthM: Number(p.piece_length_m),
          pieceWidthM: Number(p.piece_width_m),
          pieceHeightM: Number(p.piece_height_m),
          weightKg: Number(p.weight_kg),
          colorIndex: p.color_index,
          source: p.source,
        })),
        used: rem.used,
        remaining: { lengthM: rem.lengthM, payloadKg: rem.payloadKg, cbm: rem.cbm },
      });
    }

    if (path === "/space/book" && req.method === "POST") {
      const b = await req.json();
      const placed = await commitBooking({
        slotId: String(b.slot_id),
        clientName: String(b.client_name ?? "Unnamed client"),
        reference: String(b.reference ?? "unspecified"),
        source: b.source === "voice_agent" ? "voice_agent" : "crm",
        piece: {
          lengthCm: Number(b.length_cm),
          widthCm: Number(b.width_cm),
          heightCm: Number(b.height_cm),
          quantity: Number(b.quantity),
          weightKgEach: Number(b.weight_kg_each ?? 0),
          stackable: b.stackable !== false,
          uprightOnly: b.upright_only === true,
        },
      });
      if (!placed) return json({ error: "consignment does not fit in the space remaining" }, 409);
      // A booking changes what is available, so the agent's copy must not go stale.
      await syncSpaceKb();
      return json({ placement: placed, slot: await slotView(await getSlot(String(b.slot_id))) });
    }

    if (path === "/space/containers" && req.method === "GET") {
      return json({ containers: ["20GP", "40GP", "40HC", "20RF", "40RF"].map((c) => containerDimsFor(c)) });
    }

    // -------------------------------------------------------------- agent tool

    if (path === "/tools/check-space" && req.method === "POST") {
      const raw = await req.json();
      // SnapServe nests tool arguments under `args`.
      const a = { ...(raw.args ?? raw.arguments ?? {}), ...raw };

      if (!a.route) {
        return json({
          available: false,
          spoken_answer: "I need to know the route before I can check space -- which port are we shipping from and to?",
        });
      }
      const resolved = await resolveRoute(String(a.route));
      if (!resolved) {
        return json({
          available: false,
          spoken_answer: `I don't have sailings listed for ${a.route}. Let me check with the desk on that route and call you back.`,
        });
      }

      const piece: CargoPiece = {
        lengthCm: Number(a.length_cm),
        widthCm: Number(a.width_cm),
        heightCm: Number(a.height_cm),
        quantity: Number(a.quantity),
        weightKgEach: Number(a.weight_kg_each ?? 0),
        stackable: a.stackable !== false,
        uprightOnly: a.upright_only === true,
      };

      let candidates = (await listSlots()).filter((s) => s.route === resolved && s.status !== "full");
      if (a.sailing_date) {
        const exact = candidates.filter((s) => s.sailing_date === String(a.sailing_date));
        if (exact.length) candidates = exact;
        else {
          const wanted = new Date(String(a.sailing_date)).getTime();
          candidates = candidates
            .filter((s) => new Date(s.sailing_date).getTime() >= wanted)
            .sort((x, y) => x.sailing_date.localeCompare(y.sailing_date));
        }
      }

      const options = [];
      for (const slot of candidates) {
        const rem = await remainingFor(slot);
        if (!rem) continue;
        options.push({ slot, fit: checkFit(rem.dims, { lengthM: rem.lengthM, payloadKg: rem.payloadKg }, piece) });
      }

      const workable = options.filter((o) => o.fit.fits);
      if (!workable.length) {
        const why = options[0]?.fit.explanation ?? "There are no open sailings left on that route in this window.";
        return json({ available: false, route: resolved, result: why, spoken_answer: why });
      }

      workable.sort(
        (x, y) =>
          x.slot.sailing_date.localeCompare(y.slot.sailing_date) ||
          (x.fit.lengthConsumedM ?? 0) - (y.fit.lengthConsumedM ?? 0)
      );
      const best = workable[0];
      const exactDate = a.sailing_date && best.slot.sailing_date === String(a.sailing_date);
      const spoken =
        (exactDate
          ? `Yes, there's space on the ${best.slot.sailing_date} sailing. `
          : `Nothing on that exact date, but the ${best.slot.sailing_date} sailing works. `) +
        `${best.fit.explanation} Booking has to be confirmed by ${best.slot.cutoff_date}.`;

      return json({
        available: true,
        route: resolved,
        slot_id: best.slot.id,
        sailing_date: best.slot.sailing_date,
        cutoff_date: best.slot.cutoff_date,
        container: best.slot.container_code,
        result: spoken,
        spoken_answer: spoken,
      });
    }

    // -------------------------------------------------------------- SnapServe proxy

    if (path === "/calls/live" && req.method === "GET") {
      if (!SNAPSERVE_KEY) return json({ live: [], recent: [], error: "SnapServe not configured" });
      const r = await fetch(`${SNAPSERVE_BASE}/calls?limit=20`, {
        headers: { Authorization: `Bearer ${SNAPSERVE_KEY}` },
      });
      const calls = r.ok ? await r.json() : [];
      const shape = (c: Record<string, unknown>) => ({
        id: c.id,
        agentName: c.agentName,
        fromNumber: c.fromNumber,
        toNumber: c.toNumber,
        status: c.status,
        direction: c.direction,
        startedAt: c.createdAt,
        durationSeconds: c.durationSeconds,
      });
      return json({
        live: (calls as Record<string, unknown>[])
          .filter((c) => ["in_progress", "ringing", "connected", "pending"].includes(String(c.status)))
          .map(shape),
        recent: (calls as Record<string, unknown>[]).slice(0, 10).map(shape),
      });
    }

    return json({ error: "not found", path }, 404);
  } catch (e) {
    console.error("[araxys/api]", path, e);
    return json({ error: String(e) }, 500);
  }
});
