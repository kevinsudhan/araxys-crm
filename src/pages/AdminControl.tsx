import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  LogOut,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { CompanyBrand, PoweredByAraxys } from "../components/Brand";

/**
 * The administrator's landing page.
 *
 * Mostly still a shell, and it says so. The one live thing on it is the link to
 * team oversight, which is built entirely on real rows. The remaining panels
 * describe what belongs here and are wired to nothing, so the warning above
 * them stays until each is replaced by something that reads a table.
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

        {/*
          The one thing on this page that is real. Everything below it is still
          a placeholder and says so; this goes to a page built on live rows.
        */}
        <Link
          to="/oversight"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 card p-5 hover:border-border-strong transition-colors"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[15px] font-medium text-text-primary">
              <Activity size={15} className="text-brand" />
              Team oversight
            </p>
            <p className="mt-1 text-[13px] text-text-secondary max-w-prose">
              Every enquiry, when it came in, who took it on and how long that took. Open one to
              read everything that has been done to it and by whom.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand text-white text-[12px] font-medium shrink-0">
            Open
            <ArrowUpRight size={13} />
          </span>
        </Link>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Users & access"
            icon={Users}
            description="Desk staff, roles and permissions."
            items={["Employee accounts", "Administrator accounts", "Role permissions"]}
          />
          <Panel
            title="System configuration"
            icon={Settings2}
            description="Integrations, scheduled jobs and data retention."
            items={["Mailbox connection", "Document templates", "Data retention"]}
          />
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-6 pb-8">
        <PoweredByAraxys />
      </footer>
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
    <section className="card p-5">
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
