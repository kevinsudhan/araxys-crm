import { ArrowRight, Hash, Package, Sparkles } from "lucide-react";
import type { Reading } from "../services/classify";

/**
 * What the model made of a message, or of a queued row.
 *
 * ---------------------------------------------------------------------------
 * SHOWN, NEVER APPLIED
 *
 * The fields sit beside the buttons that file the thing, and a person presses
 * them — the same arrangement as the website-form panel, for the same reason: a
 * read is a proposal until somebody agrees with it. Nothing here writes.
 *
 * WHY IT IS LAID OUT BY MEANING RATHER THAN AS A FIELD LIST
 *
 * The first version printed seven label/value rows in the order the schema
 * happened to declare them, which is the shape of the data and not the shape of
 * the question. On a freight desk the question is: where is it going, what is
 * it, and who is asking. So the route reads as a route — Chennai → Colombo on
 * one line, the way it is written on every other screen in this CRM — the cargo
 * sits with it, and the contact details group as a person rather than as four
 * separate rows.
 *
 * A field the model did not find is absent, not blank. An empty row invites
 * somebody to read it as "no origin" when it means "the message did not say".
 *
 * WHY THE CONFIDENCE IS A BAR AND A NUMBER
 *
 * It is the one value that changes what to do with everything else here, and a
 * number alone gets skimmed. Neither is turned into a word like "likely" —
 * that would be this code making the judgement and hiding the evidence.
 *
 * The colour follows that value rather than decorating: a confident enquiry
 * reads green, a hedge amber, not-an-enquiry stays neutral. Three states
 * distinguishable before reading a word.
 * ---------------------------------------------------------------------------
 */
export default function ReadingPanel({
  reading,
  hint,
  action,
}: {
  reading: Reading;
  hint?: string;
  /**
   * Something to do with this reading, where there is something to do.
   *
   * A slot rather than an onApply callback, because what can be done differs by
   * where the panel is: a queued row can take these fields, and a message in the
   * inbox has no row to put them on yet. A slot keeps that knowledge in the page
   * that has it instead of teaching this component about both.
   */
  action?: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((reading.confidence ?? 0) * 100)));

  // Under 60% the model is hedging, and it should look like a hedge whichever
  // way it landed.
  const unsure = pct < 60;
  const tone = !reading.is_enquiry
    ? {
        head: "bg-surface-2",
        chip: "bg-surface-1 text-text-muted border-border",
        text: "text-text-secondary",
        bar: "bg-border-strong",
      }
    : unsure
      ? {
          head: "bg-bg-warning",
          chip: "bg-surface-1 text-text-warning border-text-warning/25",
          text: "text-text-warning",
          bar: "bg-text-warning",
        }
      : {
          head: "bg-bg-success",
          chip: "bg-surface-1 text-text-success border-text-success/25",
          text: "text-text-success",
          bar: "bg-text-success",
        };

  const route = [reading.origin, reading.destination].filter(Boolean);
  const who = [reading.contact_name, reading.company].filter(Boolean).join(" · ");
  const reach = [reading.email, reading.phone].filter(Boolean);

  return (
    <div className="w-full max-w-2xl overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      <header className={`flex items-center gap-2.5 px-3.5 py-2.5 ${tone.head}`}>
        <span
          className={`grid size-6 shrink-0 place-items-center rounded-lg border ${tone.chip}`}
          aria-hidden
        >
          <Sparkles size={12} />
        </span>

        <p className={`min-w-0 flex-1 text-[12.5px] font-medium ${tone.text}`}>
          {reading.is_enquiry ? "Reads as an enquiry" : "Not an enquiry"}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className="h-1 w-14 overflow-hidden rounded-full bg-black/10"
            role="img"
            aria-label={`${pct} per cent confident`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${tone.bar}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`w-8 text-right font-mono text-[10.5px] tabular-nums ${tone.text}`}>
            {pct}%
          </span>
        </div>
      </header>

      <div className="space-y-3 px-3.5 py-3">
        {/*
          A reference the message already carries, given its own line above the
          summary because of what it implies rather than what it says: this work
          has been numbered once already, and pushing it through would allocate
          a second reference for it. References are permanent, so the moment to
          notice is before the button, not after.
        */}
        {reading.reference && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-text-accent/25 bg-bg-accent px-3 py-2">
            <Hash size={12} className="shrink-0 text-text-accent" />
            <span className="font-mono text-[12px] font-medium text-text-accent">
              {reading.reference}
            </span>
            <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-muted">
              Already referenced. Check the board before pushing this through — a second reference
              cannot be taken back.
            </span>
          </div>
        )}

        <div>
          <p className="text-[13px] leading-relaxed text-text-primary">{reading.summary}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-text-muted">{reading.reason}</p>
        </div>

        {/* The route, as a route. Half of one is still worth showing — a message
            that names only where it is going is a real message. */}
        {(route.length > 0 || reading.cargo) && (
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            {route.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] font-medium text-text-primary">
                {reading.origin ?? <span className="text-text-muted">Origin not given</span>}
                <ArrowRight size={12} className="shrink-0 text-text-muted" />
                {reading.destination ?? (
                  <span className="text-text-muted">Destination not given</span>
                )}
              </p>
            )}
            {reading.cargo && (
              <p
                className={`flex items-start gap-1.5 text-[12px] text-text-secondary ${
                  route.length > 0 ? "mt-1" : ""
                }`}
              >
                <Package size={12} className="mt-0.5 shrink-0 text-text-muted" />
                <span className="min-w-0 break-words">{reading.cargo}</span>
              </p>
            )}
          </div>
        )}

        {/* Who is asking, as a person rather than as four rows. */}
        {(who || reach.length > 0) && (
          <div className="border-t border-border pt-2.5">
            {who && <p className="text-[12.5px] text-text-primary">{who}</p>}
            {reach.length > 0 && (
              <p className="mt-0.5 break-words text-[11.5px] text-text-secondary">
                {reach.join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Stacked rather than set beside the model name. Side by side, the hint
          wrapped into a column indented under itself, which reads as two
          unrelated fragments instead of one sentence. */}
      <footer className="border-t border-border bg-surface-2 px-3.5 py-2">
        {action && <div className="mb-2">{action}</div>}
        <p className="text-[10.5px] leading-relaxed text-text-muted">
          {hint ??
            "A reading, not a decision — nothing has been filed. Correct anything wrong in the queue after pushing it through."}
        </p>
        {/* Which model said this. Provenance is cheap to print and expensive to
            reconstruct later when somebody asks why a reading was wrong. */}
        <p className="mt-1 font-mono text-[9.5px] uppercase tracking-wide text-text-muted/70">
          {reading.model}
        </p>
      </footer>
    </div>
  );
}
