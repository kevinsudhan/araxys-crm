/**
 * Shared record + knowledge-base logic for Edge Functions (Deno).
 *
 * Mirrors server/supabase.ts and server/realRecords.ts. The duplication is deliberate:
 * Edge Functions run on Deno and cannot import from the Node server tree, and vendoring a
 * build step for a few hundred lines would cost more than it saves. The invariants that
 * must stay in step are the phone-key normalisation and the KB block shape — both are
 * marked below.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SNAPSERVE_KEY = Deno.env.get("SNAPSERVE_API_KEY") ?? "";
const SNAPSERVE_BASE = Deno.env.get("SNAPSERVE_BASE_URL") ?? "https://app.snapserve.ai/api";
const AGENT_IDS = (Deno.env.get("SNAPSERVE_AGENT_IDS") ?? "717,758")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);

import { resolveSailingDate } from "./requestFields.ts";

const KB_SOURCE_NAME = "Araxys real customer records";
const SPACE_SOURCE_NAME = "Araxys container space availability";

/**
 * Re-attaches the reference packs to every agent that is missing them.
 *
 * Container specs, pricing bands, document rules and port regulations are static: nothing
 * in this codebase creates, deletes or re-attaches them. Twice now Priya has been found
 * with only the two synced packs and none of these -- once losing the rate card entirely,
 * which is how she came to quote a customer a dollar figure that appears nowhere in it.
 *
 * The cause is upstream and not reproducible from here: a no-op prompt PATCH does not
 * strip them, and nothing on our side detaches anything. So rather than keep repairing it
 * by hand, this runs on every knowledge refresh -- which is after every call -- and puts
 * back whatever has gone missing. Attaching is additive and idempotent, so a source that
 * is already there costs one call and changes nothing.
 */
export async function ensureReferenceSources(agentIds: number[] = AGENT_IDS) {
  if (!SNAPSERVE_KEY) return { ok: false as const, error: "SNAPSERVE_API_KEY not set" };

  const list = await snap("/knowledge-sources");
  if (!list.ok || !Array.isArray(list.body)) return { ok: false as const, error: "could not list sources" };

  // Everything except the two this code rewrites on a schedule. Identified by exclusion so
  // a reference pack added in the dashboard later is protected without a code change.
  const reference = (list.body as Array<{ id: number; name: string }>).filter(
    (s) => s.name !== KB_SOURCE_NAME && s.name !== SPACE_SOURCE_NAME,
  );

  const repaired: string[] = [];
  for (const agentId of agentIds) {
    const agent = await snap(`/agents/${agentId}`);
    if (!agent.ok) continue;
    const have = new Set(((agent.body as { knowledgeSourceIds?: number[] }).knowledgeSourceIds) ?? []);
    for (const src of reference) {
      if (have.has(src.id)) continue;
      const a = await snap(`/knowledge-sources/${src.id}/attach-agent/${agentId}`, { method: "POST" });
      if (a.ok) repaired.push(`${agentId}:${src.name}`);
    }
  }

  if (repaired.length) console.log(`[araxys] re-attached reference packs: ${repaired.join(", ")}`);
  return { ok: true as const, repaired };
}

/** MUST match server/supabase.ts — a caller is identified by the last 10 digits. */
export function phoneKey(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-10);
}

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export interface RecordInput {
  phone: string;
  customer_name?: string;
  company?: string;
  bl_number?: string;
  origin?: string;
  destination?: string;
  cargo_description?: string;
  volume_cbm?: number;
  container_type?: string;
  quoted_amount_inr?: number;
  agreed_amount_inr?: number;
  sailing_date?: string;
  status?: string;
  notes?: string;
  source_call_id?: string;
  /** The full 38-field catalogue extraction. Merged across calls, never replaced. */
  request_details?: Record<string, string | number | boolean | null | undefined>;
  source_language?: string;
  /**
   * Where these values came from.
   *
   * "regex" is the pattern pass in ingest, which runs on every poll and reads only
   * English. "model" is the extractor, which reads the whole call in any language. When
   * they disagree about identity the model is right, and it has to stay right: ingest
   * runs every five minutes and would otherwise re-clobber the good value forever.
   */
  from?: "regex" | "model";
}

/** Identity fields the pattern pass must not overwrite once the model has established them. */
const MODEL_OWNED = ["customer_name", "company", "origin", "destination", "cargo_description"] as const;

