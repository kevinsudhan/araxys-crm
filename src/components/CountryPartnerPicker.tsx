import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Globe, Search, X } from "lucide-react";
import { groupByCountry } from "../lib/countries";
import { PARTNER_ROLE_LABEL, type Partner } from "../services/partners";

/**
 * Choosing partners by country (116), for Live rates' two ways of asking: a
 * shipment's rate request (RateRequestForm) and the Sunday requests.
 *
 * ---------------------------------------------------------------------------
 * The countries come first, each with how many partners the desk has there;
 * choosing one lists them, to tick. What is ticked stays ticked when another
 * country is opened, and the line at the foot says who is chosen everywhere.
 * Under a country's list, the caller shows what those partners have already
 * been sent (`history`), so the desk sees what went to Taiwan before writing to
 * Taiwan again.
 *
 * A search looks across every country at once. Partners saved before the
 * country was asked sit under "Country not set" until somebody gives it.
 * ---------------------------------------------------------------------------
 */
export default function CountryPartnerPicker({
  partners,
  isPicked,
  onToggle,
  onPickAll,
  disabled = false,
  history,
}: {
  partners: Partner[];
  isPicked: (id: string) => boolean;
  onToggle: (p: Partner) => void;
  /** Those of a country with an address and not yet chosen. */
  onPickAll: (ps: Partner[]) => void;
  disabled?: boolean;
  /** What the chosen country's partners have already been sent. */
  history?: (inCountry: Partner[], country: string) => React.ReactNode;
}) {
  const groups = useMemo(() => groupByCountry(partners), [partners]);
  // One country only: open it, there is nothing to choose between.
  const [country, setCountry] = useState<string | null>(() => (groups.length === 1 ? groups[0].country : null));
  const [query, setQuery] = useState("");

  const can = (p: Partner) => p.emails.length > 0;
  const group = country === null ? null : groups.find((g) => g.country === country) ?? null;
  const needle = query.trim().toLowerCase();
  const found = needle
    ? partners.filter((p) =>
        [p.organisation, p.name, p.country || "country not set", PARTNER_ROLE_LABEL[p.role], ...p.emails, ...p.tags].some((v) => String(v).toLowerCase().includes(needle))
      )
    : [];
  const picked = partners.filter((p) => isPicked(p.id));

  // Nobody has a country yet (every partner saved before 116): say why there is nothing to group by.
  const noCountries = groups.length > 0 && groups.every((g) => !g.country);

  return (
    <div>
      {noCountries && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            None of your partners has a country yet, so they cannot be listed by country. Give each one its country on the{" "}
            <Link to="/partners" className="font-medium underline">
              partner directory
            </Link>{" "}
            (Edit), and they appear here under it.
          </span>
        </p>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Countries">
        {groups.map((g) => {
          const on = !needle && group?.country === g.country;
          const chosenHere = g.partners.filter((p) => isPicked(p.id)).length;
          return (
            <button
              key={g.country || "-"}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setQuery("");
                setCountry(on ? null : g.country);
              }}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors ${
                on
                  ? "border-brand bg-brand text-white"
                  : g.country
                    ? "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
                    : "border-border bg-surface-1 text-text-warning hover:border-border-strong"
              }`}
            >
              {g.country ? <Globe size={11} className="opacity-70" /> : <AlertTriangle size={11} />}
              {g.country || "Country not set"}
              <span className={on ? "text-white/75" : "text-text-muted"}>{g.partners.length}</span>
              {chosenHere > 0 && (
                <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10.5px] ${on ? "bg-white/20 text-white" : "bg-bg-success text-text-success"}`}>
                  <Check size={9} /> {chosenHere}
                </span>
              )}
            </button>
          );
        })}
        <div className="relative ml-auto w-full min-w-[170px] sm:w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Any partner, any country…" className="h-8 w-full pl-7 text-[12px]" aria-label="Find a partner" />
        </div>
      </div>

      {needle ? (
        <>
          <p className="mb-1.5 text-[11.5px] text-text-muted">
            {found.length ? `${found.length} found across every country` : "Nobody matches that."}
          </p>
          <Rows partners={found} isPicked={isPicked} onToggle={onToggle} disabled={disabled} can={can} showCountry />
        </>
      ) : !group ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-text-secondary">Choose a country to see the partners there.</p>
      ) : (
        <div className="rounded-lg border border-border p-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-[12.5px] font-medium text-text-primary">
              {group.country || "Country not set"}
              <span className="ml-1.5 font-normal text-text-muted">
                {group.partners.length} partner{group.partners.length === 1 ? "" : "s"}
              </span>
            </p>
            {group.partners.some((p) => can(p) && !isPicked(p.id)) && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPickAll(group.partners.filter((p) => can(p) && !isPicked(p.id)))}
                className="ml-auto text-[11.5px] text-text-accent hover:underline disabled:opacity-50"
              >
                Choose all in {group.country || "this list"}
              </button>
            )}
          </div>
          {!group.country && !noCountries && (
            <p className="mb-2 text-[11.5px] text-text-warning">Saved before the country was asked: give each one its country on the partner directory.</p>
          )}
          <Rows partners={group.partners} isPicked={isPicked} onToggle={onToggle} disabled={disabled} can={can} />
          {history && <div className="mt-3 border-t border-border pt-2.5">{history(group.partners, group.country)}</div>}
        </div>
      )}

      {picked.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-text-muted">Chosen:</span>
          {picked.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-bg-accent py-0.5 pl-2 pr-1 text-[11px] text-text-accent">
              {p.organisation || p.name}
              <span className="opacity-70">· {p.country || "no country"}</span>
              <button type="button" disabled={disabled} onClick={() => onToggle(p)} className="grid size-4 place-items-center rounded-full hover:bg-white/40" aria-label={`Take off ${p.organisation || p.name}`}>
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Rows({
  partners,
  isPicked,
  onToggle,
  disabled,
  can,
  showCountry = false,
}: {
  partners: Partner[];
  isPicked: (id: string) => boolean;
  onToggle: (p: Partner) => void;
  disabled: boolean;
  can: (p: Partner) => boolean;
  showCountry?: boolean;
}) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {partners.map((p) => {
        const on = isPicked(p.id);
        // No address: cannot be chosen, but one already chosen can be taken off.
        const off = disabled || (!can(p) && !on);
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onToggle(p)}
              disabled={off}
              aria-pressed={on}
              title={can(p) ? p.emails.join(", ") : "No email address on the directory"}
              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                on ? "border-brand/30 bg-bg-success" : "border-border bg-surface-1 hover:border-border-strong"
              } ${can(p) ? "" : "opacity-60"}`}
            >
              <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${on ? "border-brand bg-brand text-white" : "border-border-strong bg-surface-1"}`} aria-hidden>
                {on && <Check size={10} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-text-primary">{p.organisation?.trim() || p.name}</span>
                <span className="block truncate text-[11px] text-text-muted">
                  {PARTNER_ROLE_LABEL[p.role]}
                  {showCountry ? ` · ${p.country || "country not set"}` : ""} · {can(p) ? p.emails[0] : "no email address"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
