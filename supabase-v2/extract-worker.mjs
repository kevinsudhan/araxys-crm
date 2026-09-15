/**
 * Fills in call details using a local model instead of the Claude API.
 *
 *   node supabase-v2/extract-worker.mjs              # one pass over unfilled calls
 *   node supabase-v2/extract-worker.mjs --watch      # keep going, every 60s
 *   node supabase-v2/extract-worker.mjs --call 21775 # one specific call
 *   node supabase-v2/extract-worker.mjs --model qwen2.5:7b-instruct
 *   node supabase-v2/extract-worker.mjs --dry        # show what it read, write nothing
 *   node supabase-v2/extract-worker.mjs --all        # re-read every call, not just unfilled
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS HERE AND NOT IN THE EDGE FUNCTION
 *
 * Extraction used to happen inside ingest-calls, which runs in Supabase's
 * cloud. Ollama listens on localhost, and the cloud cannot reach this machine,
 * so the work has to move to where the model is rather than the other way
 * round. Exposing Ollama through a tunnel would keep the old shape at the cost
 * of leaving an unauthenticated model endpoint on the internet.
 *
 * It slots into what already exists: with EXTRACTION_DISABLED=true the edge
 * function still ingests every call, creates the customer and the enquiry, and
 * simply leaves the detail fields empty. Those empty rows are what this picks
 * up. Nothing had to be rewired.
 *
 * WHAT IT WILL AND WILL NOT DO
 *
 * Only blanks are filled. A value somebody typed at the desk, or that an
 * earlier call established, is never overwritten by a later reading of a
 * transcript. Volume and gross weight stay derived in code and are never taken
 * from the model. A price the agent named becomes a quote marked 'sent'; a yes
 * on the call sets verbal_accept_at and nothing more, because acceptance still
 * means confirmed in writing.
 *
 * Measured on three real transcripts against the production prompts, llama3.1:8b
 * held the null discipline that matters most: it left quoted_amount_inr empty
 * when only a per-CBM rate had been named, and it read "1/2 kg" as 0.5 rather
 * than rounding it to something tidier.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { id: PROJECT } = JSON.parse(readFileSync(join(root, "server-v2/.project.json"), "utf-8"));
const { service_role } = JSON.parse(readFileSync(join(root, "server-v2/.keys.json"), "utf-8"));

const BASE = `https://${PROJECT}.supabase.co/rest/v1`;
const H = {
  apikey: service_role,
  Authorization: `Bearer ${service_role}`,
  "Content-Type": "application/json",
};

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const MODEL = arg("--model", "llama3.1:8b");
const ONLY = arg("--call", null);
const DRY = process.argv.includes("--dry");
const WATCH = process.argv.includes("--watch");
const ALL = process.argv.includes("--all");

// ---------------------------------------------------------------------------
// The prompts, lifted from the deployed extractor so the two cannot drift.
// ---------------------------------------------------------------------------
const src = readFileSync(join(root, "supabase-v2/functions/ingest-calls/extract.ts"), "utf-8");
const grab = (name) => {
  const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`could not find ${name} in extract.ts`);
  return m[1];
};
const SYSTEM = grab("SYSTEM");
const SHAPE = grab("SHAPE");

const db = async (path, init = {}) => {
  const r = await fetch(`${BASE}/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} on ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

/**
 * Same guards as the cloud extractor: zero is not a measurement, it is a slot
 * the model could not leave empty, and dimensions nobody separated are not
 * dimensions.
 */
