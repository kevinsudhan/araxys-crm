import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  Inbox,
  Mail as MailIcon,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  Search,
  Send,
  FileEdit,
  AlertCircle,
  Package,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import ComposeMail from "../components/ComposeMail";
import { useAuth } from "../lib/auth";
import {
  getMailFolders,
  getMailMessages,
  moveMailMessage,
  setMailRead,
  mailIsLive,
  whoami,
  GraphAuthError,
  type FolderId,
  type MailFolder,
  type MailMessage,
} from "../services/backend";

const FOLDER_ICON: Record<FolderId, React.ElementType> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileEdit,
  archive: Archive,
};

/**
 * Outlook inside the CRM.
 *
 * Three panes, because that is what a mail client is and inventing a novel
 * layout for one only makes it slower to use: folders, the list, the message.
 *
 * The mailbox is the signed-in account and nothing else. There is no mailbox
 * picker, because a person signed in as imports@ has no business reading
 * aarathy@ -- and a picker is how that ends up happening by accident.
 */
export default function Mail() {
  const { session, signInWithMicrosoft } = useAuth();
  const mailbox = session?.email ?? "";

  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<null | { replyTo?: MailMessage }>(null);
  const live = mailIsLive();

  /**
   * The address Microsoft says the token belongs to.
   *
   * Not the same thing as the CRM profile's email, and the difference matters:
   * /me/sendMail sends as whoever the token is, regardless of what this app
   * believes. A tenant with two domains can easily end up signing someone in as
   * one address while their Microsoft account sits on the other -- and mail then
   * goes out from a domain whose SPF may not be set up, which looks like the CRM
   * failing to send when it is actually sending as somebody else.
   */
  const [graphMailbox, setGraphMailbox] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      setGraphMailbox(null);
      return;
    }
    let cancelled = false;
    void whoami().then((who) => !cancelled && setGraphMailbox(who));
    return () => {
      cancelled = true;
    };
  }, [live]);

  const load = useCallback(async () => {
    if (!mailbox) return;
    setLoading(true);
    setError(null);
    try {
      const [f, m] = await Promise.all([
        getMailFolders(mailbox),
        getMailMessages(mailbox, folder, query || undefined),
      ]);
      setFolders(f.folders);
      setMessages(m.messages);
    } catch (e) {
      setError(
        e instanceof GraphAuthError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not load the mailbox."
      );
    } finally {
      setLoading(false);
    }
  }, [mailbox, folder, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Changing folder should not leave the previous folder's message on screen.
  useEffect(() => setSelectedId(null), [folder]);

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId]
  );

  async function open(m: MailMessage) {
    setSelectedId(m.id);
    if (!m.isRead) {
      // Optimistic: the row should stop looking unread the instant it is clicked.
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isRead: true } : x)));
      setFolders((prev) =>
        prev.map((f) => (f.id === "inbox" ? { ...f, unread: Math.max(0, f.unread - 1) } : f))
      );
      try {
        await setMailRead(mailbox, m.id, true);
      } catch {
        void load();
      }
    }
  }

  async function archive(m: MailMessage) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setSelectedId(null);
    try {
      await moveMailMessage(mailbox, m.id, "archive");
      void load();
    } catch {
      void load();
    }
  }

  if (!mailbox) return null;

  return (
    <div>
      <PageHeader
        title="Mail"
        subtitle={
          live && graphMailbox
            ? `Connected to Outlook as ${graphMailbox} — mail sent from here is sent as this address.`
            : `Outlook for ${mailbox} — the desk's mailbox, alongside the shipments it is about.`
        }
      />

      {/*
        A mismatch here is not cosmetic: mail leaves as the Microsoft address, so
        if the two disagree the sender is not who the CRM has been claiming.
      */}
      {live && graphMailbox && graphMailbox.toLowerCase() !== mailbox.toLowerCase() && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            You are signed into the CRM as <strong className="font-medium">{mailbox}</strong> but
            Outlook is connected as <strong className="font-medium">{graphMailbox}</strong>.
            Mail sent from here will come from the Outlook address, not the CRM one.
          </span>
        </div>
      )}

      {/*
        Whether this is a real mailbox is not a detail to leave people guessing
        about: "Send" means something very different in each case.
      */}
      {/*
        Connecting is offered here rather than only on the login page. Someone who
        signed in with a password has no way back to Microsoft short of signing
        out, and "sign out to fix your mail" is not an instruction worth giving.
      */}
      {!live && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <div className="flex-1">
            <p>
              <strong className="font-medium">Demonstration mailbox.</strong> These messages are
              samples, and anything sent from here is filed locally rather than delivered.
            </p>
            <button
              onClick={() => void signInWithMicrosoft()}
              className="mt-2 inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2"
            >
              <MicrosoftMark />
              Connect Outlook for {mailbox}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setComposing({})}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
        >
          <PenSquare size={13} />
          New message
        </button>

        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this folder…"
            className="w-full pl-8 h-8"
          />
        </div>

        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[168px_minmax(0,340px)_minmax(0,1fr)] gap-3 items-start">
        {/* ---- folders ---- */}
        <nav className="rounded-card border border-border bg-surface-1 p-2">
          {folders.map((f) => {
            const Icon = FOLDER_ICON[f.id];
            const active = f.id === folder;
            return (
              <button
                key={f.id}
                onClick={() => setFolder(f.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] mb-0.5 transition-colors ${
                  active
                    ? "bg-surface-2 text-text-primary font-medium"
                    : "text-text-secondary hover:bg-surface-2"
                }`}
              >
                <Icon size={14} />
                <span className="flex-1 text-left">{f.label}</span>
                {f.unread > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-medium flex items-center justify-center">
                    {f.unread}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ---- message list ---- */}
        <div className="rounded-card border border-border bg-surface-1 overflow-hidden">
          {loading && messages.length === 0 ? (
            <p className="text-[13px] text-text-muted p-4">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-text-muted p-4">
              {query ? "Nothing matches that search." : "Nothing in this folder."}
            </p>
          ) : (
            <ul className="divide-y divide-border max-h-[560px] overflow-y-auto">
              {messages.map((m) => {
                const other =
                  folder === "sent"
                    ? m.toRecipients[0]?.emailAddress.address ?? "—"
                    : m.from.emailAddress.name || m.from.emailAddress.address;
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => void open(m)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${
                        selectedId === m.id ? "bg-bg-accent" : "hover:bg-surface-2"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {!m.isRead && folder === "inbox" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
                        )}
                        <span
                          className={`flex-1 min-w-0 truncate text-[13px] ${
                            m.isRead ? "text-text-secondary" : "text-text-primary font-medium"
                          }`}
                        >
                          {other}
                        </span>
                        {m.importance === "high" && (
                          <AlertCircle size={11} className="text-text-danger shrink-0" />
                        )}
                        {m.hasAttachments && (
                          <Paperclip size={11} className="text-text-muted shrink-0" />
                        )}
                        <span className="text-[11px] text-text-muted shrink-0">
                          {shortTime(m.receivedDateTime)}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 truncate text-[12px] ${
                          m.isRead ? "text-text-secondary" : "text-text-primary font-medium"
                        }`}
                      >
                        {m.subject}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-text-muted">{m.bodyPreview}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ---- reading pane ---- */}
        <div className="rounded-card border border-border bg-surface-1 p-5 min-h-[320px]">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16">
              <MailIcon size={22} className="text-text-muted mb-2" />
              <p className="text-[13px] text-text-muted">Select a message to read it.</p>
            </div>
          ) : (
            <article>
              <h2 className="text-[17px] font-semibold tracking-tight text-text-primary">
                {selected.subject}
              </h2>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
                <span className="text-text-primary font-medium">
                  {selected.from.emailAddress.name || selected.from.emailAddress.address}
                </span>
                <span className="text-text-muted">{selected.from.emailAddress.address}</span>
                <span className="text-text-muted">{fullTime(selected.receivedDateTime)}</span>
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                To {selected.toRecipients.map((t) => t.emailAddress.address).join(", ") || "—"}
              </p>

              <ShipmentLinks text={`${selected.subject} ${selected.body.content}`} />

              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => setComposing({ replyTo: selected })}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
                >
                  <Reply size={13} />
                  Reply
                </button>
                {selected.folder !== "archive" && (
                  <button
                    onClick={() => void archive(selected)}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
                  >
                    <Archive size={13} />
                    Archive
                  </button>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-text-primary">
                  {selected.body.content}
                </pre>
              </div>

              {selected.attachments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
                    {selected.attachments.length} attachment
                    {selected.attachments.length > 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selected.attachments.map((a) => (
                      <span
                        key={a.name}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-secondary"
                      >
                        <Paperclip size={11} />
                        {a.name}
                        <span className="text-text-muted">{Math.round(a.size / 1024)} KB</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          )}
        </div>
      </div>

      {composing && (
        <ComposeMail
          mailbox={mailbox}
          fromName={session?.name ?? ""}
          replyTo={composing.replyTo}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Shipment references found in the message, linked to the record.
 *
 * This is the only reason to read mail in the CRM rather than in Outlook: an
 * email about ARX-ENQ-0001 is one click from the shipment it concerns, instead
 * of a copy-paste into a search box.
 */
function ShipmentLinks({ text }: { text: string }) {
  const refs = useMemo(() => {
    const found = text.match(/ARX-[A-Z]{3}-\d{4}/g) ?? [];
    return [...new Set(found)];
  }, [text]);

  if (!refs.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-text-muted">Mentions</span>
      {refs.map((ref) => (
        <Link
          key={ref}
          to={`/records/${ref}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-accent px-2.5 py-1 text-[12px] font-mono text-text-accent hover:underline"
        >
          <Package size={11} />
          {ref}
        </Link>
      ))}
    </div>
  );
}

/** Today shows a clock, anything older shows a date — the mail-client convention. */
function shortTime(isoDate: string) {
  const d = new Date(isoDate);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function fullTime(isoDate: string) {
  return new Date(isoDate).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Microsoft's four squares, drawn rather than fetched. */
function MicrosoftMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 23 23" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}
