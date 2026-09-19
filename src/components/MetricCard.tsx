/**
 * One figure, with room for what it means.
 *
 * The previous version set the label at the same size and weight as body text,
 * which made a row of these read as four paragraphs that happened to contain
 * numbers. A metric has a strict hierarchy — what it is, what it says, why it
 * matters — and the label's job is to be findable, not to be read.
 *
 * `tone` exists because some of these figures are judgements rather than counts.
 * "38% quote to booking" is a number; "6 shipments at risk" is a number that
 * wants looking at. It is deliberately not inferred from the value: a threshold
 * guessed here would be wrong for half the metrics on the page.
 */
export default function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const rule = {
    neutral: "bg-border-strong",
    good: "bg-[var(--text-success)]",
    warn: "bg-[var(--text-warning)]",
    bad: "bg-[var(--text-danger)]",
  }[tone];

  return (
    <div className="group relative rounded-card bg-surface-1 border border-border shadow-lift overflow-hidden transition-colors duration-200 hover:border-border-strong">
      {/* A hairline rather than a coloured card. The figure stays the loudest
          thing in the tile; the rule is only there to be caught side-on. */}
      <span aria-hidden="true" className={`absolute left-0 top-0 h-full w-[2px] ${rule}`} />

      <div className="p-4 pl-[18px]">
        <p className="eyebrow">{label}</p>
        <p className="mt-2 text-[26px] leading-none font-semibold text-text-primary tracking-[-0.03em]">
          {value}
        </p>
        {hint && <p className="mt-2 text-[11.5px] leading-snug text-text-muted">{hint}</p>}
      </div>
    </div>
  );
}
