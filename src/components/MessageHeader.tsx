import ForwardTag from "./ForwardTag";
import type { MailMessage, Recipient } from "../services/backend";

/**
 * Who wrote this, who else got it, and when.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A BLOCK AND NOT THREE LINES
 *
 * It was three loose lines of grey text under the subject — sender, address and
 * time all at the same weight on one row, then "To …" beneath in the smallest
 * size in the interface. Everything a person checks before deciding what to do
 * with a message was there, and none of it was findable: the eye had nothing to
 * land on, so the header read as a caption rather than as a record of who is
 * involved.
 *
 * On a freight desk that matters more than it does in a personal inbox. The
 * same thread runs between a shipper, an agent and two people here, and "who is
 * on this" is the question asked before every reply.
 *
 * WHAT WAS ACTUALLY MISSING
 *
 * Cc. It was never rendered at all — only toRecipients was — so a message
 * copied to three other people looked like a private one. That is not a
 * cosmetic gap: replying to a thread without knowing who is already on it is
 * how a quotation reaches somebody it was not meant for.
 *
 * The old markup also printed the sender's address twice whenever the message
 * carried no display name, because the first slot fell back to the address and
 * the second slot printed it again.
 * ---------------------------------------------------------------------------
 */

/**
 * Two letters for the avatar.
 *
 * From the display name where there is one — "AAS INT" gives AI — and from the
 * local part of the address where there is not. Never from the domain, which
 * would give every sender at one company the same initials.
 */
function initials(r: Recipient): string {
  const name = r.emailAddress.name?.trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const local = r.emailAddress.address?.split("@")[0] ?? "";
  return (local.slice(0, 2) || "?").toUpperCase();
}

function People({ label, list }: { label: string; list: Recipient[] }) {
  if (!list.length) return null;
  return (
    <div className="flex gap-2">
      <span className="w-6 shrink-0 text-[11px] leading-5 text-text-muted">{label}</span>
      <span className="min-w-0 break-words text-[12px] leading-5 text-text-secondary">
        {list.map((t) => t.emailAddress.address).filter(Boolean).join(", ")}
      </span>
    </div>
  );
}

export default function MessageHeader({
  message,
  /** Whether the full message has landed — the forward tag needs its headers. */
  complete,
  when,
}: {
  message: MailMessage;
  complete: boolean;
  when: string;
}) {
  const from = message.from;
  const name = from.emailAddress.name?.trim();
  const address = from.emailAddress.address;

  return (
    <div className="card-inset mt-3 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-1 text-[12px] font-semibold tracking-wide text-text-secondary"
          aria-hidden
        >
          {initials(from)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="min-w-0 break-words text-[13.5px] font-medium text-text-primary">
              {name || address || "Unknown sender"}
            </p>
            <span className="shrink-0 text-[11.5px] tabular-nums text-text-muted">{when}</span>
          </div>

          {/* Only when it adds something. With no display name the line above is
              already the address, and printing it twice is what the old header
              did. */}
          {name && address && (
            <p className="mt-0.5 break-words text-[12px] text-text-secondary">{address}</p>
          )}
        </div>
      </div>

      {(message.toRecipients.length > 0 || message.ccRecipients.length > 0) && (
        <div className="mt-2.5 space-y-0.5 border-t border-border pt-2.5">
          <People label="To" list={message.toRecipients} />
          <People label="Cc" list={message.ccRecipients} />
        </div>
      )}

      {/* Inside the block, because what it corrects is the sender printed above
          it — not a separate note about the message. */}
      {complete && <ForwardTag message={message} />}
    </div>
  );
}
