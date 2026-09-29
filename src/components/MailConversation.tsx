import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Forward, Paperclip, Reply, ReplyAll } from "lucide-react";
import MailBody from "./MailBody";
import MessageAttachments from "./MessageAttachments";
import MessageHeader from "./MessageHeader";
import ForwardTag from "./ForwardTag";
import { shortTime } from "./MailListRow";
import { SectionSkeleton } from "./Loading";
import Highlighted from "./Highlighted";
import { initialsFor } from "../lib/initials";
import type { ComposeMode } from "../lib/mailQuote";
import { conversationMessages, getMailMessage, setMailRead, type MailMessage } from "../services/backend";

/**
 * The opened message and the rest of its conversation, the way Outlook shows one.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG
 *
 * The Mail page showed one message at a time. A customer's enquiry, our reply,
 * their answer and our quotation were four unrelated rows in two folders, and
 * nothing on screen said they were one exchange — so it looked as though the
 * CRM did not keep threads at all, although Outlook had them all along.
 *
 * WHAT IT DOES NOW
 *
 * The whole conversation, from every folder (Inbox, Sent, Archive), newest
 * first as Outlook has it. The message opened from the list is expanded; every
 * other one is a single line — who, the first words, when — that expands in
 * place to the full message with its own Reply, Reply all and Forward. Deleted,
 * junk and draft messages are left out, as Outlook leaves them out.
 *
 * A conversation of one is drawn exactly as a single message always was.
 * ---------------------------------------------------------------------------
 */
