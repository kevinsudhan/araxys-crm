/**
 * Arrival notices (126): each house's consignee on an import console told the
 * cargo is coming in, and what they need to take delivery.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 * The mail is `arrivalHtml` (a copy of src/lib/arrivalNotice.ts; a test keeps
 * them identical), from the records by `arrivalHouseFrom`, to the job's
 * consignee address or the customer's.
 *
 * - `sweep`: pg_cron every half hour. Every import console switched on for it
 *   (`consoles.arrival_auto`), from its mailbox (`arrival_from`), for every
 *   house not yet told, once the ETA is within `arrival_days` (and not more
 *   than a week past it).
 * - `console`: "Send the waiting notices now" on one console: every house not
 *   yet told, whatever the date, from the console's mailbox or the caller's.
 * - `check`: whether Microsoft lets the CRM app send (nothing is sent).
 *
 * A house is claimed (its `arrival_notice_sent_at` set) before its mail goes,
 * so a run that overlaps another cannot send twice; a refusal puts the claim
 * back. Every send and refusal is in `arrival_notice_sends`, and a sent notice
 * is on the case file's timeline.
 *
 * WHAT IT NEEDS FROM MICROSOFT
 *
 * The same as live rates: the CRM's Azure app with the application permission
 * Mail.Send, with admin consent. Until then every send is refused, logged,
 * and said on the console.
 *
 * WHO MAY CALL IT
 *
 * pg_cron with the scheduler's secret for `sweep`; any member of staff for
 * the rest.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { arrivalDue, arrivalHouseFrom, arrivalHtml, arrivalSubject, consigneeEmail } from "./arrivalNotice.ts";
import { COMPANY } from "./company.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SCHEDULER_SECRET = Deno.env.get("MAIL_SYNC_SECRET");
const TENANT = Deno.env.get("MS_TENANT_ID");
const CLIENT_ID = Deno.env.get("MS_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET");

const GAP_MS = 2100;
const BUDGET_MS = 100_000;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Microsoft's refusal in words the desk can act on; `global` when no mail will get through. */
function explain(status: number, body: string): { message: string; global: boolean } {
  if (/AADSTS7000215|AADSTS7000222|invalid_client/i.test(body)) return { global: true, message: "Microsoft rejected the CRM app's client secret (wrong or expired)." };
  if (/AADSTS700016|unauthorized_client/i.test(body)) return { global: true, message: "Microsoft does not know the CRM app in this tenant." };
  if (status === 401 || status === 403 || /ErrorAccessDenied|Access is denied|Authorization_RequestDenied/i.test(body)) {
    return { global: true, message: "Waiting for Microsoft permission: the Azure admin has to grant the CRM app Mail.Send (application) with admin consent." };
  }
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|ResourceNotFound/i.test(body)) return { global: true, message: "The mailbox it is sent from has no Exchange Online mailbox." };
  if (/ErrorInvalidRecipients|InvalidRecipients/i.test(body)) return { global: false, message: "Microsoft refused the consignee's address; check it on the job." };
  if (status === 429) return { global: true, message: "Microsoft asked us to slow down; the next run carries on." };
  return { global: false, message: `Microsoft said ${status}: ${body.slice(0, 200)}` };
}

class Refused extends Error {}

async function appToken(): Promise<{ token: string; roles: string[] }> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const body = await r.text();
  if (!r.ok) throw new Refused(explain(r.status, body).message);
  const token = JSON.parse(body).access_token as string;
  let roles: string[] = [];
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    roles = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4))).roles ?? [];
  } catch {
    roles = [];
  }
  return { token, roles };
}

async function sendMail(token: string, from: string, to: string[], subject: string, html: string) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { subject, body: { contentType: "HTML", content: html }, toRecipients: to.map((address) => ({ emailAddress: { address } })) },
      saveToSentItems: true,
    }),
  });
  if (r.status === 202 || r.ok) return null;
  return explain(r.status, await r.text());
}

interface ConsoleRow {
  id: string;
  console_no: string | null;
  direction: string;
  status: string;
  mbl_number: string | null;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  eta: string | null;
  igm_no: string | null;
  igm_date: string | null;
  cfs_name: string | null;
  arrival_auto: boolean;
  arrival_from: string;
  arrival_days: number;
}

const CONSOLE_COLS = "id, console_no, direction, status, mbl_number, vessel, voyage, pol, pod, eta, igm_no, igm_date, cfs_name, arrival_auto, arrival_from, arrival_days";

interface Waiting {
  shipmentId: string;
  ref: string;
  to: string;
  subject: string;
  html: string;
}

/** Every house of a console not yet told, with its mail written. */
async function waitingFor(c: ConsoleRow): Promise<Waiting[]> {
  const { data: jobs, error } = await db
    .from("shipments")
    .select("id, enquiry_ref, stage, signed_off_at, consignee_name, consignee_email, piece_count, package_count, package_type, gross_weight_kg, volume_cbm, forwarders_bl_no, bl_number, arrival_notice_sent_at, customer:customers(emails, billing_email)")
    .eq("console_id", c.id);
  if (error) throw new Error(error.message);
  const open = (jobs ?? []).filter((j) => !j.arrival_notice_sent_at && !j.signed_off_at && j.stage !== "cancelled" && j.stage !== "delivered");
  if (!open.length) return [];
  const ids = open.map((j) => j.id as string);
  const [{ data: received }, { data: boxes }] = await Promise.all([
    db.from("received_house_bills").select("shipment_id, hbl_no, release_mode, data").in("shipment_id", ids),
    db.from("shipment_containers").select("shipment_id, container_no, size_type").in("shipment_id", ids),
  ]);
  const out: Waiting[] = [];
  for (const j of open) {
    const customer = j.customer as unknown as { emails?: string[]; billing_email?: string | null } | null;
    const to = consigneeEmail(j, customer);
    if (!to) continue;
    const house = arrivalHouseFrom({
      job: j as never,
      received: ((received ?? []).find((r) => r.shipment_id === j.id) as never) ?? null,
      boxes: (boxes ?? []).filter((b) => b.shipment_id === j.id) as never,
      console: c,
    });
    out.push({ shipmentId: j.id as string, ref: j.enquiry_ref as string, to, subject: arrivalSubject(house), html: arrivalHtml(house, COMPANY) });
  }
  return out;
}

