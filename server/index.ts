/**
 * Araxys backend.
 *
 * Exists for three reasons the frontend genuinely cannot cover:
 *  1. The SnapServe API key must never reach the browser — all SnapServe calls proxy here.
 *  2. SnapServe webhooks (call.started / call.completed) need a server to POST to.
 *  3. The voice agent's mid-call space-availability tool needs a real HTTP endpoint that
 *     answers from live state, which is what makes availability dynamic rather than a
 *     static knowledge-base document.
 */
import express from "express";
import cors from "cors";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFit, type CargoPiece } from "./spaceEngine";
import {
  listSlots,
  getSlot,
  remainingFor,
  commitBooking,
  listPlacements,
  placementsFor,
  usedFor,
  resolveRoute,
  containerDimsFor,
} from "./store";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the SnapServe key from the same .env the setup scripts use. Never sent to the client.
function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, "..", "snapserve-setup", ".env"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  } catch {
    console.warn("[araxys] no snapserve-setup/.env found — SnapServe proxy routes will be disabled");
  }
}
loadEnv();

const SNAPSERVE_BASE_URL = process.env.SNAPSERVE_BASE_URL ?? "https://app.snapserve.ai/api";
const SNAPSERVE_API_KEY = process.env.SNAPSERVE_API_KEY ?? "";
const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------- space availability

