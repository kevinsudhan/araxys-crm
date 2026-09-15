import { Link } from "react-router-dom";

/**
 * A single figure, with what it counts and where to go to see it.
 *
 * ---------------------------------------------------------------------------
 * A DASH IS A VALID VALUE
 *
 * `value` is allowed to be null, and renders as an em dash in muted type. That
 * is the honest reading for a figure nothing has computed yet, and it is
 * visibly different from a zero — which is a real count of nothing, and is
 * shown in full-weight type like any other number.
 *
 * Making the difference visible matters more here than it looks. "0 open
 * complaints" and "we do not track complaints" are opposite facts, and a card
 * that renders both as 0 quietly turns the second into the first.
 * ---------------------------------------------------------------------------
 */
export default function MetricCard({
  label,
  value,
  hint,
  to,
  icon: Icon,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  /** When given, the whole card becomes a link to the page behind the figure. */
  to?: string;
  icon?: React.ElementType;
}) {
  const unknown = value === null || value === undefined || value === "—";

  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={13} className="text-text-muted shrink-0" />}
        <p className="text-[11px] uppercase tracking-wide font-medium text-text-secondary truncate">
          {label}
        </p>
      </div>
      <p
        className={`text-2xl leading-none tabular-nums ${
          unknown ? "font-normal text-text-muted" : "font-medium text-text-primary"
        }`}
      >
        {unknown ? "—" : value}
      </p>
      {hint && <p className="text-[11px] text-text-muted mt-1.5 leading-snug">{hint}</p>}
    </>
  );

  const shell =
    "block card p-4 h-full transition-colors";

  return to ? (
    <Link to={to} className={`${shell} hover:border-border-strong hover:bg-surface-1`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
