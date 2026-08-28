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
  BarChart3,
  Plug,
  BookOpen,
} from "lucide-react";

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
    title: "Knowledge",
    items: [{ to: "/knowledge-base", label: "Knowledge base", icon: BookOpen }],
  },
  {
    title: "Insights",
    items: [{ to: "/analytics", label: "Analytics", icon: BarChart3 }],
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
              <p className="px-2 mb-1 text-[11px] uppercase tracking-wide text-text-muted font-medium">
                {group.title}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] mb-0.5 transition-colors ${
                    isActive
                      ? "bg-surface-2 text-text-primary font-medium"
                      : "text-text-secondary hover:bg-surface-2"
                  }`
                }
              >
                <item.icon size={16} />
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
