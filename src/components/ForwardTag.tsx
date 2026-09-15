import { CornerUpRight, Repeat2 } from "lucide-react";
import { readForwardChain } from "../services/forwardChain";
import type { MailMessage } from "../services/backend";

/**
 * How this message actually reached the mailbox.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SITS UNDER THE FROM LINE
 *
 * Because the From line is wrong, in the only sense that matters to somebody
 * working the desk. A customer writes to info@, a rule forwards it on, and the
 * message arrives saying it is from info@ — one of our own addresses. Every
 * screen then repeats that: the reading pane, the queue row, and the customer
 * record if anybody pushes it through without looking.
 *
 * So the real chain is printed where the wrong answer is, rather than somewhere
 * a careful person could go and check.
 *
 * IT IS READ, NOT INFERRED
 *
 * Every word here comes from `readForwardChain`, which is regular expressions
 * over headers Exchange wrote and over the forward block the client wrote. The
 * same message always produces the same tag. Nothing about it is a guess, and
 * nothing about it costs a request — which is the difference between this and
 * the panel below it.
 * ---------------------------------------------------------------------------
 */
export default function ForwardTag({ message }: { message: MailMessage }) {
  const chain = readForwardChain(message);
  if (!chain) return null;

  const Icon = chain.auto ? Repeat2 : CornerUpRight;
  const who = chain.originalName
    ? `${chain.originalName} <${chain.originalFrom}>`
    : chain.originalFrom;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11.5px]">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-text-secondary">
        <Icon size={12} />
        {chain.auto ? "Auto-forwarded" : "Forwarded"}
      </span>

      {chain.forwardedBy && (
        <span className="text-text-muted">
          by <span className="font-mono text-text-secondary">{chain.forwardedBy}</span>
        </span>
      )}

      {/* The part that matters: who actually wrote it. Absent when the forward
          carried no header block to read, and absent is honest — better than a
          confident guess about a customer's identity. */}
      {who ? (
        <span className="min-w-0 text-text-muted">
          — originally from <span className="break-all text-text-primary">{who}</span>
        </span>
      ) : (
        <span className="text-text-muted">— original sender not stated in the message</span>
      )}
    </div>
  );
}
