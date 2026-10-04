import { useState } from "react";
import { ChevronRight, Handshake, Send } from "lucide-react";
import AskPartners from "./AskPartners";
import { bestOf, type PartnerQuote } from "../services/rfq";
import type { Enquiry } from "../services/enquiries";

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
 * ---------------------------------------------------------------------------
 */
export default function PartnerRatesBar({
  enquiry,
  quotes,
  onAsked,
  onOpen,
}: {
  enquiry: Enquiry;
  /** Every ask on this enquiry (services/rfq `listQuotes`). */
  quotes: PartnerQuote[];
  /** After a send, so the line reads the asks again. */
  onAsked: () => void;
  /** To the Partners tab, where the replies are read. */
  onOpen: () => void;
}) {
  const [asking, setAsking] = useState(false);

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
            {!asked ? (
              "Not asked yet — ask your partners for their rates, then quote the customer."
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
