/**
 * The mail and demo-data client: the in-memory mock (./mockBackend), or Outlook
 * through Graph once it is connected.
 *
 * It was once the client for an Express backend (server/, inherited from v1, with
 * the voice desk's SnapServe calls). Nothing live used it and it was removed on
 * 26 Sep 2026; VITE_MOCK_BACKEND=off now points at whatever VITE_API_BASE names.
 *
 * ---------------------------------------------------------------------------
 * V2 WORKSPACE: THIS TALKS TO NOTHING BY DEFAULT.
 *
 * This clone exists so the CRM can be redesigned without touching the running
 * one. The production copy shares a Supabase project and a SnapServe account
 * with the live voice agents, so a booking made here, a container restowed
 * here, or a record promoted here would change what a real caller is told.
 *
 * So the default is the in-memory mock in ./mockBackend, and reaching the real
 * backend takes a deliberate act: set VITE_MOCK_BACKEND=off *and* point
 * VITE_API_BASE somewhere. Defaulting the other way -- real unless told
 * otherwise -- would mean one missing env file silently writes to production,
 * which is exactly the accident this workspace is meant to make impossible.
 * ---------------------------------------------------------------------------
 */
import { mockGet, mockPost } from "./mockBackend";

const USE_MOCK = import.meta.env.VITE_MOCK_BACKEND !== "off";
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

if (USE_MOCK && typeof console !== "undefined") {
  console.info(
    "[araxys v2] in-memory backend — no requests leave this machine. " +
      "Set VITE_MOCK_BACKEND=off to use a real API."
  );
}

async function get<T>(path: string): Promise<T> {
  if (USE_MOCK) return mockGet(path) as Promise<T>;
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (USE_MOCK) return mockPost(path, body) as Promise<T>;
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `${path} -> ${r.status}`);
  }
  return r.json() as Promise<T>;
}

// ---- live calls ----------------------------------------------------------

export interface LiveCall {
  id: number;
  agentName: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  direction?: string;
  startedAt: string;
  durationSeconds: number | null;
}

export interface RecentCall {
  id: number;
  agentName: string;
  fromNumber: string;
  status: string;
  durationSeconds: number | null;
  createdAt: string;
}

export interface CallDetail {
  id: number;
  agentName: string;
  status: string;
  fromNumber: string;
  toNumber: string;
  direction?: string;
  durationSeconds: number | null;
  createdAt: string;
  endedAt: string | null;
  transcriptAvailable: boolean;
  inProgress: boolean;
  transcript: string | null;
  callSummary: string | null;
  dispositionResult: unknown;
}

export const getLiveCalls = () =>
  get<{ live: LiveCall[]; recent: RecentCall[]; checkedAt: string }>("/api/calls/live");

export const getCallDetail = (id: number) => get<CallDetail>(`/api/calls/${id}`);

// ---- space ---------------------------------------------------------------

export interface SlotRemaining {
  lengthM: number;
  payloadKg: number;
  cbm: number;
}

export interface SpaceSlot {
  id: string;
  route: string;
  carrier: string;
  sailingDate: string;
  cutoffDate: string;
  containerCode: string;
  mode: "LCL" | "FCL";
  usedLengthM: number;
  usedWeightKg: number;
  consignmentCount: number;
  status: "open" | "closing_soon" | "full";
  internal: { lengthM: number; widthM: number; heightM: number; maxPayloadKg: number } | null;
  remaining: SlotRemaining | null;
}

/** One customer's cargo, sized and positioned inside a specific container. */
export interface PlacedConsignment {
  id: string;
  slotId: string;
  clientName: string;
  reference: string;
  xM: number;
  lengthM: number;
  piecesAcross: number;
  piecesHigh: number;
  rows: number;
  quantity: number;
  pieceLengthM: number;
  pieceWidthM: number;
  pieceHeightM: number;
  weightKg: number;
  colorIndex: number;
  source: "seed" | "crm" | "voice_agent";
}

export interface SlotPlan {
  slot: SpaceSlot;
  container: { code: string; lengthM: number; widthM: number; heightM: number; maxPayloadKg: number };
  consignments: PlacedConsignment[];
  used: { lengthM: number; weightKg: number };
  /** Where the loaded section ends. New cargo is placed here, not at `used.lengthM`. */
  frontier: number;
  /** Floor stranded in gaps between blocks — recoverable by restowing, not bookable. */
  trappedM: number;
  remaining: SlotRemaining;
}

export interface CheckSpaceRequest {
  route: string;
  sailing_date?: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  quantity: number;
  weight_kg_each: number;
  stackable?: boolean;
  upright_only?: boolean;
}

