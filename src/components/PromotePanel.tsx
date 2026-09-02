import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Check, Loader2, PackageCheck, Truck } from "lucide-react";
import {
  promoteToShipment,
  setShipmentStage,
  SHIPMENT_STAGES,
  SHIPMENT_STAGE_LABEL,
  type Enquiry,
  type Shipment,
  type ShipmentStage,
} from "../services/enquiries";

/**
 * The handover from selling to operating.
 *
 * Only offered once the customer has accepted. That is not a UI nicety -- the
 * database refuses to create a shipment without an accepted quote, so a booking
 * cannot come into existence on the strength of a conversation nobody confirmed.
 * The button reflects the rule; it does not implement it.
 */
export default function PromotePanel({
  enquiry,
  shipment,
  onChanged,
}: {
  enquiry: Enquiry;
  shipment: Shipment | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accepted = enquiry.status === "accepted";

  async function promote() {
    setBusy(true);
    setError(null);
    try {
      await promoteToShipment(enquiry.ref);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the shipment.");
    } finally {
      setBusy(false);
    }
  }

  async function advance(stage: ShipmentStage) {
    if (!shipment) return;
    setBusy(true);
    setError(null);
    try {
      await setShipmentStage(shipment.id, stage);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the stage.");
    } finally {
      setBusy(false);
    }
  }

  // ---- already a shipment ----
  if (shipment) {
    const at = SHIPMENT_STAGES.indexOf(shipment.stage);
    const next = at >= 0 && at < SHIPMENT_STAGES.length - 1 ? SHIPMENT_STAGES[at + 1] : null;

    return (
      <section className="mt-4 rounded-card border border-border bg-surface-1 p-5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
          <Truck size={12} /> In process
        </h2>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-mono text-[13px] text-text-accent">{shipment.id}</p>
            <p className="mt-0.5 text-[13px] text-text-primary">
              {SHIPMENT_STAGE_LABEL[shipment.stage]}
              {shipment.sailing_date ? ` · sailing ${shipment.sailing_date}` : ""}
              {shipment.agreed_inr
                ? ` · ₹${Number(shipment.agreed_inr).toLocaleString("en-IN")}`
                : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {next && (
              <button
                onClick={() => void advance(next)}
                disabled={busy}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
                Mark {SHIPMENT_STAGE_LABEL[next].toLowerCase()}
              </button>
            )}
            <Link
              to="/shipments/in-process"
              className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary grid place-items-center"
            >
              All shipments
            </Link>
          </div>
        </div>

        {/* Where it has got to, at a glance. */}
        <ol className="mt-4 flex flex-wrap items-center gap-1.5">
          {SHIPMENT_STAGES.map((s, i) => {
            const done = i <= at;
            return (
              <li
                key={s}
                className={`text-[11px] px-2 py-1 rounded-full ${
                  done ? "bg-bg-success text-text-success" : "bg-surface-2 text-text-muted"
                }`}
              >
                {SHIPMENT_STAGE_LABEL[s]}
              </li>
            );
          })}
        </ol>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
            <AlertCircle size={13} className="mt-px shrink-0" />
            {error}
          </div>
        )}
      </section>
    );
  }

  // ---- not yet a shipment ----
  return (
    <section className="mt-4 rounded-card border border-border bg-surface-1 p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
        <PackageCheck size={12} /> Start the shipment
      </h2>

      {accepted ? (
        <>
          <p className="text-[12px] text-text-secondary mb-3">
            The customer has accepted. Moving this to in-process creates the shipment and hands it
            to operations — booking, container space and documents follow from there.
          </p>
          <button
            onClick={() => void promote()}
            disabled={busy}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[13px] font-medium"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {busy ? "Starting…" : "Push to in-process shipments"}
          </button>
        </>
      ) : (
        <p className="text-[12px] text-text-muted">
          Available once the customer has accepted a quote. A booking is a commitment somebody
          made — starting one from an enquiry nobody said yes to would put cargo on a sailing on
          the strength of a conversation.
        </p>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
    </section>
  );
}
