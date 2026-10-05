import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { failureText } from "../lib/errorText";
import { houseProblems, problemText } from "../lib/houseMaster";
import { useTablesChanges } from "../lib/useTableChanges";
import type { Console } from "../services/consoles";
import { checkConsoleHouses, type HouseOnConsole } from "../services/houseMaster";

/**
 * Every house B/L on the console against its master (123): vessel, voyage,
 * ports, its boxes and their seals, and no house carrying the master's
 * number. Ours where we issue it; the agent's or co-loader's where they do.
 * The rules are lib/houseMaster.ts.
 */
export default function ConsoleHouseCheck({ console: c, jobs }: { console: Console; jobs: number }) {
  const [houses, setHouses] = useState<HouseOnConsole[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHouses((await checkConsoleHouses(c)).houses);
    } catch (e) {
      setError(failureText(e, "Could not check the house bills.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or its jobs change
  }, [c.id, c.updated_at, jobs]);
  useEffect(() => {
    void load();
  }, [load]);
  // A house B/L saved or received by anybody (084).
  useTablesChanges(
    [
      ["house_bills", null],
      ["received_house_bills", null],
    ],
    () => void load()
  );

  const wrong = (houses ?? []).filter((h) => houseProblems(h.rows).length);

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">House B/Ls against the master</h3>
      {error ? (
        <p className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>
      ) : !houses ? (
        <p className="flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Checking the house bills…
        </p>
      ) : !houses.length ? (
        <p className="text-[12px] text-text-muted">No house B/L saved on the console's jobs yet.</p>
      ) : !wrong.length ? (
        <p className="flex items-center gap-1.5 text-[12px] text-text-success">
          <Check size={13} /> All {houses.length} house B/L{houses.length === 1 ? "" : "s"} agree with the master: vessel, voyage, ports, boxes and seals.
        </p>
      ) : (
        <ul className="space-y-2">
          {wrong.map((h) => (
            <li key={h.shipmentId} className="rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
              <p className="flex flex-wrap items-center gap-x-2 font-medium">
                <AlertTriangle size={13} className="shrink-0" />
                <span className="font-mono">{h.hblNo ?? "(unnumbered)"}</span>
                <span className="font-normal opacity-80">{h.theirs ? "their B/L" : "our B/L"} on</span>
                <Link to={`/shipments/${h.shipmentId}/bill`} className="font-mono underline-offset-2 hover:underline">
                  {h.ref}
                </Link>
              </p>
              <ul className="mt-1 space-y-0.5 pl-5">
                {houseProblems(h.rows).map((r) => (
                  <li key={r.key} className="list-disc">
                    {problemText(r)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {houses.length > wrong.length && (
            <li className="text-[11.5px] text-text-muted">The other {houses.length - wrong.length} agree.</li>
          )}
        </ul>
      )}
    </section>
  );
}
