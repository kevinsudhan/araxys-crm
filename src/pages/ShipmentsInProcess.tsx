import { useNavigate } from "react-router-dom";
import { PhoneIncoming } from "lucide-react";
import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill, { toneForShipmentStatus } from "../components/StatusPill";
import { shipments } from "../data/mockData";

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function ShipmentsInProcess() {
  const navigate = useNavigate();
  const list = shipments.filter((s) => s.stage === "in_process");

  return (
    <div>
      <PageHeader
        title="In-process shipments"
        subtitle="Booked through delivery — the one shared shipment record, live from intake to customs clearance."
      />
      {list.map((s) => {
        const ce = s.callExtraction;
        return (
          <RowCard key={s.id} onClick={() => navigate(`/shipments/${s.id}`)}>
            {ce && (
              <span title="Sourced from a live call">
                <PhoneIncoming size={14} className="text-text-accent shrink-0" />
              </span>
            )}
            <span className="w-32 text-[13px] font-mono text-text-primary">{s.blNumber}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-text-primary truncate">{s.company}</p>
              <p className="text-xs text-text-secondary truncate">{s.origin} → {s.destination} · {s.carrier}</p>
            </div>
            {ce?.priceAskedInr !== undefined && ce?.priceNegotiatedInr !== undefined ? (
              <span className="text-xs text-text-secondary w-32 text-right">
                <span className="line-through text-text-muted">{fmtInr(ce.priceAskedInr)}</span>{" "}
                <span className="text-text-success">{fmtInr(ce.priceNegotiatedInr)}</span>
              </span>
            ) : (
              <span className="text-xs text-text-secondary w-24">ETA {s.etaDate}</span>
            )}
            {s.freeDaysRemaining !== undefined && (
              <span className="text-xs text-text-secondary w-24">{s.freeDaysRemaining}d free left</span>
            )}
            <StatusPill tone={toneForShipmentStatus(s.status)}>{s.status.replace(/_/g, " ")}</StatusPill>
          </RowCard>
        );
      })}
    </div>
  );
}
