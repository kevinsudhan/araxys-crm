import { Search, Bell } from "lucide-react";

export default function Topbar() {
  return (
    <header className="h-14 border-b border-border bg-surface-1 flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="relative w-80">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input placeholder="Search BL number, customer, phone..." className="w-full pl-8" />
      </div>
      <div className="flex items-center gap-4">
        <button className="relative text-text-secondary hover:text-text-primary" aria-label="Notifications">
          <Bell size={17} />
        </button>
        <div className="w-8 h-8 rounded-full bg-bg-accent text-text-accent flex items-center justify-center text-xs font-medium">
          KS
        </div>
      </div>
    </header>
  );
}
