/**
 * The in-memory mailbox, behind ./backend's mail calls.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR NOW
 *
 * Mail goes to Outlook through Graph once the session has a Microsoft token;
 * before that, ./backend answers the mail screens from here (./mockMail's
 * store). On the deployed site sending from it is refused (backend.sendMail),
 * so a mail can never "succeed" into it there; under `vite dev` it is the
 * mailbox the screens are designed against.
 *
 * It used to answer the voice desk's endpoints as well -- calls, records, and
 * the three-dimensional space board with its fit engine -- from when v2 had no
 * backend at all. Nothing called those after the voice era ended; they were
 * removed on 1 Oct 2026 and are in git history.
 * ---------------------------------------------------------------------------
 */

import {
  listFolders,
  listMessages,
  getMessage as getMailMessage,
  setRead,
  moveMessage,
  sendMessage,
  dropMessage,
  setFlag,
  saveDraft,
  type FolderId,
} from "./mockMail";

/** Simulated latency, so loading states are visible while designing them. */
const LATENCY_MS = 180;
const delay = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

export function mockGet(path: string): Promise<unknown> {
  // Scoped by mailbox on every call. Graph infers the mailbox from the OAuth
  // token; here it is an explicit parameter, so the scoping stays visible
  // rather than becoming an implicit assumption the UI could drift away from.
  if (path.startsWith("/api/mail/")) {
    const [route, query] = path.split("?");
    const q = new URLSearchParams(query ?? "");
    const mailbox = q.get("mailbox") ?? "";
    if (!mailbox) return Promise.reject(new Error("mail requests must name a mailbox"));

    if (route === "/api/mail/folders") return delay({ folders: listFolders(mailbox) });

    if (route === "/api/mail/messages") {
      const folder = (q.get("folder") ?? "inbox") as FolderId;
      const only = q.get("filter");
      return delay({
        messages: listMessages(mailbox, folder, q.get("q") ?? undefined, only === "unread" || only === "flagged" ? only : undefined),
      });
    }

    const one = route.match(/^\/api\/mail\/messages\/([^/]+)$/);
    if (one) {
      const m = getMailMessage(mailbox, one[1]);
      if (!m) return Promise.reject(new Error(`${path} -> 404`));
      return delay({ message: m });
    }
  }

  return Promise.reject(new Error(`mock backend has no GET ${path}`));
}

export function mockPost(path: string, body: unknown): Promise<unknown> {
  const b = (body ?? {}) as Record<string, any>;

  if (path === "/api/mail/send") {
    if (!b.mailbox) return Promise.reject(new Error("send must name a mailbox"));
    const to: string[] = (b.to ?? []).filter((x: string) => x.trim());
    if (!to.length) return Promise.reject(new Error("add at least one recipient"));
    if (!String(b.subject ?? "").trim()) return Promise.reject(new Error("add a subject"));
    // A draft sent from the compose window leaves Drafts, as it does in Outlook.
    if (b.draftId) dropMessage(b.mailbox, b.draftId);
    return delay({
      message: sendMessage({
        mailbox: b.mailbox,
        fromName: b.fromName ?? "",
        to,
        cc: b.cc ?? [],
        subject: b.subject,
        content: b.content ?? "",
        conversationId: b.conversationId,
      }),
    });
  }

  if (path === "/api/mail/draft") {
    return delay({ message: saveDraft({ mailbox: b.mailbox, fromName: b.fromName ?? "", draftId: b.draftId, to: b.to ?? [], cc: b.cc ?? [], subject: b.subject ?? "", content: b.content ?? "" }) });
  }

  const flagMatch = path.match(/^\/api\/mail\/messages\/([^/]+)\/flag$/);
  if (flagMatch) return delay({ message: setFlag(b.mailbox, flagMatch[1], b.flagged !== false) });

  const deleteMatch = path.match(/^\/api\/mail\/messages\/([^/]+)\/delete$/);
  if (deleteMatch) {
    moveMessage(b.mailbox, deleteMatch[1], "deleted");
    return delay({ ok: true });
  }

  const readMatch = path.match(/^\/api\/mail\/messages\/([^/]+)\/read$/);
  if (readMatch) {
    const m = setRead(b.mailbox, readMatch[1], b.isRead !== false);
    if (!m) return Promise.reject(new Error(`${path} -> 404`));
    return delay({ message: m });
  }

  const moveMatch = path.match(/^\/api\/mail\/messages\/([^/]+)\/move$/);
  if (moveMatch) {
    const m = moveMessage(b.mailbox, moveMatch[1], b.folder);
    if (!m) return Promise.reject(new Error(`${path} -> 404`));
    return delay({ message: m });
  }

  return Promise.reject(new Error(`mock backend has no POST ${path}`));
}
