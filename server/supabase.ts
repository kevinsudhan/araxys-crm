/**
 * Supabase-backed persistence for real customer records.
 *
 * Deliberately mirrors the function signatures of the previous JSON-file store so nothing
 * upstream changes — routes and KB generation call the same names. The difference is that
 * these rows survive a restart, a redeploy, and a machine dying mid-demo, which a file on
 * an ephemeral container filesystem does not.
 *
 * Everything here uses the service_role key and therefore bypasses RLS. That is exactly
 * why this module must only ever run server-side: the tables hold real customer names and
 * phone numbers, and the public key is blocked from reading them by design.
 */
import type { RealRecord, RecordStage } from "./realRecords";

const URL_BASE = () => process.env.SUPABASE_URL ?? "";
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function supabaseConfigured(): boolean {
  return Boolean(URL_BASE() && KEY());
}

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: KEY(),
    Authorization: `Bearer ${KEY()}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_BASE()}/rest/v1/${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!r.ok) throw new Error(`supabase ${r.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

export function phoneKey(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-10);
}

/** DB row shape (snake_case) -> app shape (camelCase). */
interface Row {
  ref: string;
  phone: string;
  phone_key: string;
  customer_name: string | null;
  company: string | null;
  bl_number: string | null;
  stage: RecordStage;
  status: string;
  origin: string | null;
  destination: string | null;
  cargo_description: string | null;
  volume_cbm: number | null;
  container_type: string | null;
  quoted_amount_inr: number | null;
  agreed_amount_inr: number | null;
  sailing_date: string | null;
  notes: string | null;
  source_call_id: string | null;
  created_at: string;
  updated_at: string;
}

const undef = <T,>(v: T | null): T | undefined => (v === null ? undefined : v);

