import { NavLink } from "react-router-dom";
import { CompanyBrand, PoweredByAraxys } from "../components/Brand";
import {
  LayoutDashboard,
  Inbox,
  PackageSearch,
  PackageCheck,
  Boxes,
  FileCheck2,
  PhoneCall,
  MessageSquareWarning,
  Receipt,
  Users,
  BarChart3,
  ShieldCheck,
  Plug,
  BookOpen,
  Workflow,} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  { items: [{ to: "/", label: "Overview", icon: LayoutDashboard }] },
  {
    title: "Pipeline",
    items: [
      { to: "/orchestration", label: "Agent orchestration", icon: Workflow },
      { to: "/inbound", label: "Inbound requests", icon: Inbox },
      { to: "/shipments/in-process", label: "In-process shipments", icon: PackageSearch },
      { to: "/shipments/completed", label: "Completed shipments", icon: PackageCheck },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/space-containers", label: "Space & containers", icon: Boxes },
      { to: "/documentation", label: "Documentation", icon: FileCheck2 },
      { to: "/live-calls", label: "Live calls & updates", icon: PhoneCall },
      { to: "/complaints", label: "Complaints", icon: MessageSquareWarning },
      { to: "/billing", label: "Billing & invoices", icon: Receipt },
    ],
  },
  {
    title: "Agents",
    items: [
      { to: "/agents", label: "Agents & squads", icon: Users },
      { to: "/knowledge-base", label: "Knowledge base", icon: BookOpen },
    ],
  },
  {
    title: "Insights",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/compliance", label: "Compliance & audit", icon: ShieldCheck },
    ],
  },
  {
    title: "Setup",
    items: [{ to: "/connections", label: "Connections", icon: Plug }],
  },
];

export default function Sidebar() {
  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 border-r border-border bg-surface-1 flex flex-col">
      <div className="px-5 py-5">
        <CompanyBrand size="sm" descriptor="Freight ops CRM" />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group, gi) => (
          <div key={gi} className="mb-4">
            {group.title && (
              <p className="eyebrow px-2.5 mb-1.5">{group.title}</p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] mb-0.5 transition-colors duration-150 ${
                    isActive
                      ? "bg-surface-2 text-text-primary font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-brand"
                      : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                  }`
                }
              >
                <item.icon size={15} strokeWidth={1.9} className="flex-none" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-border">
        <PoweredByAraxys />
      </div>
    </aside>
  );
}