export interface CheckSpaceResponse {
  available: boolean;
  route?: string;
  slot_id?: string;
  sailing_date?: string;
  cutoff_date?: string;
  carrier?: string;
  container?: string;
  mode?: string;
  spoken_answer: string;
  loading_plan?: {
    across: number;
    high: number;
    per_row: number;
    rows: number;
    floor_length_needed_m: number;
    total_weight_kg: number;
  };
  space_left_after?: { lengthM: number; payloadKg: number };
  alternatives?: Array<{ slot_id: string; sailing_date: string; cutoff_date: string; container: string }>;
  considered?: Array<{
    slot_id: string;
    sailing_date: string;
    container: string;
    reason?: string;
    max_pieces_that_fit: number;
  }>;
}

/** A real customer captured from an actual call — distinct from seeded demo shipments. */
import type { RequestDetails, SourceLanguage } from "../data/requestFields";

/**
 * enquiry -> someone rang; processing -> the desk committed to a booking; processed -> delivered.
 * The move out of enquiry is a human decision, never inferred from a transcript.
 */
export type RecordStage = "enquiry" | "processing" | "processed";

export interface RealRecord {
  ref: string;
  phone: string;
  customerName?: string;
  company?: string;
  blNumber?: string;
  stage: RecordStage;
  processingStartedAt?: string;
  status: string;
  origin?: string;
  destination?: string;
  cargoDescription?: string;
  volumeCbm?: number;
  containerType?: string;
  quotedAmountInr?: number;
  agreedAmountInr?: number;
  sailingDate?: string;
  notes?: string;
  /** Keyed by the field catalogue in src/data/requestFields.ts — see RequestDetailsGrid. */
  requestDetails?: RequestDetails;
  sourceLanguage?: SourceLanguage;
  createdAt: string;
  updatedAt: string;
}

export const getRealRecords = () => get<{ records: RealRecord[] }>("/api/records");

/** Rejected with a 409 if the move needs a sailing date and none is on file. */
export const setRecordStage = (ref: string, stage: RecordStage, sailingDate?: string) =>
  post<{ record: RealRecord }>(`/api/records/${encodeURIComponent(ref)}/stage`, {
    stage,
    ...(sailingDate ? { sailing_date: sailingDate } : {}),
  });

/** A stored call: what was said, plus the summary we generate from it. */
export interface CallLog {
  call_id: string;
  agent_name: string | null;
  direction: string | null;
  from_number: string | null;
  to_number: string | null;
  status: string | null;
  duration_secs: number | null;
  transcript: string | null;
  summary: string | null;
  extracted: Record<string, unknown> | null;
  started_at: string | null;
}

export const getCallLogs = (phone?: string) =>
  get<{ logs: CallLog[] }>(`/api/calls/logs${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`);

export const getSpaceSlots = () => get<{ slots: SpaceSlot[] }>("/api/space/slots");

export const getSlotPlan = (slotId: string) => get<SlotPlan>(`/api/space/slots/${slotId}/plan`);

export const checkSpace = (req: CheckSpaceRequest) =>
  post<CheckSpaceResponse>("/api/tools/check-space", req);

/**
 * Persists a rearranged stow. The server re-validates the whole arrangement and rejects
 * it as a unit, so a 409 here means the plan on screen is not loadable, not that one
 * consignment failed to save.
 */
export const restowSlot = (slotId: string, placements: Array<{ id: string; xM: number }>) =>
  post<{ slot: SpaceSlot; moved: number }>(`/api/space/slots/${slotId}/restow`, { placements });

export const bookSpace = (body: {
  slot_id: string;
  client_name: string;
  reference: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  quantity: number;
  weight_kg_each: number;
  stackable?: boolean;
  upright_only?: boolean;
  source?: "crm" | "voice_agent";
}) => post<{ placement: PlacedConsignment; slot: SpaceSlot }>("/api/space/book", body);

// ---- mail ----------------------------------------------------------------

/**
 * Outlook, through the CRM.
 *
 * Every call names the mailbox explicitly. Against real Microsoft Graph the
 * mailbox is implied by the signed-in user's token and these become
 * /me/mailFolders and /me/messages -- but keeping it an argument means the
 * scoping is something the code states rather than something it assumes, and
 * a shared desk address is never one bug away from showing someone else's mail.
 */
export type { MailMessage, Recipient, FolderId } from "./mockMail";
import type { MailMessage, FolderId } from "./mockMail";
import { allMessages } from "./mockMail";
import { hasHit, plainText, searchTerms, snippetAround } from "../lib/searchHighlight";

export interface MailFolder {
  id: FolderId;
  label: string;
  total: number;
  unread: number;
}

import * as graph from "./graphMail";
import { syncSentSoon } from "./mailLog";

export { GraphAuthError, hasGraphToken, clearGraphToken, whoami } from "./graphMail";

