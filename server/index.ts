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
import { lookup, allShipments, factsFor, phoneKey } from "./shipments";
import { upsertFromCall, listRecords, findByAnything, deleteRecord, backend as recordBackend, type RealRecord } from "./records";
import { syncRealRecordsToKb } from "./kbSync";
import { ingestRecentCalls } from "./transcripts";
import { listCallLogs, callLogsForPhone } from "./supabase";
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

/**
 * Loads the SnapServe key. Locally that comes from the same .env the setup scripts use;
 * in a deployed environment it comes from real environment variables, so anything already
 * present in process.env wins and the missing file is not an error.
 */
function loadEnv() {
  if (process.env.SNAPSERVE_API_KEY) {
    console.log("[araxys] using SNAPSERVE_API_KEY from environment");
    return;
  }
  try {
    const raw = readFileSync(join(__dirname, "..", "snapserve-setup", ".env"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    console.warn("[araxys] no SNAPSERVE_API_KEY set and no snapserve-setup/.env found — SnapServe routes disabled");
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
/**
 * Shipment lookup — AGENT TOOL. The only sanctioned source of shipment facts on a call.
 * Always 200, even on a miss: a miss is a real answer the agent must relay honestly,
 * not an error it should improvise around.
 */
app.post("/api/tools/lookup-shipment", (req, res) => {
  // Log the raw envelope: if SnapServe nests tool arguments (arguments/args/parameters/
  // input) or sends them as a JSON string, reading req.body.bl_number silently yields
  // nothing and looks identical to the model not passing anything.
  console.log("[araxys] RAW lookup body:", JSON.stringify(req.body));
  console.log("[araxys] RAW lookup query:", JSON.stringify(req.query));
  console.log("[araxys] RAW content-type:", req.headers["content-type"]);

  const b: Record<string, unknown> = req.body ?? {};
  const unwrap = (v: unknown): Record<string, unknown> => {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return {};
      }
    }
    return (v as Record<string, unknown>) ?? {};
  };
  const nested = {
    ...unwrap(b.arguments),
    ...unwrap(b.args),
    ...unwrap(b.parameters),
    ...unwrap(b.input),
    ...unwrap((b.tool_call as Record<string, unknown>)?.arguments),
  };
  const src = { ...nested, ...b, ...(req.query as Record<string, unknown>) };

  const bl_number = (src.bl_number ?? src.blNumber ?? src.bl ?? nested.bl_number) as string | undefined;
  const phone = (src.phone ?? src.phone_number ?? src.caller_phone) as string | undefined;
  const result = lookup({ bl_number, phone });

  if (!result.found) {
    console.log(`[araxys] shipment lookup MISS bl=${bl_number ?? "-"} phone=${phone ?? "-"} reason=${result.reason}`);
    return res.json({
      ...result,
      instruction:
        result.hard_stop ??
        "No matching shipment. Say exactly this, and do not invent any status, ETA, container number " +
          "or charge. In particular do not answer from the CRM update block injected earlier — that is " +
          "this caller's own shipment and is not the one they asked about.",
    });
  }

  console.log(`[araxys] shipment lookup HIT ${result.bl_number}`);

  // Deliberately small and flat. A large nested object gives a native-audio model far too
  // much to reconcile against whatever it already believes; a single sentence it can read
  // straight out is much harder to talk past. Detail stays available under `details` for
  // follow-up questions, but `answer` is what should be spoken.
  // Same content under several conventional key names. Which key a platform reads back
  // into the conversation is undocumented here, so covering `result` / `output` / `text` /
  // `message` costs nothing and removes one whole class of silent failure.
  // Bare minimum on purpose. Returning the full record let the native-audio model pick
  // one field it liked (the BL) and improvise the rest; with a single instruction-shaped
  // sentence and nothing else in the payload, there is nothing to cherry-pick from.
  const line =
    `Read this to the caller word for word, and say nothing about this shipment that is not in this sentence: ` +
    result.spoken_summary;
  res.json({ result: line });
});

// ------------------------------------------------- real customer records + KB sync

const AGENT_IDS = [717, 758];

function kbCtx() {
  return { baseUrl: SNAPSERVE_BASE_URL, apiKey: SNAPSERVE_API_KEY, agentIds: AGENT_IDS };
}

/** Fire-and-forget KB refresh — a call must never be held up waiting on this. */
function scheduleKbSync(reason: string) {
  setTimeout(() => {
    syncRealRecordsToKb(kbCtx())
      .then((r) => console.log(`[araxys] KB sync (${reason}):`, r.ok ? "ok" : r.error))
      .catch((e) => console.error("[araxys] KB sync threw:", e));
  }, 50);
}

/**
 * AGENT TOOL — save/refresh a caller's details.
 *
 * Deliberately write-only from the agent's point of view. Tool RESULTS do not reach the
 * model on the Gemini Live stack, but tool ARGUMENTS arrive intact (verified against the
 * live account), so capturing information this way is reliable even though reading back
 * through a tool is not. What the agent needs to KNOW comes from the knowledge base,
 * which this endpoint keeps current.
 */
app.post("/api/tools/save-customer", async (req, res) => {
  console.log("[araxys] RAW save-customer body:", JSON.stringify(req.body));
  const b: Record<string, unknown> = req.body ?? {};
  const args = ((b.args ?? b.arguments ?? b.parameters ?? {}) as Record<string, unknown>) ?? {};
  const src = { ...args, ...b };

  const phone = String(src.phone ?? src.phone_number ?? src.caller_phone ?? "").trim();
  if (!phone) {
    return res.json({
      saved: false,
      result: "No phone number was supplied, so nothing could be saved. Ask the caller for their number.",
    });
  }

  const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

  const rec = await upsertFromCall({
    phone,
    customerName: str(src.customer_name),
    company: str(src.company),
    origin: str(src.origin),
    destination: str(src.destination),
    cargoDescription: str(src.cargo_description),
    volumeCbm: num(src.volume_cbm),
    containerType: str(src.container_type),
    quotedAmountInr: num(src.quoted_amount_inr),
    agreedAmountInr: num(src.agreed_amount_inr),
    sailingDate: str(src.sailing_date),
    blNumber: str(src.bl_number),
    status: str(src.status) ?? "enquiry received",
    notes: str(src.notes),
    sourceCallId: str(b.callId),
  });

  scheduleKbSync(`save-customer ${rec.ref}`);
  res.json({ saved: true, reference: rec.ref, result: `Saved. The customer's reference number is ${rec.ref}.` });
});

app.get("/api/records", async (_req, res) => res.json({ records: await listRecords(), backend: recordBackend() }));

app.get("/api/records/find", async (req, res) => {
  const q = String(req.query.q ?? "");
  const hit = await findByAnything(q);
  res.json({ found: !!hit, record: hit ?? null });
});

app.post("/api/records", async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ error: "phone required" });
  const rec = await upsertFromCall(req.body as Partial<RealRecord> & { phone: string });
  scheduleKbSync("crm edit");
  res.json({ record: rec });
});

