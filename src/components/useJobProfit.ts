import { useCallback, useEffect, useState } from "react";
import { jobProfit, profitQuoteOf, type JobProfit } from "../lib/jobProfit";
import { useLiveVersion } from "../lib/liveVersions";
import { getBuyRate, type BuyRate } from "../services/buyRates";
import type { Quote } from "../services/enquiries";
import { linesFor } from "../services/quoteLines";

/**
 * The partner's rate on an enquiry and the profit on it against the
 * quotation in play (128): read once for the enquiry page's two places that
 * say it, so they can never disagree.
 */
export function useJobProfit(ref: string, quotes: Quote[]): {
  buy: BuyRate | null;
  quote: Quote | null;
  profit: JobProfit | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const quote = profitQuoteOf(quotes);
  const [buy, setBuy] = useState<BuyRate | null>(null);
  const [profit, setProfit] = useState<JobProfit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [b, lines] = await Promise.all([getBuyRate(ref), quote ? linesFor(quote.id) : Promise.resolve([])]);
      setBuy(b);
      setProfit(b ? jobProfit(b.lines, b.roe, lines) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not work out the profit.");
    } finally {
      setLoading(false);
    }
    // Read again when the quotation in play changes: another version, or its charges (its total moves with them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, quote?.id, quote?.amount_inr, quote?.status]);

  // The partner's rate saved by anybody (084): the enquiry page watches the enquiry's events, which a save writes.
  const live = useLiveVersion("enquiry_events", "quotes");
  useEffect(() => {
    void reload();
  }, [reload, live]);

  return { buy, quote, profit, loading, error, reload };
}
