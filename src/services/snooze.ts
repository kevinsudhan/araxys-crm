import { supabase } from "../lib/supabase";
import * as graph from "./graphMail";
import { addFolder, moveMessage as moveInStore, setRead as setReadInStore } from "./mockMail";
import { mailIsLive, type MailMessage } from "./backend";

/**
 * Snooze, for mail (105).
 *
 * ---------------------------------------------------------------------------
 * Outlook's snooze is not in Microsoft Graph, so this does what Outlook does
 * underneath: the message goes to a "Snoozed" folder in the person's mailbox,
 * and at the chosen time it comes back to the Inbox, unread, at the top. When
 * is kept in `mail_snoozes`, one row per message, visible only to its owner.
 *
 * Bringing it back needs the owner's Outlook connection, so it happens in the
 * browser: `returnDue` runs when the Mail page opens and on each of its
 * minute-by-minute refreshes. A snooze that falls due while the CRM is closed
 * comes back the next time its owner opens Mail — said on screen, in the menu.
 *
 * Without Outlook (running the app locally) the same thing happens in the
 * local store, and the rows are kept in memory.
 * ---------------------------------------------------------------------------
 */
export interface Snooze {
  id: string;
  mailbox: string;
  /** The message's id in the Snoozed folder — the one that moves it back. */
  message_id: string;
  conversation_id: string | null;
  subject: string;
  sender: string;
  until: string;
  returned_at?: string | null;
}

const SNOOZED_LOCAL = "id:snoozed" as const;
let memory: Snooze[] = [];

/** What is snoozed in this mailbox and not yet back. */
export async function listSnoozes(mailbox: string): Promise<Snooze[]> {
  if (!mailIsLive()) return memory.filter((s) => s.mailbox === mailbox && !s.returned_at);
  const { data, error } = await supabase
    .from("mail_snoozes")
    .select("id, mailbox, message_id, conversation_id, subject, sender, until")
    .eq("mailbox", mailbox)
    .is("returned_at", null)
    .order("until");
  if (error) throw new Error(error.message);
  return (data ?? []) as Snooze[];
}

/** Snoozes messages until a time: to the Snoozed folder, and a row saying when. */
export async function snoozeMessages(mailbox: string, messages: MailMessage[], until: Date): Promise<void> {
  if (!mailIsLive()) {
    addFolder(SNOOZED_LOCAL, "Snoozed");
    for (const m of messages) {
      moveInStore(mailbox, m.id, SNOOZED_LOCAL);
      memory.push({ id: crypto.randomUUID(), mailbox, message_id: m.id, conversation_id: m.conversationId, subject: m.subject, sender: m.from.emailAddress.name || m.from.emailAddress.address, until: until.toISOString() });
    }
    return;
  }
  const folder = await graph.snoozedFolderId(mailbox);
  for (const m of messages) {
    const moved = await graph.moveToFolder(m.id, folder);
    if (!moved) continue;
    const { error } = await supabase.from("mail_snoozes").insert({
      mailbox,
      message_id: moved,
      conversation_id: m.conversationId || null,
      subject: m.subject ?? "",
      sender: m.from.emailAddress.name || m.from.emailAddress.address || "",
      until: until.toISOString(),
    });
    if (error) {
      // Without its row it would never come back: put it back now instead.
      await graph.moveToFolder(moved, "inbox").catch(() => null);
      throw new Error(`Could not snooze "${m.subject}": ${error.message}`);
    }
  }
}

/** Brings one snoozed message back now, unread, to the Inbox. */
export async function bringBack(s: Snooze): Promise<void> {
  if (!mailIsLive()) {
    moveInStore(s.mailbox, s.message_id, "inbox");
    setReadInStore(s.mailbox, s.message_id, false);
    s.returned_at = new Date().toISOString();
    return;
  }
  const back = await graph.moveToFolder(s.message_id, "inbox");
  if (back) await graph.setRead(s.mailbox, back, false).catch(() => {});
  // Gone from the Snoozed folder (moved or deleted in Outlook) counts as back.
  // Its new id is kept, so the Mail page can pin it to the top until opened.
  await supabase
    .from("mail_snoozes")
    .update({ returned_at: new Date().toISOString(), ...(back ? { message_id: back } : { seen_at: new Date().toISOString() }) })
    .eq("id", s.id);
}

/**
 * Snoozed mail that has come back and not been opened since (up to three
 * days): the Mail page pins it to the top of the Inbox, "Back from snooze" —
 * Outlook keeps a moved message's received date, so it would otherwise sit
 * wherever that date puts it.
 */
export async function listReturned(mailbox: string): Promise<Snooze[]> {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  if (!mailIsLive()) return memory.filter((s) => s.mailbox === mailbox && s.returned_at && s.returned_at > since && !seen.has(s.id));
  const { data, error } = await supabase
    .from("mail_snoozes")
    .select("id, mailbox, message_id, conversation_id, subject, sender, until, returned_at")
    .eq("mailbox", mailbox)
    .gt("returned_at", since)
    .is("seen_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as Snooze[];
}

const seen = new Set<string>();
/** Opened: no longer pinned. */
export async function markSeen(ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (!mailIsLive()) {
    ids.forEach((id) => seen.add(id));
    return;
  }
  await supabase.from("mail_snoozes").update({ seen_at: new Date().toISOString() }).in("id", ids);
}

/** Everything whose time has come, back in the Inbox. Says how many. */
export async function returnDue(mailbox: string): Promise<number> {
  const due = (await listSnoozes(mailbox)).filter((s) => Date.parse(s.until) <= Date.now());
  for (const s of due) await bringBack(s);
  return due.length;
}
