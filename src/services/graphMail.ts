import { supabase } from "../lib/supabase";
import type { FolderId, MailMessage, Recipient } from "./mockMail";

/**
 * Declared here rather than imported from backend.ts, which imports this file —
 * taking it from there would close an import cycle for a four-field type.
 */
export interface MailFolder {
  id: FolderId;
  label: string;
  total: number;
  unread: number;
}

/**
 * Outlook, for real, through Microsoft Graph.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER CALLS GRAPH DIRECTLY
 *
 * Graph supports CORS and is designed to be called from single-page apps, so a
 * delegated access token in the browser is the intended pattern -- not a
 * shortcut around a missing server. v2 therefore still needs no backend.
 *
 * The token is DELEGATED, which is the whole safety argument: it acts as the
 * signed-in person and can only ever reach their own mailbox. info@ cannot read
 * aarathy@ no matter what this code asks for, because the token does not carry
 * that authority. Application permissions would have granted every mailbox in
 * the tenant at once, which is why step 5 of the setup used Delegated.
 *
 * TOKEN LIFETIME. Supabase hands back Microsoft's access token as
 * `provider_token` when the OAuth round trip completes, and it lives about an
 * hour. Supabase does not refresh it -- it refreshes its own JWT, not
 * Microsoft's -- so the token is stashed at sign-in and, when Graph answers 401,
 * the mailbox reports that it needs reconnecting rather than silently showing
 * nothing. Signing in again is the fix, and is one click.
 * ---------------------------------------------------------------------------
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * Where the Microsoft token is kept.
 *
 * sessionStorage, alongside the Supabase session and for the same reason: desk
 * machines are shared, and a mailbox token must not outlive the browser tab.
 */
const TOKEN_KEY = "araxys.graphToken";

export function storeGraphToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearGraphToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function hasGraphToken(): boolean {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

/** Thrown when Microsoft rejects the token, so the UI can offer a reconnect. */
export class GraphAuthError extends Error {
  constructor(message = "Your Outlook connection has expired. Sign in again to reconnect.") {
    super(message);
    this.name = "GraphAuthError";
  }
}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw new GraphAuthError("Outlook is not connected on this session.");

  const r = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  // 401 is an expired or revoked token; 403 is a permission the app was never
  // granted. Both mean "reconnect", and neither is worth a stack trace at the user.
  if (r.status === 401 || r.status === 403) {
    clearGraphToken();
    throw new GraphAuthError();
  }

  if (!r.ok) {
    const detail = await r.text();
    let message = `Outlook returned ${r.status}`;
    try {
      message = JSON.parse(detail)?.error?.message ?? message;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(message);
  }

  // sendMail and the update endpoints answer 202/204 with no body.
  return (r.status === 204 || r.status === 202 ? null : await r.json()) as T;
}

/**
 * Graph's well-known folder names, mapped to the four this UI shows.
 *
 * Using the well-known names rather than folder ids matters: ids differ per
 * mailbox, so hardcoding one person's Inbox id would break for everyone else.
 */
const WELL_KNOWN: Record<FolderId, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
};

const FOLDER_LABEL: Record<FolderId, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
};

interface GraphFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
}

interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string | null;
  from?: { emailAddress: { name?: string; address?: string } };
  sender?: { emailAddress: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress: { name?: string; address?: string } }>;
  receivedDateTime: string;
  bodyPreview: string | null;
  body?: { contentType: string; content: string };
  isRead: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  importance: string;
}

const recipient = (r?: { emailAddress: { name?: string; address?: string } }): Recipient => ({
  emailAddress: { name: r?.emailAddress?.name ?? "", address: r?.emailAddress?.address ?? "" },
});

/**
 * Graph's message, in the shape the UI already reads.
 *
 * The field names line up almost exactly -- which was the point of shaping the
 * mock on Graph in the first place -- so this is a thin adapter rather than a
 * translation layer. `mailbox` and `folder` are the only additions, because
 * Graph infers both from the token and the URL while the UI wants them stated.
 */
function adapt(m: GraphMessage, mailbox: string, folder: FolderId): MailMessage {
  const html = m.body?.contentType?.toLowerCase() === "html";
  return {
    id: m.id,
    conversationId: m.conversationId,
    mailbox,
    folder,
    subject: m.subject || "(no subject)",
    from: recipient(m.from ?? m.sender),
    toRecipients: (m.toRecipients ?? []).map(recipient),
    ccRecipients: (m.ccRecipients ?? []).map(recipient),
    receivedDateTime: m.receivedDateTime,
    bodyPreview: m.bodyPreview ?? "",
    body: {
      contentType: html ? "html" : "text",
      content: m.body?.content ?? m.bodyPreview ?? "",
    },
    isRead: m.isRead,
    isDraft: m.isDraft,
    hasAttachments: m.hasAttachments,
    attachments: [],
    importance: (m.importance as MailMessage["importance"]) ?? "normal",
  };
}

