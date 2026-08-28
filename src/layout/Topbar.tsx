import { useEffect, useRef, useState } from "react";
import { Search, Bell, LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function Topbar() {
  const { session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on an outside click, so the menu does not sit open behind the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const initials = (session?.name ?? "")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

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

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-8 h-8 rounded-full bg-bg-accent text-text-accent flex items-center justify-center text-xs font-medium hover:ring-2 hover:ring-border-strong"
            aria-label="Account menu"
            aria-expanded={open}
          >
            {initials || "?"}
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-52 rounded-card border border-border bg-surface-1 shadow-lg py-1">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-[13px] font-medium text-text-primary">{session?.name}</p>
                <p className="text-[11px] text-text-muted capitalize">{session?.role}</p>
              </div>
              <button
                onClick={signOut}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
