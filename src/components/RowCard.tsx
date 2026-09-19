/**
 * One row in a list.
 *
 * The clickable version was a plain div with an onClick, which meant it could not
 * be reached by Tab and did not respond to Enter or Space — the whole of
 * Inbound requests and In-process shipments was mouse-only. That is not a styling
 * detail: a desk that takes calls all day has people who work from the keyboard,
 * and a screen reader announced these as static text.
 *
 * So a row that does something now says so: it takes focus, carries a button
 * role, and activates on Enter or Space like anything else. A row that does
 * nothing stays an ordinary div rather than pretending to be interactive.
 *
 * The hover treatment moved from the border to a lift and a rule. A border-colour
 * change on a hairline is nearly invisible against paper, so nothing signalled
 * that the row was live until you clicked it.
 */
export default function RowCard({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const base =
    "relative flex items-center gap-3 rounded-card bg-surface-1 border border-border px-4 py-3 mb-2 transition-[box-shadow,border-color,transform] duration-150";

  if (!onClick) return <div className={base}>{children}</div>;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // Space scrolls the page by default; a row that moves the viewport when
        // you try to open it is worse than one that does nothing.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`${base} cursor-pointer text-left w-full
        hover:border-border-strong hover:shadow-lift
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--text-secondary)]
        before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-full
        before:bg-brand before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-150`}
    >
      {children}
    </div>
  );
}
