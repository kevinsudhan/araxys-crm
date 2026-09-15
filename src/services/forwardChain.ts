import type { MailMessage } from "./backend";

/**
 * How a message actually reached this mailbox.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT ASKED OF A MODEL
 *
 * Because it does not need to be. When info@ auto-forwards a customer's mail to
 * aashish@, the From line says info@ and the real sender is one layer down —
 * but that layer is written into the message by Exchange and by the forwarding
 * client, in fields with fixed names and fixed shapes. It is a fact to be read,
 * not a judgement to be made, and a model asked to read a fact will occasionally
 * decide to be helpful about it.
 *
 * So this is regular expressions over headers and over the forward block, and
 * the same message always produces the same answer. Nothing here calls out.
 *
 * WHAT IT LOOKS AT, IN ORDER OF HOW MUCH IT PROVES
 *
 * 1. X-MS-Exchange-Inbox-Rules-Loop. Microsoft 365 stamps this when an INBOX
 *    RULE forwards a message, and its value is the mailbox the rule belongs to.
 *    That is exactly the auto-forward case and exactly the address we want:
 *    "info@ forwarded this."
 * 2. Resent-From / X-Forwarded-For / Delivered-To. The same idea from other
 *    mail systems, in case a rule is ever moved off Exchange.
 * 3. The forward block in the body — "From: … Sent: … To: …" — which is what a
 *    person's Outlook writes when they press Forward by hand. Weaker evidence
 *    of an AUTO forward, but the strongest evidence of who originally wrote.
 *
 * A message that shows none of these is not a forward, and this returns null
 * rather than a shrug. Absent is a real answer.
 *
 * NOT PROOF OF HONESTY
 *
 * Every header here can be written by whoever composed the message. This tells
 * an operator where a mail says it came from, which is worth showing, and it is
 * not an authentication result. It never decides anything on its own.
 * ---------------------------------------------------------------------------
 */

export interface ForwardChain {
  /** An inbox rule forwarded this, rather than a person pressing Forward. */
  auto: boolean;
  /** The mailbox that forwarded it — info@aashishlogistics.com. */
  forwardedBy: string | null;
  /** Who wrote the message that was forwarded. */
  originalFrom: string | null;
  /** The name against that address, when the forward block carries one. */
  originalName: string | null;
  /** Where the original was addressed, which is usually the desk address. */
  originalTo: string | null;
  /** Which field this was read from, so a wrong answer can be traced. */
  via: "inbox-rule" | "resent-header" | "forward-block" | null;
}

/** A bare address out of "Name <a@b.com>", "a@b.com", or "<a@b.com>". */
const ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function address(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(ADDRESS);
  return m ? m[0].toLowerCase() : null;
}

/** The display name in front of an address, if the line carries one. */
function displayName(v: string): string | null {
  const m = v.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  const name = m?.[1]?.trim();
  // A name that is only the address again tells the reader nothing.
  return name && !ADDRESS.test(name) ? name : null;
}

function header(m: MailMessage, name: string): string | null {
  const hit = m.internetMessageHeaders?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return hit?.value?.trim() || null;
}

/**
 * The header block Outlook writes at the top of a forward.
 *
 * Matched on the plain text rather than the HTML, so the same expression works
 * whether the body arrived as HTML or as text — the tags are stripped first.
 * Graph prefixes ids and classes it does not own, but the words are the words.
 */
const FROM_LINE = /^\s*(?:From|De|Van)\s*:\s*(.+)$/im;
const TO_LINE = /^\s*(?:To|Para|Aan)\s*:\s*(.+)$/im;

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function readForwardChain(m: MailMessage): ForwardChain | null {
  // ---- 1. An Exchange inbox rule, which is the auto-forward case ----
  const rulesLoop = address(header(m, "X-MS-Exchange-Inbox-Rules-Loop"));

  // ---- 2. The same idea from other mail systems ----
  const resent =
    address(header(m, "Resent-From")) ??
    address(header(m, "X-Forwarded-For")) ??
    address(header(m, "X-Forwarded-To")) ??
    address(header(m, "Delivered-To"));

  // ---- 3. The forward block a client writes into the body ----
  const text = m.body?.contentType === "html" ? stripTags(m.body.content) : m.body?.content ?? "";
  const fromLine = text.match(FROM_LINE)?.[1] ?? null;
  const toLine = text.match(TO_LINE)?.[1] ?? null;

  const blockFrom = address(fromLine);
  const blockName = fromLine ? displayName(fromLine) : null;
  const blockTo = address(toLine);

  const forwardedBy = rulesLoop ?? resent ?? null;
  const header_says = Boolean(rulesLoop || resent);

  // Nothing said this was forwarded at all.
  if (!header_says && !blockFrom) return null;

  /**
   * The original sender is only interesting when it differs from the address on
   * the From line. On a message nobody forwarded they are the same, and saying
   * "originally from X" about the person who just wrote to you is noise.
   */
  const envelopeFrom = m.from?.emailAddress?.address?.toLowerCase() || null;
  const originalFrom = blockFrom && blockFrom !== envelopeFrom ? blockFrom : null;

  // A forward block on its own is a person pressing Forward, not a rule.
  if (!header_says && !originalFrom) return null;

  return {
    auto: Boolean(rulesLoop),
    // The rule's own mailbox beats everything: it is the address that forwarded.
    // Falling back to the From line covers a hand forward, where the person who
    // sent it to you is, literally, who forwarded it.
    forwardedBy: forwardedBy ?? envelopeFrom,
    originalFrom,
    originalName: originalFrom ? blockName : null,
    originalTo: blockTo,
    via: rulesLoop ? "inbox-rule" : resent ? "resent-header" : "forward-block",
  };
}
