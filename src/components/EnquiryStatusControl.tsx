import { useState } from "react";
import { Loader2, RotateCcw, XCircle } from "lucide-react";
import { failureText } from "../lib/errorText";
import { CLOSE_REASONS, STATUS_TONE, canClose, canReopen, reopenedStatus } from "../lib/enquiryStatus";
import { STATUS_LABEL, closeEnquiry, reopenEnquiry, type Enquiry, type Quote } from "../services/enquiries";

/**
 * Where an enquiry stands, and the two things a person decides about it: that
 * it is over without a job (closed, with the reason), or that it is not
 * (reopened). Quoting, accepting and booking move it themselves; these are
 * the answers no quotation gives.
 */
export default function EnquiryStatusControl({
  enquiry,
  quotes,
  shipped,
  onChanged,
}: {
  enquiry: Enquiry;
  quotes: Quote[];
  /** A booking exists: it is cancelled on the shipment, not closed here. */
  shipped: boolean;
  onChanged: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState<string>(CLOSE_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setClosing(false);
      setNote("");
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(false);
    }
  }

  const status = enquiry.status;
  const needsNote = reason === "Other" || reason === "Duplicate of another enquiry";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>

      {!closing && !shipped && canClose(status) && (
        <button
          type="button"
          onClick={() => setClosing(true)}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] text-text-muted hover:bg-surface-2 hover:text-text-primary"
        >
          <XCircle size={12} /> Close enquiry
        </button>
      )}

      {!shipped && canReopen(status) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(() => reopenEnquiry(enquiry.ref, reopenedStatus(quotes)))}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-surface-1 px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reopen
        </button>
      )}

      {closing && (
        <div className="mt-1 w-72 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-surface-1 p-3 text-left shadow-sm">
          <p className="text-[12px] font-medium text-text-primary">Close without a job?</p>
          <p className="mt-0.5 text-[11.5px] text-text-muted">It leaves the open list; the timeline keeps why. It can be reopened.</p>
          <label className="mt-2 block text-[11.5px] text-text-secondary">
            Why
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-8 w-full text-[12px]">
              {CLOSE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-[11.5px] text-text-secondary">
            {needsNote ? "Say which, or what" : "Note (optional)"}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder={reason === "Duplicate of another enquiry" ? "e.g. ALG09008-26" : ""}
              className="mt-1 h-8 w-full text-[12px]"
            />
          </label>
          {error && <p className="mt-2 text-[11.5px] text-text-danger">{error}</p>}
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setClosing(false)} className="h-7 rounded-lg px-2.5 text-[12px] text-text-secondary hover:text-text-primary">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || (needsNote && !note.trim())}
              onClick={() => void act(() => closeEnquiry(enquiry.ref, reason, note))}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {busy && <Loader2 size={12} className="animate-spin" />} Close it
            </button>
          </div>
        </div>
      )}
      {!closing && error && <p className="max-w-xs text-[11.5px] text-text-danger">{error}</p>}
    </div>
  );
}
