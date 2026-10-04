import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DOMPurify from "dompurify";
import { AlertCircle, Check, CheckCircle2, Eye, Loader2, Plus, RotateCcw, Send, Sparkles, X, XCircle } from "lucide-react";
import RichTextEditor from "./RichTextEditor";
import Drafting from "./Drafting";
import CountryPartnerPicker from "./CountryPartnerPicker";
import PartnerForm from "./PartnerForm";
import StatusPill from "./StatusPill";
import { InlineLoading } from "./Loading";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { cleanServices, defaultServices, personalise, serviceCatalogue, withReference } from "../lib/rateRequest";
import { draftRequest, draftRequestWithAi, QUOTE_STATUS_LABEL, rateRequestsTo, sendBurst, type BurstResult, type PartnerQuote, type QuoteStatus } from "../services/rfq";
import { listPartners, PARTNER_ROLE_LABEL, type Partner } from "../services/partners";
import { mailIsLive } from "../services/backend";
import type { Enquiry } from "../services/enquiries";

/**
 * A rate request for one job to the partners the desk picks, each asked for
 * the services the desk chooses for them (107).
 *
 * ---------------------------------------------------------------------------
 * ONE MAIL PER PARTNER
 *
 * Each partner gets their own mail, so replies stay attributable and nobody
 * sees who else was asked. Each opens with their own greeting and the list of
 * services they in particular are to price, then the desk's message about the
 * shipment — built from the enquiry, editable, or written with AI to a brief.
 *
 * FROM THE SENDER'S OUTLOOK, FILED ON THE JOB
 *
 * It goes from the signed-in person's mailbox, where the reply comes back and
 * is found (services/rfq.ts `findReplies`). The record of each send files the
 * conversation on the enquiry and the partner among its parties, so the
 * request and the replies read as a thread on the case file.
 *
 * The same form serves the case file's Partner quotes (in a dialog) and Live
 * rates (on the page, after choosing the job).
 * ---------------------------------------------------------------------------
 */
