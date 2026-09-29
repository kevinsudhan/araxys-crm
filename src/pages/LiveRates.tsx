import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  Mail,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import LiveRatesForShipment from "../components/LiveRatesForShipment";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { ListSkeleton } from "../components/Loading";
import { useAuth } from "../lib/auth";
import { COMPANY } from "../lib/company";
import { formatDate } from "../lib/dates";
import { failureText, type FailureText } from "../lib/errorText";
import { dayLabel, nextSendAt, rateRequestMail, SCHEDULE_LABEL, weekAsked } from "../lib/liveRates";
import { listPartners, PARTNER_ROLES, PARTNER_ROLE_LABEL, type Partner, type PartnerRole } from "../services/partners";
import {
  crmMailboxes,
  listLiveRates,
  liveRates,
  recentLiveRateSends,
  removeLiveRate,
  saveLiveRate,
  setLiveRateActive,
  type LiveRateRequest,
  type LiveRateSend,
  type LiveRatesAnswer,
} from "../services/liveRates";

/**
 * Live rates: asking partners for rates.
 *
 * Two ways, on two tabs:
 * - For a shipment (107): choose a job, the partners and what each should
 *   price; sent now from the sender's Outlook and filed on the job
 *   (components/LiveRatesForShipment.tsx).
 * - Every Sunday (101): the services the desk asks its partners to price,
 *   mailed to them every Sunday at 10:30 pm IST — below.
 *
 * ---------------------------------------------------------------------------
 * The desk names a service ("FCL 20'/40' · Chennai → Jebel Ali"), says what to
 * quote, and picks the partners. Every Sunday night each of them gets their
 * own mail asking for the coming week's rates on it, from the desk's mailbox,
 * so the replies are waiting on Monday morning and show under Partner mail.
 *
 * The sending is the server's (the `live-rates` function on pg_cron), so it
 * happens with nobody signed in. It needs Microsoft to let the CRM's Azure app
 * send mail; until it does, this page says so rather than letting a Sunday
 * pass silently.
 * ---------------------------------------------------------------------------
 */
