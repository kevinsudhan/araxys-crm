import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * A dropdown that belongs to this interface.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A NATIVE SELECT
 *
 * Because the browser draws the open list, not the page. A native select shows
 * an operating-system menu: system font, system row height, a bright blue
 * highlight that exists nowhere else in this product, and no relationship to
 * the surface it opened from. Closed it looks fine; open it looks like a
 * different application, which is exactly where it was noticed.
 *
 * The cost is that everything the native control gave away for free has to be
 * built: keyboard navigation, focus handling, screen-reader roles and closing
 * behaviour. All of that is below, and none of it is optional — a dropdown you
 * cannot reach with a keyboard is worse than an ugly one.
 *
 * WHAT IS DELIBERATELY MISSING
 *
 * No search box, no multi-select, no async loading, no grouping. Every list in
 * this product is a handful of people or a fixed set of channels, and each of
 * those features costs a branch in the keyboard handling that would then need
 * testing against a case nobody has.
 * ---------------------------------------------------------------------------
 */

export interface SelectOption {
  value: string;
  label: string;
  /** A second line, for the thing that distinguishes two similar labels. */
  hint?: string;
}

export default function Select({
  value,
  options,
  onChange,
  label,
  className,
  align = "left",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Read to assistive tech, since the trigger shows the value, not the field. */
  label: string;
  className?: string;
  /** Which edge the list lines up with when it is wider than the trigger. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  /** Which row the keyboard is on, which is not the same as which is chosen. */
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((o) => o.value === value)),
    [options, value]
  );
  const selected = options[selectedIndex];

  // Opening lands on the current choice rather than the top of the list, so
  // arrowing once moves you next to where you already are.
  useEffect(() => {
    if (open) setActive(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }, [active, open]);

  function choose(i: number) {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        // Tab commits and moves on, which is what the native control does.
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      default: {
        // Type a letter to jump, the way every list in every OS behaves.
        if (e.key.length !== 1) return;
        const from = active + 1;
        const order = [...options.slice(from), ...options.slice(0, from)];
        const hit = order.find((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
        if (hit) setActive(options.indexOf(hit));
      }
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`flex h-8 w-full items-center gap-2 rounded-lg border bg-surface-1 px-2.5 text-left text-[12px] transition-colors ${
          open
            ? "border-border-strong text-text-primary"
            : "border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? label}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-opt-${active}`}
          tabIndex={-1}
          className={`absolute z-30 mt-1 max-h-[22rem] min-w-full overflow-y-auto overscroll-contain rounded-lg border border-border-strong bg-surface-1 py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-[12px] ${
                  i === active ? "bg-surface-2" : ""
                }`}
              >
                <Check
                  size={12}
                  className={`mt-0.5 shrink-0 text-brand ${isSelected ? "" : "invisible"}`}
                />
                <span className="min-w-0">
                  <span
                    className={`block truncate ${
                      isSelected ? "font-medium text-text-primary" : "text-text-primary"
                    }`}
                  >
                    {o.label}
                  </span>
                  {o.hint && <span className="block text-[11px] text-text-muted">{o.hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
