import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill from "../components/StatusPill";
import { callRecords } from "../data/mockData";

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LiveCalls() {
  return (
    <div>
      <PageHeader
        title="Live calls & updates"
        subtitle="Forwarder-rep agent conversations, with proactive status pushes and squad handoffs visible in real time."
      />
      {callRecords.map((c) => (
        <div key={c.id} className="mb-2">
          <RowCard>
            <StatusPill tone={c.status === "live" ? "danger" : "neutral"}>{c.status === "live" ? "Live" : "Ended"}</StatusPill>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-text-primary">{c.phone} · {c.agent}</p>
              {c.blNumber && <p className="text-xs text-text-secondary">{c.blNumber} · {c.customerName}</p>}
            </div>
            <span className="text-xs text-text-secondary w-14 text-right">{formatDuration(c.durationSec)}</span>
          </RowCard>
          <div className="rounded-card bg-surface-2 px-4 py-2.5 -mt-2 mb-2 text-xs text-text-secondary">
            "{c.transcriptSnippet}"
            {c.squadHandoff && <StatusPill tone="accent"> → {c.squadHandoff}</StatusPill>}
            {c.disposition && !c.squadHandoff && <StatusPill tone="success"> {c.disposition}</StatusPill>}
          </div>
        </div>
      ))}
    </div>
  );
}