function normalise(e) {
  const num = (v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (v) => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t && !/^(null|n\/a|unknown|none|not (given|mentioned|stated))$/i.test(t) ? t : null;
  };
  const date = (v) => {
    const s = str(v);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const separated = e.dimensions_stated_separately === true;
  return {
    customer_name: str(e.customer_name),
    company: str(e.company),
    email: str(e.email)?.toLowerCase() ?? null,
    origin: str(e.origin),
    destination: str(e.destination),
    cargo: str(e.cargo),
    incoterm: str(e.incoterm)?.toUpperCase() ?? null,
    piece_count: num(e.piece_count),
    piece_length_cm: separated ? num(e.piece_length_cm) : null,
    piece_width_cm: separated ? num(e.piece_width_cm) : null,
    piece_height_cm: separated ? num(e.piece_height_cm) : null,
    weight_per_piece_kg: num(e.weight_per_piece_kg),
    dimensions_stated_separately: separated,
    ready_date: date(e.ready_date),
    pickup_location: str(e.pickup_location),
    consignee_name: str(e.consignee_name),
    consignee_country: str(e.consignee_country),
    special_handling: str(e.special_handling),
    quoted_amount_inr: num(e.quoted_amount_inr),
    quoted_basis: str(e.quoted_basis),
    agreed_sailing_date: date(e.agreed_sailing_date),
    quote_accepted: e.quote_accepted === true,
    language: str(e.language),
    summary: str(e.summary),
  };
}

async function extract(transcript, when) {
  if (transcript.trim().length < 40) return null;

  const user =
    `This call took place on ${(when ?? new Date().toISOString()).slice(0, 10)}. ` +
    `Resolve any relative date ("the 8th", "next Monday") against that, choosing the ` +
    `reading that puts the sailing in the future.\n\n` +
    `Return exactly this shape:\n${SHAPE}\n\nTRANSCRIPT:\n${transcript.slice(0, 24000)}`;

  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      // Ollama constrains the decode to valid JSON, which removes the whole
      // class of "the model wrapped it in prose" failures.
      format: "json",
      // temperature 0 alone is not determinism: the same transcript produced
      // 30 cm on one run and 120 on the next. A fixed seed makes a wrong
      // reading reproducible, which is the difference between a bug you can
      // chase and one that moves when you look at it.
      options: { temperature: 0, num_ctx: 8192, seed: 42, top_p: 1, top_k: 1 },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });

  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const body = await r.json();
  const text = (body.message?.content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return normalise(JSON.parse(text));
}

/** Only fields the enquiry does not already hold. */
function fillBlanks(existing, found, fields) {
  const patch = {};
  for (const f of fields) {
    const has = existing[f];
    const got = found[f];
    if (got !== null && got !== undefined && (has === null || has === undefined || has === "")) {
      patch[f] = got;
    }
  }
  return patch;
}

const FIELDS = [
  "origin", "destination", "cargo", "incoterm",
  "piece_count", "piece_length_cm", "piece_width_cm", "piece_height_cm",
  "weight_per_piece_kg", "ready_date", "pickup_location",
  "consignee_name", "consignee_country", "special_handling",
];