function slotView(slot: ReturnType<typeof listSlots>[number]) {
  const rem = remainingFor(slot);
  const used = usedFor(slot.id);
  return {
    ...slot,
    usedLengthM: used.lengthM,
    usedWeightKg: used.weightKg,
    consignmentCount: placementsFor(slot.id).length,
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

app.get("/api/space/slots", (req, res) => {
  const { route, date } = req.query as { route?: string; date?: string };
  let slots = listSlots();
  if (route) {
    const resolved = resolveRoute(route);
    if (resolved) slots = slots.filter((s) => s.route === resolved);
  }
  if (date) slots = slots.filter((s) => s.sailingDate === date);
  res.json({ slots: slots.map(slotView) });
});

/**
 * THE AGENT TOOL. Called by the voice agent mid-conversation.
 *
 * Takes what a customer actually says on a call — route, date, and the dimensions of
 * their cargo — and answers with a real 3D fit decision plus a sentence the agent can
 * speak verbatim. Never decides by volume; see spaceEngine.ts.
 */
app.post("/api/tools/check-space", (req, res) => {
  const {
    route,
    sailing_date,
    length_cm,
    width_cm,
    height_cm,
    quantity,
    weight_kg_each,
    stackable,
    upright_only,
  } = req.body ?? {};

  if (!route) {
    return res.json({
      available: false,
      spoken_answer: "I need to know the route before I can check space — which port are we shipping from and to?",
    });
  }

  const resolvedRoute = resolveRoute(String(route));
  if (!resolvedRoute) {
    return res.json({
      available: false,
      spoken_answer: `I don't have sailings listed for ${route}. Let me check with the desk on that route and call you back.`,
    });
  }

  const piece: CargoPiece = {
    lengthCm: Number(length_cm),
    widthCm: Number(width_cm),
    heightCm: Number(height_cm),
    quantity: Number(quantity),
    weightKgEach: Number(weight_kg_each ?? 0),
    stackable: stackable !== false,
    uprightOnly: upright_only === true,
  };

  let candidates = listSlots().filter((s) => s.route === resolvedRoute && s.status !== "full");
  if (sailing_date) {
    const exact = candidates.filter((s) => s.sailingDate === String(sailing_date));
    if (exact.length) candidates = exact;
    else {
      // Nothing on that exact date — offer the nearest sailings after it instead of failing flat.
      const wanted = new Date(String(sailing_date)).getTime();
      candidates = candidates
        .filter((s) => new Date(s.sailingDate).getTime() >= wanted)
        .sort((a, b) => a.sailingDate.localeCompare(b.sailingDate));
    }
  }

  const options = [];
  for (const slot of candidates) {
    const rem = remainingFor(slot);
    if (!rem) continue;
    const fit = checkFit(rem.dims, { lengthM: rem.lengthM, payloadKg: rem.payloadKg }, piece);
    options.push({ slot, rem, fit });
  }

  const workable = options.filter((o) => o.fit.fits);

  if (!workable.length) {
    const closest = options[0];
    const why = closest?.fit.explanation ?? "There are no open sailings left on that route in this window.";
    return res.json({
      available: false,
      route: resolvedRoute,
      requested_date: sailing_date ?? null,
      spoken_answer:
        sailing_date && candidates.length && candidates[0].sailingDate !== String(sailing_date)
          ? `Nothing sails on exactly ${sailing_date} for ${resolvedRoute}. ${why}`
          : why,
      considered: options.map((o) => ({
        slot_id: o.slot.id,
        sailing_date: o.slot.sailingDate,
        container: o.slot.containerCode,
        reason: o.fit.reason,
        max_pieces_that_fit: o.fit.maxPiecesThatFit ?? 0,
      })),
    });
  }

  // Prefer the earliest sailing; break ties by tightest fit so partly-full boxes fill first.
  workable.sort(
    (a, b) =>
      a.slot.sailingDate.localeCompare(b.slot.sailingDate) ||
      (a.fit.lengthConsumedM ?? 0) - (b.fit.lengthConsumedM ?? 0)
  );
  const best = workable[0];
  const exactDate = sailing_date && best.slot.sailingDate === String(sailing_date);

  res.json({
    available: true,
    route: resolvedRoute,
    slot_id: best.slot.id,
    sailing_date: best.slot.sailingDate,
    cutoff_date: best.slot.cutoffDate,
    carrier: best.slot.carrier,
    container: best.slot.containerCode,
    mode: best.slot.mode,
    loading_plan: {
      across: best.fit.piecesAcrossWidth,
      high: best.fit.piecesStackedHigh,
      per_row: best.fit.piecesPerRow,
      rows: best.fit.rowsNeeded,
      floor_length_needed_m: best.fit.lengthConsumedM,
      total_weight_kg: best.fit.totalWeightKg,
    },
    space_left_after: best.fit.remainingAfter,
    spoken_answer:
      (exactDate
        ? `Yes, there's space on the ${best.slot.sailingDate} sailing to ${resolvedRoute.split("->")[1].trim()}. `
        : `Nothing on that exact date, but the ${best.slot.sailingDate} sailing works. `) +
      `${best.fit.explanation} Booking has to be confirmed by ${best.slot.cutoffDate}.`,
    alternatives: workable.slice(1, 3).map((o) => ({
      slot_id: o.slot.id,
      sailing_date: o.slot.sailingDate,
      cutoff_date: o.slot.cutoffDate,
      container: o.slot.containerCode,
    })),
  });
});

/** Commits space — used by the CRM, and available to the agent once a customer confirms. */
app.post("/api/space/book", (req, res) => {
  const { slot_id, client_name, reference, source, length_cm, width_cm, height_cm, quantity, weight_kg_each, stackable, upright_only } =
    req.body ?? {};
  const slot = getSlot(String(slot_id));
  if (!slot) return res.status(404).json({ error: "unknown slot" });

  const placed = commitBooking({
    slotId: String(slot_id),
    clientName: String(client_name ?? "Unnamed client"),
    reference: String(reference ?? "unspecified"),
    source: source === "voice_agent" ? "voice_agent" : "crm",
    piece: {
      lengthCm: Number(length_cm),
      widthCm: Number(width_cm),
      heightCm: Number(height_cm),
      quantity: Number(quantity),
      weightKgEach: Number(weight_kg_each ?? 0),
      stackable: stackable !== false,
      uprightOnly: upright_only === true,
    },
  });

  if (!placed) {
    const rem = remainingFor(slot);
    return res.status(409).json({
      error: "consignment does not fit in the space remaining",
      remaining: rem ? { lengthM: rem.lengthM, payloadKg: rem.payloadKg } : null,
    });
  }
  res.json({ placement: placed, slot: slotView(getSlot(String(slot_id))!) });
});

/** Full load plan for one container — every consignment, sized and positioned. */
app.get("/api/space/slots/:id/plan", (req, res) => {
  const slot = getSlot(req.params.id);
  if (!slot) return res.status(404).json({ error: "unknown slot" });
  const rem = remainingFor(slot);
  if (!rem) return res.status(400).json({ error: "slot has no container dimensions" });

  res.json({
    slot: slotView(slot),
    container: {
      code: rem.dims.code,
      lengthM: rem.dims.internalLengthM,
      widthM: rem.dims.internalWidthM,
      heightM: rem.dims.internalHeightM,
      maxPayloadKg: rem.dims.maxPayloadKg,
    },
    consignments: placementsFor(slot.id),
    used: rem.used,
    remaining: { lengthM: rem.lengthM, payloadKg: rem.payloadKg, cbm: rem.cbm },
  });
});

app.get("/api/space/placements", (_req, res) => res.json({ placements: listPlacements() }));

app.get("/api/space/containers", (_req, res) => {
  const codes = [...new Set(listSlots().map((s) => s.containerCode))];
  res.json({ containers: codes.map((c) => containerDimsFor(c)).filter(Boolean) });
});

// ------------------------------------------------------------------------ live calls

const LIVE_STATUSES = new Set(["pending", "ringing", "in_progress", "connected"]);

async function snapserve(path: string) {
  if (!SNAPSERVE_API_KEY) throw new Error("SNAPSERVE_API_KEY not configured");
  const r = await fetch(`${SNAPSERVE_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${SNAPSERVE_API_KEY}` },
  });
  if (!r.ok) throw new Error(`snapserve ${path} -> ${r.status}`);
  return r.json();
}

