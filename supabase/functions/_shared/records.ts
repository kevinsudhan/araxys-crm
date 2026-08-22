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

const KB_SOURCE_NAME = "Araxys real customer records";

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
}

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
    stage: r.stage as "processing" | "processed",
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

  const row: Record<string, unknown> = { phone: input.phone, phone_key: key };
  for (const [k, v] of Object.entries(input)) {
    if (k === "phone") continue;
    if (v !== undefined && v !== null && v !== "") row[k] = v;
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
  row.stage = "processing";
  if (!row.status) row.status = "enquiry received";
  const created = await rest("real_records", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return created?.[0];
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
  L.push(
    `- Say this to the caller: ${who}, reference ${r.ref}. ${route}. Currently ${r.stage}, ${r.status}.` +
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
    "These are live customers who have actually contacted us. IMPORTANT: recognise a caller by " +
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