async function processCall(call) {
  const found = await extract(call.transcript ?? "", call.started_at);
  if (!found) return { call: call.call_id, skipped: "transcript too short" };

  if (DRY) return { call: call.call_id, read: found };

  const out = { call: call.call_id, filled: 0, quote: null, email: null, customer: null };

  // The call row itself: language and summary come straight off the reading.
  const callPatch = {};
  if (found.language && !call.language) callPatch.language = found.language;
  if (found.summary && !call.summary) callPatch.summary = found.summary;
  if (Object.keys(callPatch).length) {
    await db(`calls?call_id=eq.${call.call_id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(callPatch),
    });
  }

  /**
   * A name the caller gave replaces "Caller 9188...", but only on a
   * provisional record. Somebody entered by hand is never renamed because a
   * transcript heard something else — and the company only fills when it is
   * still empty, for the same reason.
   *
   * This was missing entirely: the model had been returning customer_name and
   * company on every call and the worker was throwing both away, so every
   * caller stayed "Caller 91…" no matter what they said.
   */
  if (call.customer_id && (found.customer_name || found.company)) {
    const [customer] = await db(`customers?id=eq.${call.customer_id}&select=id,name,company`);
    if (customer) {
      const patch = {};
      if (found.customer_name && String(customer.name ?? "").startsWith("Caller ")) {
        patch.name = found.customer_name;
      }
      if (found.company && !String(customer.company ?? "").trim()) {
        patch.company = found.company;
      }
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        await db(`customers?id=eq.${call.customer_id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(patch),
        });
        out.customer = Object.entries(patch)
          .filter(([k]) => k !== "updated_at")
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
      }
    }
  }

  // An address heard on the call is the bridge to that customer's mail.
  // Reported only when it is NEW: the RPC is idempotent, so re-linking the same
  // address every pass was counting as a change and triggering a caller-memory
  // and knowledge-base republish every single minute.
  if (found.email && call.customer_id) {
    const [before] = await db(`customers?id=eq.${call.customer_id}&select=emails`);
    const known = (before?.emails ?? []).map((e) => String(e).toLowerCase());
    const isNew = !known.includes(found.email.toLowerCase());
    await db("rpc/link_email_to_customer", {
      method: "POST",
      body: JSON.stringify({ p_customer_id: call.customer_id, p_email: found.email }),
    });
    if (isNew) out.email = found.email;
  }

  if (!call.enquiry_ref) return out;

  const [current] = await db(`enquiries?select=*&ref=eq.${encodeURIComponent(call.enquiry_ref)}`);
  if (!current) return out;

  const patch = fillBlanks(current, found, FIELDS);

  // Volume and gross weight stay derived here, never read off the transcript.
  const l = patch.piece_length_cm ?? current.piece_length_cm;
  const w = patch.piece_width_cm ?? current.piece_width_cm;
  const h = patch.piece_height_cm ?? current.piece_height_cm;
  const n = patch.piece_count ?? current.piece_count;
  const kg = patch.weight_per_piece_kg ?? current.weight_per_piece_kg;
  if (l && w && h && n) patch.volume_cbm = Number(((l * w * h * n) / 1_000_000).toFixed(2));
  if (kg && n) patch.gross_weight_kg = Number((kg * n).toFixed(2));

  if (Object.keys(patch).length && current.status === "new") patch.status = "qualifying";

  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    await db(`enquiries?ref=eq.${encodeURIComponent(call.enquiry_ref)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    out.filled = Object.keys(patch).length;
  }

  // A price named on the call is a quote that was communicated. A yes on the
  // phone is a verbal indication only — acceptance still means in writing.
  if (found.quoted_amount_inr) {
    const priced = await db(
      `quotes?select=id,version,amount_inr&enquiry_ref=eq.${encodeURIComponent(call.enquiry_ref)}` +
        `&order=version.desc&limit=1`
    );
    const same = priced.length && Number(priced[0].amount_inr) === Number(found.quoted_amount_inr);

    if (same && found.quote_accepted) {
      await db(`quotes?id=eq.${priced[0].id}&verbal_accept_at=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ verbal_accept_at: new Date().toISOString() }),
      });
    }

    if (!same) {
      const [created] = await db("quotes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          enquiry_ref: call.enquiry_ref,
          version: (priced[0]?.version ?? 0) + 1,
          amount_inr: found.quoted_amount_inr,
          basis: [found.quoted_basis, "quoted on call"].filter(Boolean).join(" — "),
          sailing_date: found.agreed_sailing_date,
          status: "sent",
          sent_at: new Date().toISOString(),
          verbal_accept_at: found.quote_accepted ? new Date().toISOString() : null,
        }),
      });

      await db(`enquiries?ref=eq.${encodeURIComponent(call.enquiry_ref)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "quoted", updated_at: new Date().toISOString() }),
      });

      await db("enquiry_events", {
        method: "POST",
        body: JSON.stringify({
          enquiry_ref: call.enquiry_ref,
          kind: found.quote_accepted ? "verbal_accept" : "quote_sent",
          summary:
            `Quoted ₹${found.quoted_amount_inr.toLocaleString("en-IN")}` +
            `${found.quoted_basis ? ` ${found.quoted_basis}` : ""} on the call` +
            (found.quote_accepted ? " — agreed verbally, still to be confirmed in writing" : ""),
          detail: { call_id: call.call_id, from: `local:${MODEL}`, quote_id: created?.id },
        }),
      });
      out.quote = `v${(priced[0]?.version ?? 0) + 1} ₹${found.quoted_amount_inr}`;
    }
  }

  return out;
}

/** Stamped whether or not anything was found, so a call is never re-read. */
async function markAttempted(callId) {
  await db(`calls?call_id=eq.${callId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ extracted_at: new Date().toISOString() }),
  });
}

/**
 * Calls worth reading.
 *
 * "Already extracted" cannot be judged from the call row: SnapServe writes its
 * own callSummary during ingest, and language arrives as an empty string rather
 * than null, so both look filled when nothing has been read. The honest signal
 * is the ENQUIRY -- if it still has no cargo and no dimensions, nothing has
 * been taken off the transcript yet.
 *
 * --all re-reads everything regardless, for when the model or the prompt has
 * changed and you want the fields rebuilt.
 */
