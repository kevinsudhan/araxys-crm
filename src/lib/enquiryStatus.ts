import type { EnquiryStatus } from "../services/enquiries";

/** How a status reads as a pill: a light fill inside a hairline of its hue. The board and the case file alike. */
export const STATUS_TONE: Record<EnquiryStatus, string> = {
  new: "bg-bg-accent text-text-accent border-text-accent/25",
  qualifying: "bg-bg-accent text-text-accent border-text-accent/25",
  quoted: "bg-bg-warning text-text-warning border-text-warning/25",
  accepted: "bg-bg-success text-text-success border-text-success/25",
  declined: "bg-surface-2 text-text-secondary border-border-strong",
  lost: "bg-surface-2 text-text-muted border-border-strong",
};

/**
 * Why an enquiry that will not become a job is closed.
 *
 * Nothing used to set "lost", so an enquiry that went nowhere — the customer
 * booked elsewhere, never answered, or it was a consol confirmation that
 * arrived as an enquiry — sat on the board as New for good (30 Sep).
 */
export const CLOSE_REASONS = [
  "Customer went elsewhere",
  "No reply from the customer",
  "Rates not competitive",
  "Not an enquiry",
  "Duplicate of another enquiry",
  "Other",
] as const;

/** Open enquiries can be closed; closed ones reopened. An accepted one is a job, and is cancelled on the shipment instead. */
export const canClose = (s: EnquiryStatus) => s === "new" || s === "qualifying" || s === "quoted";
export const canReopen = (s: EnquiryStatus) => s === "lost" || s === "declined";

/** Where a reopened enquiry goes back to: quoted when a quotation is out with the customer, else new. */
export function reopenedStatus(quotes: Array<{ status: string }>): EnquiryStatus {
  return quotes.some((q) => q.status === "sent") ? "quoted" : "new";
}
