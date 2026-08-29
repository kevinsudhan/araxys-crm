import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Send, X } from "lucide-react";
import { sendMail, mailIsLive, type MailMessage } from "../services/backend";

/**
 * Compose, and reply.
 *
 * One component for both: a reply is a compose with the recipient, subject and
 * quoted body already filled, and the conversation id carried across so the
 * sent copy threads with what it answers. Splitting them would duplicate the
 * validation and the send path for no gain.
 */
export default function ComposeMail({
  mailbox,
  fromName,
  replyTo,
  onClose,
  onSent,
}: {
  mailbox: string;
  fromName: string;
  replyTo?: MailMessage;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(replyTo ? replyTo.from.emailAddress.address : "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    replyTo ? (/^re:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : ""
  );
  const [content, setContent] = useState(
    replyTo
      ? `\n\n---\nOn ${new Date(replyTo.receivedDateTime).toLocaleString()}, ` +
          `${replyTo.from.emailAddress.name || replyTo.from.emailAddress.address} wrote:\n\n` +
          replyTo.body.content
              .split("\n")
              .map((l) => `> ${l}`)
              .join("\n")
      : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Whether this will actually leave the building.
   *
   * Read once when the dialog opens, and everything the user sees follows from
   * it -- the banner, the footer, and the wording on the button. The dialog
   * previously said "Demo mailbox" no matter what, which is worse than saying
   * nothing: it was wrong when the mailbox was real, and it was a footnote
   * nobody reads when the mailbox was not.
   */
  const live = mailIsLive();

  // A reply opens with the cursor above the quoted text, where you write.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, 0);
    el.scrollTop = 0;
  }, []);

  // Escape closes, as it does in every mail client.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addresses = (s: string) =>
    s
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const recipients = addresses(to);
    if (!recipients.length) return setError("Add at least one recipient.");

    const bad = recipients.find((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (bad) return setError(`"${bad}" is not a valid email address.`);

    if (!subject.trim()) return setError("Add a subject.");

    setBusy(true);
    try {
      await sendMail({
        mailbox,
        fromName,
        to: recipients,
        cc: addresses(cc),
        subject: subject.trim(),
        content,
        conversationId: replyTo?.conversationId,
      });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl rounded-t-card sm:rounded-card border border-border bg-surface-1 shadow-xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={replyTo ? "Reply" : "New message"}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">
            {replyTo ? "Reply" : "New message"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4" noValidate>
          {!live && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
              <AlertCircle size={13} className="mt-px shrink-0" />
              <span>
                <strong className="font-medium">This will not be delivered.</strong> Outlook is
                not connected on this session, so the message is only filed in the demo Sent
                folder. Sign in with Microsoft to send for real.
              </span>
            </div>
          )}

          <Row label="From">
            {/* Fixed, not a field. You send as the account you signed in with. */}
            <span className="text-[13px] text-text-secondary">{mailbox}</span>
          </Row>

          <Row label="To">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@company.com"
              className="w-full"
              autoComplete="off"
            />
          </Row>

          <Row label="Cc">
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="Optional, comma separated"
              className="w-full"
              autoComplete="off"
            />
          </Row>

          <Row label="Subject">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full"
              autoComplete="off"
            />
          </Row>

          <textarea
            ref={bodyRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder="Write your message…"
            className="w-full mt-3 resize-y leading-relaxed"
          />

          {error && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
          <p className="text-[11px] text-text-muted">
            {live
              ? `Sending as ${mailbox} — this will be delivered.`
              : "Demo mailbox — nothing leaves this machine."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {busy ? (live ? "Sending…" : "Saving…") : live ? "Send" : "Save to demo Sent"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-border">
      <span className="w-14 shrink-0 text-[12px] text-text-secondary">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
