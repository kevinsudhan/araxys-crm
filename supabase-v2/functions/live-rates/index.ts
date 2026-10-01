/**
 * Live rates (101): mails the desk's partners for the coming week's rates.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 * For each running request (a service the desk named, and the partners it
 * goes to), one mail per partner from the request's mailbox, written by
 * `rateRequestMail` (a copy of src/lib/liveRates.ts; a test keeps them
 * identical). Every mail is logged in `live_rate_sends`, sent or refused.
 *
 * - `weekly`: pg_cron, Sunday 20:30 IST and every ten minutes to 21:20 (117). Each
 *   partner is claimed once per Sunday before its mail goes, so a re-run picks
 *   up only what failed or was not reached, and nobody gets two.
 * - `now`: "Send now" on the Live rates page, to every partner of one request.
 * - `test`: "Send a test to me": the mail as the first partner would get it,
 *   to the signed-in person's own address only.
 * - `check`: whether Microsoft lets the CRM app send (nothing is sent).
 *
 * WHAT IT NEEDS FROM MICROSOFT
 *
 * The CRM's Azure app (the one mail-sync signs in as, app-only) needs the
 * application permission Mail.Send, with admin consent. Until then every send
 * is refused and the refusal is logged and shown on the page.
 *
 * Exchange Online takes about 30 mails a minute from one mailbox, so mails go
 * two seconds apart, and a run stops after 100 seconds: the next ten-minute run
 * carries on where it stopped.
 *
 * WHO MAY CALL IT
 *
 * pg_cron with the scheduler's secret (MAIL_SYNC_SECRET, shared with mail-sync:
 * supabase-v2/set-mail-sync-secret.mjs) for `weekly`; any signed-in member of
 * staff for the rest.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { istDate, rateRequestMail } from "./liveRates.ts";
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Microsoft's refusal in words the desk can act on; `global` when no mail will get through. */
function explain(status: number, body: string): { message: string; global: boolean } {
  if (/AADSTS7000215|AADSTS7000222|invalid_client/i.test(body)) {
    return { global: true, message: "Microsoft rejected the CRM app's client secret (wrong or expired). Renew it in Azure and run set-mail-sync-secret again." };
  }
  if (/AADSTS700016|unauthorized_client/i.test(body)) {
    return { global: true, message: "Microsoft does not know the CRM app in this tenant." };
  }
  if (status === 401 || status === 403 || /ErrorAccessDenied|Access is denied|Authorization_RequestDenied/i.test(body)) {
    return { global: true, message: "Waiting for Microsoft permission: the Azure admin has to grant the CRM app Mail.Send (application) with admin consent." };
  }
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|ResourceNotFound/i.test(body)) {
    return { global: true, message: "The mailbox it is sent from has no Exchange Online mailbox." };
  }
  if (/ErrorInvalidRecipients|InvalidRecipients/i.test(body)) {
    return { global: false, message: "Microsoft refused the partner's address; check it on the directory." };
  }
  if (status === 429) return { global: true, message: "Microsoft asked us to slow down; the next run carries on." };
  return { global: false, message: `Microsoft said ${status}: ${body.slice(0, 200)}` };
}

class Refused extends Error {}

async function appToken(): Promise<{ token: string; roles: string[] }> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Refused(explain(r.status, body).message);
  const token = JSON.parse(body).access_token as string;
  // The permissions granted are in the token itself.
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
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (r.status === 202 || r.ok) return null;
  return explain(r.status, await r.text());
}

interface PartnerRow {
  id: string;
  name: string;
  organisation: string;
  emails: string[];
  active: boolean;
}
interface RequestRow {
  id: string;
  service: string;
  details: string;
  from_mailbox: string;
  active: boolean;
  live_rate_recipients: Array<{ partners: PartnerRow | null }>;
}

async function loadRequests(onlyId?: string): Promise<RequestRow[]> {
  let q = db
    .from("live_rate_requests")
    .select("id, service, details, from_mailbox, active, live_rate_recipients(partners(id, name, organisation, emails, active))")
    .order("created_at");
  if (onlyId) q = q.eq("id", onlyId);
  else q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RequestRow[];
}

const reachable = (r: RequestRow) =>
  r.live_rate_recipients
    .map((x) => x.partners)
    .filter((p): p is PartnerRow => Boolean(p && p.active && p.emails?.length));

interface Outcome {
  request_id: string;
  partner: string;
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

