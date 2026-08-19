import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill from "../components/StatusPill";
import ChannelBadge from "../components/ChannelBadge";
import { complaints } from "../data/mockData";

const toneFor = { open: "warning", escalated: "danger", resolved: "success" } as const;

export default function Complaints() {
  return (
    <div>
      <PageHeader
        title="Complaints & exceptions"
        subtitle="Resolved on the call where possible, escalated with a real next step otherwise — never a bare 'we'll get back to you.'"
      />
      {complaints.map((c) => (
        <div key={c.id} className="mb-2">
          <RowCard>
            <ChannelBadge channel={c.channel} />
            <span className="w-32 text-[13px] font-mono text-text-primary">{c.blNumber}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-text-primary">{c.customerName}</p>
              <p className="text-xs text-text-secondary capitalize">{c.type}</p>
            </div>
            <StatusPill tone={toneFor[c.status]}>{c.status}</StatusPill>
          </RowCard>
          <div className="rounded-card bg-surface-2 px-4 py-2.5 -mt-2 mb-2 text-xs text-text-secondary">
            {c.note}
            {c.resolutionNote && <p className="text-text-success mt-1">Resolved: {c.resolutionNote}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
