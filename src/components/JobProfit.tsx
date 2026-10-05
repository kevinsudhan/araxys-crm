import { useState } from "react";
import { AlertTriangle, ClipboardPaste, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { formatDate } from "../lib/dates";
import type { ProfitRow } from "../lib/jobProfit";
import { quoteFromBuyRate, removeBuyRate } from "../services/buyRates";
import type { Enquiry, Quote } from "../services/enquiries";
import PasteQuoteDialog from "./PasteQuoteDialog";
import { useJobProfit } from "./useJobProfit";

const inr = (n: number) => `${n < -0.5 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const rate = (r: { currency: string; rate: number; unit: string } | null) =>
  r ? `${r.currency} ${r.rate.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${r.unit && r.unit !== "Lumpsum" ? ` / ${r.unit}` : ""}` : "—";

/**
 * The partner's original rate and the profit on the job (128): pasted as the
 * partner sent it, set charge by charge against the quotation the customer
 * gets, and the difference — the commission, or a loss — in rupees before
 * GST. The rules are lib/jobProfit.ts.
 */
export default function JobProfit({ enquiry, quotes, onChanged }: { enquiry: Enquiry; quotes: Quote[]; onChanged: () => void }) {
  const { buy, quote, profit, loading, error, reload } = useJobProfit(enquiry.ref, quotes);
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setFailed(null);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const loss = profit ? profit.profitInr < 0 : false;
  const tile = (label: string, value: string, note: string, tone = "text-text-primary") => (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`text-[17px] font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="truncate text-[11px] text-text-muted">{note}</p>
    </div>
  );

  return (
    <section className="card mt-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-[13px] font-medium text-text-primary">Partner's rate and profit</h3>
        <button
          type="button"
          onClick={() => setPasting(true)}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12px] font-medium ${buy ? "border border-border text-text-secondary hover:text-text-primary" : "bg-brand text-white hover:bg-brand-dark"}`}
        >
          <ClipboardPaste size={13} /> {buy ? "Paste it again" : "Paste the partner's rate"}
        </button>
        {buy && (
          <button
            type="button"
            onClick={() => window.confirm("Remove the partner's rate from this enquiry?") && void act("remove", () => removeBuyRate(enquiry.ref))}
            disabled={busy !== null}
            className="h-8 rounded-lg px-2.5 text-[12px] text-text-muted hover:text-text-danger"
          >
            Remove
          </button>
        )}
      </div>

      {(error || failed) && <p className="mt-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{failed ?? error}</p>}

      {loading ? (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Reading the partner's rate…
        </p>
      ) : !buy ? (
        <p className="mt-1.5 max-w-prose text-[12.5px] leading-relaxed text-text-secondary">
          Paste the rate your partner gave you, as they sent it. Quote the customer with your commission on top, and the profit — or the loss — on this job is
          worked out here, charge by charge.
        </p>
      ) : (
        profit && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {tile(
                "Partner's rate (cost)",
                inr(profit.buyInr),
                `${buy.partner_label || "Partner"} · ${buy.lines.length} charge${buy.lines.length === 1 ? "" : "s"}${buy.updated_at ? ` · ${formatDate(buy.updated_at, { day: "numeric", month: "short" })}` : ""}`
              )}
              {tile("Your quotation", quote ? inr(profit.sellInr) : "—", quote ? `Version ${quote.version} · ${quote.status}` : "Not quoted yet")}
              {tile(
                loss ? "Loss on the job" : "Profit on the job",
                quote ? inr(profit.profitInr) : "—",
                quote && profit.margin !== null ? `${(profit.margin * 100).toFixed(1)}% of the quotation` : "Once the customer is quoted",
                !quote ? "text-text-muted" : loss ? "text-text-danger" : "text-text-success"
              )}
            </div>

            {profit.missingRoe.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> No rate of exchange for {profit.missingRoe.join(", ")} on the partner's rate: those charges are left out. Paste it
                again with the rate of exchange.
              </p>
            )}

            {!quote ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
                <p className="mr-auto text-[12.5px] text-text-secondary">
                  Start the quotation from the partner's rate — the same charges — then put your commission on each charge in the grid above, or paste your own quotation.
                </p>
                <button
                  type="button"
                  onClick={() => void act("start", () => quoteFromBuyRate(enquiry, null, buy))}
                  disabled={busy !== null}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy === "start" && <Loader2 size={13} className="animate-spin" />} Start the quotation from it
                </button>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                      <th className="py-1.5 pr-2 font-medium">Charge</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Partner</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Yours</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Cost ₹</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Charged ₹</th>
                      <th className="py-1.5 text-right font-medium">Profit ₹</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {profit.rows.map((r, i) => (
                      <Row key={i} r={r} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border-strong font-semibold">
                      <td className="py-1.5 pr-2" colSpan={4}>
                        Total
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{inr(profit.buyInr)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{inr(profit.sellInr)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${loss ? "text-text-danger" : "text-text-success"}`}>
                        <span className="inline-flex items-center gap-1">
                          {loss ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                          {inr(profit.profitInr)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-1.5 text-[11px] text-text-muted">
                  Before GST, in rupees at the rates of exchange; each charge on your quotation's quantity. A charge only the partner bills is a cost you carry; one
                  only you charge is all margin.
                </p>
              </div>
            )}
          </>
        )
      )}

      {pasting && (
        <PasteQuoteDialog
          enquiry={enquiry}
          live={null}
          liveCount={0}
          purpose="cost"
          partnerQuoteLabel={buy?.partner_label}
          onClose={() => setPasting(false)}
          onApplied={() => {
            setPasting(false);
            void reload();
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function Row({ r }: { r: ProfitRow }) {
  return (
    <tr className="align-top">
      <td className="py-1.5 pr-2">
        {r.name}
        {r.kind === "buy_only" && <span className="block text-[11px] text-text-warning">Only the partner's: a cost you carry</span>}
        {r.kind === "sell_only" && <span className="block text-[11px] text-text-muted">Your own charge</span>}
        {r.buy?.note && <span className="block text-[11px] text-text-muted">Partner: {r.buy.note}</span>}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">{rate(r.buy)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">{rate(r.sell)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">{r.quantity ?? "—"}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.buyInr === null ? "—" : inr(r.buyInr)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.sellInr === null ? "—" : inr(r.sellInr)}</td>
      <td className={`py-1.5 text-right font-medium tabular-nums ${r.profitInr !== null && r.profitInr < 0 ? "text-text-danger" : "text-text-primary"}`}>
        {r.profitInr === null ? "—" : inr(r.profitInr)}
      </td>
    </tr>
  );
}
