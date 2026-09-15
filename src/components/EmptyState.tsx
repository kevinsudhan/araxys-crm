import { Inbox } from "lucide-react";

/**
 * What a screen shows when there is nothing on it.
 *
 * ---------------------------------------------------------------------------
 * AN EMPTY STATE IS AN EXPLANATION, NOT AN APOLOGY
 *
 * This CRM shows real records or none, so empty is the normal state of a fresh
 * desk rather than a fault. What a reader needs to know is which of two things
 * they are looking at: a surface that works and has nothing in it yet, or one
 * that is not connected to anything.
 *
 * `tone="unwired"` says the second out loud, in dashed borders and plain words,
 * because a page that renders a confident "Nothing outstanding" while being
 * attached to no data source is telling a lie with a cheerful face.
 * ---------------------------------------------------------------------------
 */
export default function EmptyState({
  label,
  title,
  hint,
  icon: Icon = Inbox,
  action,
  tone = "empty",
}: {
  /** Short form: the old single-line API, still used in a few places. */
  label?: string;
  title?: string;
  hint?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  tone?: "empty" | "unwired";
}) {
  const heading = title ?? label ?? "Nothing here yet";

  return (
    <div
      className={`rounded-card bg-surface-1 px-6 py-12 text-center ${
        tone === "unwired" ? "border border-dashed border-border-strong" : "border border-border"
      }`}
    >
      <Icon size={22} className="mx-auto text-text-muted" strokeWidth={1.5} />
      <p className="mt-3 text-[14px] font-medium text-text-primary">{heading}</p>
      {hint && (
        <p className="mt-1.5 text-[13px] text-text-secondary max-w-md mx-auto leading-relaxed">
          {hint}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * The narrower case: a surface with no backend behind it.
 *
 * Named separately so the wording stays identical everywhere it appears. Four
 * pages making the same admission in four different phrasings reads like four
 * different problems.
 */
export function NotWired({
  what,
  icon,
  source,
}: {
  what: string;
  icon?: React.ElementType;
  /** What would have to be connected for this page to fill up. */
  source: string;
}) {
  return (
    <EmptyState
      tone="unwired"
      icon={icon}
      title={`${what} is not connected yet`}
      hint={`Nothing is shown here because nothing is feeding it. ${source} Sample rows would make this page look finished, so there are none.`}
    />
  );
}
