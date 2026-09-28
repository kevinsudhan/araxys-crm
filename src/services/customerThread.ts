import { correspondenceFor } from "./enquiries";
import { getMailMessage, mailIsLive, type MailMessage } from "./backend";

/**
 * The message a CRM mail to someone on a job should answer, so it lands in the
 * conversation already running with them rather than starting a new one.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG
 *
 * The quotation, the booking confirmation and the tracking link each went out
 * through /me/sendMail as a new message. The customer had written in on one
 * thread; they got their quotation on a second, the confirmation on a third and
 * the tracking link on a fourth, and every reply of theirs picked one of the
 * four. In their Outlook and in ours the job was scattered across conversations
 * that nothing tied together.
 *
 * WHAT IT DOES NOW
 *
 * Looks through the job's correspondence in the signed-in mailbox — the
 * enquiry's bound threads and anything carrying its reference — for the newest
 * message from, to or copied to this person, and hands it back with its body.
 * The compose window answers it through Graph's createReply, which sets the
 * In-Reply-To and References headers, so the mail joins that thread in both
 * mailboxes.
 *
 * None found (a customer who phoned, or whose mail came into a colleague's
 * mailbox) means a new conversation, and the compose window says so.
 * ---------------------------------------------------------------------------
 */
export async function threadWith(
  enquiryRef: string,
  mailbox: string,
  /** The addresses that count as this person: the one being written to, and the customer's others. */
  addresses: string[]
): Promise<MailMessage | null> {
  if (!mailIsLive() || !mailbox || !enquiryRef) return null;
  const wanted = new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return null;

  const filed = await correspondenceFor(enquiryRef, mailbox);
  // Newest first already.
  const hit = filed.find(({ message: m }) => !m.isDraft && involves(m, wanted))?.message;
  if (!hit) return null;

  // The reply quotes it, and a list row carries only a preview.
  return getMailMessage(mailbox, hit.id, hit.folder)
    .then((r) => ({ ...hit, ...r.message, folder: hit.folder }))
    .catch(() => hit);
}

function involves(m: MailMessage, wanted: Set<string>): boolean {
  return [m.from, ...m.toRecipients, ...m.ccRecipients].some((r) =>
    wanted.has((r?.emailAddress?.address ?? "").toLowerCase())
  );
}
