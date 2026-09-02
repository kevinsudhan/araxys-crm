import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  Clock,
  FileText,
  Mail as MailIcon,
  Package,
  Paperclip,
  PhoneCall,
  Users,
} from "lucide-react";
import {
  callsFor,
  correspondenceFor,
  getCustomer,
  getEnquiry,
  partiesFor,
  timelineFor,
  type FiledMessage,
} from "../services/mockCaseFile";
import { ROLE_LABEL, ROLE_ORDER, type PartyRole } from "../services/caseFile";

/**
 * One shipment, everything about it.
 *
 * A shipment's correspondence is spread across several desk mailboxes and
 * several counterparties -- the customer, the line, the broker, the CFS -- and
 * a mail client can only ever show one mailbox at a time. This page is the
 * reason to read mail inside the CRM rather than in Outlook: it assembles the
 * whole file around the reference instead of around a folder.
 */
export default function CaseFile() {
  const { ref = "" } = useParams();
  const [view, setView] = useState<"timeline" | "grouped">("timeline");

  /**
   * Which party groups are showing.
   *
   * Empty means all of them: opening "By party" to a blank screen would make
   * the view look broken, so nothing selected is treated as no filter rather
   * than as an empty filter. Clicking a chip narrows to it.
   */
  const [shown, setShown] = useState<PartyRole[]>([]);
  const [showCalls, setShowCalls] = useState(true);

  const enquiry = useMemo(() => getEnquiry(ref), [ref]);
  const customer = enquiry ? getCustomer(enquiry.customerId) : null;
  const parties = useMemo(() => partiesFor(ref), [ref]);
  const correspondence = useMemo(() => correspondenceFor(ref), [ref]);
  const calls = useMemo(() => callsFor(ref), [ref]);
  const timeline = useMemo(() => timelineFor(ref), [ref]);

  if (!enquiry) {
    return (
      <div>
        <Link to="/enquiries" className="inline-flex items-center gap-1 text-[12px] text-text-accent mb-4">
          <ChevronLeft size={14} /> All enquiries
        </Link>
        <p className="text-[13px] text-text-muted">No enquiry with reference {ref}.</p>
      </div>
    );
  }

  const allGroups = ROLE_ORDER.map((role) => ({
    role,
    items: correspondence.filter((c) => c.role === role),
  })).filter((g) => g.items.length);

  const filtering = shown.length > 0;
  const byRole = filtering ? allGroups.filter((g) => shown.includes(g.role)) : allGroups;
  const callsVisible = filtering ? showCalls && shown.length === 0 : showCalls;

  const toggleRole = (role: PartyRole) =>
    setShown((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  return (
    <div>
      <Link
        to="/enquiries"
        className="inline-flex items-center gap-1 text-[12px] text-text-accent mb-3 hover:underline"
      >
        <ChevronLeft size={14} /> All enquiries
      </Link>

      {/* ---- header ---- */}
      <div className="rounded-card border border-border bg-surface-1 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-mono text-[13px] text-text-accent">{enquiry.ref}</p>
            <h1 className="mt-0.5 text-[19px] font-semibold tracking-tight text-text-primary">
              {customer?.company ?? "Unknown customer"}
            </h1>
            <p className="mt-0.5 text-[13px] text-text-secondary">
              {customer?.name} · {enquiry.origin} → {enquiry.destination} · {enquiry.cargo}
            </p>
          </div>
          <span className="rounded-full bg-bg-accent px-2.5 py-1 text-[11px] font-medium text-text-accent capitalize">
            {enquiry.stage.replace("_", " ")}
          </span>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5 text-[12px]">
          <Fact label="Volume" value={enquiry.volumeCbm ? `${enquiry.volumeCbm} CBM` : "—"} />
          <Fact label="Container" value={enquiry.containerCode ?? "—"} />
          <Fact label="Container no." value={enquiry.containerNumber ?? "—"} mono />
          <Fact label="B/L" value={enquiry.blNumber ?? "—"} mono />
          <Fact label="Sailing" value={enquiry.sailingDate ?? "—"} />
        </dl>
      </div>

      {/* ---- parties ---- */}
      <section className="mt-4 rounded-card border border-border bg-surface-1 p-5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
          <Users size={12} /> Parties
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {parties.map((p) => (
            <div key={`${p.role}-${p.emails[0]}`} className="rounded-lg bg-surface-2 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">
                {ROLE_LABEL[p.role]}
              </p>
              <p className="mt-0.5 text-[13px] text-text-primary">{p.name}</p>
              <p className="text-[11px] text-text-secondary">{p.organisation}</p>
              <p className="mt-0.5 text-[11px] text-text-muted truncate">{p.emails.join(", ")}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- view switch ---- */}
      <div className="mt-5 flex items-center gap-2">
        <Toggle active={view === "timeline"} onClick={() => setView("timeline")}>
          <Clock size={13} /> Timeline
        </Toggle>
        <Toggle active={view === "grouped"} onClick={() => setView("grouped")}>
          <MailIcon size={13} /> By party
        </Toggle>
        <span className="ml-auto text-[11px] text-text-muted">
          {correspondence.length} messages · {calls.length} calls
        </span>
      </div>

      {/*
        The party chips live under the toggle rather than in a sidebar, because
        they only mean anything in this view and a filter that persists across a
        view it does not apply to is a filter people forget they left on.
      */}
      {view === "grouped" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip active={!filtering} onClick={() => { setShown([]); setShowCalls(true); }}>
            All
            <Count n={correspondence.length + calls.length} />
          </Chip>
          {allGroups.map((g) => (
            <Chip
              key={g.role}
              active={shown.includes(g.role)}
              onClick={() => toggleRole(g.role)}
            >
              {ROLE_LABEL[g.role]}
              <Count n={g.items.length} />
            </Chip>
          ))}
          {calls.length > 0 && (
            <Chip
              active={!filtering && showCalls}
              onClick={() => {
                setShown([]);
                setShowCalls(true);
              }}
            >
              Calls
              <Count n={calls.length} />
            </Chip>
          )}
        </div>
      )}

      {view === "timeline" ? (
        /**
         * Chronology is the default: a customs query at 11am and the broker's
         * reply at 2pm belong next to each other, not in separate buckets.
         * Grouping is how you find a message; this is how you understand what
         * happened.
         */
        <ol className="mt-3 space-y-2">
          {timeline.map((entry) =>
            entry.kind === "call" ? (
              <li key={`call-${entry.call.callId}`}>
                <div className="rounded-card border border-border bg-surface-1 p-4">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <PhoneCall size={12} className="text-text-success" />
                    <span className="font-medium text-text-success uppercase tracking-wide">Call</span>
                    <span>{entry.call.agent}</span>
                    <span>{entry.call.fromNumber}</span>
                    <span>{entry.call.language}</span>
                    <span>{Math.round(entry.call.durationSecs / 60)} min</span>
                    <span className="ml-auto">{when(entry.at)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] text-text-primary">{entry.call.summary}</p>
                </div>
              </li>
            ) : (
              <li key={`mail-${entry.filed.message.id}`}>
                <MailRow filed={entry.filed} showRole />
              </li>
            )
          )}
        </ol>
      ) : (
        <div className="mt-3 space-y-5">
          {byRole.map((group) => (
            <section key={group.role}>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
                {ROLE_LABEL[group.role as PartyRole]}
                <span className="ml-1.5 text-text-muted">{group.items.length}</span>
              </h3>
              <div className="space-y-2">
                {group.items.map((filed) => (
                  <MailRow key={filed.message.id} filed={filed} />
                ))}
              </div>
            </section>
          ))}

          {!byRole.length && (
            <p className="text-[13px] text-text-muted py-4">
              Nothing in that group.
            </p>
          )}

          {callsVisible && calls.length > 0 && (
            <section>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
                Calls <span className="ml-1.5 text-text-muted">{calls.length}</span>
              </h3>
              <div className="space-y-2">
                {calls.map((c) => (
                  <div key={c.callId} className="rounded-card border border-border bg-surface-1 p-4">
                    <div className="flex items-center gap-2 text-[11px] text-text-muted">
                      <PhoneCall size={12} className="text-text-success" />
                      <span>{c.agent}</span>
                      <span>{c.fromNumber}</span>
                      <span>{c.language}</span>
                      <span className="ml-auto">{when(c.startedAt)}</span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-text-primary">{c.summary}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {enquiry.recordRef && (
        <p className="mt-5 text-[12px] text-text-secondary">
          <FileText size={12} className="inline mr-1 -mt-0.5" />
          Pipeline record{" "}
          <Link to={`/records/${enquiry.recordRef}`} className="text-text-accent hover:underline font-mono">
            {enquiry.recordRef}
          </Link>{" "}
          — captured fields, documents and container placement.
        </p>
      )}
    </div>
  );
}

function MailRow({ filed, showRole = false }: { filed: FiledMessage; showRole?: boolean }) {
  const { message: m } = filed;
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
        <span className="text-text-muted">via {m.mailbox.split("@")[0]}@</span>
        {m.hasAttachments && <Paperclip size={11} />}
        {/*
          How a message came to be filed here is shown, not hidden. A container
          number found in a body is a guess -- carriers mention several bookings
          in one message -- and a guess should not look like a stated fact.
        */}
        {filed.confidence === "likely" && (
          <span className="inline-flex items-center gap-1 rounded bg-bg-warning px-1.5 py-0.5 text-[10px] text-text-warning">
            <AlertCircle size={9} />
            matched on {filed.via.replace(/-/g, " ")}
          </span>
        )}
        <span className="ml-auto">{when(m.receivedDateTime)}</span>
      </div>
      <p className="mt-1 text-[13px] font-medium text-text-primary">{m.subject}</p>
      <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-2">{m.bodyPreview}</p>
    </div>
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

function Count({ n }: { n: number }) {
  return <span className="opacity-60">{n}</span>;
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={`text-[13px] text-text-primary ${mono ? "font-mono" : ""}`}>{value}</dd>
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

function when(iso: string) {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export { Package };
