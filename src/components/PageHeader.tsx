/**
 * The heading block at the top of every page.
 *
 * The action stacks under the title on narrow screens rather than being
 * squeezed beside it: a button that shrinks to fit is harder to hit than one
 * that has moved somewhere predictable.
 *
 * On a short window (a 768-px laptop) the space under it is smaller. `dense`,
 * for a page whose content is the point (Mail), keeps the heading for screen
 * readers only there: the menu already marks where you are.
 */
export default function PageHeader({
  title,
  subtitle,
  action,
  dense,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  dense?: boolean;
}) {
  return (
    <div className={`${dense ? "mb-3 short:sr-only" : "mb-6 short:mb-4"} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
      <div className="min-w-0">
        {/*
          A step up in size and a step tighter in tracking.
          ------------------------------------------------------------------
          At 19px semibold-adjacent the title sat only a little above the 13px
          body around it, so a page opened with no clear first thing to read.
          Larger type wants tighter letter-spacing — the gaps scale with the
          glyphs and start to look loose — which is why the two move together
          rather than the size alone.
        */}
        <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.02em] text-text-primary sm:text-[23px]">
          {title}
        </h1>
        {subtitle && (
          <p className={`mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-secondary ${dense ? "short:hidden" : ""}`}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
