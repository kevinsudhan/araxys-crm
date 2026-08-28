import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  LogOut,
  PhoneCall,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { CompanyBrand, PoweredByAraxys } from "../components/Brand";

/**
 * Admin control — placeholder.
 *
 * Deliberately a shell: the panels below describe what belongs here and are
 * wired to nothing. Everything showing a number is marked as such, so nobody
 * demonstrates this page believing the figures are live.
 */
export default function AdminControl() {
  const { session, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="h-14 border-b border-border bg-surface-1 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <CompanyBrand size="sm" />
          <span className="px-2 py-0.5 rounded-full bg-bg-warning text-text-warning text-[10px] font-medium">
            Admin
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[12px] text-text-secondary">
            {session?.name} · administrator
          </span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">
              Admin control
            </h1>
            <p className="mt-1 text-[13px] text-text-secondary">
              System configuration, user access and voice-agent management.
            </p>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-[12px] text-text-accent hover:underline"
          >
            Open the operations CRM
            <ArrowUpRight size={13} />
          </Link>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
          <ShieldCheck size={13} className="mt-px shrink-0" />
          Placeholder screen. The panels below are not wired to the backend and every figure
          shown is illustrative.
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Voice agents" value="2" note="Priya · Arun" icon={PhoneCall} />
          <Stat label="Active users" value="—" note="not wired" icon={Users} />
          <Stat label="Knowledge sources" value="7" note="5 static · 2 live" icon={BookOpen} />
          <Stat label="System status" value="Healthy" note="illustrative" icon={Activity} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Voice agents"
            icon={PhoneCall}
            description="Prompts, greetings, language rules and squad handoff."
            items={[
              "Priya — forwarder desk (agent 717)",
              "Arun — documentation desk (agent 758)",
              "Chennai desk squad — handoff configuration",
            ]}
          />
          <Panel
            title="Users & access"
            icon={Users}
            description="Desk staff, roles and permissions."
            items={["Employee accounts", "Administrator accounts", "Role permissions"]}
          />
          <Panel
            title="Knowledge base"
            icon={BookOpen}
            description="Reference packs the agents read, and the live packs republished after every call."
            items={[
              "Route pricing & negotiation bands",
              "Container specifications",
              "Customer records — republished automatically",
              "Container space — republished automatically",
            ]}
          />
          <Panel
            title="System configuration"
            icon={Settings2}
            description="Integrations, scheduled jobs and data retention."
            items={["SnapServe connection", "Extraction schedule", "Caller data retention"]}
          />
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-6 pb-8">
        <PoweredByAraxys />
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Icon size={13} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-[22px] font-semibold tracking-tight text-text-primary">{value}</p>
      <p className="mt-0.5 text-[11px] text-text-muted">{note}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  description,
  items,
}: {
  title: string;
  icon: React.ElementType;
  description: string;
  items: string[];
}) {
  return (
    <section className="rounded-card border border-border bg-surface-1 p-5">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-text-accent" />
        <h2 className="text-[14px] font-medium text-text-primary">{title}</h2>
      </div>
      <p className="mt-1 text-[12px] text-text-secondary">{description}</p>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-text-secondary"
          >
            {item}
            <span className="text-[10px] text-text-muted">not wired</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