export default function LiveRates() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "weekly" ? "weekly" : "shipment";
  const setTab = (t: "shipment" | "weekly") =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (t === "weekly") n.set("tab", "weekly");
        else n.delete("tab");
        return n;
      },
      { replace: true }
    );

  return (
    <div>
      <PageHeader
        title="Live rates"
        subtitle="Ask partners for rates on a shipment now, each for the services you choose, or every Sunday night for the week ahead."
      />
      <div role="tablist" aria-label="Live rates" className="mb-4 inline-flex rounded-lg border border-border bg-surface-1 p-0.5">
        {(
          [
            ["shipment", "For a shipment"],
            ["weekly", "Every Sunday"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-8 rounded-md px-3.5 text-[12.5px] font-medium transition-colors ${
              tab === key ? "bg-brand text-white" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "shipment" ? <LiveRatesForShipment /> : <WeeklyRates />}
    </div>
  );
}

/** The Sunday requests (101), unchanged. */
function WeeklyRates() {
  const { session } = useAuth();
  const admin = session?.role === "admin";
  const [requests, setRequests] = useState<LiveRateRequest[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sends, setSends] = useState<LiveRateSend[]>([]);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [perm, setPerm] = useState<LiveRatesAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, p, s, m] = await Promise.all([listLiveRates(), listPartners(false), recentLiveRateSends(), crmMailboxes()]);
      setRequests(r);
      setPartners(p);
      setSends(s);
      setMailboxes(m);
    } catch (e) {
      setError(failureText(e, "Could not load the live rate requests."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    liveRates("check")
      .then(setPerm)
      .catch((e) => setPerm({ canSend: false, error: failureText(e, "Could not ask Microsoft.").message }));
  }, [load]);

  const next = nextSendAt(new Date());
  const week = weekAsked(next);
  const byId = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);

  return (
    <div>
      <p className="mb-3 max-w-prose text-[12px] text-text-secondary">
        Name a service and pick the partners: every Sunday at 10:30 pm IST each of them gets their own mail asking for the coming week's
        rates on it. Replies come back to the sending mailbox and show under Partner mail.
      </p>

      {/* ---- when, and whether Microsoft lets it ---- */}
      <div className="card mb-4 flex flex-wrap items-start gap-x-8 gap-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-accent text-text-accent">
            <CalendarClock size={17} />
          </span>
          <div>
            <p className="text-[12px] text-text-secondary">{SCHEDULE_LABEL}</p>
            <p className="text-[14px] font-medium text-text-primary">
              Next: {formatDate(next.toISOString(), { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })} IST
            </p>
            <p className="text-[12px] text-text-muted">
              Asks for {dayLabel(week.from)} to {dayLabel(week.to, true)}
            </p>
          </div>
        </div>
        <div className="min-w-[260px] flex-1">
          {!perm ? (
            <p className="flex items-center gap-2 text-[12px] text-text-muted">
              <Loader2 size={12} className="animate-spin" /> Asking Microsoft whether the CRM may send…
            </p>
          ) : perm.canSend ? (
            <p className="flex items-center gap-2 text-[13px] text-text-success">
              <Check size={14} /> Microsoft lets the CRM send these mails.
            </p>
          ) : (
            <div className="rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle size={13} /> Not sending yet: Microsoft has not let the CRM app send mail.
              </p>
              <p className="mt-1 leading-relaxed">
                The Azure admin grants it once: Azure portal → App registrations → the CRM's app → API permissions → Add a
                permission → Microsoft Graph → <b>Application</b> permissions → <b>Mail.Send</b> → Grant admin consent. Until
                then the Sunday run tries, and each refusal is listed under its request.
              </p>
              {perm.error && <p className="mt-1 opacity-80">{perm.error}</p>}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {editing !== "new" && (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
        >
          <Plus size={13} /> New rate request
        </button>
      )}

      {editing === "new" && (
        <Editor
          partners={partners}
          mailboxes={mailboxes}
          admin={admin}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {loading && !requests.length ? (
        <ListSkeleton rows={3} />
      ) : !requests.length && editing !== "new" ? (
        <EmptyState
          icon={CalendarClock}
          title="No live rate requests yet"
          hint="Name a service — say FCL 20' / 40' from Chennai to Jebel Ali — and pick the agents to ask. They will be mailed every Sunday night."
        />
      ) : (
        <div className="space-y-3">
          {requests.map((r) =>
            editing === r.id ? (
              <Editor
                key={r.id}
                request={r}
                partners={partners}
                mailboxes={mailboxes}
                admin={admin}
                onCancel={() => setEditing(null)}
                onSaved={async () => {
                  setEditing(null);
                  await load();
                }}
              />
            ) : (
              <RequestCard
                key={r.id}
                request={r}
                partnersById={byId}
                sends={sends.filter((s) => s.request_id === r.id)}
                next={next}
                myEmail={session?.email ?? ""}
                onEdit={() => setEditing(r.id)}
                onChanged={load}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RequestCard({
  request: r,
  partnersById,
  sends,
  next,
  myEmail,
  onEdit,
  onChanged,
}: {
  request: LiveRateRequest;
  partnersById: Map<string, Partner>;
  sends: LiveRateSend[];
  next: Date;
  myEmail: string;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"now" | "delete" | null>(null);
  const [preview, setPreview] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const recipients = r.partner_ids.map((id) => partnersById.get(id)).filter((p): p is Partner => Boolean(p));
  const mailable = recipients.filter((p) => p.emails.length > 0);
  const unmailable = recipients.filter((p) => p.emails.length === 0);
  const archivedCount = r.partner_ids.length - recipients.length;

  // The last Sunday's run: each partner's last word that week.
  const weekly = sends.filter((s) => s.kind === "weekly");
  const lastWeek = weekly[0]?.week_of ?? null;
  const thatWeek = lastWeek ? weekly.filter((s) => s.week_of === lastWeek) : [];
  const perPartner = new Map<string, LiveRateSend>();
  for (const s of thatWeek) if (s.partner_id && !perPartner.has(s.partner_id)) perPartner.set(s.partner_id, s);
  const weekSent = [...perPartner.values()].filter((s) => s.status === "sent").length;
  const weekFailed = [...perPartner.values()].filter((s) => s.status === "failed");
  const lastManual = sends.find((s) => s.kind !== "weekly");

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ tone: "bad", text: failureText(e, "That did not work.").message });
    } finally {
      setBusy(null);
    }
  }

  const sample = mailable[0] ?? { name: "", organisation: "Partner", emails: [] as string[] };
  const mail = rateRequestMail(r, sample, COMPANY, next);

  return (
    <div className={`card p-4 ${r.active ? "" : "opacity-75"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-medium text-text-primary">{r.service}</p>
            <StatusPill tone={r.active ? "success" : "neutral"}>{r.active ? "Every Sunday" : "Paused"}</StatusPill>
          </div>
          {r.details && <p className="mt-1 whitespace-pre-line text-[12px] text-text-secondary">{r.details}</p>}
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-text-muted">
            <Mail size={11} /> From {r.from_mailbox}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Btn icon={Eye} onClick={() => setPreview(!preview)} active={preview}>
            Preview
          </Btn>
          <Btn
            icon={Send}
            busy={busy === "test"}
            disabled={busy !== null || !myEmail}
            title={myEmail ? `Sends the mail to ${myEmail} only` : "Your login has no email address"}
            onClick={() =>
              act("test", async () => {
                const a = await liveRates("test", r.id);
                setNote(a.error ? { tone: "bad", text: a.error } : { tone: "ok", text: `Test sent to ${a.to}. It is the mail ${sample.organisation || sample.name} will get.` });
                await onChanged();
              })
            }
          >
            Send a test to me
          </Btn>
          <Btn icon={Send} disabled={busy !== null || !mailable.length} onClick={() => setConfirm("now")}>
            Send now
          </Btn>
          <Btn
            icon={r.active ? Pause : Play}
            busy={busy === "active"}
            disabled={busy !== null}
            onClick={() => act("active", async () => { await setLiveRateActive(r.id, !r.active); await onChanged(); })}
          >
            {r.active ? "Pause" : "Resume"}
          </Btn>
          <Btn icon={Pencil} disabled={busy !== null} onClick={onEdit}>
            Edit
          </Btn>
          <Btn icon={Trash2} disabled={busy !== null} onClick={() => setConfirm("delete")}>
            Delete
          </Btn>
        </div>
      </div>

      {/* ---- who ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-text-muted">
          To {mailable.length} partner{mailable.length === 1 ? "" : "s"}, one mail each
        </span>
        {mailable.map((p) => (
          <span key={p.id} className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] text-text-accent" title={p.emails.join(", ")}>
            {p.organisation || p.name}
          </span>
        ))}
        {unmailable.map((p) => (
          <span key={p.id} className="rounded-full bg-bg-warning px-2 py-0.5 text-[11px] text-text-warning" title="No email address on the directory">
            {p.organisation || p.name} · no email
          </span>
        ))}
        {archivedCount > 0 && <span className="text-[11px] text-text-muted">+{archivedCount} archived, left out</span>}
      </div>
      {!mailable.length && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-warning">
          <AlertTriangle size={12} /> Nobody on this request can be mailed. Add partners with an email address.
        </p>
      )}

      {/* ---- confirmations ---- */}
      {confirm === "now" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-[12px]">
          <span className="text-text-primary">
            Mail {mailable.length} partner{mailable.length === 1 ? "" : "s"} now, from {r.from_mailbox}? The Sunday mail still goes as usual.
          </span>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-3 font-medium text-white hover:bg-brand-dark"
            onClick={() => {
              setConfirm(null);
              void act("now", async () => {
                const a = await liveRates("now", r.id);
                const bad = (a.outcomes ?? []).filter((o) => o.status === "failed");
                setNote(
                  bad.length || a.stopped
                    ? { tone: "bad", text: `Sent ${a.sent ?? 0}, failed ${a.failed ?? 0}. ${a.stopped ?? bad[0]?.error ?? ""}` }
                    : { tone: "ok", text: `Sent to ${a.sent ?? 0} partner${a.sent === 1 ? "" : "s"}${a.skipped ? ` (${a.skipped} already had it in the last five minutes)` : ""}.` }
                );
                await onChanged();
              });
            }}
          >
            Send
          </button>
          <button type="button" className="h-7 rounded-lg border border-border px-3 text-text-secondary hover:text-text-primary" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      )}
      {confirm === "delete" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-[12px]">
          <span className="text-text-primary">Delete this request and its send history? The partners are not touched.</span>
          <button
            type="button"
            className="h-7 rounded-lg bg-bg-danger px-3 font-medium text-text-danger"
            onClick={() => {
              setConfirm(null);
              void act("delete", async () => {
                await removeLiveRate(r.id);
                await onChanged();
              });
            }}
          >
            Delete
          </button>
          <button type="button" className="h-7 rounded-lg border border-border px-3 text-text-secondary hover:text-text-primary" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      )}
      {busy === "now" && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Sending, two seconds apart (Microsoft's pace)…
        </p>
      )}
      {note && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${note.tone === "ok" ? "bg-bg-success text-text-success" : "bg-bg-danger text-text-danger"}`}>{note.text}</p>
      )}

      {/* ---- the mail ---- */}
      {preview && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-surface-2 px-3 py-2 text-[12px]">
            <p className="text-text-muted">
              As {sample.organisation || sample.name || "a partner"} gets it on {formatDate(next.toISOString(), { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
              {sample.emails.length ? ` · to ${sample.emails.join(", ")}` : ""}
            </p>
            <p className="mt-0.5 font-medium text-text-primary">{mail.subject}</p>
          </div>
          {/* Our own template, every value in it escaped (lib/liveRates.ts): shown as the partner's Outlook shows it. */}
          <div className="bg-white px-5 py-4" dangerouslySetInnerHTML={{ __html: mail.html }} />
        </div>
      )}

      {/* ---- what happened ---- */}
      <div className="mt-3 border-t border-border pt-2.5 text-[12px] text-text-secondary">
        {lastWeek ? (
          <p className="flex flex-wrap items-center gap-x-2">
            <span>
              Sunday {formatDate(lastWeek, { day: "numeric", month: "short" })}: sent to {weekSent} of {mailable.length}
            </span>
            {weekFailed.length > 0 && <span className="text-text-danger">· {weekFailed.length} not sent</span>}
          </p>
        ) : (
          <p className="text-text-muted">Not sent on a Sunday yet.</p>
        )}
        {weekFailed.length > 0 && (
          <ul className="mt-1 space-y-0.5 pl-4 text-text-danger">
            {weekFailed.map((s) => (
              <li key={s.id} className="list-disc">
                <b className="font-medium">{partnersById.get(s.partner_id ?? "")?.organisation || s.to_addresses.join(", ")}</b>: {s.error}
              </li>
            ))}
          </ul>
        )}
        {lastManual && (
          <p className="mt-1 text-text-muted">
            Last {lastManual.kind === "test" ? "test" : "sent by hand"}:{" "}
            {formatDate(lastManual.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })} to {lastManual.to_addresses.join(", ")} ·{" "}
            <span className={lastManual.status === "failed" ? "text-text-danger" : ""}>{lastManual.status === "failed" ? lastManual.error : "sent"}</span>
          </p>
        )}
        {sends.length > 0 && (
          <button type="button" onClick={() => setShowLog(!showLog)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary">
            {showLog ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Every mail ({sends.length})
          </button>
        )}
        {showLog && (
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {sends.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-2">
                <span className="text-text-muted">{formatDate(s.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</span>
                <span>{s.kind === "weekly" ? "Sunday" : s.kind === "now" ? "By hand" : "Test"}</span>
                <span>{s.to_addresses.join(", ")}</span>
                <span className={s.status === "sent" ? "text-text-success" : s.status === "failed" ? "text-text-danger" : "text-text-muted"}>
                  {s.status === "sent" ? "sent" : s.status === "failed" ? s.error : "sending"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Editor({
  request,
  partners,
  mailboxes,
  admin,
  onCancel,
  onSaved,
}: {
  request?: LiveRateRequest;
  partners: Partner[];
  mailboxes: string[];
  admin: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [service, setService] = useState(request?.service ?? "");
  const [details, setDetails] = useState(request?.details ?? "");
  const [from, setFrom] = useState(request?.from_mailbox ?? (mailboxes.includes("info@aashishlogistics.com") ? "info@aashishlogistics.com" : mailboxes[0] ?? ""));
  const [picked, setPicked] = useState<Set<string>>(new Set(request?.partner_ids ?? []));
  const [role, setRole] = useState<PartnerRole | "all">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = partners
    .filter((p) => role === "all" || p.role === role)
    .filter((p) => {
      const n = query.trim().toLowerCase();
      return !n || [p.name, p.organisation, ...p.emails, ...p.tags].some((v) => String(v).toLowerCase().includes(n));
    });
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function save() {
    setError(null);
    if (service.trim().length < 2) return setError("Name the service the partners should price.");
    if (!picked.size) return setError("Pick at least one partner to ask.");
    setBusy(true);
    try {
      await saveLiveRate({
        id: request?.id,
        service,
        details,
        from_mailbox: admin && from !== (request?.from_mailbox ?? "info@aashishlogistics.com") ? from : undefined,
        partner_ids: [...picked],
      });
      await onSaved();
    } catch (e) {
      setError(failureText(e, "Could not save the request.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-3 space-y-3 p-4">
      <p className="text-[13px] font-medium text-text-primary">{request ? "Edit the rate request" : "New rate request"}</p>
      <label className="block text-[12px] text-text-secondary">
        Service to ask about
        <input
          value={service}
          maxLength={200}
          onChange={(e) => setService(e.target.value)}
          placeholder="e.g. FCL 20' / 40' · Chennai → Jebel Ali"
          className="mt-1 h-9 w-full text-[13px]"
          autoFocus
        />
      </label>
      <label className="block text-[12px] text-text-secondary">
        What to quote <span className="text-text-muted">(optional, one line each)</span>
        <textarea
          value={details}
          maxLength={2000}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          placeholder={"Ocean freight per container\nOrigin and destination charges\nTransit time and free days"}
          className="mt-1 w-full py-2 text-[13px]"
        />
      </label>
      <div className="text-[12px] text-text-secondary">
        Sent from
        {admin ? (
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block h-9 w-full max-w-sm text-[13px]">
            {mailboxes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-1 text-[13px] text-text-primary">
            {from} <span className="text-[11px] text-text-muted">· an administrator can change this</span>
          </p>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <p className="text-[12px] text-text-secondary">
            Partners to ask <span className="text-text-muted">· {picked.size} picked</span>
          </p>
          <div className="relative ml-auto min-w-[200px] max-w-xs flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company, contact, tag…" className="h-8 w-full pl-7 text-[12px]" />
          </div>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {(["all", ...PARTNER_ROLES] as Array<PartnerRole | "all">).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`h-7 rounded-full border px-2.5 text-[12px] ${role === r ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"}`}
            >
              {r === "all" ? "All" : PARTNER_ROLE_LABEL[r]}
            </button>
          ))}
          <button
            type="button"
            className="ml-auto text-[12px] text-text-accent hover:underline"
            onClick={() => setPicked((s) => new Set([...s, ...shown.filter((p) => p.emails.length).map((p) => p.id)]))}
          >
            Pick all shown
          </button>
          <button type="button" className="text-[12px] text-text-muted hover:text-text-primary" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
        {!partners.length ? (
          <p className="text-[12px] text-text-muted">
            No partners yet. <Link to="/partners/new" className="text-text-accent underline">Add them on the directory</Link> first.
          </p>
        ) : (
          <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {shown.map((p) => {
              const can = p.emails.length > 0;
              return (
                <label key={p.id} className={`flex items-start gap-3 px-3 py-2 text-[12px] ${can ? "cursor-pointer hover:bg-surface-2" : "opacity-60"}`}>
                  {/* No address: cannot be added, but one already on the request can be taken off. */}
                  <input type="checkbox" className="mt-0.5" disabled={!can && !picked.has(p.id)} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="min-w-0">
                    <span className="font-medium text-text-primary">{p.organisation || p.name}</span>
                    {p.organisation && p.name && <span className="text-text-secondary"> · {p.name}</span>}
                    <span className="block text-text-muted">{can ? p.emails.join(", ") : "No email address — add one on the directory"}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-text-muted">{PARTNER_ROLE_LABEL[p.role]}</span>
                </label>
              );
            })}
            {!shown.length && <p className="px-3 py-3 text-[12px] text-text-muted">Nobody matches that.</p>}
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {request ? "Save" : "Create — mailed every Sunday"}
        </button>
        <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Btn({
  icon: Icon,
  children,
  onClick,
  disabled,
  busy,
  active,
  title,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] disabled:opacity-50 ${
        active ? "border-border-strong bg-surface-2 text-text-primary" : "border-border text-text-secondary hover:text-text-primary"
      }`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {children}
    </button>
  );
}
