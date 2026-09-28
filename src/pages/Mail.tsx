import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  Archive,
  Inbox,
  Mail as MailIcon,
  PenSquare,
  PenLine,
  RefreshCw,
  Forward,
  Reply,
  ReplyAll,
  Search,
  Send,
  FileEdit,
  AlertCircle,
  Check,
  Loader2,
  Package,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import ComposeMail from "../components/ComposeMail";
import MessageAttachments from "../components/MessageAttachments";
import SignatureEditor from "../components/SignatureEditor";
import PushMailToQueue from "../components/PushMailToQueue";
import FileToEnquiry from "../components/FileToEnquiry";
import MailBody from "../components/MailBody";
import MailListRow from "../components/MailListRow";
import MailConversation from "../components/MailConversation";
import { groupIntoThreads } from "../lib/threads";
import { useAuth } from "../lib/auth";
import { outcomeText } from "../lib/outlookConnect";
import type { ComposeMode } from "../lib/mailQuote";
import { clearOutlookNotice, connectOutlook, peekOutlookNotice } from "../services/graphMail";
import {
  getMailFolders,
  getMailMessage,
  getMailMessages,
  getMoreMailMessages,
  moveMailMessage,
  setMailRead,
  mailIsLive,
  whoami,
  GraphAuthError,
  type FolderId,
  type MailFolder,
  type MailMessage,
} from "../services/backend";
import { intakeByMessage, type Intake } from "../services/intake";
import { refsFor } from "../services/threadRefs";
import { listPeople, type Person } from "../services/enquiries";
import { ListSkeleton, SectionSkeleton } from "../components/Loading";
import { formatDate } from "../lib/dates";

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
  const { session, saveSignature } = useAuth();
  const mailbox = session?.email ?? "";

  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * The opened message, fetched in full.
   *
   * The list query does not ask for bodies — forty of them would be a slow
   * request and most are never read — so a row carries only Graph's plain-text
   * preview. The reading pane was rendering that preview and calling it the
   * message, which is why every mail arrived stripped of its formatting and cut
   * off around 255 characters. This holds the real one.
   */
  const [full, setFull] = useState<MailMessage | null>(null);
  /**
   * Why the body is not here, when it is not here.
   *
   * A failed fetch used to be swallowed, and the pane fell back to the list row
   * — whose body is Graph's 255-character preview wearing the same shape as a
   * real one. So a throttled or expired request looked exactly like a short
   * message, and the only symptom was mail that "doesn't load properly".
   */
  const [bodyError, setBodyError] = useState<string | null>(null);
  /**
   * Which open is the current one.
   *
   * Two clicks in quick succession are two requests, and they do not have to
   * come back in order. Guarding on the previous state could not tell them
   * apart — each open clears it first — so a slow first response could land
   * under the second message's header. A counter can.
   */
  const openReq = useRef(0);
  /** The reading pane, so a message opened from deep in a long thread starts at its top. */
  const reader = useRef<HTMLDivElement>(null);
  /** The part of the reading pane that scrolls on a wide screen. */
  const readerScroll = useRef<HTMLDivElement>(null);
  /** The desk, so a message can be handed straight to a colleague. */
  const [people, setPeople] = useState<Person[]>([]);
  /**
   * What the intake queue already knows about the messages on screen.
   *
   * Fetched once per folder load rather than per row, so a hundred-message
   * inbox is one request. Without it every row would offer to queue a message
   * that is already queued, and the press would silently return the same row.
   */
  const [queued, setQueued] = useState<Map<string, Pick<Intake, "id" | "status" | "enquiry_ref">>>(
    new Map()
  );
  /**
   * Graph's link to the next page, when there is one.
   *
   * Its absence is what "that is all of them" means — there is no count to
   * compare against, because the folder's total counts everything in the
   * mailbox while the list holds only what has been fetched.
   */
  const [nextLink, setNextLink] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<null | { replyTo?: MailMessage; mode?: ComposeMode }>(null);
  /**
   * The reference this conversation is already filed under, if any.
   *
   * Usually the subject still carries it and the reply inherits it for free.
   * This is for when it does not: plenty of senders rewrite a subject, and a
   * reply that goes back without the token breaks the filing for every message
   * after it. Looked up when the box opens, for the one conversation.
   */
  const [replyRef, setReplyRef] = useState<string | null>(null);
  const [editingSignature, setEditingSignature] = useState(false);
  /** Bumped after a send, so the open conversation fetches the reply just sent. */
  const [sentTick, setSentTick] = useState(0);
  /**
   * How many messages each conversation holds, once one has been opened.
   *
   * The list only knows the messages in this folder — a customer's two mails in
   * Inbox, not our three replies in Sent — so the count on a row grows to the
   * real one when the conversation is read.
   */
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const noteSize = useCallback(
    (conversationId: string, n: number) =>
      setSizes((prev) => (prev.get(conversationId) === n ? prev : new Map(prev).set(conversationId, n))),
    []
  );
  const live = mailIsLive();

  /*
    "Read at full width": the list folds away while a message is open, for a
    small laptop or a wide mail. Remembered in this browser.
  */
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem("araxys:mail-wide") === "1";
    } catch {
      return false;
    }
  });
  const toggleWide = useCallback(() => {
    setWide((w) => {
      try {
        localStorage.setItem("araxys:mail-wide", w ? "0" : "1");
      } catch {
        /* for this visit only */
      }
      return !w;
    });
  }, []);

  /**
   * Connecting Outlook (095): how the last attempt went, shown once, and the
   * button's own state while the browser is on its way to Microsoft.
   */
  const [notice, setNotice] = useState(() => peekOutlookNotice());
  useEffect(() => {
    if (notice) clearOutlookNotice();
  }, [notice]);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const connect = () => {
    setConnecting(true);
    setConnectError(null);
    setNotice(null);
    connectOutlook("/mail").catch((e: unknown) => {
      setConnectError(e instanceof Error ? e.message : "Could not start connecting Outlook.");
      setConnecting(false);
    });
  };

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

  /**
   * Opening one message by id, from a link somewhere else in the CRM.
   *
   * The partner-quotes panel links to the reply a rate was read out of, and
   * "open the mail it came from" has to land ON that mail rather than on the
   * inbox with an instruction to go and find it.
   *
   * It fetches the message directly rather than hunting the list for it: the
   * reply may be older than the fifty rows loaded, or filed in a folder that is
   * not the one showing. The id is the whole address.
   */
  const [params, setParams] = useSearchParams();
  const wanted = params.get("open");

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
      setNextLink(m.nextLink);
      // One lookup for the whole folder, so each row can say whether it has
      // already been queued instead of offering a push that does nothing.
      setQueued(await intakeByMessage(m.messages.map((x) => x.id)));
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

  // Resolve the conversation's reference when the compose box opens. Cancelled
  // on close so a slow lookup cannot land on the next message opened.
  useEffect(() => {
    const conversationId = composing?.replyTo?.conversationId;
    if (!conversationId) {
      setReplyRef(null);
      return;
    }
    let live = true;
    refsFor([conversationId])
      .then((found) => {
        if (live) setReplyRef(found.get(conversationId)?.ref ?? null);
      })
      // Best-effort: the subject usually carries the token already, and a
      // failed lookup must not stop somebody answering their mail.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [composing]);

  /**
   * Appends the next page.
   *
   * Appends rather than replaces, and de-duplicates on the way in: mail
   * arriving between two pages shifts everything down by one, which makes Graph
   * hand back a message the list already has.
   */
  async function loadMore() {
    if (!nextLink || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await getMoreMailMessages(mailbox, folder, nextLink);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...more.messages.filter((m) => !seen.has(m.id))];
      });
      setNextLink(more.nextLink);
      // The new rows need their queue status too, or they would all offer to
      // queue a message that is already filed.
      const fresh = await intakeByMessage(more.messages.map((x) => x.id));
      setQueued((prev) => new Map([...prev, ...fresh]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more mail.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Fetched once. It is four rows and it does not change while a folder is read.
  useEffect(() => {
    void listPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  // Changing folder should not leave the previous folder's message on screen,
  // nor its body waiting behind the next selection.
  useEffect(() => {
    setSelectedId(null);
    // Retire any request still in flight, so its answer cannot arrive into the
    // new folder and reopen a message from the old one.
    openReq.current++;
    setFull(null);
    setBodyError(null);
  }, [folder]);

  /**
   * The row, and the full message once it lands.
   *
   * The row arrives first and carries everything the header needs, so the pane
   * can draw immediately and fill in the body a moment later rather than
   * flashing empty.
   */
  const row = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId]
  );

  /**
   * The folder as conversations, the way Outlook lists it: one row each, drawn
   * from its newest message here, most recent first. A reply and the mail it
   * answers were two rows that nothing tied together.
   */
  const conversations = useMemo(() => groupIntoThreads(messages), [messages]);
  const selected = useMemo(
    () => (full && full.id === selectedId ? { ...row, ...full } : row),
    [row, full, selectedId]
  );

  /**
   * Fetches the real body for a message, and says so when it cannot.
   *
   * Separate from `open` because it is also what Try again calls: a body that
   * failed to arrive is worth one press to ask for again, and re-opening the
   * message to get that press would mean marking it read a second time.
   */
  const loadBody = useCallback(
    (id: string) => {
      const req = ++openReq.current;
      setFull(null);
      setBodyError(null);
      void getMailMessage(mailbox, id, folder)
        .then((r) => {
          // A response for a message nobody is looking at any more is dropped.
          if (req !== openReq.current) return;
          setFull(r.message);
        })
        .catch((e) => {
          if (req !== openReq.current) return;
          setBodyError(e instanceof Error ? e.message : "The message could not be loaded.");
        });
    },
    [mailbox, folder]
  );

  useEffect(() => {
    if (!wanted) return;
    // Consumed once. Left in the URL it would reopen on every refetch and fight
    // whatever the operator clicked since.
    setParams((p) => {
      p.delete("open");
      return p;
    }, { replace: true });

    setSelectedId(wanted);
    loadBody(wanted);
  }, [wanted, setParams, loadBody]);

  /**
   * Opens a message — from the list, the conversation's newest here — and marks
   * the conversation's unread ones in this folder read, as Outlook does when a
   * conversation is selected.
   */
  async function open(m: MailMessage, conversation: MailMessage[] = [m]) {
    setSelectedId(m.id);

    // The next message opened starts at its own top, not part-way down where
    // the last one was left: the pane's own scroll on a wide screen, the
    // page's on a phone.
    readerScroll.current?.scrollTo({ top: 0 });
    const top = reader.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) window.scrollBy({ top: top - 72 });

    // The body has to be fetched; the row does not have one.
    loadBody(m.id);

    const unread = conversation.filter((x) => !x.isRead);
    if (unread.length) {
      // Optimistic: the row should stop looking unread the instant it is clicked.
      const ids = new Set(unread.map((x) => x.id));
      setMessages((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, isRead: true } : x)));
      if (folder === "inbox") {
        setFolders((prev) =>
          prev.map((f) => (f.id === "inbox" ? { ...f, unread: Math.max(0, f.unread - unread.length) } : f))
        );
      }
      try {
        await Promise.all(unread.map((x) => setMailRead(mailbox, x.id, true)));
      } catch {
        void load();
      }
    }
  }

  /**
   * Archives the conversation's messages in this folder, not only the one open:
   * the list shows the conversation as one row, and archiving one message of
   * three left the row standing on the next one, as if nothing had happened.
   */
  async function archive(m: MailMessage) {
    const going = m.conversationId ? messages.filter((x) => x.conversationId === m.conversationId) : [];
    if (!going.some((x) => x.id === m.id)) going.push(m);
    const ids = new Set(going.map((x) => x.id));
    setMessages((prev) => prev.filter((x) => !ids.has(x.id)));
    setSelectedId(null);
    try {
      await Promise.all(going.map((x) => moveMailMessage(mailbox, x.id, "archive")));
    } finally {
      void load();
    }
  }

  if (!mailbox) return null;

  // Reading at full width only applies while a message is open; the list comes back without one.
  const wideOpen = wide && Boolean(selected);
  const roomy = wideOpen;

  return (
    /*
      On a wide screen the page is exactly the window's height and does not
      scroll: the list and the message each scroll inside their own pane, the
      way Outlook does. It used to be a normal page with the list and the Reply
      bar pinned by `sticky`, which only takes hold once the page has scrolled
      past the header — so both rode up with the page first, and it read as the
      whole screen moving. The height is the window less the top bar (56) and
      main's padding (32 below xl, 48 from it). Below `lg` it is one column and
      scrolls as a page.

      Its floor is 360px, not the 560 it was: on a 768-px laptop the browser
      shows about 650 px (525 at 125% scaling, 470 on a 720-px one), and a floor
      taller than the window made the whole page scroll and cut the message off
      at the bottom.
    */
    <div className="lg:flex lg:h-[calc(100dvh-88px)] lg:min-h-[360px] lg:flex-col xl:h-[calc(100dvh-104px)]">
      <div className="lg:shrink-0">
      <PageHeader
        dense
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
      {notice &&
        (() => {
          const said = outcomeText(notice, mailbox);
          const tone =
            said.tone === "success"
              ? "bg-bg-success text-text-success"
              : said.tone === "warning"
                ? "bg-bg-warning text-text-warning"
                : "bg-bg-danger text-text-danger";
          return (
            <div role="status" className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] ${tone}`}>
              {said.tone === "success" ? <Check size={13} className="mt-px shrink-0" /> : <AlertCircle size={13} className="mt-px shrink-0" />}
              <span className="flex-1">{said.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
                <X size={13} />
              </button>
            </div>
          );
        })()}

      {/*
        Connecting adds the login's own mailbox to the session already open —
        it does not sign in again, and a Microsoft account other than this
        login's is refused on the server (095).
      */}
      {!live && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <div className="flex-1">
            <p>
              <strong className="font-medium">Outlook is not connected.</strong> These are sample
              messages, not your mailbox, and nothing can be sent until you connect it. Sign in to
              Microsoft as {mailbox}; another account will not be accepted.
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              className="mt-2 inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60"
            >
              {connecting ? <Loader2 size={13} className="animate-spin" /> : <MicrosoftMark />}
              Connect Outlook for {mailbox}
            </button>
            {connectError && <p className="mt-2 text-text-danger">{connectError}</p>}
          </div>
        </div>
      )}

      {/*
        One row: compose, the folders, search, and the two quieter buttons.
        ------------------------------------------------------------------
        The folders ran across a card of their own under this row. As a column
        they had cost 168px of width; as a row of their own they still cost a
        row of height — and on a 768-px laptop every row above the message is a
        line of the message not shown. So they sit in the toolbar, and Refresh
        and Signature keep their words only where there is room (xl).
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setComposing({})}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
        >
          <PenSquare size={13} />
          New message
        </button>

        <nav aria-label="Folders" className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-1 p-0.5">
          {folders.map((f) => {
            const Icon = FOLDER_ICON[f.id];
            const active = f.id === folder;
            return (
              <button
                key={f.id}
                onClick={() => setFolder(f.id)}
                aria-current={active ? "page" : undefined}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors ${
                  active ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                }`}
              >
                <Icon size={13} />
                {f.label}
                {f.unread > 0 && (
                  <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-medium text-white">
                    {f.unread}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="relative min-w-[160px] flex-1 max-w-sm">
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
          title="Refresh"
          aria-label="Refresh"
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary xl:px-3"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span className="hidden xl:inline">Refresh</span>
        </button>

        <button
          onClick={() => setEditingSignature(true)}
          title="Signature"
          aria-label="Signature"
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary xl:px-3"
        >
          <PenLine size={13} />
          <span className="hidden xl:inline">Signature</span>
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      </div>

      {/* Two panes now, not three. The list keeps a readable column — a third
          of the width, between 240 and 360px, so a small laptop's message is
          not left with what a fixed 360 did not take — and the message takes
          the rest. "Wider" hides the list while a message is open. On a wide
          screen they fill what is left of the window and scroll separately. */}
      <div
        className={`grid grid-cols-1 items-start gap-3 lg:min-h-0 lg:flex-1 lg:items-stretch ${
          wideOpen ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[minmax(240px,min(360px,32%))_minmax(0,1fr)]"
        }`}
      >
        {/* ---- message list ---- */}
        <div className={`card flex flex-col overflow-hidden lg:min-h-0 ${wideOpen ? "lg:hidden" : ""}`}>
          {loading && messages.length === 0 ? (
            <ListSkeleton bare rows={7} />
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-text-muted p-4">
              {query ? "Nothing matches that search." : "Nothing in this folder."}
            </p>
          ) : (
            <ul className="divide-y divide-border max-h-[calc(100vh-260px)] min-h-[300px] overflow-y-auto overscroll-contain lg:max-h-none lg:min-h-0 lg:flex-1">
              {conversations.map((t) => {
                const newest = t.messages[t.messages.length - 1];
                return (
                  <MailListRow
                    key={t.conversationId}
                    message={newest}
                    folder={folder}
                    selected={Boolean(selected) && (t.conversationId === selected?.conversationId || t.messages.some((m) => m.id === selectedId))}
                    queued={t.messages.map((m) => queued.get(m.id)).find(Boolean)}
                    count={Math.max(t.messages.length, sizes.get(t.conversationId) ?? 0)}
                    anyUnread={t.unread}
                    onOpen={() => void open(newest, t.messages)}
                    onChanged={() => void load()}
                  />
                );
              })}
            </ul>
          )}

          {/*
            Sits under the scroller rather than inside it, so it does not have
            to be scrolled to twice — once to the bottom of the list, once to
            find the button.
          */}
          {messages.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              {nextLink ? (
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
                  {loadingMore ? "Loading…" : "Load older mail"}
                </button>
              ) : (
                <p className="py-0.5 text-center text-[11px] text-text-muted">
                  {messages.length} message{messages.length === 1 ? "" : "s"} — that is the whole
                  folder.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- reading pane ---- */}
        <div ref={reader} className="card min-h-[320px] p-5 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:p-0">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16 lg:px-5">
              <MailIcon size={22} className="text-text-muted mb-2" />
              <p className="text-[13px] text-text-muted">Select a message to read it.</p>
            </div>
          ) : (
            <article className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              {/*
                The subject and what can be done with the message, above the
                part that scrolls: replying to the end of a long thread does not
                mean scrolling back to its start first.
              */}
              {/* `contents` below lg: a sticky bar only sticks within its parent,
                  and on a phone that has to be the whole message, not this. */}
              <div className="contents lg:block lg:shrink-0 lg:border-b lg:border-border lg:px-5 lg:pb-3 lg:pt-4 short:lg:pb-2.5 short:lg:pt-3">
              <div className="flex items-start gap-2">
                {/* Two lines at most above the message on a desk; the whole subject is its title. */}
                <h2 title={selected.subject} className="min-w-0 flex-1 text-[16px] font-semibold tracking-tight text-text-primary lg:line-clamp-2 short:lg:line-clamp-1 xl:text-[17px]">
                  {selected.subject}
                </h2>
                <button
                  type="button"
                  onClick={toggleWide}
                  title={wide ? "Show the list beside the message" : "Hide the list: read the message at full width"}
                  aria-label={wide ? "Show the message list" : "Read at full width"}
                  aria-pressed={wide}
                  className="hidden shrink-0 rounded-lg border border-border p-1.5 text-text-secondary hover:border-border-strong hover:text-text-primary lg:block"
                >
                  {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>

              {/*
                On a phone the page scrolls, so the bar pins under the top bar
                instead once it reaches it.
              */}
              <div className="sticky top-14 z-10 -mx-5 mt-2.5 flex flex-wrap items-start gap-2 border-b border-transparent bg-surface-1/95 px-5 py-2 backdrop-blur supports-[backdrop-filter]:bg-surface-1/85 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:backdrop-blur-none">
                <button
                  onClick={() => setComposing({ replyTo: selected, mode: "reply" })}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
                >
                  <Reply size={13} />
                  Reply
                </button>
                {/* Their words only where there is room (xl, or reading at full width). */}
                <button
                  onClick={() => setComposing({ replyTo: selected, mode: "replyAll" })}
                  title="Reply all"
                  aria-label="Reply all"
                  className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors ${roomy ? "px-3" : "lg:px-2.5 xl:px-3"}`}
                >
                  <ReplyAll size={13} />
                  <span className={roomy ? "" : "lg:hidden xl:inline"}>Reply all</span>
                </button>
                <button
                  onClick={() => setComposing({ replyTo: selected, mode: "forward" })}
                  title="Forward"
                  aria-label="Forward"
                  className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors ${roomy ? "px-3" : "lg:px-2.5 xl:px-3"}`}
                >
                  <Forward size={13} />
                  <span className={roomy ? "" : "lg:hidden xl:inline"}>Forward</span>
                </button>

                {/*
                  Filing onto an enquiry that already exists, which is a
                  different act from the queue buttons beside it: those mint a
                  reference, and most mail after the first on a job should not.
                  An enquiry collects threads — the customer's original, the
                  agent's rate, the carrier's booking note — and each arriving
                  as its own enquiry is how one job ends up holding four
                  references with a quarter of the correspondence under each.
                */}
                <FileToEnquiry message={selected} onFiled={() => void load()} />

                {/*
                  Beside reply and archive, because it is the third thing you do
                  with a message: answer it, file it away, or decide it is work.
                */}
                <PushMailToQueue
                  message={selected}
                  queued={queued.get(selected.id)}
                  people={people}
                  meId={session?.userId}
                  onChanged={() => void load()}
                />

                {selected.folder !== "archive" && (
                  <button
                    onClick={() => void archive(selected)}
                    title="Archive the conversation"
                    aria-label="Archive the conversation"
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors ${roomy ? "px-3" : "lg:px-2.5 xl:px-3"}`}
                  >
                    <Archive size={13} />
                    <span className={roomy ? "" : "lg:hidden xl:inline"}>Archive</span>
                  </button>
                )}
              </div>
              </div>

              <div ref={readerScroll} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-5 lg:pb-5">
              {/*
                The whole conversation, Outlook's way: this message open, every
                other one in the thread — from any folder — a line that opens in
                place. A conversation of one reads exactly as a single message.
              */}
              <MailConversation
                mailbox={mailbox}
                message={selected}
                complete={Boolean(full && full.id === selectedId)}
                when={fullTime}
                refresh={sentTick}
                onSize={noteSize}
                onReply={(m, mode) => setComposing({ replyTo: m, mode })}
                opened={
                  <>
                    <ShipmentLinks text={`${selected.subject} ${selected.body.content}`} />

                    <div className="mt-4 pt-4 border-t border-border">
                      {/*
                        The body is only ever drawn from the fetched message. The list
                        row carries a 255-character preview in the same shape, and
                        rendering that on a failure is what made a broken request look
                        like a short mail.
                      */}
                      {full && full.id === selectedId ? (
                        <MailBody message={selected} />
                      ) : bodyError ? (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
                          <span className="inline-flex items-start gap-2">
                            <AlertCircle size={13} className="mt-px shrink-0" />
                            {bodyError}
                          </span>
                          <button
                            onClick={() => loadBody(selected.id)}
                            className="h-7 px-2.5 rounded-lg border border-current/30 text-[12px] hover:bg-white/40 transition-colors"
                          >
                            Try again
                          </button>
                        </div>
                      ) : (
                        <SectionSkeleton lines={5} label="Loading the message" className="py-2" />
                      )}
                    </div>

                    {/*
                      No enquiryRef: this screen is the mailbox, not a case. A message
                      here may belong to no enquiry, or to one nobody has decided on
                      yet — saving an attachment would have to guess which, and a
                      customer's packing list filed onto the wrong job is worse than
                      one not filed at all. File the thread first, then save from the
                      case file.
                    */}
                    <MessageAttachments message={selected} />
                  </>
                }
              />
              </div>
            </article>
          )}
        </div>
      </div>

      {editingSignature && (
        <SignatureEditor
          initial={session?.signature ?? ""}
          onSave={saveSignature}
          onClose={() => setEditingSignature(false)}
        />
      )}

      {composing && (
        <ComposeMail
          mailbox={mailbox}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          replyTo={composing.replyTo}
          mode={composing.mode}
          reference={replyRef}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            setSentTick((t) => t + 1);
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
        <EnquiryLink
          key={ref}
          to={`/enquiries/${ref}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-accent px-2.5 py-1 text-[12px] font-mono text-text-accent hover:underline"
        >
          <Package size={11} />
          {ref}
        </EnquiryLink>
      ))}
    </div>
  );
}

function fullTime(isoDate: string) {
  return formatDate(isoDate, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
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
