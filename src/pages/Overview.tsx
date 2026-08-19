import PageHeader from "../components/PageHeader";
import MetricCard from "../components/MetricCard";
import RowCard from "../components/RowCard";
import StatusPill from "../components/StatusPill";
import { kpis, shipments, inboundRequests } from "../data/mockData";
import { Link } from "react-router-dom";

export default function Overview() {
  const recent = [
    { text: "MSCU7291044 — certificate of origin flagged missing, WhatsApp checklist sent", tone: "warning" as const },
    { text: "TCLU2201983 — space found in 70% full Jebel Ali container, booking locked", tone: "success" as const },
    { text: "MSCU5510221 — vessel delayed 9h, customer notified via call", tone: "neutral" as const },
    { text: "req-3 (Vantage Traders) — quote accepted via WhatsApp intake", tone: "success" as const },
  ];

  return (
    <div>
      <PageHeader title="Ops overview" subtitle="Snapshot across inbound requests, active shipments, and support." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Demurrage avoided" value={`₹${(kpis.demurrageAvoidedInr / 1000).toFixed(0)}k`} />
        <MetricCard label="Calls deflected" value={String(kpis.callsDeflected)} />
        <MetricCard label="Quote → booking" value={`${kpis.quoteToBookingPct}%`} />
        <MetricCard label="Active shipments" value={String(kpis.activeShipments)} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Link to="/inbound" className="block">
          <MetricCard label="Open inbound requests" value={String(kpis.inboundRequestsOpen)} hint="Needs quote or human review" />
        </Link>
        <Link to="/shipments/in-process" className="block">
          <MetricCard label="In-process shipments" value={String(shipments.filter((s) => s.stage === "in_process").length)} hint="Booked through delivery" />
        </Link>
        <Link to="/complaints" className="block">
          <MetricCard label="Open complaints" value={String(kpis.openComplaints)} hint="Billing, damage, delay" />
        </Link>
      </div>

      <p className="text-sm font-medium text-text-primary mb-2">Recent activity</p>
      {recent.map((r, i) => (
        <RowCard key={i}>
          <span className="flex-1 text-[13px] text-text-primary">{r.text}</span>
          <StatusPill tone={r.tone}>{r.tone === "success" ? "Resolved" : r.tone === "warning" ? "At risk" : "Updated"}</StatusPill>
        </RowCard>
      ))}

      <p className="text-sm font-medium text-text-primary mt-6 mb-2">Newest inbound requests</p>
      {inboundRequests.slice(0, 3).map((r) => (
        <RowCard key={r.id}>
          <span className="flex-1 text-[13px] text-text-primary">{r.company} — {r.origin} → {r.destination}</span>
          <span className="text-xs text-text-secondary">{r.status}</span>
        </RowCard>
      ))}
    </div>
  );
}
