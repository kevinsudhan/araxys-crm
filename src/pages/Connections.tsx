import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill from "../components/StatusPill";
import { SNAPSERVE_CONFIG, listSquads, getWallet, getWhatsappChannel, getEmailChannel } from "../services/snapserve";

const endpointGroups = [
  { name: "Agents", fns: "list_agents · create_agent · get_agent · toggle_agent" },
  { name: "Calls", fns: "outbound_call · get_call · get_call_logs · end_call" },
  { name: "Campaigns & leads", fns: "list_campaigns · get_campaign · get_website_webhook" },
  { name: "Journeys", fns: "list_journeys · activate_journey · pause_journey" },
  { name: "WhatsApp & email", fns: "get_whatsapp_channel · get_email_channel" },
  { name: "Numbers & squads", fns: "list_phone_numbers · list_squads · list_webcall_links" },
  { name: "Analytics & wallet", fns: "get_analytics_dashboard · get_agent_analytics · get_wallet" },
  { name: "Caller memory", fns: "POST/GET /agents/{id}/caller-memory/{phone}/facts" },
];

export default function Connections() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    Promise.all([listSquads(), getWallet(), getWhatsappChannel(), getEmailChannel()]).then(() => setChecked(true));
  }, []);

  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle="SnapServe endpoint boundary — stubbed for now, wired to dummy data so every page already calls through this layer."
      />

      <div className="rounded-card bg-surface-1 border border-border p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">SnapServe API</p>
            <p className="text-xs text-text-secondary mt-0.5">{SNAPSERVE_CONFIG.baseUrl}</p>
          </div>
          <StatusPill tone={SNAPSERVE_CONFIG.connected ? "success" : "warning"}>
            {SNAPSERVE_CONFIG.connected ? "Connected" : "Not connected — stubbed"}
          </StatusPill>
        </div>
        <p className="text-xs text-text-muted mt-3">
          {checked ? "Service layer responded with dummy data — wiring verified end to end." : "Checking service layer…"}
        </p>
      </div>

      <p className="text-sm font-medium text-text-primary mb-2">CRM ↔ SnapServe sync</p>
      <p className="text-xs text-text-secondary mb-3">
        Both stores are meant to hold the full customer/shipment record — CRM is the system of record, SnapServe is a
        genuine second copy once connected.
      </p>
      {["Shipment facts (status, ETA, demurrage dates)", "Knowledge base documents", "Campaign lead fields", "Call logs & dispositions"].map(
        (item) => (
          <RowCard key={item}>
            <span className="flex-1 text-[13px] text-text-primary">{item}</span>
            <StatusPill tone="warning">Awaiting connection</StatusPill>
          </RowCard>
        )
      )}

      <p className="text-sm font-medium text-text-primary mt-6 mb-2">Endpoint groups (stubbed)</p>
      {endpointGroups.map((g) => (
        <RowCard key={g.name}>
          <span className="w-44 text-[13px] text-text-primary">{g.name}</span>
          <span className="flex-1 text-xs text-text-secondary font-mono truncate">{g.fns}</span>
          <StatusPill tone="neutral">Stub</StatusPill>
        </RowCard>
      ))}
    </div>
  );
}