  let body: { mode?: string; request_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const mode = body.mode ?? "";

  // The scheduler's secret (weekly only), or a member of staff (the rest).
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
    if (mode === "weekly") return json({ error: "The weekly run is the scheduler's." }, 403);
  } else if (mode !== "weekly") {
    return json({ error: "The scheduler only runs the weekly mail." }, 403);
  }
  if (!["weekly", "now", "test", "check"].includes(mode)) return json({ error: "Unknown mode." }, 400);

  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) {
    return json({ configured: false, canSend: false, error: "The CRM's Azure app has no client secret on the server (MS_CLIENT_SECRET)." }, 503);
  }

  let token: string, roles: string[];
  try {
    ({ token, roles } = await appToken());
  } catch (e) {
    return json({ configured: true, canSend: false, error: (e as Error).message }, 502);
  }
  const canSend = roles.includes("Mail.Send");
  if (mode === "check") return json({ configured: true, canSend, roles });

  const started = Date.now();
  const now = new Date();
  const outcomes: Outcome[] = [];
  const log = (row: Record<string, unknown>) => db.from("live_rate_sends").insert(row).select("id").single();

  try {
    if (mode === "test") {
      const [r] = await loadRequests(body.request_id);
      if (!r) return json({ error: "No such request." }, 404);
      if (!me?.email) return json({ error: "Your login has no email address to send the test to." }, 400);
      const first = reachable(r)[0] ?? { id: "", name: "", organisation: "Test partner", emails: [], active: true };
      const mail = rateRequestMail(r, first, COMPANY, now);
      const subject = `[Test] ${mail.subject}`;
      const refused = await sendMail(token, r.from_mailbox, [me.email], subject, mail.html);
      await log({ request_id: r.id, kind: "test", status: refused ? "failed" : "sent", from_mailbox: r.from_mailbox, to_addresses: [me.email], subject, error: refused?.message ?? null, sent_by: me.id });
      return json({ canSend, sent: refused ? 0 : 1, failed: refused ? 1 : 0, to: me.email, error: refused?.message ?? null });
    }

    const requests = await loadRequests(mode === "now" ? body.request_id : undefined);
    if (mode === "now" && !requests.length) return json({ error: "No such request." }, 404);
    const weekOf = istDate(now);

    if (mode === "weekly") {
      // A claim left by a run that died mid-send is released for this run.
      await db
        .from("live_rate_sends")
        .update({ status: "failed", error: "Interrupted before Microsoft answered; tried again.", updated_at: new Date().toISOString() })
        .eq("kind", "weekly")
        .eq("status", "sending")
        .lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    }

    let stop: string | null = null;
    let sentAny = false;
    outer: for (const r of requests) {
      for (const p of reachable(r)) {
        if (stop) break outer;
        if (Date.now() - started > BUDGET_MS) {
          stop = "Out of time for this run; the next one carries on.";
          break outer;
        }
        const label = p.organisation || p.name;
        const mail = rateRequestMail(r, p, COMPANY, now);
        const to = p.emails.map((e) => e.trim().toLowerCase()).filter(Boolean);

        if (mode === "now") {
          // A second press within five minutes does not mail them again.
          const { count } = await db
            .from("live_rate_sends")
            .select("id", { count: "exact", head: true })
            .eq("request_id", r.id)
            .eq("partner_id", p.id)
            .eq("kind", "now")
            .eq("status", "sent")
            .gt("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
          if (count) {
            outcomes.push({ request_id: r.id, partner: label, status: "skipped", error: "Sent to them in the last five minutes." });
            continue;
          }
        }

        const claim = await log({
          request_id: r.id,
          partner_id: p.id,
          kind: mode,
          week_of: mode === "weekly" ? weekOf : null,
          status: "sending",
          from_mailbox: r.from_mailbox,
          to_addresses: to,
          subject: mail.subject,
          sent_by: me?.id ?? null,
        });
        if (claim.error) {
          // 23505: this Sunday's mail to them is already out (or going).
          if (claim.error.code === "23505") {
            outcomes.push({ request_id: r.id, partner: label, status: "skipped" });
            continue;
          }
          throw new Error(claim.error.message);
        }

        if (sentAny) await sleep(GAP_MS);
        const refused = await sendMail(token, r.from_mailbox, to, mail.subject, mail.html);
        await db
          .from("live_rate_sends")
          .update({ status: refused ? "failed" : "sent", error: refused?.message ?? null, updated_at: new Date().toISOString() })
          .eq("id", claim.data.id);
        outcomes.push({ request_id: r.id, partner: label, status: refused ? "failed" : "sent", error: refused?.message });
        sentAny = true;
        // A refusal of the app itself fails every other mail the same way.
        if (refused?.global) stop = refused.message;
      }
    }

    return json({
      canSend,
      week_of: mode === "weekly" ? weekOf : null,
      sent: outcomes.filter((o) => o.status === "sent").length,
      failed: outcomes.filter((o) => o.status === "failed").length,
      skipped: outcomes.filter((o) => o.status === "skipped").length,
      stopped: stop,
      outcomes,
    });
  } catch (e) {
    return json({ error: (e as Error).message, outcomes }, 500);
  }
});
