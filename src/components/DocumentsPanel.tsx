import { useState } from "react";
import { FileDown, Check, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { RealRecord } from "../services/backend";
import { documentDataFromRecord, documentStatuses, generateDocument } from "../lib/documents";

/**
 * Every document the desk can issue for this customer, with what each one is still
 * waiting for.
 *
 * Listed in shipment order rather than alphabetically, because that is the order they get
 * produced in and the list doubles as a progress view: how far down it you can go before
 * things stop being issuable is exactly how far the booking has actually got.
 *
 * Nothing is hidden and nothing is disabled. A document that cannot be issued yet still
 * generates as a stamped draft naming its gaps — that draft is what the desk sends the
 * customer to chase the missing details, so refusing to produce it would remove the tool
 * that closes the gap.
 */
export default function DocumentsPanel({ record }: { record: RealRecord }) {
  const [open, setOpen] = useState(false);
  const data = documentDataFromRecord(record);
  const statuses = documentStatuses(data);
  const readyCount = statuses.filter((s) => s.ready).length;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={13} className="text-text-muted" /> : <ChevronRight size={13} className="text-text-muted" />}
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Documents
        </span>
        <span className="text-[11px] text-text-muted">
          {readyCount} of {statuses.length} ready to issue
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-1">
          {statuses.map(({ spec, ready, missingLabels, have, need }) => (
            <div
              key={spec.id}
              className={`flex items-start gap-3 rounded border px-2.5 py-2 ${
                ready ? "border-border bg-surface-1" : "border-dashed border-border"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] text-text-primary">{spec.shortName}</span>
                  {ready ? (
                    <Check size={11} className="text-text-success shrink-0" />
                  ) : (
                    <AlertTriangle size={11} className="text-text-warning shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-text-muted">{spec.purpose}</p>
                {!ready && (
                  <p className="mt-0.5 text-[11px] text-text-warning">
                    {have} of {need} — needs: {missingLabels.join(", ")}
                  </p>
                )}
              </div>

              <button
                onClick={() => generateDocument(spec, data)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium ${
                  ready
                    ? "bg-brand text-white hover:bg-brand-dark"
                    : "border border-border text-text-secondary hover:bg-surface-2"
                }`}
              >
                <FileDown size={11} />
                {ready ? "Generate" : "Draft"}
              </button>
            </div>
          ))}

          <p className="pt-1 text-[11px] leading-relaxed text-text-muted">
            Drafts print every unestablished field as TBD and name what is outstanding on
            the document itself. Nothing is inferred from a similar shipment.
          </p>
        </div>
      )}
    </div>
  );
}
