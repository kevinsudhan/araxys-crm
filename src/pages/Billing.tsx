import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill from "../components/StatusPill";
import { invoices } from "../data/mockData";

const toneFor = { paid: "success", pending: "warning", disputed: "danger" } as const;

export default function Billing() {
  return (
    <div>
      <PageHeader title="Billing & invoices" subtitle="Invoice status and query handling per shipment." />
      {invoices.map((inv) => (
        <RowCard key={inv.id}>
          <span className="w-32 text-[13px] font-mono text-text-primary">{inv.blNumber}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text-primary">{inv.customerName}</p>
            {inv.queryNote && <p className="text-xs text-text-danger">{inv.queryNote}</p>}
          </div>
          <span className="text-xs text-text-secondary w-24">Due {inv.dueDate}</span>
          <span className="text-[13px] text-text-primary w-24 text-right">
            {inv.currency} {inv.amount.toLocaleString("en-IN")}
          </span>
          <StatusPill tone={toneFor[inv.status]}>{inv.status}</StatusPill>
        </RowCard>
      ))}
    </div>
  );
}
