import { useEffect, useMemo, useRef, useState } from "react";
import { currentToken, rankAddresses, type AddressEntry } from "../lib/addressRank";
import { parseAddresses } from "../lib/addresses";
import { loadAddressBook } from "../services/addressBook";

const KIND_LABEL: Record<AddressEntry["kind"], string> = {
  customer: "Customer",
  partner: "Partner",
  desk: "Desk",
  recent: "Recent",
};

/**
 * A To, Cc or Bcc box that suggests as you type, as Outlook does.
 *
 * Every address used to be typed out in full, on a desk that writes to the
 * same few hundred customers and partners all day. Now the part after the last
 * comma is matched against them (services/addressBook.ts) and a suggestion is
 * taken with Enter, Tab or a click; the line stays plain text, so pasting a
 * list or typing a new address works exactly as before.
 */
export default function AddressInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  label: string;
}) {
  const [book, setBook] = useState<AddressEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const load = () => {
    if (!book) void loadAddressBook().then(setBook);
  };

  const { before, token } = currentToken(value);
  const suggestions = useMemo(
    () => (book && token.trim().length >= 1 ? rankAddresses(book, token, parseAddresses(before)) : []),
    [book, token, before]
  );
  useEffect(() => setActive(0), [token]);
  const showing = open && suggestions.length > 0;

  const take = (entry: AddressEntry) => {
    const lead = before ? `${before.trimEnd()} ` : "";
    onChange(`${lead}${entry.address}, `);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div className="relative">
      <input
        ref={input}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          load();
        }}
        onFocus={load}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!showing) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            take(suggestions[active]);
          } else if (e.key === "Escape") {
            // Closes the list, not the compose window around it.
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showing}
        autoFocus={autoFocus}
        className="w-full"
        autoComplete="off"
      />
      {showing && (
        <ul
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.address}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${i === active ? "bg-surface-2" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-text-primary">
                    {s.name}
                    {s.detail && s.detail !== s.name && s.kind !== "desk" && <span className="text-text-muted"> · {s.detail}</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-text-secondary">{s.address}</span>
                </span>
                <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] leading-4 text-text-muted">{KIND_LABEL[s.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
