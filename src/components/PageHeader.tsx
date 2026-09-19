/**
 * The top of every page.
 *
 * `eyebrow` names the area the page belongs to. Without it a screen titled
 * "Completed shipments" gives no sense of where you are in the product, and the
 * sidebar is the only thing orienting you — which stops working the moment
 * someone follows a deep link or screenshots a page.
 */
export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  action,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6 pb-4 border-b border-border">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="text-[22px] leading-tight font-semibold text-text-primary">{title}</h1>
        {subtitle && (
          <p className="text-[13px] text-text-secondary mt-1 max-w-[62ch] leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