/** Newest first — the CRM lists most-recently-touched customers at the top. */
export async function listRecords() {
  const rows = await rest("real_records?select=*&order=updated_at.desc");
  return (rows ?? []).map(toCamel);
}

/** Matches any handle a caller might give: phone, reference, BL, company or name. */
export async function findByAnything(q: string) {
  const raw = String(q ?? "").trim();
  if (!raw) return null;

  const key = phoneKey(raw);
  if (key.length >= 10) {
    const byPhone = await rest(`real_records?select=*&phone_key=eq.${encodeURIComponent(key)}&limit=1`);
    if (byPhone?.length) return toCamel(byPhone[0]);
  }

  const esc = encodeURIComponent(raw);
  const rows = await rest(
    `real_records?select=*&or=(ref.ilike.${esc},bl_number.ilike.${esc},company.ilike.*${esc}*,customer_name.ilike.*${esc}*)&limit=1`
  );
  return rows?.length ? toCamel(rows[0]) : null;
}

/** DB rows are snake_case; the CRM expects camelCase. */
function toCamel(r: Record<string, unknown>) {
  const u = <T>(v: T | null) => (v === null ? undefined : v);
  return {
    ref: r.ref as string,
    phone: r.phone as string,
    customerName: u(r.customer_name as string | null),
    company: u(r.company as string | null),
    blNumber: u(r.bl_number as string | null),
    stage: r.stage as RecordStage,
    status: r.status as string,
    origin: u(r.origin as string | null),
    destination: u(r.destination as string | null),
    cargoDescription: u(r.cargo_description as string | null),
    volumeCbm: u(r.volume_cbm as number | null),
    containerType: u(r.container_type as string | null),
    quotedAmountInr: u(r.quoted_amount_inr as number | null),
    agreedAmountInr: u(r.agreed_amount_inr as number | null),
    sailingDate: u(r.sailing_date as string | null),
    notes: u(r.notes as string | null),
    processingStartedAt: u(r.processing_started_at as string | null),
    // Deliberately not camelised inside: the keys are the field catalogue's own, and the
    // CRM grid looks them up by the same key the extractor and the schema use.
    requestDetails: u(r.request_details as Record<string, unknown> | null),
    sourceLanguage: u(r.source_language as string | null),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

async function nextRef(): Promise<string> {
  const rows = await rest("real_records?select=ref&order=ref.desc&limit=1");
  const last = rows?.[0]?.ref?.match(/(\d+)$/)?.[1];
  const n = last ? Number(last) + 1 : 1;
  return `ARX-ENQ-${String(n).padStart(4, "0")}`;
}

/** Creates or merges by phone. Never blanks a known fact with an empty later value. */
export async function upsertRecord(input: RecordInput) {
  const key = phoneKey(input.phone);
  if (key.length < 10) throw new Error("phone number too short to identify a caller");

  const existing = await rest(`real_records?select=*&phone_key=eq.${encodeURIComponent(key)}&limit=1`);

  const priorDetails = (existing?.[0]?.request_details ?? {}) as Record<string, unknown>;

  const row: Record<string, unknown> = { phone: input.phone, phone_key: key };
  for (const [k, v] of Object.entries(input)) {
    if (k === "phone" || k === "request_details" || k === "from") continue;
    if (v === undefined || v === null || v === "") continue;

    // The pattern pass reads "I am shipping machinery parts" and offers "Shipping
    // Machinery Parts" as a name, because "I am" is how people introduce themselves. Once
    // the model has read the same call and found Kevin, ingest must stop overwriting it.
    if (
      input.from === "regex" &&
      (MODEL_OWNED as readonly string[]).includes(k) &&
      typeof priorDetails[k] === "string" &&
      String(priorDetails[k]).trim()
    ) {
      continue;
    }

    row[k] = v;
  }

  // request_details is merged key-by-key rather than replaced. A customer who rings back
  // to give their consignee address has not retracted the dimensions they gave last
  // week, and a whole-object write would silently drop them.
  if (input.request_details && Object.keys(input.request_details).length) {
    const merged = { ...priorDetails };
    for (const [k, v] of Object.entries(input.request_details)) {
      if (v !== undefined && v !== null && v !== "") merged[k] = v;
    }
    row.request_details = merged;
  }

  if (existing?.length) {
    const ref = existing[0].ref;
    const updated = await rest(`real_records?ref=eq.${encodeURIComponent(ref)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    return updated?.[0] ?? existing[0];
  }

  row.ref = await nextRef();
  // A call creates an enquiry, never an in-process shipment. Moving it on is a decision
  // the desk makes once there is a sailing date it will stand behind -- see advanceStage.
  row.stage = "enquiry";
  if (!row.status) row.status = "enquiry received";
  const created = await rest("real_records", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return created?.[0];
}

export type RecordStage = "enquiry" | "processing" | "processed";

/**
 * Promotes an enquiry the moment the call establishes both halves of a booking.
 *
 * The desk asked for this to be automatic: an enquiry is a shipment without a sailing
 * date, the agent's job is to get one, and a customer accepting the rate is the other
 * half. When both land on the same record it is no longer an enquiry, and making someone
 * click a button to say so is bookkeeping rather than a decision.
 *
 * Deliberately one-way. It never demotes a record, because a later call that does not
 * repeat the acceptance is not a retraction of it.
 */
export async function autoPromote(
  ref: string,
  details: Record<string, unknown>,
  callDate?: string,
) {
  // Resolved rather than required-as-ISO: a record can still be carrying "August 30" from
  // an extraction that predates the resolver, and the desk should not have to re-run a
  // call to get a booking moving.
  const date = resolveSailingDate(details.preferred_sailing_date, callDate);
  const accepted = details.quote_accepted === true;
  if (!date || !accepted) return { promoted: false as const };

  const rows = await rest(`real_records?select=stage&ref=eq.${encodeURIComponent(ref)}&limit=1`);
  if (rows?.[0]?.stage !== "enquiry") return { promoted: false as const };

  const result = await advanceStage(ref, "processing", date);
  if (!result.ok) return { promoted: false as const };
  console.log(`[araxys] ${ref} promoted to processing — sailing ${date}, quote accepted`);
  return { promoted: true as const, record: result.record };
}

/**
 * Moves a record along the pipeline.
 *
 * Guarded rather than free-form: reaching 'processing' means the desk is committing to a
 * booking, and a booking without a sailing date is not one. The check lives here rather
 * than only in the button, because the button is not the only thing that can call this.
 */
export async function advanceStage(ref: string, stage: RecordStage, sailingDate?: string) {
  const rows = await rest(`real_records?select=*&ref=eq.${encodeURIComponent(ref)}&limit=1`);
  const record = rows?.[0];
  if (!record) return { ok: false as const, error: "unknown reference" };

  const date = sailingDate ?? (record.sailing_date as string | null) ?? "";
  if (stage === "processing" && !date) {
    return { ok: false as const, error: "a sailing date is needed before a booking can start" };
  }

  const patch: Record<string, unknown> = { stage };
  if (sailingDate) patch.sailing_date = sailingDate;
  if (stage === "processing" && !record.processing_started_at) {
    patch.processing_started_at = new Date().toISOString();
  }

  const updated = await rest(`real_records?ref=eq.${encodeURIComponent(ref)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return { ok: true as const, record: toCamel(updated?.[0] ?? record) };
}

/** MUST stay in step with recordToKbBlock in server/realRecords.ts. */
function kbBlock(r: Record<string, string | number | null>): string {
  const digits = phoneKey(String(r.phone ?? ""));
  const L: string[] = [];
  L.push(`## Customer ${r.company ?? r.customer_name ?? r.ref} — reference ${r.ref}`);
  L.push(
    `Identifiers for this customer: reference ${r.ref}; phone ${r.phone}; phone ${digits}; phone +91${digits}` +
      (r.bl_number ? `; BL number ${r.bl_number}` : "; no BL number issued yet")
  );
  if (r.customer_name) L.push(`- Contact name: ${r.customer_name}`);
  if (r.company) L.push(`- Company: ${r.company}`);
  L.push(`- Reference number: ${r.ref}`);
  L.push(r.bl_number ? `- BL number: ${r.bl_number}` : `- BL number: not issued yet (booking not completed)`);
  L.push(`- Stage: ${r.stage}`);
  L.push(`- Status: ${r.status}`);
  if (r.origin && r.destination) L.push(`- Route: ${r.origin} to ${r.destination}`);
  if (r.cargo_description) L.push(`- Cargo: ${r.cargo_description}`);
  if (r.volume_cbm !== null && r.volume_cbm !== undefined) L.push(`- Volume: ${r.volume_cbm} CBM`);
  if (r.container_type) L.push(`- Container type: ${r.container_type}`);
  if (r.quoted_amount_inr) L.push(`- Quoted: Rs. ${Number(r.quoted_amount_inr).toLocaleString("en-IN")}`);
  if (r.agreed_amount_inr) L.push(`- Agreed rate: Rs. ${Number(r.agreed_amount_inr).toLocaleString("en-IN")}`);
  if (r.sailing_date) L.push(`- Sailing date: ${r.sailing_date}`);
  if (r.notes) L.push(`- Notes: ${r.notes}`);

  const who = r.customer_name ?? r.company ?? "this caller";
  const route = r.origin && r.destination ? `${r.origin} to ${r.destination}` : "route not yet confirmed";
  // Ownership, stated on the record itself. The previous wording — "Say this to the
  // caller" — named no caller, and a real call ended with one customer being read
  // another's reference number and destination straight off this page. A pack that holds
  // every customer has to say, beside each record, who it may be spoken to.
  L.push(
    `- WHOSE RECORD THIS IS: the person calling from ${r.phone}. Do NOT read any part of it ` +
      `to a caller from a different number, and do NOT offer this reference to someone whose ` +
      `own record you cannot find. If the caller-memory block names a different reference, ` +
      `that one is the caller's and this one is not.`
  );
  L.push(
    `- Say this ONLY to the owner named above: ${who}, reference ${r.ref}. ${route}. Currently ${r.stage}, ${r.status}.` +
      (r.bl_number ? ` BL number ${r.bl_number}.` : ` No BL number yet — booking not completed.`)
  );
  return L.join("\n");
}

export async function buildKb(): Promise<string> {
  const recs = await rest("real_records?select=*&order=updated_at.desc");
  const out: string[] = [];
  out.push("# Real customer records — Araxys Logistics");
  out.push("");
  out.push(
    "These are live customers who have actually contacted us. EVERY RECORD BELOW BELONGS TO A " +
      "DIFFERENT CUSTOMER, and each one names the number it belongs to. Never read a record to " +
      "anyone but its owner: if the caller is not calling from that record's number and has not " +
      "read out that reference themselves, it is not theirs and must not be mentioned. When the " +
      "caller-memory block already names this caller's reference, use that and do not search here " +
      "at all. IMPORTANT: recognise a caller by " +
      "ANY of these — their phone number (the number they are calling from), their reference number, " +
      "their company name, their contact name, or a BL number if one has been issued. Most customers " +
      "here have NO BL number yet because their booking is not finished; never tell such a caller we " +
      "have no record of them just because they cannot give a BL number. Match on the phone number " +
      "they are calling from first."
  );
  out.push("");
  if (!recs?.length) {
    out.push("No real customer records yet.");
    return out.join("\n");
  }
  for (const r of recs) {
    out.push(kbBlock(r));
    out.push("");
  }
  return out.join("\n");
}

async function snap(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SNAPSERVE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SNAPSERVE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch { /* keep raw */ }
  return { ok: r.ok, status: r.status, body };
}

/**
 * Rewrites the KB source from current database state.
 *
 * Delete-then-recreate with entries inline: there is no update-in-place endpoint, and a
 * source created empty stays at status "failed", which attach-agent refuses — so the
 * content would embed but never reach the agent.
 */
/**
 * Writes each customer's own details into SnapServe caller memory, keyed by their phone.
 *
 * This is what makes the agent recognise someone the moment they ring, without asking for
 * a reference number. SnapServe matches on the calling number and injects these facts as
 * ground truth before the agent speaks, so "who am I talking to" is already answered.
 *
 * The knowledge base is a different job: it holds every customer and is searched when the
 * agent needs to look someone up. Caller memory is only ever about the person on the line.
 */
/**
 * Which language to open a call in, per caller.
 *
 * Derived from what they actually spoke on previous calls rather than stored as a
 * setting, because nobody is going to maintain a language field by hand and the calls
 * already say it — the extractor labels every transcript en / ta / mixed.
 *
 * Two rules, both from how these customers actually talk:
 *
 *   1. `mixed` counts as Tamil. Someone moving between Tamil and English is comfortable
 *      in Tamil; someone comfortable only in English never produces a Tamil-leaning
 *      transcript at all. So a tie goes to Tamil — the cost of opening in Tamil with a
 *      bilingual caller is nil, and the cost of opening in English with someone who
 *      rang in Tamil last week is that they have to ask, again, to be spoken to in
 *      their own language.
 *   2. Only the last three calls count, and recency has to win. A caller whose last two
 *      calls were Tamil-leaning gets Tamil even if the three before that were English —
 *      a wider window let stale English calls outvote what the customer is doing now,
 *      which is the exact complaint this was built to fix. Three means it takes two
 *      English-only calls out of the last three to move someone back to English.
 */
const LANGUAGE_WINDOW = 3;

export type CallerLanguage = "ta" | "en";

export async function languageByPhone(): Promise<Map<string, CallerLanguage>> {
  const out = new Map<string, CallerLanguage>();
  const rows = await rest(
    "call_logs?select=phone_key,extracted&extracted=not.is.null&order=started_at.desc&limit=500"
  );
  if (!rows?.length) return out;

  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const key = String(r.phone_key ?? "");
    if (!key) continue;
    const lang = (r.extracted as Record<string, unknown> | null)?.source_language;
    if (lang !== "ta" && lang !== "en" && lang !== "mixed") continue;
    const list = seen.get(key) ?? [];
    if (list.length < LANGUAGE_WINDOW) list.push(String(lang));
    seen.set(key, list);
  }

  for (const [key, langs] of seen) {
    const tamilish = langs.filter((l) => l === "ta" || l === "mixed").length;
    const english = langs.filter((l) => l === "en").length;
    out.set(key, tamilish >= english ? "ta" : "en");
  }
  return out;
}

export async function syncCallerMemory(agentIds: number[] = AGENT_IDS) {
  if (!SNAPSERVE_KEY) return { ok: false, error: "SNAPSERVE_API_KEY not set" };

  const rows = await rest("real_records?select=*&order=updated_at.desc");
  if (!rows?.length) return { ok: true, synced: 0 };

  // Group by phone: one caller may have several enquiries, and the agent needs to know
  // whether to proceed with the obvious one or ask which they mean.
  const byPhone = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = phoneKey(String(r.phone ?? ""));
    if (key.length < 10) continue;
    byPhone.set(key, [...(byPhone.get(key) ?? []), r]);
  }

  const languages = await languageByPhone();
  const results: Array<{ phone: string; ok: boolean; shipments: number }> = [];

  for (const [phoneKeyValue, recs] of byPhone) {
    const first = recs[0];
    const phone = String(first.phone);
    const name = (first.customer_name as string) ?? null;
    const company = (first.company as string) ?? null;

    const describe = (r: Record<string, unknown>) => {
      const ref = r.bl_number ? `BL ${r.bl_number}` : `reference ${r.ref}`;
      const route = r.origin && r.destination ? `${r.origin} to ${r.destination}` : "route not yet confirmed";
      return `${ref} — ${route}, currently ${r.stage}, ${r.status}`;
    };

    let note: string;
    if (recs.length === 1) {
      note =
        `You are speaking to ${name ?? company ?? "a known customer"}${company && name ? ` from ${company}` : ""}. ` +
        `They have ONE shipment with us: ${describe(first)}. ` +
        `Greet them by name and do NOT ask for a BL or reference number — you already know who they are and which shipment they mean. ` +
        `Only ask for a number if they bring up a shipment that is clearly not this one.`;
    } else {
      note =
        `You are speaking to ${name ?? company ?? "a known customer"}${company && name ? ` from ${company}` : ""}. ` +
        `They have ${recs.length} shipments with us: ${recs.map(describe).join("; ")}. ` +
        `Greet them by name. Do NOT ask for a BL number — instead ask which of these they are calling about, ` +
        `naming them briefly so they can pick. Never assume it is one of them without asking.`;
    }

    // Prepended, not appended: the agent has to know which language to open in before it
    // reads anything else, and the greeting is the first thing it says.
    const language = languages.get(phoneKeyValue);
    if (language === "ta") {
      note =
        "This caller speaks TAMIL with us. Greet them and hold the conversation in Tamil, " +
        "not English, unless they switch to English themselves. " +
        note;
    } else if (language === "en") {
      note = "This caller speaks ENGLISH with us. Open in English. " + note;
    }

    const context: Record<string, string | number> = {
      known_customer: "yes",
      shipment_count: recs.length,
      reference: String(first.ref),
    };
    if (language) context.preferred_language = language === "ta" ? "Tamil" : "English";
    if (name) context.customer_name = name;
    if (company) context.company = company;
    if (recs.length === 1) {
      if (first.origin) context.origin = String(first.origin);
      if (first.destination) context.destination = String(first.destination);
      if (first.bl_number) context.bl_number = String(first.bl_number);
      context.order_status = String(first.status);
    }

    for (const agentId of agentIds) {
      try {
        const r = await fetch(
          `${SNAPSERVE_BASE}/agents/${agentId}/caller-memory/${encodeURIComponent(phone)}/facts`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${SNAPSERVE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ note, context }),
          }
        );
        if (agentId === agentIds[0]) results.push({ phone, ok: r.ok, shipments: recs.length });
      } catch (e) {
        console.error(`[araxys] caller-memory ${phone}:`, e);
      }
    }
  }

  const synced = results.filter((r) => r.ok).length;
  console.log(`[araxys] caller memory synced for ${synced}/${results.length} callers`);
  return { ok: true, synced, callers: results.length };
}

/**
 * Pushes live container availability into the knowledge base.
 *
 * Kept as its own source rather than folded into the customer document: space changes
 * whenever anyone books, while customer records change on calls, and rewriting one should
 * not churn the other. A source is deleted and recreated on each sync because SnapServe
 * has no update-in-place, and a source created empty stays at status "failed" — which
 * attach-agent refuses, so the content would embed but never reach the agent.
 */
export async function syncSpaceKb(agentIds: number[] = AGENT_IDS) {
  if (!SNAPSERVE_KEY) return { ok: false, error: "SNAPSERVE_API_KEY not set" };

  const { buildSpaceKb } = await import("./spaceKb.ts");
  const content = await buildSpaceKb();
  const NAME = "Araxys container space availability";

  const list = await snap("/knowledge-sources");
  if (list.ok && Array.isArray(list.body)) {
    const existing = (list.body as Array<{ id: number; name: string }>).find((s) => s.name === NAME);
    if (existing) await snap(`/knowledge-sources/${existing.id}`, { method: "DELETE" });
  }

  const created = await snap("/knowledge-sources", {
    method: "POST",
    body: JSON.stringify({
      name: NAME,
      type: "text",
      entries: [{ title: "Live container space", content }],
    }),
  });
  if (!created.ok) return { ok: false, error: `create failed ${created.status}`, detail: created.body };

  const sourceId = (created.body as { id: number }).id;
  const check = await snap(`/knowledge-sources/${sourceId}`);
  const status = (check.body as { status?: string })?.status;
  if (status !== "ready") {
    return { ok: false, error: `source status is "${status}" — agents can only attach a ready source`, sourceId };
  }

  const attached: Record<string, boolean> = {};
  for (const id of agentIds) {
    const a = await snap(`/knowledge-sources/${sourceId}/attach-agent/${id}`, { method: "POST" });
    attached[String(id)] = a.ok;
  }

  console.log(`[araxys] space KB sync -> source ${sourceId}, ${content.length} chars`);
  return { ok: true, sourceId, chars: content.length, attached };
}

export async function syncKb() {
  if (!SNAPSERVE_KEY) return { ok: false, error: "SNAPSERVE_API_KEY not set on the function" };

  const content = await buildKb();

  const list = await snap("/knowledge-sources");
  if (list.ok && Array.isArray(list.body)) {
    const existing = (list.body as Array<{ id: number; name: string }>).find((s) => s.name === KB_SOURCE_NAME);
    if (existing) await snap(`/knowledge-sources/${existing.id}`, { method: "DELETE" });
  }

  const created = await snap("/knowledge-sources", {
    method: "POST",
    body: JSON.stringify({
      name: KB_SOURCE_NAME,
      type: "text",
      entries: [{ title: "Real customer records", content }],
    }),
  });
  if (!created.ok) return { ok: false, error: `create failed ${created.status}`, detail: created.body };

  const sourceId = (created.body as { id: number }).id;
  const attached: Record<string, boolean> = {};
  for (const id of AGENT_IDS) {
    const a = await snap(`/knowledge-sources/${sourceId}/attach-agent/${id}`, { method: "POST" });
    attached[String(id)] = a.ok;
  }
  return { ok: true, sourceId, chars: content.length, attached };
}