interface Outcome {
  ref: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

Deno.serve(async (req) => {
  CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST." }, 405);

  let body: { mode?: string; console_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const mode = body.mode ?? "";

  // The scheduler's secret (sweep only), or a member of staff (the rest).
  const secret = req.headers.get("x-scheduler-secret");
  const byCron = Boolean(SCHEDULER_SECRET && secret && secret.length === SCHEDULER_SECRET.length && secret === SCHEDULER_SECRET);
  let me: { id: string; email: string } | null = null;
  if (!byCron) {
    const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    }).auth.getUser();
    if (error || !data.user) return json({ error: "Sign in first." }, 401);
    const { data: prof } = await db.from("profiles").select("id, email").eq("id", data.user.id).maybeSingle();
    if (!prof) return json({ error: "Staff only." }, 403);
    me = { id: prof.id, email: String(prof.email ?? data.user.email ?? "").toLowerCase() };
    if (mode === "sweep") return json({ error: "The sweep is the scheduler's." }, 403);
  } else if (mode !== "sweep") {
    return json({ error: "The scheduler only runs the sweep." }, 403);
  }
  if (!["sweep", "console", "check"].includes(mode)) return json({ error: "Unknown mode." }, 400);

  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) return json({ ok: false, error: "The CRM's Microsoft app is not configured on the server." });
  let token: string;
  let roles: string[];
  try {
    ({ token, roles } = await appToken());
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
  if (mode === "check") {
    return json({ ok: roles.includes("Mail.Send"), error: roles.includes("Mail.Send") ? null : "Waiting for Microsoft permission: the Azure admin has to grant the CRM app Mail.Send (application) with admin consent." });
  }

  // The consoles to work through, and the mailbox each sends from.
  let consoles: ConsoleRow[] = [];
  if (mode === "sweep") {
    const { data, error } = await db.from("consoles").select(CONSOLE_COLS).eq("direction", "import").eq("arrival_auto", true).neq("status", "cancelled");
    if (error) return json({ ok: false, error: error.message }, 500);
    consoles = ((data ?? []) as ConsoleRow[]).filter((c) => arrivalDue(c.eta, c.arrival_days));
  } else {
    if (!body.console_id) return json({ error: "Which console?" }, 400);
    const { data, error } = await db.from("consoles").select(CONSOLE_COLS).eq("id", body.console_id).maybeSingle();
    if (error || !data) return json({ error: "No such console." }, 404);
    if ((data as ConsoleRow).direction !== "import") return json({ error: "Arrival notices are for import consoles." }, 400);
    consoles = [data as ConsoleRow];
  }

  const started = Date.now();
  const outcomes: Outcome[] = [];
  let stopped: string | null = null;
  for (const c of consoles) {
    const from = (c.arrival_from || (mode === "console" ? me?.email ?? "" : "")).trim();
    if (!from) {
      outcomes.push({ ref: c.console_no ?? c.id, status: "skipped", error: "No mailbox to send from." });
      continue;
    }
    for (const w of await waitingFor(c)) {
      if (Date.now() - started > BUDGET_MS) {
        stopped = "Stopped for time; the next run carries on.";
        break;
      }
      // Claimed before it goes: an overlapping run finds it taken.
      const { data: claimed } = await db
        .from("shipments")
        .update({ arrival_notice_sent_at: new Date().toISOString(), arrival_notice_sent_to: w.to, arrival_notice_via: "auto" })
        .eq("id", w.shipmentId)
        .is("arrival_notice_sent_at", null)
        .select("id");
      if (!claimed?.length) continue;
      const refused = await sendMail(token, from, [w.to], w.subject, w.html);
      await db.from("arrival_notice_sends").insert({
        console_id: c.id,
        shipment_id: w.shipmentId,
        from_mailbox: from,
        to_addresses: [w.to],
        subject: w.subject,
        status: refused ? "failed" : "sent",
        error: refused?.message ?? null,
        sent_by: me?.id ?? null,
      });
      if (refused) {
        await db.from("shipments").update({ arrival_notice_sent_at: null, arrival_notice_sent_to: "", arrival_notice_via: null }).eq("id", w.shipmentId);
        outcomes.push({ ref: w.ref, status: "failed", error: refused.message });
        if (refused.global) {
          stopped = refused.message;
          break;
        }
      } else {
        await db.from("enquiry_events").insert({
          enquiry_ref: w.ref,
          kind: "arrival_notice",
          summary: `Arrival notice sent to ${w.to}${mode === "sweep" ? " (automatically)" : ""}`,
          detail: { shipment_id: w.shipmentId, console_id: c.id, from },
          actor: me?.id ?? null,
        });
        outcomes.push({ ref: w.ref, status: "sent" });
      }
      await sleep(GAP_MS);
    }
    if (stopped) break;
  }
  return json({ ok: !stopped || outcomes.some((o) => o.status === "sent"), sent: outcomes.filter((o) => o.status === "sent").length, outcomes, stopped });
});
