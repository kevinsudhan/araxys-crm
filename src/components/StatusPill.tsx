type Tone = "success" | "warning" | "danger" | "accent" | "neutral";

/**
 * Each tone carries a hairline in its own colour.
 *
 * A pill is a small tinted rectangle with small text in it. Without an edge it
 * dissolves into the white card behind it and stops reading as a tag — which is
 * most of why a board full of statuses looked washed rather than labelled. The
 * fill stays light so the label keeps its contrast; only the boundary firms up.
 */
const toneClasses: Record<Tone, string> = {
  success: "bg-bg-success text-text-success border-text-success/25",
  warning: "bg-bg-warning text-text-warning border-text-warning/25",
  danger: "bg-bg-danger text-text-danger border-text-danger/25",
  accent: "bg-bg-accent text-text-accent border-text-accent/25",
  neutral: "bg-surface-2 text-text-secondary border-border-strong",
};

export default function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${toneClasses[tone]}`}
    >
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
