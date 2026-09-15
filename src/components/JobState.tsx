import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  promoteToShipment,
  setShipmentStage,
  type Enquiry,
  type Shipment,
} from "../services/enquiries";

/**
 * Moving a job between inbound, in process and completed.
 *
 * ---------------------------------------------------------------------------
 * ONE CONTROL FOR WHAT WAS THREE SCATTERED ONES
 *
 * The moves already existed and were in three different places: a button on the
 * case file promoted an enquiry, a stepper on the shipment's own page walked it
 * through eight stages, and "completed" was whatever `delivered` happened to
 * mean. Somebody minding their own jobs had to know all three.
 *
 * WHAT THE THREE STATES ACTUALLY ARE
 *
 * They are not a column. They are read off what exists:
 *
 *   inbound     — no shipment yet
 *   in process  — a shipment exists and has not been delivered
 *   completed   — the shipment's stage is `delivered`
 *
 * So there is nothing to keep in step. The global boards read the same two
 * facts, which is why a move made here shows up there without anything being
 * copied between them.
 *
 * WHY GOING BACK TO INBOUND IS REFUSED
 *
 * A shipment is a commitment somebody made — space booked, a customer told.
 * Deleting it because the state control offers three buttons would throw that
 * away silently. The way back is to cancel the shipment on its own page, which
 * says what it is doing.
 * ---------------------------------------------------------------------------
 */

export type JobStateKey = "inbound" | "in_process" | "completed";

export const STATE_LABEL: Record<JobStateKey, string> = {
  inbound: "Inbound",
  in_process: "In process",
  completed: "Completed",
};

/** Read the state off what exists, rather than off a column that could drift. */
export function stateOf(shipment: Shipment | undefined | null): JobStateKey {
  if (!shipment) return "inbound";
  return shipment.stage === "delivered" ? "completed" : "in_process";
}

const ORDER: JobStateKey[] = ["inbound", "in_process", "completed"];

export default function JobState({
  enquiry,
  shipment,
  onChanged,
}: {
  enquiry: Enquiry;
  shipment?: Shipment | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<JobStateKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = stateOf(shipment);

  /**
   * Why a particular move is not available, in the words of what is missing.
   *
   * A disabled button that does not say why is a button somebody presses three
   * times and then asks a colleague about.
   */
  function refuse(to: JobStateKey): string | null {
    if (to === current) return null;

    if (to === "inbound") {
      return "A booking has been made. Cancel the shipment on its own page if it is genuinely off.";
    }
    if (to === "in_process" && !shipment) {
      return enquiry.status === "accepted"
        ? null
        : "The customer has not accepted a quote yet, so there is nothing to book.";
    }
    if (to === "completed" && !shipment) {
      return "Nothing has been booked yet, so there is nothing to complete.";
    }
    return null;
  }

  async function move(to: JobStateKey) {
    const why = refuse(to);
    if (why) return setError(why);

    setBusy(to);
    setError(null);
    try {
      if (to === "in_process") {
        if (!shipment) await promoteToShipment(enquiry.ref);
        // Coming back from completed: `arrived` is the stage before delivery,
        // so reopening puts it where it was rather than at the beginning.
        else await setShipmentStage(shipment.id, "arrived");
      } else if (to === "completed" && shipment) {
        await setShipmentStage(shipment.id, "delivered");
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not move.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-w-0">
      <div
        className="inline-flex overflow-hidden rounded-lg border border-border"
        role="group"
        aria-label="Which state this job is in"
      >
        {ORDER.map((k) => {
          const isNow = k === current;
          const why = refuse(k);
          return (
            <button
              key={k}
              onClick={() => void move(k)}
              disabled={busy !== null || isNow}
              aria-current={isNow ? "true" : undefined}
              title={why ?? (isNow ? `Currently ${STATE_LABEL[k].toLowerCase()}` : undefined)}
              className={`inline-flex h-7 items-center gap-1 border-r border-border px-2.5 text-[12px] transition-colors last:border-r-0 ${
                isNow
                  ? "bg-brand font-medium text-white"
                  : why
                    ? "cursor-not-allowed bg-surface-1 text-text-muted"
                    : "bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              }`}
            >
              {busy === k && <Loader2 size={11} className="animate-spin" />}
              {STATE_LABEL[k]}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-1 text-[11px] leading-relaxed text-text-warning">{error}</p>}
    </div>
  );
}
