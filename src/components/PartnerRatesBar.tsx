import { useState } from "react";
import { ChevronRight, Handshake, Send } from "lucide-react";
import AskPartners from "./AskPartners";
import { useJobProfit } from "./useJobProfit";
import { bestOf, type PartnerQuote } from "../services/rfq";
import type { Enquiry, Quote } from "../services/enquiries";

const inr = (n: number) => `${n < -0.5 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

/**
 * Partner rates, on every tab of the enquiry (1 Oct).
 *
 * ---------------------------------------------------------------------------
 * The order of the work is: the enquiry comes in, partners are asked for
 * their rates, their rates come back, and only then is the customer quoted.
 * Asking lived on the Partners tab, which nobody passes on the way from the
 * mail to the quotation — so the step the quotation depends on was the one
 * that could not be seen from where the desk works.
 *
 * One line under the workflow: whether partners have been asked, how many
 * answered, and the best rate so far, with the button that asks them — the
 * same form as the Partners tab (components/AskPartners.tsx), where a
 * partner not yet in the directory can be added on the spot. The replies
 * themselves are read on the Partners tab.
 *
 * The partner's original rate is pasted in the box right under this line
 * (OriginalRate, 128), whichever way it came; this line then says what it
 * costs and the profit against the quotation; the charge-by-charge view is
 * under the quotation.
 * ---------------------------------------------------------------------------
 */
export default function PartnerRatesBar({
  enquiry,
  quotes,
  onAsked,
  onOpen,
  customerQuotes,
  onProfit,
}: {
  enquiry: Enquiry;
  /** Every ask on this enquiry (services/rfq `listQuotes`). */
  quotes: PartnerQuote[];
  /** After a send, so the line reads the asks again. */
  onAsked: () => void;
  /** To the Partners tab, where the replies are read. */
  onOpen: () => void;
  /** The customer's quotations, for the profit against the partner's rate (128). */
  customerQuotes: Quote[];
  /** To where the quotation and the profit are, charge by charge. */
  onProfit: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const { buy, quote, profit } = useJobProfit(enquiry.ref, customerQuotes);

  const asked = quotes.length;
  const answered = quotes.filter((q) => q.status === "replied" || q.status === "quoted" || q.status === "declined").length;
  const priced = quotes.filter((q) => q.status === "quoted" && q.amount != null);
  // One priced reply is the best there is; several are compared only within one currency (bestOf).
  const best = bestOf(quotes) ?? (priced.length === 1 ? priced[0] : null);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-1 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-accent text-text-accent">
          <Handshake size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-primary">Partner rates</p>
          <p className="text-[12px] text-text-secondary">
            {!asked && buy ? (
              "Rate pasted from the partner"
            ) : !asked ? (
              "Not asked yet — ask your partners for their rates, or paste the rate they gave you below, then quote the customer."
            ) : (
              <>
                {asked} asked · {answered} replied
                {best && best.amount != null && (
                  <>
                    {" · "}
                    <span className="text-text-primary">
                      best {best.currency ?? ""} {Number(best.amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </span>{" "}
                    from {best.partner_label || best.partner_email}
                  </>
                )}
              </>
            )}
          </p>
          {buy && profit && (
            <p className="text-[12px] text-text-secondary">
              Original rate <span className="font-medium text-text-primary tabular-nums">{inr(profit.buyInr)}</span>
              {quote ? (
                <>
                  {" · quoted "}
                  <span className="tabular-nums">{inr(profit.sellInr)}</span>
                  {" · "}
                  <span className={`font-medium tabular-nums ${profit.profitInr < 0 ? "text-text-danger" : "text-text-success"}`}>
                    {profit.profitInr < 0 ? "loss " : "profit "}
                    {inr(profit.profitInr)}
                    {profit.margin !== null ? ` (${(profit.margin * 100).toFixed(1)}%)` : ""}
                  </span>
                </>
              ) : (
                " · not quoted yet"
              )}{" "}
              <button type="button" onClick={onProfit} className="text-text-accent hover:underline">
                See it charge by charge
              </button>
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {asked > 0 && (
          <button
            type="button"
            onClick={onOpen}
            className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] text-text-accent hover:underline"
          >
            See replies <ChevronRight size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark"
        >
          <Send size={13} />
          {asked ? "Ask more partners" : "Ask partners"}
        </button>
      </div>

      {asking && <AskPartners enquiry={enquiry} onClose={() => setAsking(false)} onSent={() => onAsked()} />}

    </div>
  );
}
