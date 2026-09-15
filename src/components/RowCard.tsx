/**
 * One row in a list.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WRAPS
 *
 * These rows are built from fixed-width spans — a reference at `w-32`, an
 * amount at `w-24`, a status pill — which fit a desk monitor and do not fit a
 * phone. `flex-wrap` lets the trailing cells drop to a second line instead of
 * crushing the name in the middle, which is the one column somebody actually
 * needs to read.
 *
 * A clickable row is a real `button`, not a `div` with an onClick. The latter
 * cannot be reached by keyboard and is invisible to a screen reader, and this
 * is the primary way into most records in the app.
 * ---------------------------------------------------------------------------
 */
export default function RowCard({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const shell =
    "w-full flex flex-wrap items-center gap-x-3 gap-y-2 card px-3 sm:px-4 py-3 mb-2";

  if (!onClick) return <div className={shell}>{children}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${shell} text-left cursor-pointer hover:border-border-strong hover:bg-surface-1 transition-colors`}
    >
      {children}
    </button>
  );
}
