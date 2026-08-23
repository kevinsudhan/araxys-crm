import { useState } from "react";
import { ArrowRight, CalendarCheck, AlertTriangle } from "lucide-react";
import { setRecordStage, type RealRecord } from "../services/backend";

/**
 * Moves an enquiry into the booking pipeline, and a booking to delivered.
 *
 * The sailing date is asked for here rather than assumed, because it is the thing that
 * makes a booking a booking. An agent hearing "yes, go ahead" on a call is not the same
 * as the desk having space on a named sailing at an agreed rate — so this is a human
 * action, and the date has to be on the record before it can happen. The server enforces
 * the same rule; this form exists so the requirement is visible rather than arriving as
 * a rejected request.
 */
export default function StageAction({
  record,
  onChanged,
}: {
  record: RealRecord;
  onChanged: () => void;
}) {
  const [date, setDate] = useState(record.sailingDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (record.stage === "processed") return null;

  async function move(stage: "processing" | "processed") {
    setBusy(true);
    setError(null);
    try {
      await setRecordStage(record.ref, stage, stage === "processing" ? date || undefined : undefined);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the record");
    } finally {
      setBusy(false);
    }
  }

  if (record.stage === "processing") {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface-1 px-4 py-3">
        <span className="text-[13px] text-text-secondary">
          In process since {record.processingStartedAt?.slice(0, 10) ?? "—"}
          {record.sailingDate ? ` · sailing ${record.sailingDate}` : ""}
        </span>
        <button
          onClick={() => move("processed")}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium border border-border text-text-primary hover:bg-surface-2 disabled:opacity-50"
        >
          Mark delivered <ArrowRight size={12} />
        </button>
        {error && (
          <p className="w-full text-[11px] text-text-danger flex items-center gap-1">
            <AlertTriangle size={11} /> {error}
          </p>
        )}
      </div>
    );
  }

  const ready = Boolean(date);

  return (
    <div className="mb-5 rounded-card border border-border bg-surface-1 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-text-muted mb-1">
            Confirmed sailing date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-border bg-surface-0 px-2 py-1.5 text-[13px] text-text-primary"
          />
        </div>

        <button
          onClick={() => move("processing")}
          disabled={!ready || busy}
          title={ready ? undefined : "Confirm the sailing date first"}
          className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
            ready
              ? "bg-brand text-white hover:bg-brand-dark"
              : "border border-border text-text-muted cursor-not-allowed"
          } disabled:opacity-60`}
        >
          <CalendarCheck size={12} />
          {busy ? "Moving…" : "Start processing"}
          <ArrowRight size={12} />
        </button>

        <p className="text-[11px] text-text-muted max-w-md">
          {ready
            ? "Moves this enquiry to in-process shipments and pushes the new stage to the agent's caller memory."
            : "A booking needs a sailing date the desk will stand behind. Confirm one to enable this."}
        </p>
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-text-danger flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}
    </div>
  );
}
