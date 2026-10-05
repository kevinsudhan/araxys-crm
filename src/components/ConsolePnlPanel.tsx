import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { failureText } from "../lib/errorText";
import { consolePnl, type ConsolePnl } from "../lib/consolePnl";
import { useTablesChanges } from "../lib/useTableChanges";
import type { Console } from "../services/consoles";
import { loadConsolePnl } from "../services/jobPnl";

const inr = (n: number) => `${n < -0.5 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const pct = (m: number | null) => (m === null ? "—" : `${(m * 100).toFixed(1)}%`);
const fig = (n: number, dp = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: dp });

/**
 * The console's P&L (125): the space bought against the space sold, what the
 * box cost per CBM and where it breaks even, and the margin on the console
 * and on each house. Worked out as the job P&L is (lib/consolePnl.ts).
 */
export default function ConsolePnlPanel({ console: c, jobs, capacityCbm, boxCode }: { console: Console; jobs: number; capacityCbm: number | null; boxCode: string | null }) {
  const [pnl, setPnl] = useState<ConsolePnl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const coload = c.space_from === "coloader";

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await loadConsolePnl(c.id);
      setPnl(consolePnl(data.jobs, data.docs, { capacityCbm, coload }));
    } catch (e) {
      setError(failureText(e, "Could not work out the console's P&L.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console, its jobs or its box change
  }, [c.id, c.updated_at, jobs, capacityCbm, coload]);
  useEffect(() => {
    void load();
  }, [load]);
  // An invoice or bill recorded or changed by anybody.
  useTablesChanges(
    [
      ["invoices", null],
      ["bills", null],
      ["quotes", null],
    ],
    () => void load()
  );

  const tile = (label: string, value: string, note?: string, tone = "text-text-primary") => (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`text-[16px] font-semibold tabular-nums ${tone}`}>{value}</p>
      {note && <p className="text-[11px] text-text-muted">{note}</p>}
    </div>
  );

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Console P&amp;L</h3>
      {error ? (
        <p className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>
      ) : !pnl ? (
        <p className="flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Working out the P&amp;L…
        </p>
      ) : !pnl.houses.length ? (
        <p className="text-[12px] text-text-muted">No jobs on the console yet.</p>
      ) : (
        <>
          {/* ---- space bought against space sold ---- */}
          <p className="mb-2 text-[12.5px] text-text-secondary">
            {pnl.space.coload ? (
              <>Bought by the W/M from the co-loader: </>
            ) : pnl.space.capacityCbm ? (
              <>
                Box {boxCode ?? ""}: {fig(pnl.space.capacityCbm)} CBM usable ·{" "}
              </>
            ) : (
              <>Box type not recorded, so no load factor · </>
            )}
            <span className="font-medium text-text-primary">sold {fig(pnl.space.soldCbm, 3)} CBM</span>
            {pnl.space.loadFactor !== null && (
              <span className={pnl.space.loadFactor < 60 ? "text-text-warning" : "text-text-primary"}> ({pnl.space.loadFactor}% full)</span>
            )}{" "}
            · {fig(pnl.space.soldWm, 3)} W/M
            {pnl.space.coloaderWm > 0 && <> · {fig(pnl.space.coloaderWm, 3)} W/M to co-loaders</>}
          </p>

          {/* ---- the money ---- */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {tile("Revenue", inr(pnl.revenue), pnl.onQuote ? `${pnl.onQuote} house${pnl.onQuote === 1 ? "" : "s"} at the quoted rate` : `invoiced ${inr(pnl.invoiced)}`)}
            {tile("Cost", inr(pnl.cost), pnl.consoleCost ? `of which the box and console ${inr(pnl.consoleCost)}` : "no bill on the console yet")}
            {tile("Gross profit", inr(pnl.gp), undefined, pnl.gp < 0 ? "text-text-danger" : "text-text-success")}
            {tile("Margin", pct(pnl.margin), pnl.provisional ? "includes draft bills" : undefined, pnl.margin !== null && pnl.margin < 0 ? "text-text-danger" : "text-text-primary")}
          </div>

          {/* ---- what the box cost, and where it breaks even ---- */}
          {!pnl.space.coload && (
            <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
              {!pnl.consoleCost ? (
                <>No bill on the console yet: record the line's invoice under Costs below to see what the box cost and where it breaks even.</>
              ) : (
                <>
                  The box and console cost {inr(pnl.consoleCost)}
                  {pnl.space.costPerCbm !== null && <>, {inr(pnl.space.costPerCbm)} per usable CBM</>}.
                  {pnl.space.revenuePerCbm !== null && pnl.space.breakEvenCbm !== null && (
                    <>
                      {" "}
                      The houses pay {inr(pnl.space.revenuePerCbm)} per CBM on average, so it breaks even at{" "}
                      <span className="font-medium text-text-primary">{fig(pnl.space.breakEvenCbm)} CBM</span>
                      {pnl.space.capacityCbm ? <> ({fig((pnl.space.breakEvenCbm / pnl.space.capacityCbm) * 100, 1)}% of the box)</> : null}
                      {pnl.space.soldCbm >= pnl.space.breakEvenCbm ? (
                        <span className="text-text-success">: covered.</span>
                      ) : (
                        <span className="text-text-warning">: {fig(pnl.space.breakEvenCbm - pnl.space.soldCbm)} CBM still to sell.</span>
                      )}
                    </>
                  )}
                </>
              )}
            </p>
          )}

          {/* ---- each house ---- */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                  <th className="py-1.5 pr-2 font-medium">Job</th>
                  <th className="py-1.5 pr-2 font-medium">Customer</th>
                  <th className="py-1.5 pr-2 text-right font-medium">CBM</th>
                  <th className="py-1.5 pr-2 text-right font-medium">W/M</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Revenue</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Own cost</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Share of box</th>
                  <th className="py-1.5 pr-2 text-right font-medium">GP</th>
                  <th className="py-1.5 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pnl.houses.map((h) => (
                  <tr key={h.jobId}>
                    <td className="py-1.5 pr-2">
                      <Link to={`/shipments/${h.jobId}/costs`} className="font-mono text-text-accent hover:underline">
                        {h.ref ?? "—"}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2">
                      {h.customer}
                      {h.coloader && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-text-secondary">co-loader</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{h.cbm ? fig(h.cbm, 3) : "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{h.wm ? fig(h.wm, 3) : "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {inr(h.revenue)}
                      {h.onQuote && <span className="block text-[10.5px] text-text-muted">quoted</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{inr(h.ownCost)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{inr(h.sharedCost)}</td>
                    <td className={`py-1.5 pr-2 text-right font-medium tabular-nums ${h.gp < 0 ? "text-text-danger" : "text-text-primary"}`}>{inr(h.gp)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${h.margin !== null && h.margin < 0 ? "text-text-danger" : "text-text-secondary"}`}>{pct(h.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-text-muted">
            Before GST. A house not invoiced yet counts at its accepted quotation. The console's own bills are shared by volume, as in the job P&amp;L.
            {pnl.provisional && (
              <span className="ml-1 inline-flex items-center gap-1 text-text-warning">
                <AlertTriangle size={11} /> Draft bills included: the cost is known, the vendor's invoice is not in.
              </span>
            )}
          </p>
        </>
      )}
    </section>
  );
}