/**
 * Real Outlook when this session has a Microsoft token, the in-memory mailbox
 * otherwise.
 *
 * The fallback is not a convenience -- it is what keeps the mail screens usable
 * for design work, and what the app shows before anyone has connected Outlook.
 * `hasGraphToken()` is checked per call rather than once at module load because
 * the token arrives after sign-in, not before this file is imported.
 */
const live = () => graph.hasGraphToken();

export const getMailFolders = async (mailbox: string) =>
  live()
    ? { folders: await graph.listFolders(mailbox) }
    : get<{ folders: MailFolder[] }>(`/api/mail/folders?mailbox=${encodeURIComponent(mailbox)}`);

export const getMailMessages = async (
  mailbox: string,
  folder: FolderId,
  q?: string,
  filter?: "unread" | "flagged"
): Promise<{ messages: MailMessage[]; nextLink?: string }> =>
  live()
    ? graph.listMessages(mailbox, folder, q, filter)
    : get<{ messages: MailMessage[] }>(
        `/api/mail/messages?mailbox=${encodeURIComponent(mailbox)}&folder=${folder}` +
          (q ? `&q=${encodeURIComponent(q)}` : "") +
          (filter ? `&filter=${filter}` : "")
      );

/** Flag for follow-up, or take the flag off. */
export const setMailFlag = async (mailbox: string, id: string, flagged: boolean) => {
  if (live()) return graph.setFlag(id, flagged);
  return post(`/api/mail/messages/${encodeURIComponent(id)}/flag`, { mailbox, flagged });
};

/** To Deleted Items (recoverable there). */
export const deleteMailMessage = async (mailbox: string, id: string) => {
  if (live()) return graph.deleteMessage(id);
  return post(`/api/mail/messages/${encodeURIComponent(id)}/delete`, { mailbox });
};

/**
 * The next page of a folder. Only the live mailbox pages — the in-memory one
 * hands back everything it has in one go, so it never produces a link.
 */
export const getMoreMailMessages = async (
  mailbox: string,
  folder: FolderId,
  nextLink: string
): Promise<{ messages: MailMessage[]; nextLink?: string }> =>
  graph.listMore(mailbox, folder, nextLink);

/**
 * Mail search, Outlook's way: every folder (`folder` null) or one, each result
 * with the line around its first match and the folder it is in. Without Outlook,
 * the local store's own (running the app locally only).
 */
export const searchMessages = async (
  mailbox: string,
  query: string,
  folder: FolderId | null
): Promise<{ messages: MailMessage[]; nextLink?: string }> => {
  if (live()) return graph.searchMessages(mailbox, query, folder);
  const terms = searchTerms(query);
  const label: Record<FolderId, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive" };
  const messages = allMessages()
    .filter((m) => m.mailbox === mailbox && (!folder || m.folder === folder))
    .map((m) => ({ m, text: plainText(m.body.content, m.body.contentType === "html") }))
    // Every word must appear, in any order, as Outlook reads a search.
    .filter(({ m, text }) =>
      query
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => hasHit(`${m.subject} ${m.from.emailAddress.name} ${m.from.emailAddress.address} ${text}`, searchTerms(w)))
    )
    .map(({ m, text }) => ({ ...m, searchSnippet: snippetAround(text, terms), folderLabel: label[m.folder] }))
    .sort((a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime));
  return { messages };
};

/** The next page of a search. Only the live mailbox pages. */
export const searchMoreMessages = async (mailbox: string, query: string, folder: FolderId | null, nextLink: string) =>
  graph.searchMore(mailbox, query, folder, nextLink);

export const getMailMessage = async (mailbox: string, id: string, folder: FolderId = "inbox") =>
  live()
    ? { message: await graph.getMessage(mailbox, id, folder) }
    : get<{ message: MailMessage }>(
        `/api/mail/messages/${encodeURIComponent(id)}?mailbox=${encodeURIComponent(mailbox)}`
      );

export const setMailRead = async (mailbox: string, id: string, isRead: boolean) => {
  if (live()) return graph.setRead(mailbox, id, isRead);
  return post<{ message: MailMessage }>(`/api/mail/messages/${encodeURIComponent(id)}/read`, {
    mailbox,
    isRead,
  });
};

export const moveMailMessage = async (mailbox: string, id: string, folder: FolderId) => {
  if (live()) return graph.moveMessage(mailbox, id, folder);
  return post<{ message: MailMessage }>(`/api/mail/messages/${encodeURIComponent(id)}/move`, {
    mailbox,
    folder,
  });
};

/**
 * Sends one message and reports the conversation it started.
 *
 * Only meaningful against a real mailbox: the in-memory one has no threading to
 * track, so it reports an empty conversation and the caller records the ask
 * without a way to match a reply — which is correct, because in the demo
 * mailbox no reply is ever coming.
 */
