import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill from "../components/StatusPill";
import { shipments } from "../data/mockData";

export default function ShipmentsCompleted() {
  const navigate = useNavigate();
  const list = shipments.filter((s) => s.stage === "completed");

  return (
    <div>
      <PageHeader title="Completed shipments" subtitle="Delivered shipments, kept for history, billing, and audit." />
      {list.map((s) => (
        <RowCard key={s.id} onClick={() => navigate(`/shipments/${s.id}`)}>
          <span className="w-32 text-[13px] font-mono text-text-primary">{s.blNumber}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text-primary truncate">{s.company}</p>
            <p className="text-xs text-text-secondary truncate">{s.origin} → {s.destination} · {s.carrier}</p>
          </div>
          <span className="text-xs text-text-secondary w-28">Delivered {s.deliveredDate}</span>
          <span className="text-xs text-text-secondary w-20 text-right">₹{s.quoteAmount.toLocaleString("en-IN")}</span>
          <StatusPill tone="success">Delivered</StatusPill>
        </RowCard>
      ))}
    </div>
  );
}
