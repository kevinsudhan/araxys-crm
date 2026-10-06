import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ClipboardPaste, Loader2, X } from "lucide-react";
import { formatDate } from "../lib/dates";
import { pasteSummary } from "../lib/buyRate";
import { useLiveVersion } from "../lib/liveVersions";
import { getBuyRate, removeBuyLine, removeBuyRate, type BuyRate } from "../services/buyRates";
import { isAirQuote } from "../services/pasteQuote";
import type { Enquiry } from "../services/enquiries";
import PasteInput from "./PasteInput";
import PasteQuoteDialog from "./PasteQuoteDialog";

// A figure missing from a line shows as 0 rather than taking the case file down with it (7 Oct).
const fig = (n: number, dp = 2) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: dp });
const when = (iso?: string) => (iso ? formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "");

/**
 * The partner's original rate (128, 129), right under "Ask partners": pasted
 * as it comes, and built up — a revised charge updated, a later batch of
 * charges added — into the one rate the job costs. The profit against the
 * quotation is under the quotation (JobProfit) and on the partner rates line.
 */
export default function OriginalRate({ enquiry, onChanged }: { enquiry: Enquiry; onChanged: () => void }) {
  const [buy, setBuy] = useState<BuyRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [openPaste, setOpenPaste] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setBuy(await getBuyRate(enquiry.ref));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the original rate.");
    } finally {
      setLoading(false);
    }
  }, [enquiry.ref]);
  // Anybody's paste writes the enquiry's timeline, which the page watches (084).
  const live = useLiveVersion("enquiry_events");
  useEffect(() => {
    void load();
  }, [load, live]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const lines = buy?.lines ?? [];
  const missingRoe = [...new Set(lines.map((l) => l.currency).filter((c) => c !== "INR" && !((buy?.roe[c] ?? 0) > 0)))];

  return (
    <section className="mt-3 rounded-card border border-border bg-surface-1 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-medium text-text-primary">Original rate</h3>
        <p className="mr-auto text-[12px] text-text-secondary">
          {lines.length
            ? `${lines.length} charge${lines.length === 1 ? "" : "s"} from the partner${new Set(lines.map((l) => l.from).filter(Boolean)).size > 1 ? "s" : ""}`
            : "What the partner charges you — paste their rate as it comes"}
          {buy?.total_inr != null && lines.length > 0 && (
            <>
              {" · "}
              <span className="font-medium tabular-nums text-text-primary">₹{fig(buy.total_inr)}</span> before GST
            </>
          )}
        </p>
        {lines.length > 0 && (
          <button
            type="button"
            onClick={() => window.confirm("Clear the whole original rate?") && void act("clear", () => removeBuyRate(enquiry.ref))}
            disabled={busy !== null}
            className="text-[12px] text-text-muted hover:text-text-danger"
          >
            Clear
          </button>
        )}
      </div>

      {error && <p className="mt-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}

      {loading ? (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Reading the original rate…
        </p>
      ) : (
        <>
          {lines.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                    <th className="py-1.5 pr-2 font-medium">Charge</th>
                    <th className="py-1.5 pr-2 font-medium">From</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                    <th className="py-1.5 pr-2 text-right font-medium">₹</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l, i) => {
                    const r = l.currency === "INR" ? 1 : buy?.roe[l.currency];
                    return (
                      <tr key={i} className="align-top">
                        <td className="py-1.5 pr-2">
                          {l.description}
                          {l.note && <span className="ml-1 text-[11px] text-text-muted">({l.note})</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-text-secondary">
                          {l.from || "—"}
                          {l.at && <span className="block text-[11px] text-text-muted">{when(l.at)}</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {l.rate ? `${l.currency} ${fig(l.rate)}` : "—"}
                          {l.unit && l.unit !== "Lumpsum" && <span className="text-text-muted"> / {l.unit}</span>}
                          {l.was && (
                            <span className="block text-[11px] text-text-warning">
                              was {l.was.currency} {fig(l.was.rate)}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">{fig(l.quantity, 3)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{r ? fig(l.rate * l.quantity * r) : <span className="text-text-warning">no rate of exchange</span>}</td>
                        <td className="py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => buy && void act(`rm:${i}`, () => removeBuyLine(buy, i))}
                            disabled={busy !== null}
                            aria-label={`Take ${l.description} off the original rate`}
                            className="text-text-muted hover:text-text-danger disabled:opacity-40"
                          >
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {missingRoe.length > 0 && <p className="mt-1 text-[11.5px] text-text-warning">Give the rate of exchange for {missingRoe.join(", ")}: paste the rate again with it.</p>}
            </div>
          )}

          {/* ---- the paste box: always there, ready for the next rate ---- */}
          <div className="mt-3">
            <PasteInput value={text} onChange={setText} air={isAirQuote(enquiry)} rows={lines.length ? 4 : 7} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReading(true)}
                disabled={!text.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <ClipboardPaste size={13} /> {lines.length ? "Add to the original rate" : "Read the partner's rate"}
              </button>
              <span className="text-[11.5px] text-text-muted">
                {lines.length
                  ? "A revised rate or the rest of the charges: paste it here. A charge already above is updated (its old figure kept), a new one added, the rest stay."
                  : "From a mail, WhatsApp or a rate sheet, as the partner sent it. Never sent to the customer."}
              </span>
            </div>
          </div>

          {(buy?.history.length ?? 0) > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowHistory((s) => !s)} className="flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary">
                <ChevronDown size={13} className={`transition-transform ${showHistory ? "rotate-180" : ""}`} />
                {buy!.history.length} paste{buy!.history.length === 1 ? "" : "s"}
              </button>
              {showHistory && (
                <ol className="mt-1.5 space-y-1.5">
                  {[...buy!.history].reverse().map((h, k) => (
                    <li key={k} className="rounded-lg bg-surface-2 px-3 py-2 text-[12px]">
                      <p className="text-text-primary">
                        <span className="text-text-muted">{when(h.at)}</span> · {h.from || "Partner"} · {pasteSummary(h)}
                      </p>
                      {h.updated.length > 0 && (
                        <ul className="mt-0.5 text-[11.5px] text-text-secondary">
                          {h.updated.map((u, j) => (
                            <li key={j}>
                              {u.name}: {u.from} → {u.to}
                            </li>
                          ))}
                        </ul>
                      )}
                      {h.added.length > 0 && !h.replaced && <p className="text-[11.5px] text-text-secondary">Added: {h.added.join(", ")}</p>}
                      <button type="button" onClick={() => setOpenPaste(openPaste === k ? null : k)} className="mt-0.5 text-[11.5px] text-text-accent hover:underline">
                        {openPaste === k ? "Hide what was pasted" : "What was pasted"}
                      </button>
                      {openPaste === k && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-1 p-2 font-sans text-[11.5px] text-text-secondary">{h.pasted_text}</pre>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </>
      )}

      {reading && (
        <PasteQuoteDialog
          enquiry={enquiry}
          live={null}
          liveCount={0}
          purpose="cost"
          initialText={text}
          existing={lines}
          partnerQuoteLabel={buy?.partner_label}
          onClose={() => setReading(false)}
          onApplied={() => {
            setReading(false);
            setText("");
            void load();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
