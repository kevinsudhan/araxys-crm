import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../lib/auth";

/**
 * The bar across the top: navigation trigger, search, and the account menu.
 *
 * ---------------------------------------------------------------------------
 * THE SEARCH BOX DOES SOMETHING NOW
 *
 * It used to be an input with no handler — it accepted typing, discarded it,
 * and looked exactly like a search that was working. A control that pretends is
 * worse than one that is absent, because somebody eventually types a reference
 * into it and concludes the record is gone.
 *
 * It submits to the enquiries list, which reads `?q=` and filters on reference,
 * customer, company, route and cargo. That is a real answer over the real
 * table, and the placeholder now names the fields it actually searches.
 *
 * On small screens it collapses to an icon that expands over the bar, because
 * a full-width search plus a menu button plus an avatar does not fit at 375px
 * and shrinking all three makes each of them hard to hit.
 * ---------------------------------------------------------------------------
 */
export default function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on an outside click, so the menu does not sit open behind the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // An expanded search that is not focused is just a box in the way.
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const initials = (session?.name ?? "")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/enquiries?q=${encodeURIComponent(q)}` : "/enquiries");
    setSearchOpen(false);
  }

  return (
    <header className="h-14 shrink-0 border-b border-border bg-surface-1/95 backdrop-blur supports-[backdrop-filter]:bg-surface-1/80 flex items-center gap-3 px-4 sm:px-6 sticky top-0 z-20">
      <button
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="lg:hidden -ml-1 rounded-lg p-2 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        <Menu size={18} />
      </button>

      {/* Desktop: always present. Mobile: an icon that expands over the bar. */}
      <form onSubmit={submit} className="hidden sm:block relative w-full max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search reference, customer, route, cargo…"
          aria-label="Search enquiries"
          className="w-full pl-8 h-9"
        />
      </form>

      {searchOpen && (
        <form onSubmit={submit} className="sm:hidden absolute inset-x-0 top-0 h-14 bg-surface-1 flex items-center gap-2 px-4 z-10">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Reference, customer, route…"
              aria-label="Search enquiries"
              className="w-full pl-8 h-9"
            />
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            aria-label="Close search"
            className="rounded-lg p-2 text-text-secondary hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </form>
      )}

      <div className="flex-1 sm:hidden" />

      <div className="flex items-center gap-2 sm:gap-3 ml-auto">
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="sm:hidden rounded-lg p-2 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >
          <Search size={17} />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-8 h-8 rounded-full bg-bg-accent text-text-accent flex items-center justify-center text-xs font-medium hover:ring-2 hover:ring-border-strong transition-shadow"
            aria-label="Account menu"
            aria-expanded={open}
          >
            {initials || "?"}
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-56 card shadow-lg py-1">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-[13px] font-medium text-text-primary truncate">{session?.name}</p>
                <p className="text-[11px] text-text-muted truncate">{session?.email}</p>
                <p className="text-[11px] text-text-muted capitalize mt-0.5">{session?.role}</p>
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