function toRecord(r: Row): RealRecord {
  return {
    ref: r.ref,
    phone: r.phone,
    customerName: undef(r.customer_name),
    company: undef(r.company),
    blNumber: undef(r.bl_number),
    stage: r.stage,
    status: r.status,
    origin: undef(r.origin),
    destination: undef(r.destination),
    cargoDescription: undef(r.cargo_description),
    volumeCbm: undef(r.volume_cbm),
    containerType: undef(r.container_type),
    quotedAmountInr: undef(r.quoted_amount_inr),
    agreedAmountInr: undef(r.agreed_amount_inr),
    sailingDate: undef(r.sailing_date),
    notes: undef(r.notes),
    sourceCallId: undef(r.source_call_id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toRow(rec: Partial<RealRecord>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined) row[k] = v;
  };
  set("ref", rec.ref);
  set("phone", rec.phone);
  if (rec.phone) row.phone_key = phoneKey(rec.phone);
  set("customer_name", rec.customerName);
  set("company", rec.company);
  set("bl_number", rec.blNumber);
  set("stage", rec.stage);
  set("status", rec.status);
  set("origin", rec.origin);
  set("destination", rec.destination);
  set("cargo_description", rec.cargoDescription);
  set("volume_cbm", rec.volumeCbm);
  set("container_type", rec.containerType);
  set("quoted_amount_inr", rec.quotedAmountInr);
  set("agreed_amount_inr", rec.agreedAmountInr);
  set("sailing_date", rec.sailingDate);
  set("notes", rec.notes);
  set("source_call_id", rec.sourceCallId);
  return row;
}

export async function listRecords(): Promise<RealRecord[]> {
  const rows = (await rest("real_records?select=*&order=updated_at.desc")) as Row[];
  return rows.map(toRecord);
}

export async function findByPhone(phone: string): Promise<RealRecord | undefined> {
  const key = phoneKey(phone);
  if (key.length < 10) return undefined;
  const rows = (await rest(`real_records?select=*&phone_key=eq.${encodeURIComponent(key)}&limit=1`)) as Row[];
  return rows.length ? toRecord(rows[0]) : undefined;
}

/** Matches any handle a caller might give: phone, reference, BL, company or name. */
export async function findByAnything(q: string): Promise<RealRecord | undefined> {
  const raw = String(q ?? "").trim();
  if (!raw) return undefined;

  const byPhone = await findByPhone(raw);
  if (byPhone) return byPhone;

  const esc = encodeURIComponent(raw);
  const rows = (await rest(
    `real_records?select=*&or=(ref.ilike.${esc},bl_number.ilike.${esc},company.ilike.*${esc}*,customer_name.ilike.*${esc}*)&limit=1`
  )) as Row[];
  return rows.length ? toRecord(rows[0]) : undefined;
}

async function nextRef(): Promise<string> {
  const rows = (await rest("real_records?select=ref&order=ref.desc&limit=1")) as Array<{ ref: string }>;
  const last = rows[0]?.ref?.match(/(\d+)$/)?.[1];
  const n = last ? Number(last) + 1 : 1;
  return `ARX-ENQ-${String(n).padStart(4, "0")}`;
}

/**
 * Creates a record for a new caller, or merges into the existing one for that phone.
 * Only fields that actually arrived are written — a later call must not blank facts a
 * previous call established.
 */
export async function upsertFromCall(input: Partial<RealRecord> & { phone: string }): Promise<RealRecord> {
  const existing = await findByPhone(input.phone);

  if (existing) {
    const patch = toRow({ ...input, ref: undefined });
    delete patch.ref;
    // Drop empty strings so a blank does not overwrite a known value.
    for (const [k, v] of Object.entries(patch)) if (v === "" || v === null) delete patch[k];
    const rows = (await rest(`real_records?ref=eq.${encodeURIComponent(existing.ref)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    })) as Row[];
    console.log(`[araxys] supabase record UPDATED ${existing.ref}`);
    return rows.length ? toRecord(rows[0]) : existing;
  }

  const ref = await nextRef();
  const row = toRow({ stage: "processing", status: "enquiry received", ...input, ref });
  const rows = (await rest("real_records", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  })) as Row[];
  console.log(`[araxys] supabase record CREATED ${ref} (${input.phone})`);
  return toRecord(rows[0]);
}

export async function deleteRecord(ref: string): Promise<boolean> {
  await rest(`real_records?ref=eq.${encodeURIComponent(ref)}`, { method: "DELETE" });
  return true;
}

// ------------------------------------------------------------------ call logs

export interface CallLogInput {
  callId: string;
  agentName?: string;
  direction?: string;
  fromNumber?: string;
  toNumber?: string;
  status?: string;
  durationSecs?: number;
  transcript?: string;
  summary?: string;
  extracted?: unknown;
  startedAt?: string;
  endedAt?: string;
}

/** Idempotent: re-ingesting the same call updates it rather than duplicating. */
export async function saveCallLog(input: CallLogInput) {
  const linkPhone = input.direction === "inbound" ? input.fromNumber : input.toNumber;
  const row = {
    call_id: input.callId,
    agent_name: input.agentName ?? null,
    direction: input.direction ?? null,
    from_number: input.fromNumber ?? null,
    to_number: input.toNumber ?? null,
    phone_key: linkPhone ? phoneKey(linkPhone) : null,
    status: input.status ?? null,
    duration_secs: input.durationSecs ?? null,
    transcript: input.transcript ?? null,
    summary: input.summary ?? null,
    extracted: input.extracted ?? null,
    started_at: input.startedAt ?? null,
    ended_at: input.endedAt ?? null,
  };
  await rest("call_logs", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
}

export async function listCallLogs(limit = 50) {
  return (await rest(`call_logs?select=*&order=started_at.desc.nullslast&limit=${limit}`)) as unknown[];
}

export async function callLogsForPhone(phone: string, limit = 20) {
  const key = phoneKey(phone);
  return (await rest(
    `call_logs?select=*&phone_key=eq.${encodeURIComponent(key)}&order=started_at.desc.nullslast&limit=${limit}`
  )) as unknown[];
}
