import PageHeader from "../components/PageHeader";
import MetricCard from "../components/MetricCard";
import { kpis, callsPerWeek, inboundRequests } from "../data/mockData";
import type { Channel } from "../types";

const channelLabels: Record<Channel, string> = { voice: "Voice", email: "Email", whatsapp: "WhatsApp", web_form: "Web form" };

export default function Analytics() {
  const max = Math.max(...callsPerWeek);
  const channelCounts = (Object.keys(channelLabels) as Channel[]).map((c) => ({
    channel: c,
    count: inboundRequests.filter((r) => r.channel === c).length,
  }));
  const maxChannel = Math.max(...channelCounts.map((c) => c.count), 1);

  return (
    <div>
      <PageHeader title="Analytics & reporting" subtitle="What the forwarder is paying for at renewal time." />

      <div className="grid grid-cols-4 gap-3 mb-6">
        <MetricCard label="Demurrage avoided" value={kpis.demurrageAvoidedInr === null ? "—" : `₹${(kpis.demurrageAvoidedInr / 1000).toFixed(0)}k`} />
        <MetricCard label="Calls deflected" value={String(kpis.callsDeflected ?? "—")} />
        <MetricCard label="Quote → booking" value={kpis.quoteToBookingPct === null ? "—" : `${kpis.quoteToBookingPct}%`} />
        <MetricCard label="Active shipments" value={String(kpis.activeShipments ?? "—")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-card bg-surface-1 border border-border p-4">
          <p className="text-sm font-medium text-text-primary mb-3">Calls per week</p>
          <div className="flex items-end gap-3 h-32">
            {callsPerWeek.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className="w-full bg-bg-accent rounded-t"
                  style={{ height: `${(v / max) * 100}%` }}
                />
                <span className="text-[11px] text-text-muted">W{i + 1}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-card bg-surface-1 border border-border p-4">
          <p className="text-sm font-medium text-text-primary mb-3">Inbound requests by channel</p>
          <div className="flex flex-col gap-3">
            {channelCounts.map((c) => (
              <div key={c.channel} className="flex items-center gap-3">
                <span className="text-xs text-text-secondary w-16">{channelLabels[c.channel]}</span>
                <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div className="h-full bg-brand" style={{ width: `${(c.count / maxChannel) * 100}%` }} />
                </div>
                <span className="text-xs text-text-secondary w-4 text-right">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