/**
 * Sending without Outlook is refused on the live site, in words.
 *
 * Until 25 Sep 2026 a send with no Microsoft connection went to the demo
 * mailbox and came back as success: a quotation "sent" by somebody signed in
 * with a password never left, and a rate request was recorded as asked when
 * nobody had been. The demo mailbox is for running the app locally only.
 */
const NOT_CONNECTED = "Outlook is not connected, so nothing was sent. Connect Outlook on the Mail page, then send it again.";
const demoMail = import.meta.env.DEV;

export const sendTrackedMail = async (input: {
  to: string[];
  cc?: string[];
  subject: string;
  content: string;
}): Promise<{ conversationId: string | null }> => {
  if (!live()) {
    if (demoMail) return { conversationId: null };
    throw new Error(NOT_CONNECTED);
  }
  const { conversationId } = await graph.sendTracked(input);
  // Into the desk's mail log for oversight once Outlook has filed it (086).
  syncSentSoon();
  return { conversationId };
};

/**
 * Every message in one conversation, wherever it now sits. Unordered.
 * Without Outlook, the local store's own (running the app locally only).
 */
export const conversationMessages = async (
  mailbox: string,
  conversationId: string
): Promise<MailMessage[]> =>
  live()
    ? graph.messagesInConversation(mailbox, conversationId)
    : demoMail
      ? allMessages().filter((m) => m.mailbox === mailbox && m.conversationId === conversationId)
      : [];

/**
 * Every message in the mailbox matching a KQL query, across all folders.
 *
 * The caller writes the query, because `participants:"x@y"` and a bare phrase
 * are different questions — see the header of `graphMail.searchMailbox`.
 */
export const searchMail = async (mailbox: string, kql: string): Promise<MailMessage[]> =>
  live() ? graph.searchMailbox(mailbox, kql) : [];

export const sendMail = async (body: {
  mailbox: string;
  fromName: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  conversationId?: string;
  replyToId?: string;
  /** A forward: through Graph's own, so the original's attachments go too. */
  forwardOfId?: string;
  /** A draft already in the mailbox (started in Outlook): updated, then sent itself. */
  draftId?: string;
  attachments?: graph.OutgoingAttachment[];
}) => {
  if (live()) {
    if (body.draftId) {
      await graph.sendDraft({
        draftId: body.draftId,
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        content: body.content,
        attachments: body.attachments,
      });
      syncSentSoon();
      return;
    }
    if (body.forwardOfId) {
      await graph.forwardTracked({
        forwardOfId: body.forwardOfId,
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        content: body.content,
        attachments: body.attachments,
      });
      syncSentSoon();
      return;
    }

    /*
      A reply goes through the reply path, not the send path.
      --------------------------------------------------------------------
      /me/sendMail starts a new conversation and sets no In-Reply-To or
      References headers, so a reply sent that way lands outside the thread
      it is answering however right the "Re:" subject looks. Threading is
      what `replyToId` buys, and it is only correct when it is used.
    */
    if (body.replyToId) {
      await graph.replyTracked({
        replyToId: body.replyToId,
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        content: body.content,
        attachments: body.attachments,
      });
      syncSentSoon();
      return;
    }

    await graph.sendMessage({
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      content: body.content,
      attachments: body.attachments,
    });
    syncSentSoon();
    return;
  }
  if (!demoMail) throw new Error(NOT_CONNECTED);
  return post<{ message: MailMessage }>("/api/mail/send", body);
};

/**
 * One attachment's bytes, to download. Only a real mailbox has them; the local
 * store's messages carry names and sizes only.
 */
export const getMailAttachment = async (
  messageId: string,
  attachmentId: string
): Promise<{ name: string; contentType: string; size: number; contentBytes: string }> => {
  if (!live()) {
    // Running locally: the local store's own file, when it carries one.
    const a = demoMail
      ? (allMessages().find((m) => m.id === messageId)?.attachments.find((x) => x.id === attachmentId) as
          | { name: string; contentType: string; size: number; contentBytes?: string }
          | undefined)
      : undefined;
    if (a?.contentBytes) return { name: a.name, contentType: a.contentType, size: a.size, contentBytes: a.contentBytes };
    throw new Error("Connect Outlook on the Mail page to open attachments.");
  }
  return graph.getAttachmentBytes(messageId, attachmentId);
};

/** Keeps a message being written as a draft in Outlook, unsent. */
export const saveMailDraft = async (body: {
  mailbox: string;
  fromName: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  draftId?: string;
  replyToId?: string;
  forwardOfId?: string;
  attachments?: graph.OutgoingAttachment[];
}) => {
  if (live()) return graph.saveDraft(body);
  if (!demoMail) throw new Error(NOT_CONNECTED);
  return post("/api/mail/draft", body);
};

/** True when this session is talking to a real Outlook mailbox. */
export const mailIsLive = () => graph.hasGraphToken();