/** Calls currently in progress. The browser polls this; the API key stays server-side. */
app.get("/api/calls/live", async (_req, res) => {
  try {
    const calls = (await snapserve("/calls?limit=25")) as any[];
    const live = calls.filter((c) => LIVE_STATUSES.has(c.status));
    res.json({
      live: live.map((c) => ({
        id: c.id,
        agentName: c.agentName,
        fromNumber: c.fromNumber,
        toNumber: c.toNumber,
        status: c.status,
        direction: c.direction,
        startedAt: c.createdAt,
        durationSeconds: c.durationSeconds,
      })),
      recent: calls.slice(0, 8).map((c) => ({
        id: c.id,
        agentName: c.agentName,
        fromNumber: c.fromNumber,
        status: c.status,
        durationSeconds: c.durationSeconds,
        createdAt: c.createdAt,
      })),
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: String(e), live: [], recent: [] });
  }
});

/**
 * One call's detail, including transcript.
 *
 * Note on live calls: SnapServe populates `transcript` when the call completes — there is
 * no per-turn streaming event on the public API — so a call still in progress returns
 * transcriptAvailable:false rather than a partial transcript. The UI says so plainly
 * instead of implying live text it cannot actually get.
 */
app.get("/api/calls/:id", async (req, res) => {
  try {
    const call = (await snapserve(`/calls/${req.params.id}`)) as any;
    const inProgress = LIVE_STATUSES.has(call.status);
    res.json({
      id: call.id,
      agentName: call.agentName,
      status: call.status,
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      direction: call.direction,
      durationSeconds: call.durationSeconds,
      createdAt: call.createdAt,
      endedAt: call.endedAt,
      transcriptAvailable: Boolean(call.transcript),
      inProgress,
      transcript: call.transcript ?? null,
      callSummary: call.callSummary ?? null,
      dispositionResult: call.dispositionResult ?? null,
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// -------------------------------------------------------------------------- webhooks

interface CallEvent {
  receivedAt: string;
  event: string;
  callId?: number;
  raw: unknown;
}
const callEvents: CallEvent[] = [];

app.post("/api/webhooks/snapserve", (req, res) => {
  const body = req.body ?? {};
  callEvents.unshift({
    receivedAt: new Date().toISOString(),
    event: body.event ?? body.type ?? "unknown",
    callId: body.callId ?? body.call?.id,
    raw: body,
  });
  if (callEvents.length > 200) callEvents.length = 200;
  console.log(`[araxys] webhook ${body.event ?? body.type ?? "unknown"} call=${body.callId ?? body.call?.id ?? "?"}`);
  res.json({ ok: true });
});

app.get("/api/webhooks/events", (_req, res) => res.json({ events: callEvents.slice(0, 50) }));

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, snapserveConfigured: Boolean(SNAPSERVE_API_KEY), slots: listSlots().length })
);

app.listen(PORT, () => {
  console.log(`[araxys] backend on http://localhost:${PORT}`);
  console.log(`[araxys] snapserve key ${SNAPSERVE_API_KEY ? "loaded" : "MISSING"}`);
});
