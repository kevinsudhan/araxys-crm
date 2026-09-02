import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Clock,
  IndianRupee,
  Loader2,
  Mail as MailIcon,
  Paperclip,
  PhoneCall,
  Users,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import QuotePanel from "../components/QuotePanel";
import CargoPanel from "../components/CargoPanel";
import {
  callsFor,
  correspondenceFor,
  eventsFor,
  getEnquiry,
  partiesFor,
  quotesFor,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
  type EnquiryEvent,
  type FiledMessage,
  type Party,
  type Quote,
  type Call,
} from "../services/enquiries";
import { mailIsLive } from "../services/backend";
import { ROLE_LABEL, ROLE_ORDER, type PartyRole } from "../services/caseFile";

/**
 * One enquiry, everything about it.
 *
 * The inbound half of the job lives here: what the customer wants, what is
 * still missing before it can be priced, what was quoted, and whether they said
 * yes. Correspondence and events are the record of how it got there.
 */
export default function CaseFile() {
  const { ref = "" } = useParams();
  const { session } = useAuth();
  const mailbox = session?.email ?? "";

  const [enquiry, setEnquiry] = useState<(Enquiry & { customer: Customer | null }) | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [events, setEvents] = useState<EnquiryEvent[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [mail, setMail] = useState<FiledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"timeline" | "grouped">("timeline");
  const [shown, setShown] = useState<PartyRole[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const e = await getEnquiry(ref);
      setEnquiry(e);
      if (!e) return;
      const [p, q, ev, cl] = await Promise.all([
        partiesFor(ref),
        quotesFor(ref),
        eventsFor(ref),
        callsFor(ref),
      ]);
      setParties(p);
      setQuotes(q);
      setEvents(ev);
      setCalls(cl);
      // Mail is best-effort: a mailbox that will not load must not blank the file.
      setMail(await correspondenceFor(ref, mailbox).catch(() => []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this enquiry.");
    } finally {
      setLoading(false);
    }
  }, [ref, mailbox]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () =>
      ROLE_ORDER.map((role) => ({ role, items: mail.filter((m) => m.role === role) })).filter(
        (g) => g.items.length
      ),
    [mail]
  );

  const filtering = shown.length > 0;
  const visibleGroups = filtering ? groups.filter((g) => shown.includes(g.role)) : groups;

  const timeline = useMemo(() => {
    const entries = [
      ...mail.map((m) => ({ kind: "mail" as const, at: m.message.receivedDateTime, mail: m })),
      // Calls carry their own row; the matching event exists for the audit trail
      // and would otherwise say the same thing twice on screen.
      ...events
        .filter((e) => e.kind !== "call")
        .map((e) => ({ kind: "event" as const, at: e.at, event: e })),
      ...calls.map((c) => ({ kind: "call" as const, at: c.started_at ?? "", call: c })),
    ];
    return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [mail, events, calls]);

  if (loading && !enquiry) {
    return <p className="text-[13px] text-text-muted py-8">Loading…</p>;
  }

  if (!enquiry) {
    return (
      <div>
        <Back />
        <p className="text-[13px] text-text-muted">
          {error ?? `No enquiry with reference ${ref}.`}
        </p>
      </div>
    );
  }

  const customer = enquiry.customer;

  return (
    <div>
      <Back />

      {/* ---- header ---- */}
      <div className="rounded-card border border-border bg-surface-1 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-mono text-[13px] text-text-accent">{enquiry.ref}</p>
            <h1 className="mt-0.5 text-[19px] font-semibold tracking-tight text-text-primary">
              {customer?.company || customer?.name || "Unknown customer"}
            </h1>
            <p className="mt-0.5 text-[13px] text-text-secondary">
              {customer?.name}
              {enquiry.origin || enquiry.destination
                ? ` · ${[enquiry.origin, enquiry.destination].filter(Boolean).join(" → ")}`
                : ""}
              {enquiry.cargo ? ` · ${enquiry.cargo}` : ""}
            </p>
          </div>
          <div className="text-right">
            <span className="rounded-full bg-bg-accent px-2.5 py-1 text-[11px] font-medium text-text-accent">
              {STATUS_LABEL[enquiry.status]}
            </span>
            <p className="mt-1 text-[11px] text-text-muted capitalize">via {enquiry.source}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- what we know, and what is still missing ---- */}
      <CargoPanel enquiry={enquiry} onSaved={load} />

      {/* ---- quoting and acceptance ---- */}
      <QuotePanel enquiry={enquiry} quotes={quotes} onChanged={load} />

      {/* ---- parties ---- */}
      <section className="mt-4 rounded-card border border-border bg-surface-1 p-5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
          <Users size={12} /> Parties
        </h2>
        {!parties.length ? (
          <p className="text-[12px] text-text-muted">
            Nobody recorded yet. Correspondents are added as they appear, and the role is what
            groups their mail below.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {parties.map((p) => (
              <div key={p.id} className="rounded-lg bg-surface-2 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">
                  {ROLE_LABEL[p.role]}
                </p>
                <p className="mt-0.5 text-[13px] text-text-primary">{p.name}</p>
                {p.organisation && (
                  <p className="text-[11px] text-text-secondary">{p.organisation}</p>
                )}
                <p className="mt-0.5 text-[11px] text-text-muted truncate">{p.emails.join(", ")}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- correspondence and history ---- */}
      <div className="mt-5 flex items-center gap-2">
        <Toggle active={view === "timeline"} onClick={() => setView("timeline")}>
          <Clock size={13} /> Timeline
        </Toggle>
        <Toggle active={view === "grouped"} onClick={() => setView("grouped")}>
          <MailIcon size={13} /> By party
        </Toggle>
        <span className="ml-auto text-[11px] text-text-muted">
          {mail.length} messages · {calls.length} calls · {events.length} events
        </span>
      </div>

      {view === "grouped" && groups.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip active={!filtering} onClick={() => setShown([])}>
            All <span className="opacity-60">{mail.length}</span>
          </Chip>
          {groups.map((g) => (
            <Chip
              key={g.role}
              active={shown.includes(g.role)}
              onClick={() =>
                setShown((prev) =>
                  prev.includes(g.role) ? prev.filter((r) => r !== g.role) : [...prev, g.role]
                )
              }
            >
              {ROLE_LABEL[g.role]} <span className="opacity-60">{g.items.length}</span>
            </Chip>
          ))}
        </div>
      )}

      {!mailIsLive() && (
        <p className="mt-3 text-[12px] text-text-muted">
          Outlook is not connected on this session, so no correspondence is shown. Connect it on
          the Mail page.
        </p>
      )}

      {view === "timeline" ? (
        <ol className="mt-3 space-y-2">
          {timeline.map((entry) =>
            entry.kind === "call" ? (
              <li key={entry.call.call_id}>
                <div className="rounded-card border border-border bg-surface-1 p-4">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted flex-wrap">
                    <PhoneCall size={12} className="text-text-success" />
                    <span className="font-medium text-text-success uppercase tracking-wide">
                      Call
                    </span>
                    <span>{entry.call.agent_name}</span>
                    <span>{entry.call.from_number}</span>
                    {entry.call.language && <span>{entry.call.language}</span>}
                    <span>{Math.round(entry.call.duration_secs / 60)} min</span>
                    {/*
                      A caller identified by reading out a reference is a
                      different kind of certainty from one matched on their
                      number, and an unmatched one is a guess. Say which.
                    */}
                    {entry.call.matched_by === "reference" && (
                      <span className="rounded bg-bg-accent px-1.5 py-0.5 text-[10px] text-text-accent">
                        matched by reference
                      </span>
                    )}
                    {entry.call.matched_by === "unmatched" && (
                      <span className="rounded bg-bg-warning px-1.5 py-0.5 text-[10px] text-text-warning">
                        caller not identified
                      </span>
                    )}
                    <span className="ml-auto">{when(entry.at)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] text-text-primary">
                    {entry.call.summary || "No summary available for this call."}
                  </p>
                </div>
              </li>
            ) : entry.kind === "event" ? (
              <li key={entry.event.id}>
                <div className="rounded-card border border-border bg-surface-1 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <EventIcon kind={entry.event.kind} />
                    <span className="uppercase tracking-wide">
                      {entry.event.kind.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto">{when(entry.at)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-text-primary">{entry.event.summary}</p>
                </div>
              </li>
            ) : (
              <li key={entry.mail.message.id}>
                <MailRow filed={entry.mail} showRole />
              </li>
            )
          )}
          {!timeline.length && (
            <p className="text-[13px] text-text-muted py-6">Nothing recorded yet.</p>
          )}
        </ol>
      ) : (
        <div className="mt-3 space-y-5">
          {visibleGroups.map((g) => (
            <section key={g.role}>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
                {ROLE_LABEL[g.role]} <span className="ml-1 text-text-muted">{g.items.length}</span>
              </h3>
              <div className="space-y-2">
                {g.items.map((f) => (
                  <MailRow key={f.message.id} filed={f} />
                ))}
              </div>
            </section>
          ))}
          {!visibleGroups.length && (
            <p className="text-[13px] text-text-muted py-6">No correspondence in that group.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Back() {
  return (
    <Link
      to="/enquiries"
      className="inline-flex items-center gap-1 text-[12px] text-text-accent mb-3 hover:underline"
    >
      <ChevronLeft size={14} /> All enquiries
    </Link>
  );
}

function EventIcon({ kind }: { kind: string }) {
  if (kind === "accepted") return <Check size={12} className="text-text-success" />;
  if (kind === "quote_sent") return <IndianRupee size={12} className="text-text-warning" />;
  if (kind === "mail_linked") return <MailIcon size={12} className="text-text-accent" />;
  if (kind === "created") return <PhoneCall size={12} className="text-text-accent" />;
  return <Clock size={12} />;
}

function MailRow({ filed, showRole = false }: { filed: FiledMessage; showRole?: boolean }) {
  const m = filed.message;
  const outbound = m.folder === "sent";
  const other = outbound
    ? m.toRecipients[0]?.emailAddress.address ?? "—"
    : m.from.emailAddress.name || m.from.emailAddress.address;

  return (
    <div className="rounded-card border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-2 text-[11px] text-text-muted flex-wrap">
        <MailIcon size={12} className="text-text-accent" />
        <span className={outbound ? "text-text-secondary" : "text-text-primary font-medium"}>
          {outbound ? `To ${other}` : other}
        </span>
        {showRole && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
            {ROLE_LABEL[filed.role]}
          </span>
        )}
        {m.hasAttachments && <Paperclip size={11} />}
        {filed.confidence === "likely" && (
          <span className="inline-flex items-center gap-1 rounded bg-bg-warning px-1.5 py-0.5 text-[10px] text-text-warning">
            <AlertCircle size={9} /> matched on {filed.via.replace(/-/g, " ")}
          </span>
        )}
        <span className="ml-auto">{when(m.receivedDateTime)}</span>
      </div>
      <p className="mt-1 text-[13px] font-medium text-text-primary">{m.subject}</p>
      <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-2">{m.bodyPreview}</p>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors ${
        active
          ? "border-border-strong bg-surface-2 text-text-primary"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}

export { Loader2 };

function when(iso: string) {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
