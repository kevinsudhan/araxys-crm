import { supabase } from "../lib/supabase";

/**
 * Live rates (101): the services the desk asks its partners to price every
 * Sunday night, who each goes to, and every mail sent. The mail itself is
 * lib/liveRates.ts; the sending is the `live-rates` function.
 */

export interface LiveRateRequest {
  id: string;
  service: string;
  details: string;
  from_mailbox: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  partner_ids: string[];
}

export interface LiveRateSend {
  id: number;
  request_id: string | null;
  partner_id: string | null;
  kind: "weekly" | "now" | "test";
  week_of: string | null;
  status: "sending" | "sent" | "failed";
  from_mailbox: string;
  to_addresses: string[];
  subject: string;
  error: string | null;
  created_at: string;
}

export async function listLiveRates(): Promise<LiveRateRequest[]> {
  const { data, error } = await supabase
    .from("live_rate_requests")
    .select("id, service, details, from_mailbox, active, created_at, updated_at, live_rate_recipients(partner_id)")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const { live_rate_recipients, ...rest } = r as typeof r & { live_rate_recipients: Array<{ partner_id: string }> };
    return { ...rest, partner_ids: (live_rate_recipients ?? []).map((x) => x.partner_id) } as LiveRateRequest;
  });
}

/** The last mails sent, newest first, for every request. */
export async function recentLiveRateSends(limit = 300): Promise<LiveRateSend[]> {
  const { data, error } = await supabase
    .from("live_rate_sends")
    .select("id, request_id, partner_id, kind, week_of, status, from_mailbox, to_addresses, subject, error, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveRateSend[];
}

/**
 * Creates or updates a request and sets exactly these partners on it. The
 * mailbox is sent only when it changes: the database lets only an
 * administrator change it (101).
 */
export async function saveLiveRate(input: {
  id?: string;
  service: string;
  details: string;
  from_mailbox?: string;
  partner_ids: string[];
}): Promise<string> {
  const fields: Record<string, unknown> = { service: input.service.trim(), details: input.details.trim() };
  if (input.from_mailbox) fields.from_mailbox = input.from_mailbox;

  let id = input.id;
  if (id) {
    const { error } = await supabase.from("live_rate_requests").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from("live_rate_requests").insert(fields).select("id").single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }

  const { data: now, error: readErr } = await supabase.from("live_rate_recipients").select("partner_id").eq("request_id", id);
  if (readErr) throw new Error(readErr.message);
  const had = new Set((now ?? []).map((r) => r.partner_id as string));
  const want = new Set(input.partner_ids);
  const gone = [...had].filter((p) => !want.has(p));
  const added = [...want].filter((p) => !had.has(p));
  if (gone.length) {
    const { error } = await supabase.from("live_rate_recipients").delete().eq("request_id", id).in("partner_id", gone);
    if (error) throw new Error(error.message);
  }
  if (added.length) {
    const { error } = await supabase.from("live_rate_recipients").insert(added.map((partner_id) => ({ request_id: id, partner_id })));
    if (error) throw new Error(error.message);
  }
  return id;
}

export async function setLiveRateActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("live_rate_requests").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeLiveRate(id: string): Promise<void> {
  const { error } = await supabase.from("live_rate_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** The CRM logins' mailboxes: the only ones a request may be sent from. */
export async function crmMailboxes(): Promise<string[]> {
  const { data, error } = await supabase.from("profiles").select("email").order("email");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => String(r.email ?? "").toLowerCase()).filter(Boolean);
}

export interface LiveRatesAnswer {
  configured?: boolean;
  canSend?: boolean;
  sent?: number;
  failed?: number;
  skipped?: number;
  stopped?: string | null;
  to?: string;
  error?: string | null;
  outcomes?: Array<{ partner: string; status: "sent" | "failed" | "skipped"; error?: string }>;
}

/** Asks the `live-rates` function: whether Microsoft lets it send, a test to me, or every partner now. */
export async function liveRates(mode: "check" | "test" | "now", requestId?: string): Promise<LiveRatesAnswer> {
  const { data, error } = await supabase.functions.invoke("live-rates", { body: { mode, request_id: requestId } });
  if (error) {
    const said = (await (error as { context?: Response }).context?.json?.().catch(() => null)) as LiveRatesAnswer | null;
    if (said && mode === "check") return said;
    throw new Error(said?.error ?? error.message);
  }
  return data as LiveRatesAnswer;
}
