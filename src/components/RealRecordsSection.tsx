import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PhoneIncoming, RefreshCw, ChevronRight } from "lucide-react";
import RowCard from "./RowCard";
import StatusPill from "./StatusPill";
import { getRealRecords, type RealRecord, type RecordStage } from "../services/backend";

/**
 * Real customers, kept visually separate from the seeded demo data above it.
 *
 * The separation is the point: during a build it must be obvious at a glance which rows
 * came from an actual phone call and which are scaffolding, so a demo record is never
 * mistaken for a real customer or vice versa.
 *
 * A row opens the record as a page rather than expanding in place. It used to unfold into
 * the fields and the call history, which worked while that was all there was — now there
 * is also the container, the timeline and twelve documents, and none of that belongs
 * inside a list row.
 */
export default function RealRecordsSection({
  stage,
  title = "Real data",
  blurb = "Live customers captured from real calls. Everything above this line is seeded demo data.",
  emptyLabel,
}: {
  stage: RecordStage;
  title?: string;
  blurb?: string;
  emptyLabel?: string;
}) {
  const navigate = useNavigate();
  const [records, setRecords] = useState<RealRecord[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const r = await getRealRecords();
      setRecords(r.records.filter((x) => x.stage === stage));
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // 4s, not 8: SnapServe now webhooks us the moment a call ends, so the record is
    // usually in Postgres within seconds. The old interval was the slowest link in an
    // otherwise near-instant path.
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [stage]);

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-px flex-1 bg-border-strong" />
        <span className="text-[11px] uppercase tracking-wide text-text-secondary font-medium">{title}</span>
        <div className="h-px flex-1 bg-border-strong" />
      </div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-text-muted">
          {blurb}
        </p>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {offline && (
        <p className="text-[13px] text-text-muted py-4">
          Backend not reachable — start it with <code>npm run server</code> to see real records.
        </p>
      )}

      {!offline && !loading && records.length === 0 && (
        <p className="text-[13px] text-text-muted py-4">
          {emptyLabel ?? `No real ${stage} customers yet. They appear here automatically after a call.`}
        </p>
      )}

      {records.map((r) => (
        <RowCard key={r.ref} onClick={() => navigate(`/records/${encodeURIComponent(r.ref)}`)}>
          <span className="text-text-muted shrink-0">
            <ChevronRight size={14} />
          </span>
          <span title="Captured from a real call">
            <PhoneIncoming size={14} className="text-text-accent shrink-0" />
          </span>
          <span className="w-32 text-[13px] font-mono text-text-primary">{r.blNumber ?? r.ref}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text-primary truncate">{r.company ?? r.customerName ?? "Unnamed caller"}</p>
            <p className="text-xs text-text-secondary truncate">
              {r.origin && r.destination ? `${r.origin} → ${r.destination}` : "Route not confirmed"}
              {r.cargoDescription ? ` · ${r.cargoDescription}` : ""}
            </p>
          </div>
          <span className="text-xs text-text-secondary w-32 truncate">{r.phone}</span>
          {r.agreedAmountInr ? (
            <span className="text-xs text-text-success w-24 text-right">
              ₹{r.agreedAmountInr.toLocaleString("en-IN")}
            </span>
          ) : r.quotedAmountInr ? (
            <span className="text-xs text-text-secondary w-24 text-right">
              ₹{r.quotedAmountInr.toLocaleString("en-IN")}
            </span>
          ) : (
            <span className="w-24" />
          )}
          {!r.blNumber && <StatusPill tone="warning">No BL yet</StatusPill>}
          <StatusPill tone={r.stage === "processed" ? "success" : "accent"}>{r.stage}</StatusPill>
        </RowCard>
      ))}
    </div>
  );
}
