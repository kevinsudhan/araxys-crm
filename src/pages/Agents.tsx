import PageHeader from "../components/PageHeader";
import StatusPill from "../components/StatusPill";
import { agentConfigs } from "../data/mockData";
import { ArrowRight, User, Database, Headset, FileText } from "lucide-react";

const roleIcon = { forwarder_rep: User, ground_truth: Database, human_ops: Headset } as const;
const roleLabel = { forwarder_rep: "Forwarder-rep", ground_truth: "Ground-truth", human_ops: "Human ops" } as const;

const generalInstructions = [
  "Certificate of origin must be submitted within 5 days of container departure or demurrage risk is flagged.",
  "Truck pickup requires 24h advance notice to the trucking team.",
  "Customs broker escalations route to the Documentation desk, not the forwarder-rep agent.",
  "Negotiated rates outside the floor/ceiling band always require human sign-off before confirming to the customer.",
];

export default function Agents() {
  return (
    <div>
      <PageHeader
        title="Agents & squads"
        subtitle="The forwarder-rep persona is the only agent a customer ever talks to; the ground-truth agent and human ops sit behind it."
      />

      <div className="flex items-center gap-3 mb-6">
        {agentConfigs.map((a, i) => {
          const Icon = roleIcon[a.role];
          return (
            <div key={a.id} className="flex items-center gap-3">
              <div className="rounded-card bg-surface-1 border border-border p-4 w-52">
                <p className="text-xs text-text-secondary flex items-center gap-1.5 mb-1">
                  <Icon size={14} /> {roleLabel[a.role]}
                </p>
                <p className="text-[14px] font-medium text-text-primary">{a.name}</p>
                <p className="text-xs text-text-muted mt-1">{a.languages.join(", ")}</p>
                <StatusPill tone={a.status === "active" ? "success" : "neutral"}>{a.status}</StatusPill>
              </div>
              {i < agentConfigs.length - 1 && <ArrowRight size={16} className="text-text-muted shrink-0" />}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-card bg-surface-1 border border-border p-4">
          <p className="text-sm font-medium text-text-primary mb-3">Negotiation guardrails</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-secondary w-20">Floor / ceiling</span>
            <input type="range" className="flex-1" defaultValue={30} readOnly />
            <StatusPill tone="neutral">₹28,000 – ₹34,000</StatusPill>
          </div>
          <p className="text-[11px] text-text-muted mt-2">Outside this band, the call escalates to a human before confirming.</p>

          <p className="text-sm font-medium text-text-primary mt-5 mb-2 flex items-center gap-1.5">
            <FileText size={14} /> Knowledge base
          </p>
          <div className="flex flex-col gap-1.5">
            {agentConfigs[0].knowledgeBase?.map((k) => (
              <p key={k} className="text-[13px] text-text-secondary">{k}</p>
            ))}
          </div>
        </div>

        <div className="rounded-card bg-surface-1 border border-border p-4">
          <p className="text-sm font-medium text-text-primary mb-3">General instructions to clients & external agents</p>
          <ul className="flex flex-col gap-2.5">
            {generalInstructions.map((instr, i) => (
              <li key={i} className="text-[13px] text-text-secondary leading-relaxed pl-3 border-l-2 border-border">
                {instr}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