export default function MailConversation({
  mailbox,
  message,
  complete,
  when,
  opened,
  onReply,
  refresh,
  onSize,
  highlight,
}: {
  mailbox: string;
  /** The message opened from the list, with its body once it has landed. */
  message: MailMessage;
  /** Whether that body has landed. */
  complete: boolean;
  /** The full date and time, as the page writes it. */
  when: (iso: string) => string;
  /** The opened message's links, body and attachments, as the page draws them. */
  opened: ReactNode;
  onReply: (m: MailMessage, mode: ComposeMode) => void;
  /** Bumped after a send, so the reply just sent joins the thread. */
  refresh: number;
  /** How many messages the conversation holds, for the list's count. */
  onSize?: (conversationId: string, size: number) => void;
  /** Words searched for, marked in every message of the conversation. */
  highlight?: string[];
}) {
  const conversationId = message.conversationId;
  const [thread, setThread] = useState<MailMessage[] | null>(null);
  const [threadError, setThreadError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([message.id]));
  /** Bodies of the other messages, fetched when each is expanded. */
  const [bodies, setBodies] = useState<Map<string, { full?: MailMessage; error?: string }>>(new Map());
  const reportSize = useRef(onSize);
  reportSize.current = onSize;

  // A different conversation starts clean; a different message in the same one
  // keeps the bodies already fetched but opens on the one just chosen.
  useEffect(() => {
    setThread(null);
    setThreadError(false);
    setBodies(new Map());
  }, [conversationId]);
  useEffect(() => {
    setExpanded(new Set([message.id]));
  }, [message.id]);

  const fetchThread = useCallback(() => {
    if (!conversationId) {
      setThread([]);
      return () => {};
    }
    let live = true;
    setThreadError(false);
    conversationMessages(mailbox, conversationId)
      .then((list) => {
        if (!live) return;
        setThread(list);
        reportSize.current?.(conversationId, list.filter((m) => !m.isDraft).length);
      })
      .catch(() => {
        if (live) setThreadError(true);
      });
    return () => {
      live = false;
    };
  }, [mailbox, conversationId]);

  useEffect(() => {
    const cancel = fetchThread();
    // After a send, once more a few seconds later: Outlook files the sent copy
    // a moment after it accepts the message, and the first ask can miss it.
    const again = refresh ? window.setTimeout(fetchThread, 4000) : undefined;
    return () => {
      cancel();
      if (again) window.clearTimeout(again);
    };
  }, [fetchThread, refresh]);

  /** Newest first. The opened message is the page's copy, which carries its body. */
  const list = useMemo(() => {
    const byId = new Map<string, MailMessage>();
    for (const m of thread ?? []) if (!m.isDraft) byId.set(m.id, m);
    byId.set(message.id, { ...byId.get(message.id), ...message });
    return [...byId.values()].sort((a, b) => at(b) - at(a));
  }, [thread, message]);

  const loadBody = useCallback(
    (m: MailMessage) => {
      setBodies((prev) => new Map(prev).set(m.id, {}));
      getMailMessage(mailbox, m.id, m.folder)
        .then((r) => setBodies((prev) => new Map(prev).set(m.id, { full: { ...m, ...r.message } })))
        .catch((e) =>
          setBodies((prev) =>
            new Map(prev).set(m.id, { error: e instanceof Error ? e.message : "The message could not be loaded." })
          )
        );
    },
    [mailbox]
  );

  const toggle = (m: MailMessage) => {
    const opening = !expanded.has(m.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (opening) next.add(m.id);
      else next.delete(m.id);
      return next;
    });
    if (!opening || m.id === message.id) return;
    if (!bodies.get(m.id)?.full) loadBody(m);
    if (!m.isRead) {
      setThread((prev) => prev?.map((x) => (x.id === m.id ? { ...x, isRead: true } : x)) ?? prev);
      void setMailRead(mailbox, m.id, true).catch(() => {});
    }
  };

  // One message: as a single message has always been drawn.
  if (list.length <= 1) {
    return (
      <>
        <MessageHeader message={message} complete={complete} when={when(message.receivedDateTime)} />
        {opened}
        {threadError && <ThreadError onRetry={fetchThread} />}
      </>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-[11.5px] text-text-muted">
        {list.length} messages in this conversation · newest first
      </p>

      {list.map((m) => {
        const mine = m.from.emailAddress.address?.toLowerCase() === mailbox.toLowerCase();
        if (!expanded.has(m.id)) {
          return <Collapsed key={m.id} message={m} mine={mine} highlight={highlight} onOpen={() => toggle(m)} />;
        }

        const isOpened = m.id === message.id;
        const got = bodies.get(m.id);
        // What Reply answers: the fetched message, so the quote carries its body.
        const full = isOpened ? message : got?.full;
        return (
          <section key={m.id} className="rounded-xl border border-border bg-surface-1 px-3.5 pb-4 pt-3">
            <ExpandedHead
              message={full ?? m}
              mine={mine}
              when={when(m.receivedDateTime)}
              onCollapse={() => toggle(m)}
              onReply={full ? (mode) => onReply(full, mode) : undefined}
            />

            {isOpened ? (
              <>
                {complete && <ForwardTag message={message} />}
                {opened}
              </>
            ) : full ? (
              <>
                <ForwardTag message={full} />
                <div className="mt-3 border-t border-border pt-3">
                  <MailBody message={full} highlight={highlight} />
                </div>
                <MessageAttachments message={full} />
              </>
            ) : got?.error ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
                <span className="inline-flex items-start gap-2">
                  <AlertCircle size={13} className="mt-px shrink-0" />
                  {got.error}
                </span>
                <button
                  onClick={() => loadBody(m)}
                  className="h-7 rounded-lg border border-current/30 px-2.5 text-[12px] transition-colors hover:bg-white/40"
                >
                  Try again
                </button>
              </div>
            ) : (
              <SectionSkeleton lines={3} label="Loading the message" className="pt-3" />
            )}
          </section>
        );
      })}

      {threadError && <ThreadError onRetry={fetchThread} />}
    </div>
  );
}

const at = (m: MailMessage) => Date.parse(m.receivedDateTime) || 0;

