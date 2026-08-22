import { useEffect, useState } from "react";
import { PhoneIncoming, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import RowCard from "./RowCard";
import StatusPill from "./StatusPill";
import CallHistoryPanel from "./CallHistoryPanel";
import { getRealRecords, type RealRecord } from "../services/backend";

/**
 * Real customers, kept visually separate from the seeded demo data above it.
 *
 * The separation is the point: during a build it must be obvious at a glance which rows
 * came from an actual phone call and which are scaffolding, so a demo record is never
 * mistaken for a real customer or vice versa.
 */
export default function RealRecordsSection({ stage }: { stage: "processing" | "processed" }) {
  const [records, setRecords] = useState<RealRecord[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

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
    const t = setInterval(refresh, 8000); // new calls should appear without a manual reload
    return () => clearInterval(t);
  }, [stage]);

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-px flex-1 bg-border-strong" />
        <span className="text-[11px] uppercase tracking-wide text-text-secondary font-medium">Real data</span>
        <div className="h-px flex-1 bg-border-strong" />
      </div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-text-muted">
          Live customers captured from real calls. Everything above this line is seeded demo data.
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
          No real {stage} customers yet. They appear here automatically after a call.
        </p>
      )}

      {records.map((r) => (
        <div key={r.ref}>
        <RowCard onClick={() => setExpanded(expanded === r.ref ? null : r.ref)}>
          <span className="text-text-muted shrink-0">
            {expanded === r.ref ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
        {expanded === r.ref && <CallHistoryPanel phone={r.phone} />}
        </div>
      ))}
    </div>
  );
}
