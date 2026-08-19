import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import { auditLog } from "../data/mockData";
import { ShieldCheck } from "lucide-react";

export default function Compliance() {
  return (
    <div>
      <PageHeader
        title="Compliance & audit trail"
        subtitle="Every agent action, negotiation, and CRM write, logged with actor and target."
      />
      {auditLog.map((a) => (
        <RowCard key={a.id}>
          <ShieldCheck size={15} className="text-text-muted shrink-0" />
          <span className="text-xs text-text-secondary w-32">{a.timestamp}</span>
          <span className="text-[13px] text-text-primary w-40">{a.actor}</span>
          <span className="flex-1 text-[13px] text-text-secondary">{a.action}</span>
          <span className="text-xs font-mono text-text-muted">{a.target}</span>
        </RowCard>
      ))}
    </div>
  );
}
