import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill from "../components/StatusPill";
import { shipments } from "../data/mockData";

export default function Documentation() {
  const missing = shipments.flatMap((s) =>
    s.documents.filter((d) => d.status === "missing").map((d) => ({ shipment: s, doc: d }))
  );
  const generated = shipments.flatMap((s) =>
    s.documents.filter((d) => d.status === "generated").map((d) => ({ shipment: s, doc: d }))
  );

  return (
    <div>
      <PageHeader
        title="Documentation"
        subtitle="Generation, collection, and missing-document chasing across every shipment."
      />

      <p className="text-sm font-medium text-text-primary mb-2">Missing — chasing</p>
      {missing.length === 0 && <p className="text-sm text-text-muted mb-4">Nothing outstanding.</p>}
      {missing.map(({ shipment, doc }, i) => (
        <RowCard key={i}>
          <span className="w-32 text-[13px] font-mono text-text-primary">{shipment.blNumber}</span>
          <span className="flex-1 text-[13px] text-text-primary">{doc.name}</span>
          <span className="text-xs text-text-secondary w-28">Due {doc.dueDate}</span>
          <button className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2">
            Send WhatsApp checklist
          </button>
          <StatusPill tone="danger">Missing</StatusPill>
        </RowCard>
      ))}

      <p className="text-sm font-medium text-text-primary mt-6 mb-2">Auto-generated</p>
      {generated.map(({ shipment, doc }, i) => (
        <RowCard key={i}>
          <span className="w-32 text-[13px] font-mono text-text-primary">{shipment.blNumber}</span>
          <span className="flex-1 text-[13px] text-text-primary">{doc.name}</span>
          <button className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2">Download</button>
          <StatusPill tone="accent">Generated</StatusPill>
        </RowCard>
      ))}

      <button className="mt-6 text-xs px-3 py-2 rounded-lg border border-border hover:bg-surface-2">
        + Generate commercial invoice / packing list
      </button>
    </div>
  );
}