app.delete("/api/records/:ref", async (req, res) => {
  const ok = await deleteRecord(req.params.ref);
  if (ok) scheduleKbSync("crm delete");
  res.json({ deleted: ok });
});

app.post("/api/kb/sync", async (_req, res) => res.json(await syncRealRecordsToKb(kbCtx())));

// ------------------------------------------------------- call transcripts

app.post("/api/calls/ingest", async (_req, res) => {
  const r = await ingestRecentCalls({ baseUrl: SNAPSERVE_BASE_URL, apiKey: SNAPSERVE_API_KEY });
  if (r.ok && (r.recordsTouched ?? 0) > 0) scheduleKbSync("transcript ingest");
  res.json(r);
});

app.get("/api/calls/logs", async (req, res) => {
  const phone = String(req.query.phone ?? "");
  try {
    res.json({ logs: phone ? await callLogsForPhone(phone) : await listCallLogs() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Keep transcripts flowing in without anyone remembering to trigger it. Poll rather than
// webhook: a webhook needs a permanently reachable URL, which is the thing that kept
// breaking, and SnapServe's own post-call extraction never fires anyway.
const INGEST_EVERY_MS = 120_000;
setInterval(() => {
  ingestRecentCalls({ baseUrl: SNAPSERVE_BASE_URL, apiKey: SNAPSERVE_API_KEY })
    .then((r) => {
      if (!r.ok) console.warn("[araxys] transcript ingest:", r.error);
      else if ((r.recordsTouched ?? 0) > 0) scheduleKbSync("transcript ingest");
    })
    .catch((e) => console.error("[araxys] transcript ingest threw:", e));
}, INGEST_EVERY_MS);

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

/**
 * Pushes each shipment's confirmed facts into SnapServe caller memory, keyed by the
 * customer's phone. SnapServe injects these as ground truth on the next call, so the
 * agent opens already knowing the caller's real status instead of having to ask — and
 * has no room to invent one. This is the CRM -> SnapServe half of the sync; the CRM
 * stays the system of record.
 */
async function syncCallerMemory(agentId: string) {
  if (!SNAPSERVE_API_KEY) return { ok: false, error: "no SnapServe key configured" };

  const results: Array<{ phone: string; bl: string; ok: boolean; detail?: string }> = [];
  const skipped: Array<{ phone: string; bl: string }> = [];

  for (const s of allShipments()) {
    const f = factsFor(s);
    const key = phoneKey(s.phone);
    if (key.length < 10) continue;

    // Never inject placeholder records as ground truth. A half-captured lead ("Unidentified
    // caller", carrier "TBD", ETA "Pending booking") is not a confirmed shipment, and once
    // injected the agent will answer from it with total confidence — which is exactly how a
    // caller ends up being told their Jeddah container is in Singapore.
    const placeholder =
      /unidentified|not captured|unknown/i.test(`${f.customer_name} ${f.company}`) ||
      /tbd|pending/i.test(f.carrier) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(f.eta_date);
    if (placeholder) {
      console.log(`[araxys] caller-memory SKIP ${f.bl_number} — placeholder record, not confirmed fact`);
      skipped.push({ phone: s.phone, bl: f.bl_number });
      continue;
    }

    const missing = f.documents_missing.map((d) => (d.due_date ? `${d.name} (due ${d.due_date})` : d.name));
    // Scoped deliberately: the agent must not read this as the answer to ANY shipment
    // question, only as this caller's own most recent one.
    const note =
      `This caller's most recent shipment is ${f.bl_number}. ` +
      `Status ${f.status.replace(/_/g, " ")}, ${f.origin} to ${f.destination} on ${f.carrier}. ` +
      (f.delivered_date ? `Delivered ${f.delivered_date}.` : `ETA ${f.eta_date}.`) +
      (missing.length ? ` Outstanding documents: ${missing.join(", ")}.` : " All documents received.") +
      (f.demurrage_start_date ? ` Demurrage starts ${f.demurrage_start_date}.` : "") +
      ` IMPORTANT: if the caller asks about any BL number other than ${f.bl_number}, these facts do not ` +
      `apply — call the lookup_shipment tool with the BL number they said instead of answering from here.`;

    const context: Record<string, string | number> = {
      bl_number: f.bl_number,
      order_status: f.status,
      origin: f.origin,
      destination: f.destination,
      carrier: f.carrier,
      eta_date: f.eta_date,
    };
    if (f.container_id) context.container_id = f.container_id;
    if (f.free_days_remaining !== null) context.free_days_remaining = f.free_days_remaining;
    if (f.demurrage_start_date) context.demurrage_start_date = f.demurrage_start_date;
    if (missing.length) context.documents_missing = missing.join("; ");

    try {
      const r = await fetch(
        `${SNAPSERVE_BASE_URL}/agents/${agentId}/caller-memory/${encodeURIComponent(s.phone)}/facts`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${SNAPSERVE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ note, context }),
        }
      );
      results.push({ phone: s.phone, bl: f.bl_number, ok: r.ok, detail: r.ok ? undefined : await r.text() });
    } catch (e) {
      results.push({ phone: s.phone, bl: f.bl_number, ok: false, detail: String(e) });
    }
  }
  return {
    ok: true,
    synced: results.filter((r) => r.ok).length,
    skipped,
    failed: results.filter((r) => !r.ok),
    results,
  };
}

app.post("/api/sync/caller-memory", async (req, res) => {
  const agentId = String(req.body?.agent_id ?? "717");
  res.json(await syncCallerMemory(agentId));
});

/**
 * Overwrites a caller's memory with an explicit "nothing confirmed on file" note.
 *
 * Facts already written to SnapServe do not expire on their own, so a bad entry keeps
 * being injected as ground truth on every future call. Blanking the values and stating
 * plainly that there is no confirmed shipment is what stops the agent answering from it.
 */
app.post("/api/sync/clear-caller-memory", async (req, res) => {
  const agentId = String(req.body?.agent_id ?? "717");
  const phone = String(req.body?.phone ?? "");
  if (!phone) return res.status(400).json({ error: "phone required" });
  if (!SNAPSERVE_API_KEY) return res.status(400).json({ error: "no SnapServe key configured" });

  const body = {
    note:
      "No confirmed shipment on file for this caller. Do not state any shipment status, route, ETA, " +
      "container number or document position for them from memory. Always call the lookup_shipment " +
      "tool with the BL number they give you.",
    context: {
      bl_number: "none on file",
      order_status: "none on file",
      origin: "none on file",
      destination: "none on file",
      carrier: "none on file",
      eta_date: "none on file",
      container_id: "none on file",
      documents_missing: "none on file",
      demurrage_start_date: "none on file",
      free_days_remaining: "none on file",
    },
  };

  const r = await fetch(
    `${SNAPSERVE_BASE_URL}/agents/${agentId}/caller-memory/${encodeURIComponent(phone)}/facts`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${SNAPSERVE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  console.log(`[araxys] cleared caller memory for ${phone} -> ${r.status}`);
  res.json({ ok: r.ok, status: r.status, detail: r.ok ? undefined : await r.text() });
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, snapserveConfigured: Boolean(SNAPSERVE_API_KEY), slots: listSlots().length })
);

app.listen(PORT, () => {
  console.log(`[araxys] backend on http://localhost:${PORT}`);
  console.log(`[araxys] snapserve key ${SNAPSERVE_API_KEY ? "loaded" : "MISSING"}`);
});
