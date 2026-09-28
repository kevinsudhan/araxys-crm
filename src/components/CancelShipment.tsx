import { useEffect, useState } from "react";
import { AlertCircle, Ban, Loader2, RotateCcw } from "lucide-react";
import { failureText } from "../lib/errorText";
import { formatDate } from "../lib/dates";
import { ACCOUNTS_DESK } from "../lib/features";
import { listInvoicesForShipment } from "../services/billing";
import { cancelShipment, listPeople, reopenShipment, type Shipment } from "../services/enquiries";

/**
 * Calling a shipment off, and putting it back on (103).
 *
 * ---------------------------------------------------------------------------
 * CANCEL IS NOT "SEND BACK"
 *
 * Sending a booking back to its enquiry deletes it: right for a booking made
 * too early, and refused once an invoice exists. A job the customer called off
 * after work started is different — there are costs, maybe invoices, a trail
 * somebody will ask about — so it stays, marked cancelled, with the reason. It
 * leaves the in-process board, its customer page says it is cancelled, and
 * nothing more is recorded on it until it is reopened.
 *
 * Invoices are not touched: a tax invoice is undone by a credit note, and the
 * form says how many are waiting for one.
 *
 * REOPENING
 *
 * Puts it back at whatever stage its customer milestones say, with a reason
 * of its own on the timeline.
 * ---------------------------------------------------------------------------
 */
export default function CancelShipment({ shipment: s, onChanged }: { shipment: Shipment; onChanged: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !ACCOUNTS_DESK) return;
    void listInvoicesForShipment(s.id)
      .then((list) => setIssued(list.filter((i) => i.status !== "draft" && i.status !== "cancelled" && i.kind !== "credit_note" && i.kind !== "proforma").length))
      .catch(() => setIssued(null));
  }, [open, s.id]);

  if (s.stage === "cancelled") return null;
  if (s.signed_off_at) {
    return <p className="text-[12px] text-text-muted">Signed off. An admin reopens the sign-off before a finished job can be cancelled.</p>;
  }

  async function go() {
    if (reason.trim().length < 5) return setError("Say why it is being cancelled; the case file and the job show it.");
    setBusy(true);
    setError(null);
    try {
      await cancelShipment(s.id, reason.trim());
      setOpen(false);
      setReason("");
      await onChanged();
    } catch (e) {
      setError(failureText(e, "Could not cancel it.").message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-danger"
      >
        <Ban size={13} /> Cancel the shipment
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-border-strong bg-surface-1 p-4">
      <p className="text-[13px] font-medium text-text-primary">Cancel {s.id}?</p>
      <p className="mt-1 max-w-prose text-[12px] text-text-secondary">
        The job and everything recorded on it stay. It leaves the in-process board, the customer&rsquo;s tracking page says it is cancelled, and
        nothing more can be recorded on it until it is reopened.
      </p>
      {issued !== null && issued > 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
          <AlertCircle size={13} className="mt-px shrink-0" />
          It has {issued} issued invoice{issued === 1 ? "" : "s"}. Cancelling does not touch them: raise a credit note for each on the Invoices tab.
        </p>
      )}
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why — the case file will show this" className="mt-3 h-8 w-full" />
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-bg-danger px-3 text-[12px] font-medium text-text-danger ring-1 ring-inset ring-current hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
          Cancel the shipment
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

/** Across the top of a cancelled job: when, by whom, why — and the way back. */
export function CancelledBanner({ shipment: s, onChanged }: { shipment: Shipment; onChanged: () => Promise<void> | void }) {
  const [who, setWho] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!s.cancelled_by) return setWho(null);
    void listPeople()
      .then((people) => {
        const p = people.find((x) => x.id === s.cancelled_by);
        setWho(p ? p.full_name || p.email : null);
      })
      .catch(() => setWho(null));
  }, [s.cancelled_by]);

  async function go() {
    if (reason.trim().length < 5) return setError("Say why it is back on.");
    setBusy(true);
    setError(null);
    try {
      await reopenShipment(s.id, reason.trim());
      setOpen(false);
      setReason("");
      await onChanged();
    } catch (e) {
      setError(failureText(e, "Could not reopen it.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-text-danger bg-bg-danger px-4 py-3 text-[12.5px] text-text-danger">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex min-w-0 items-start gap-2">
          <Ban size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Cancelled</strong>
            {s.cancelled_at ? ` ${formatDate(s.cancelled_at, { day: "numeric", month: "short", year: "numeric" })}` : ""}
            {who ? ` by ${who}` : ""}
            {s.cancel_reason ? `: ${s.cancel_reason}` : "."}
          </span>
        </p>
        {!open && !s.signed_off_at && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-current px-2.5 text-[11.5px] font-medium hover:opacity-80"
          >
            <RotateCcw size={12} /> Reopen
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Why it is back on"
            className="h-8 min-w-[220px] flex-1 text-text-primary"
            autoFocus
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void go()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            Reopen the shipment
          </button>
          <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg border border-current px-3 text-[12px] hover:opacity-80">
            Keep it cancelled
          </button>
          {error && <p className="basis-full text-[12px]">{error}</p>}
        </div>
      )}
    </div>
  );
}