async function pending() {
  if (ONLY) return db(`calls?call_id=eq.${ONLY}&select=*`);

  // extracted_at is the record of having TRIED. Selecting on "the enquiry still
  // looks empty" instead meant a transcript too garbled to yield anything stayed
  // eligible forever, and got re-read every sixty seconds for nothing.
  const filter = ALL ? "" : "&extracted_at=is.null";
  return db(
    "calls?select=*&transcript=not.is.null&duration_secs=gte.20" +
      filter +
      "&order=started_at.desc&limit=25"
  );
}

/**
 * Push what was just learned back to the agents.
 *
 * The edge function writes each caller's memory during ingest -- who they are,
 * their reference, and the fields still outstanding. With extraction local,
 * that memory is written BEFORE anything has been read off the transcript, so
 * it says everything is missing when it no longer is. Without this, a customer
 * who rings back gets asked for the cargo and the dimensions they gave on the
 * previous call.
 *
 * syncMemory:"all" recomputes it from current CRM state, which is exactly what
 * is wanted once the fields are filled. Failure is logged and swallowed: the
 * extraction has already succeeded and is the thing that mattered.
 */
async function refreshAgents() {
  try {
    const r = await fetch(`https://${PROJECT}.supabase.co/functions/v1/ingest-calls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${service_role}`, "Content-Type": "application/json" },
      body: JSON.stringify({ syncMemory: "all" }),
    });
    const j = await r.json();
    console.log(`  caller memory refreshed for ${j.callerMemory ?? 0} number(s)`);
  } catch (e) {
    console.log(`  caller memory refresh failed — ${e.message}`);
  }

  try {
    const r = await fetch(`https://${PROJECT}.supabase.co/functions/v1/kb-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${service_role}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "extract-worker" }),
    });
    const j = await r.json();
    console.log(`  knowledge base republished (${j.customers ?? 0} customers)`);
  } catch (e) {
    console.log(`  knowledge sync failed — ${e.message}`);
  }
}

async function pass() {
  const calls = await pending();
  if (!calls.length) {
    console.log(`  nothing to fill`);
    return;
  }
  console.log(`  ${calls.length} call(s) to read, model ${MODEL}${DRY ? " (dry run)" : ""}`);
  let changed = 0;
  for (const c of calls) {
    const t0 = Date.now();
    try {
      const out = await processCall(c);
      if (!DRY) await markAttempted(c.call_id);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      if (DRY) {
        console.log(`\n  call ${out.call} (${secs}s):`);
        console.log(JSON.stringify(out.read ?? out.skipped, null, 1));
      } else {
        changed += (out.filled ?? 0) + (out.quote ? 1 : 0) + (out.email ? 1 : 0) + (out.customer ? 1 : 0);
        console.log(
          `  call ${out.call} ${secs}s — ${out.filled ?? 0} field(s)` +
            `${out.customer ? `, ${out.customer}` : ""}` +
            `${out.quote ? `, quote ${out.quote}` : ""}${out.email ? `, email ${out.email}` : ""}` +
            `${out.skipped ? ` — ${out.skipped}` : ""}`
        );
      }
    } catch (e) {
      console.log(`  call ${c.call_id} FAILED — ${e.message}`);
    }
  }

  if (changed && !DRY) await refreshAgents();
}

// Fail loudly and early if the model is not there, rather than per call.
const tags = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json()).catch(() => null);
if (!tags) {
  console.error(`\n  Ollama is not answering on ${OLLAMA}. Start it and try again.\n`);
  process.exit(1);
}
if (!(tags.models ?? []).some((m) => m.name === MODEL)) {
  console.error(`\n  ${MODEL} is not pulled. Available: ${(tags.models ?? []).map((m) => m.name).join(", ")}\n`);
  process.exit(1);
}

console.log(`\nextract-worker — ${MODEL} via ${OLLAMA}\n`);
await pass();
if (WATCH) {
  console.log("\n  watching, every 60s. Ctrl-C to stop.\n");
  setInterval(() => {
    pass().catch((e) => console.log(`  pass failed — ${e.message}`));
  }, 60_000);
} else {
  console.log("");
}
