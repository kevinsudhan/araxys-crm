type Tone = "success" | "warning" | "danger" | "accent" | "neutral";

/**
 * A state, said quietly.
 *
 * Every pill used to carry a tinted background, which meant a list of thirty
 * shipments arrived as thirty coloured chips and the eye had nothing to land on.
 * When everything is highlighted, nothing is. So the colour moved into a dot and
 * the chip itself went neutral: the state is still readable at a glance, and a
 * screen full of them reads as a list rather than a warning.
 *
 * `danger` is the deliberate exception and keeps its fill. A demurrage risk is
 * the one status on this system that costs money per day it is not noticed, and
 * it should be the only thing shouting on the page.
 *
 * The dot is never the only carrier of meaning — the label is always beside it,
 * so this works without colour vision and in a black-and-white printout.
 */
const dotFor: Record<Tone, string> = {
  success: "bg-[var(--text-success)]",
  warning: "bg-[var(--text-warning)]",
  danger: "bg-[var(--text-danger)]",
  accent: "bg-[var(--text-accent)]",
  neutral: "bg-border-strong",
};

const chipFor: Record<Tone, string> = {
  success: "bg-surface-1 border-border text-text-secondary",
  warning: "bg-surface-1 border-border text-text-secondary",
  accent: "bg-surface-1 border-border text-text-secondary",
  neutral: "bg-surface-1 border-border text-text-muted",
  danger: "bg-bg-danger border-[color:var(--text-danger)]/25 text-text-danger font-semibold",
};

export default function StatusPill({
  tone,
  children,
  dot = true,
}: {
  tone: Tone;
  children: React.ReactNode;
  /** Off for pills that are already prefixed by an icon, so there is one marker not two. */
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11.5px] font-medium leading-none whitespace-nowrap ${chipFor[tone]}`}
    >
      {dot && (
        <span aria-hidden="true" className={`w-[5px] h-[5px] rounded-full flex-none ${dotFor[tone]}`} />
      )}
      {children}
    </span>
  );
}

export function toneForShipmentStatus(status: string): Tone {
  switch (status) {
    case "delivered":
    case "booked":
      return "success";
    case "docs_missing":
    case "in_transit_delay":
    case "escalated":
      return "warning";
    case "demurrage_risk":
      return "danger";
    default:
      return "neutral";
  }
}

export function toneForRequestStatus(status: string): Tone {
  switch (status) {
    case "accepted":
      return "success";
    case "negotiating":
    case "quoting":
      return "warning";
    case "rejected":
      return "danger";
    default:
      return "neutral";
  }
}