export default function RateRequestForm({
  enquiry,
  source,
  layout,
  onSent,
  onCancel,
  onBusy,
}: {
  enquiry: Enquiry;
  source: "case_file" | "live_rates";
  /** In a dialog: the body scrolls between a fixed footer. On a page: all of it in flow. */
  layout: "dialog" | "page";
  onSent: (result: BurstResult) => void;
  onCancel?: () => void;
  /** Sending, so a dialog around it can refuse to close. */
  onBusy?: (busy: boolean) => void;
}) {
  const { session } = useAuth();
  const fromName = session?.name ?? "";
  const live = mailIsLive();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  /** Who is asked, in the order they were picked, with the services for each. */
  const [picked, setPicked] = useState<Array<{ id: string; services: string[] }>>([]);
  const [adding, setAdding] = useState<Record<string, string>>({});

  const initial = useMemo(() => draftRequest(enquiry, fromName), [enquiry, fromName]);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);

  const [briefing, setBriefing] = useState(false);
  const [brief, setBrief] = useState("");
  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState(false);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BurstResult | null>(null);
  /** Moves after each send, so the country's list of what was sent reads itself again. */
  const [sentVersion, setSentVersion] = useState(0);
  /**
   * A partner not in the directory yet, added here (1 Oct): asking a new
   * agent for a rate used to mean leaving the job for Agents & partners and
   * coming back. Saved to the directory like any other, and chosen at once.
   */
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void listPartners()
      .then(setPartners)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the partners."))
      .finally(() => setLoading(false));
  }, []);

  // A half-typed new partner holds the dialog open, as a send does.
  useEffect(() => onBusy?.(busy || creating), [busy, creating, onBusy]);

  const byId = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);
  const catalogue = useMemo(() => serviceCatalogue(enquiry), [enquiry]);
  const chosen = new Set(picked.map((p) => p.id));
  const tagsInUse = useMemo(() => [...new Set(partners.flatMap((p) => p.tags))].sort(), [partners]);

  /** The partner just added: into the list, and chosen for this request when they have an address. */
  function added(p: Partner) {
    setCreating(false);
    setPartners((list) => [...list.filter((x) => x.id !== p.id), p]);
    if (p.emails.length) {
      setResult(null);
      setPicked((list) => (list.some((x) => x.id === p.id) ? list : [...list, { id: p.id, services: defaultServices(p.role, enquiry) }]));
    }
  }

  function toggle(p: Partner) {
    if (!p.emails.length) return;
    setResult(null);
    setPicked((list) =>
      list.some((x) => x.id === p.id)
        ? list.filter((x) => x.id !== p.id)
        : [...list, { id: p.id, services: defaultServices(p.role, enquiry) }]
    );
  }

  const setServices = (id: string, fn: (s: string[]) => string[]) =>
    setPicked((list) => list.map((x) => (x.id === id ? { ...x, services: cleanServices(fn(x.services)) } : x)));

  function addService(id: string) {
    const text = (adding[id] ?? "").trim();
    if (!text) return;
    setServices(id, (s) => [...s, text]);
    setAdding((a) => ({ ...a, [id]: "" }));
  }

  async function writeIt() {
    if (!brief.trim()) return setError("Say what this request should do.");
    setWriting(true);
    setError(null);
    try {
      setBody(await draftRequestWithAi({ enquiry, fromName, instruction: brief }));
      setWrote(true);
      setBriefing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write that request.");
    } finally {
      setWriting(false);
    }
  }

  const mailFor = (id: string) => {
    const p = byId.get(id)!;
    const services = picked.find((x) => x.id === id)?.services ?? [];
    return {
      partnerId: p.id,
      to: p.emails,
      label: p.organisation?.trim() || p.name,
      services,
      subject: withReference(subject, enquiry.ref),
      body: personalise(body, p, services, enquiry),
    };
  };

  const missing = picked.filter((x) => !x.services.length).map((x) => byId.get(x.id)).filter((p): p is Partner => Boolean(p));

  async function send() {
    setError(null);
    if (!picked.length) return setError("Choose at least one partner.");
    if (missing.length) return setError(`Choose what ${missing.map((p) => p.organisation || p.name).join(", ")} should price.`);
    if (!subject.trim()) return setError("The request needs a subject.");
    if (!body.replace(/<[^>]+>/g, "").trim()) return setError("The message about the shipment is empty.");
    setBusy(true);
    setProgress({ done: 0, total: picked.length });
    try {
      const r = await sendBurst({
        enquiry,
        source,
        mails: picked.map((x) => mailFor(x.id)),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(r);
      setSentVersion((v) => v + 1);
      // Whoever was reached is done; whoever was not stays picked, to try again.
      const reached = new Set(r.sent.map((q) => q.partner_id));
      setPicked((list) => list.filter((x) => !reached.has(x.id)));
      onSent(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the request.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const preview = previewId && chosen.has(previewId) ? mailFor(previewId) : null;
  const dialog = layout === "dialog";

  return (
    <>
      <div className={dialog ? "flex-1 space-y-5 overflow-y-auto px-5 py-4" : "space-y-5"}>
        {!live && (
          <div className="flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
            <AlertCircle size={13} className="mt-px shrink-0" />
            <span>
              <strong className="font-medium">Outlook is not connected on this session.</strong> Rate requests go from your own mailbox, so
              nothing can be sent until you connect it on the Mail page.
            </span>
          </div>
        )}

        {/* ---- who ---- */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-text-secondary">
              1 · Partners to ask, by country
              {picked.length > 0 && <span className="ml-2 font-normal text-text-muted">{picked.length} chosen</span>}
            </p>
            {!creating && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="flex h-7 items-center gap-1 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
              >
                <Plus size={12} /> New partner
              </button>
            )}
          </div>

          {creating && (
            <div className="mb-3">
              <PartnerForm inline suggestions={tagsInUse} onClose={() => setCreating(false)} onSaved={added} />
            </div>
          )}

          {loading ? (
            <InlineLoading label="Loading partners" className="py-1 text-[12px]" />
          ) : !partners.length ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-text-secondary">
              No partners yet. Add the first with <strong className="font-medium text-text-primary">New partner</strong>, above.
            </p>
          ) : (
            <CountryPartnerPicker
              partners={partners}
              isPicked={(id) => chosen.has(id)}
              onToggle={toggle}
              onPickAll={(ps) => {
                setResult(null);
                setPicked((list) => [...list, ...ps.map((p) => ({ id: p.id, services: defaultServices(p.role, enquiry) }))]);
              }}
              disabled={busy}
              history={(inCountry, country) => <SentToCountry partners={inCountry} country={country} version={sentVersion} />}
            />
          )}
        </section>

        {/* ---- what each is asked for ---- */}
        {picked.length > 0 && (
          <section>
            <p className="mb-2 text-[12px] font-medium text-text-secondary">
              2 · What each partner should price
              <span className="ml-2 font-normal text-text-muted">Ticked from their role; change it for each.</span>
            </p>
            <div className="space-y-2">
              {picked.map((x) => {
                const p = byId.get(x.id);
                if (!p) return null;
                const custom = x.services.filter((s) => !catalogue.includes(s));
                return (
                  <div key={x.id} className={`rounded-lg border px-3 py-2.5 ${x.services.length ? "border-border" : "border-text-warning/40 bg-bg-warning/40"}`}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 truncate text-[12.5px] font-medium text-text-primary">{p.organisation?.trim() || p.name}</p>
                      <span className="text-[11px] text-text-muted">{PARTNER_ROLE_LABEL[p.role]}</span>
                      <button
                        type="button"
                        onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
                        className={`ml-auto inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] ${previewId === p.id ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
                      >
                        <Eye size={11} /> {previewId === p.id ? "Hide their mail" : "Their mail"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => toggle(p)} className="grid size-6 place-items-center rounded-md text-text-muted hover:text-text-primary" aria-label={`Remove ${p.organisation || p.name}`}>
                        <X size={12} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[...catalogue, ...custom].map((s) => {
                        const on = x.services.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={busy}
                            aria-pressed={on}
                            onClick={() => setServices(x.id, (list) => (on ? list.filter((v) => v !== s) : [...list, s]))}
                            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] transition-colors ${
                              on ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
                            }`}
                          >
                            {on && <Check size={10} />}
                            {s}
                          </button>
                        );
                      })}
                      <span className="inline-flex h-7 items-center overflow-hidden rounded-full border border-dashed border-border-strong bg-surface-1">
                        <input
                          value={adding[x.id] ?? ""}
                          onChange={(e) => setAdding((a) => ({ ...a, [x.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addService(x.id);
                            }
                          }}
                          maxLength={120}
                          placeholder="Another service"
                          aria-label={`Another service for ${p.organisation || p.name}`}
                          className="h-full w-32 border-0 bg-transparent px-2.5 text-[11.5px] focus:ring-0"
                        />
                        <button type="button" onClick={() => addService(x.id)} className="grid h-full w-7 place-items-center text-text-muted hover:text-text-primary" aria-label="Add the service">
                          <Plus size={12} />
                        </button>
                      </span>
                    </div>
                    {!x.services.length && <p className="mt-1.5 text-[11px] text-text-warning">Choose at least one service for them.</p>}
                    {preview && previewId === x.id && <MailPreview mail={preview} from={session?.email || "your mailbox"} />}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ---- the message ---- */}
        <section>
          <p className="mb-1.5 text-[12px] font-medium text-text-secondary">3 · The mail</p>
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-text-muted">Subject — the reference {`[${enquiry.ref}]`} stays in it, so replies file on the job</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full" autoComplete="off" disabled={busy} />
          </label>

          <div className="mb-1.5 mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11.5px] text-text-muted">
              {wrote ? "Written to your brief — read it before it goes." : "About the shipment, built from the enquiry. Each partner's greeting and services go above it."}
            </p>
            <div className="flex items-center gap-2">
              {wrote && (
                <button
                  type="button"
                  onClick={() => {
                    setBody(initial.body);
                    setWrote(false);
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary"
                >
                  <RotateCcw size={11} /> Back to the standard message
                </button>
              )}
              <button
                type="button"
                onClick={() => setBriefing((v) => !v)}
                aria-expanded={briefing}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary"
              >
                <Sparkles size={11} /> {wrote ? "Write it again" : "Write it with AI"}
              </button>
            </div>
          </div>

          {briefing && (
            <div className="mb-2 rounded-card border border-border bg-surface-2 p-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">What should this request do?</span>
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (!writing) void writeIt();
                    }
                  }}
                  rows={3}
                  autoFocus
                  placeholder="e.g. the customer needs it on the water before the 15th — ask for the earliest sailing and whether they can hold space"
                  className="w-full text-[12.5px]"
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] leading-relaxed text-text-muted">It may use only the details on this enquiry. It cannot invent a weight, a volume or a date.</p>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => setBriefing(false)} className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:text-text-primary">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void writeIt()}
                    disabled={writing || !brief.trim()}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[11.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    {writing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    {writing ? "Writing…" : "Write it"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {writing ? <Drafting label="Writing the rate request" lines={5} /> : <RichTextEditor value={body} onChange={setBody} minHeight={200} />}
        </section>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
            <AlertCircle size={13} className="mt-px shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-border px-3 py-2.5 text-[12px]">
            {result.sent.map((q) => (
              <p key={q.id} className="flex items-start gap-1.5 text-text-success">
                <CheckCircle2 size={13} className="mt-px shrink-0" />
                <span>
                  Sent to <b className="font-medium">{q.partner_label || q.partner_email}</b>
                  {q.services.length ? ` for ${q.services.join(", ")}` : ""} — filed on {q.enquiry_ref}.
                </span>
              </p>
            ))}
            {result.failed.map((f) => (
              <p key={f.email + f.label} className="mt-0.5 flex items-start gap-1.5 text-text-danger">
                <XCircle size={13} className="mt-px shrink-0" />
                <span>
                  <b className="font-medium">{f.label || f.email}</b>: {f.reason} They are still chosen, to try again.
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      <footer className={`flex flex-wrap items-center justify-between gap-3 ${dialog ? "border-t border-border px-5 py-3" : "mt-4 border-t border-border pt-3"}`}>
        <p className="text-[11px] text-text-muted">
          {busy && progress
            ? `Sending ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : picked.length === 0
              ? "Nobody chosen yet."
              : `${picked.length} separate mail${picked.length === 1 ? "" : "s"} from ${session?.email || "your mailbox"} — nobody sees who else was asked.`}
        </p>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={busy} className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50">
              {result ? "Close" : "Cancel"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !picked.length || (!live && !import.meta.env.DEV)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {busy ? "Sending…" : picked.length ? `Send to ${picked.length} partner${picked.length === 1 ? "" : "s"}` : "Send"}
          </button>
        </div>
      </footer>
    </>
  );
}

const STATUS_TONE: Record<QuoteStatus, "neutral" | "accent" | "success" | "warning"> = {
  asked: "neutral",
  replied: "accent",
  quoted: "success",
  declined: "warning",
  no_reply: "neutral",
};

/**
 * The rate requests a country's partners have been sent, on any job, from
 * here or from a case file (116): under the country's list, so what went to
 * Taiwan last is in view when Taiwan is asked again.
 */
function SentToCountry({ partners, country, version }: { partners: Partner[]; country: string; version: number }) {
  const [rows, setRows] = useState<PartnerQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const ids = partners.map((p) => p.id).join(",");

  useEffect(() => {
    let gone = false;
    setRows(null);
    setError(null);
    rateRequestsTo(ids ? ids.split(",") : [])
      .then((r) => !gone && setRows(r))
      .catch((e) => !gone && setError(failureText(e, "Could not read what was sent.").message));
    return () => {
      gone = true;
    };
  }, [ids, version]);

  const shown = all ? rows ?? [] : (rows ?? []).slice(0, 5);
  return (
    <div>
      <p className="text-[11.5px] font-medium text-text-secondary">Sent to partners in {country || "this list"}</p>
      {error ? (
        <p className="mt-1 text-[11.5px] text-text-danger">{error}</p>
      ) : rows === null ? (
        <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-text-muted">
          <Loader2 size={11} className="animate-spin" /> Reading…
        </p>
      ) : !rows.length ? (
        <p className="mt-1 text-[11.5px] text-text-muted">No rate request has gone to them yet.</p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border">
            {shown.map((q) => (
              <li key={q.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-[11.5px]">
                <span className="text-text-muted">{formatDate(q.sent_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</span>
                <span className="font-medium text-text-primary">{q.partner_label || q.partner_email}</span>
                <Link to={`/enquiries/${encodeURIComponent(q.enquiry_ref)}?section=quote`} className="font-mono text-text-accent hover:underline">
                  {q.enquiry_ref}
                </Link>
                <StatusPill tone={STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</StatusPill>
                {q.amount != null && (
                  <span className="tabular-nums text-text-primary">
                    {q.currency ? `${q.currency} ` : ""}
                    {Number(q.amount).toLocaleString("en-IN")}
                  </span>
                )}
                <span className="w-full truncate text-text-muted">
                  {q.subject}
                  {q.services.length ? ` · ${q.services.join(", ")}` : ""}
                  {q.sent_from ? ` · from ${q.sent_from}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="mt-1 text-[11.5px] text-text-accent hover:underline">
              Show all {rows.length}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** One partner's mail, exactly: as their Outlook shows it, bullets and spacing included. */
function MailPreview({ mail, from }: { mail: { to: string[]; subject: string; body: string }; from: string }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-surface-2 px-3 py-2 text-[12px]">
        <p className="break-words text-text-muted">
          To {mail.to.join(", ")} · from {from}
        </p>
        <p className="mt-0.5 break-words font-medium text-text-primary">{mail.subject}</p>
      </div>
      {/* The message may be AI-written or edited: shown sanitised. */}
      <div
        className="overflow-x-auto bg-white px-4 py-3 text-[13px] leading-relaxed text-[#1f2937] [&_li]:my-0.5 [&_p]:my-2 [&_td]:align-top [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mail.body) }}
      />
    </div>
  );
}