export async function listFolders(mailbox: string): Promise<MailFolder[]> {
  const data = await graph<{ value: GraphFolder[] }>(
    "/me/mailFolders?$top=60&$select=id,displayName,totalItemCount,unreadItemCount"
  );

  // Match Graph's folders to ours by display name, so a mailbox in another
  // language or with renamed folders degrades to zeroes rather than throwing.
  const byName = new Map(data.value.map((f) => [f.displayName.toLowerCase(), f]));
  const lookup: Record<FolderId, string[]> = {
    inbox: ["inbox"],
    sent: ["sent items", "sent"],
    drafts: ["drafts"],
    archive: ["archive"],
  };

  return (Object.keys(WELL_KNOWN) as FolderId[]).map((id) => {
    const hit = lookup[id].map((n) => byName.get(n)).find(Boolean);
    return {
      id,
      label: FOLDER_LABEL[id],
      total: hit?.totalItemCount ?? 0,
      unread: id === "inbox" ? hit?.unreadItemCount ?? 0 : 0,
    };
  });
}

export async function listMessages(
  mailbox: string,
  folder: FolderId,
  q?: string
): Promise<MailMessage[]> {
  const select =
    "id,conversationId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,isDraft,hasAttachments,importance";

  // $search and $orderby cannot be combined in Graph; search results come back
  // by relevance, which is the right order for a search anyway.
  const path = q?.trim()
    ? `/me/mailFolders/${WELL_KNOWN[folder]}/messages?$top=40&$select=${select}&$search=${encodeURIComponent(`"${q.trim()}"`)}`
    : `/me/mailFolders/${WELL_KNOWN[folder]}/messages?$top=40&$select=${select}&$orderby=receivedDateTime desc`;

  const data = await graph<{ value: GraphMessage[] }>(path, {
    // ConsistencyLevel is required for $search on messages.
    headers: q?.trim() ? { ConsistencyLevel: "eventual" } : {},
  });
  return data.value.map((m) => adapt(m, mailbox, folder));
}

export async function getMessage(
  mailbox: string,
  id: string,
  folder: FolderId
): Promise<MailMessage> {
  const m = await graph<GraphMessage>(`/me/messages/${encodeURIComponent(id)}`);
  const full = adapt(m, mailbox, folder);

  if (m.hasAttachments) {
    const at = await graph<{ value: Array<{ name: string; size: number; contentType: string }> }>(
      `/me/messages/${encodeURIComponent(id)}/attachments?$select=name,size,contentType`
    );
    full.attachments = at.value.map((a) => ({
      name: a.name,
      size: a.size,
      contentType: a.contentType,
    }));
  }
  return full;
}

export async function setRead(_mailbox: string, id: string, isRead: boolean): Promise<void> {
  await graph(`/me/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

export async function moveMessage(
  _mailbox: string,
  id: string,
  folder: FolderId
): Promise<void> {
  await graph(`/me/messages/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: WELL_KNOWN[folder] }),
  });
}

export async function sendMessage(input: {
  to: string[];
  cc?: string[];
  subject: string;
  content: string;
  /** Set when replying, so Outlook threads it against the original. */
  replyToId?: string;
}): Promise<void> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

  /**
   * A reply goes through /reply so Outlook keeps the conversation intact and
   * sets the In-Reply-To headers itself. Sending a fresh message with "Re:" in
   * the subject would look right in our list and break threading in the
   * recipient's client, which is the one that matters.
   */
  if (input.replyToId) {
    await graph(`/me/messages/${encodeURIComponent(input.replyToId)}/reply`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          toRecipients: recipients(input.to),
          ccRecipients: recipients(input.cc ?? []),
        },
        comment: input.content,
      }),
    });
    return;
  }

  await graph("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: input.subject,
        // HTML rather than plain text, to match what Outlook itself sends.
        // A bare text/plain message from a domain with no sending history is
        // among the easiest things for a strict receiver to reject, and the
        // same message composed in Outlook Web -- same sender, same recipient --
        // was being delivered where this one was not.
        body: { contentType: "HTML", content: input.content },
        toRecipients: recipients(input.to),
        // Omitted entirely when empty. An explicit empty array is legal but
        // there is no reason to send a header nobody asked for.
        ...(input.cc?.length ? { ccRecipients: recipients(input.cc) } : {}),
      },
      saveToSentItems: true,
    }),
  });
}

/** The address Microsoft says this token belongs to — used to label the mailbox. */
export async function whoami(): Promise<string | null> {
  try {
    const me = await graph<{ mail?: string; userPrincipalName?: string }>(
      "/me?$select=mail,userPrincipalName"
    );
    return me.mail ?? me.userPrincipalName ?? null;
  } catch {
    return null;
  }
}

/** Captures the Microsoft token Supabase returns after the OAuth round trip. */
export async function captureGraphTokenFromSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = (data.session as { provider_token?: string } | null)?.provider_token;
  if (token) storeGraphToken(token);
}
