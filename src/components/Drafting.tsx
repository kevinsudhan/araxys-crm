import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * What the screen does while a model is writing.
 *
 * ---------------------------------------------------------------------------
 * IN THE PLACE THE TEXT WILL APPEAR
 *
 * A spinner in a button says something is happening; it does not say what, or
 * where. When a model is drafting a reply the thing worth watching is the body
 * of the message, so the waiting state goes there — lines the length of prose,
 * sweeping left to right, one after another rather than in unison. A block that
 * pulses together reads as loading. This is writing.
 *
 * WHY IT SAYS WHAT IT IS DOING
 *
 * "Writing…" is a verb with no object. Drafting a reply, writing a rate request
 * and reading a message are three different waits on this desk, and the one you
 * are in decides whether it is worth staying for. So the caller names it.
 *
 * WHY THE SECONDS ARE SHOWN
 *
 * Because this is a free-tier model that returns a 503 roughly one request in
 * four and retries behind the scenes. A wait with no counter is a wait people
 * abandon at four seconds and press again, which costs a second request. A
 * counter that is visibly still moving is the difference between waiting and
 * wondering.
 *
 * The count starts at nothing and only appears after three seconds — showing
 * "0s" the instant a button is pressed makes a fast answer feel slow.
 * ---------------------------------------------------------------------------
 */
export default function Drafting({
  label,
  lines = 4,
  compact,
}: {
  /** What is being written, as a verb phrase: "Drafting a reply". */
  label: string;
  /** Roughly how much prose to suggest. */
  lines?: number;
  /** For a panel rather than a full message body. */
  compact?: boolean;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      500
    );
    return () => window.clearInterval(t);
  }, []);

  // Uneven, and short on the last line, because that is the shape of a
  // paragraph. Four equal bars read as a table.
  const widths = ["92%", "97%", "88%", "64%", "94%", "71%"];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-card border border-border bg-surface-1 ${compact ? "p-3" : "p-4"}`}
    >
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
        <Sparkles size={12} className="text-brand" />
        {label}
        <span className="draft-caret ml-0.5 inline-block h-3 w-px translate-y-px bg-brand" />
        {seconds >= 3 && (
          <span className="ml-auto tabular-nums text-[11px] font-normal text-text-muted">
            {seconds}s
          </span>
        )}
      </p>

      <div className={compact ? "mt-2.5 space-y-2" : "mt-3 space-y-2.5"} aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="draft-line"
            style={{
              width: widths[i % widths.length],
              // Staggered so it reads as one line after another rather than a
              // block breathing in unison.
              animationDelay: `${i * 0.14}s`,
            }}
          />
        ))}
      </div>

      {seconds >= 12 && (
        <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
          Still going. The model is on a free tier that refuses roughly one
          request in four, and this retries rather than failing — pressing again
          starts a second one rather than hurrying this.
        </p>
      )}
    </div>
  );
}
