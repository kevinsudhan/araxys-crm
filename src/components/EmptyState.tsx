import { Inbox } from "lucide-react";

/**
 * Nothing here — and, where possible, why.
 *
 * The previous version centred an inbox icon over one line of grey text, which
 * reads the same whether the list is empty because the desk is clear or because
 * a filter excluded everything. Those are opposite situations: one is good news
 * and the other is a wrong turn, and a person cannot act on either without being
 * told which it is.
 *
 * So `hint` exists and callers are expected to use it. The dashed rule is there
 * to give the space an edge — an icon floating in white reads as a page that
 * failed to load rather than a list with nothing in it.
 */
export default function EmptyState({
  label,
  hint,
  icon: Icon = Inbox,
}: {
  label: string;
  hint?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-card border border-dashed border-border-strong bg-surface-1/60">
      <span className="grid place-items-center w-9 h-9 rounded-full bg-surface-2 text-text-muted mb-3">
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <p className="text-[13px] font-medium text-text-secondary">{label}</p>
      {hint && <p className="text-[11.5px] text-text-muted mt-1 max-w-[42ch] leading-relaxed">{hint}</p>}
    </div>
  );
}