function Avatar({ message, mine, size }: { message: MailMessage; mine: boolean; size: "sm" | "md" }) {
  const who = message.from.emailAddress;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-lg border font-semibold tracking-wide ${
        size === "md" ? "size-9 text-[12px]" : "size-8 text-[11px]"
      } ${mine ? "border-brand/25 bg-bg-success text-text-success" : "border-border bg-surface-2 text-text-secondary"}`}
    >
      {initialsFor(who.name, who.address)}
    </span>
  );
}

/** Marks what went out from this mailbox, which is half of any conversation. */
function SentTag() {
  return (
    <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-text-secondary">
      Sent
    </span>
  );
}

/** One line per message: who, the first words, when. The whole line opens it. */
function Collapsed({
  message,
  mine,
  highlight,
  onOpen,
}: {
  message: MailMessage;
  mine: boolean;
  highlight?: string[];
  onOpen: () => void;
}) {
  const who = message.from.emailAddress;
  const preview = message.bodyPreview?.replace(/\s+/g, " ").trim();
  const unread = !message.isRead && !mine;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-1 px-3.5 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
    >
      <Avatar message={message} mine={mine} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`min-w-0 truncate text-[13px] text-text-primary ${unread ? "font-semibold" : "font-medium"}`}
          >
            {who.name?.trim() || who.address || "Unknown sender"}
          </span>
          {mine && <SentTag />}
          {message.hasAttachments && <Paperclip size={11} className="shrink-0 text-text-muted" />}
          {unread && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
        </span>
        <span className={`mt-0.5 block truncate text-[12px] ${preview ? "text-text-secondary" : "italic text-text-muted"}`}>
          {preview ? <Highlighted text={preview} terms={highlight} /> : "(No message text)"}
        </span>
      </span>
      <span className="shrink-0 self-start pt-0.5 text-[11px] tabular-nums text-text-muted">
        {shortTime(message.receivedDateTime)}
      </span>
    </button>
  );
}

function Addresses({ label, list }: { label: string; list: MailMessage["toRecipients"] }) {
  const text = list.map((r) => r.emailAddress.address).filter(Boolean).join(", ");
  if (!text) return null;
  return (
    <span className="mt-0.5 block break-words text-[12px] leading-5 text-text-secondary">
      <span className="text-text-muted">{label} </span>
      {text}
    </span>
  );
}

/**
 * An expanded message's header: the same line as when it is folded, with who it
 * went to under the name and its own Reply, Reply all and Forward on the right.
 * Pressing the name folds it again.
 */
function ExpandedHead({
  message,
  mine,
  when,
  onCollapse,
  onReply,
}: {
  message: MailMessage;
  mine: boolean;
  when: string;
  onCollapse: () => void;
  /** Absent until the body has landed: a reply quotes it. */
  onReply?: (mode: ComposeMode) => void;
}) {
  const who = message.from.emailAddress;
  const name = who.name?.trim();
  const icon =
    "grid size-7 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-40";
  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={onCollapse}
        aria-expanded
        title="Fold this message"
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <Avatar message={message} mine={mine} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 break-words text-[13.5px] font-medium text-text-primary">
              {name || who.address || "Unknown sender"}
            </span>
            {name && who.address && <span className="min-w-0 break-all text-[12px] text-text-muted">{who.address}</span>}
            {mine && <SentTag />}
          </span>
          <Addresses label="To" list={message.toRecipients} />
          <Addresses label="Cc" list={message.ccRecipients} />
        </span>
      </button>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1">
          <button
            type="button"
            className={icon}
            disabled={!onReply}
            onClick={() => onReply?.("reply")}
            title="Reply"
            aria-label={`Reply to ${name || who.address || "this message"}`}
          >
            <Reply size={13} />
          </button>
          <button
            type="button"
            className={icon}
            disabled={!onReply}
            onClick={() => onReply?.("replyAll")}
            title="Reply all"
            aria-label="Reply all"
          >
            <ReplyAll size={13} />
          </button>
          <button
            type="button"
            className={icon}
            disabled={!onReply}
            onClick={() => onReply?.("forward")}
            title="Forward"
            aria-label="Forward"
          >
            <Forward size={13} />
          </button>
        </span>
        <span className="text-[11px] tabular-nums text-text-muted">{when}</span>
      </span>
    </div>
  );
}

function ThreadError({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
      <AlertCircle size={13} className="shrink-0" />
      The rest of this conversation could not be loaded.
      <button onClick={onRetry} className="underline underline-offset-2 hover:text-text-primary">
        Try again
      </button>
    </p>
  );
}
