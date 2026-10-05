import { wmOf } from "./coload";
import { buildEntries, type PnlDoc, type PnlJob } from "./jobPnl";

/**
 * A console's profit and loss (125): the space bought against the space sold,
 * what each cubic metre of the box cost, and the margin on the console and on
 * every house in it.
 *
 * ---------------------------------------------------------------------------
 * THE SAME FIGURES AS THE JOB P&L
 *
 * The money is the job P&L's (lib/jobPnl.ts), worked out the same way:
 * issued invoices less credit notes for revenue, bills for cost, both before
 * GST, and a bill on the console itself — the line's freight, the CFS
 * stuffing, the co-loader's invoice — shared across its jobs by volume. A
 * house's cost is its own bills plus its share of the console's.
 *
 * QUOTED UNTIL INVOICED
 *
 * While the box is being filled nothing is invoiced yet, and the question is
 * whether the box will pay. So a house not yet invoiced is counted at its
 * accepted quotation, and says so; once any invoice is issued on it, the
 * invoices are what count.
 *
 * WHAT THE BOX COST, AND WHERE IT BREAKS EVEN
 *
 * On our own box the console's own costs are the box: divided by its usable
 * CBM they are what each CBM cost, and divided by what the houses are paying
 * per CBM they are the CBM that must be sold to cover it. On space bought
 * from a co-loader there is no box of ours: the cost is by the W/M.
 * ---------------------------------------------------------------------------
 */

export interface HouseLine {
  jobId: string;
  ref: string | null;
  customer: string;
  coloader: boolean;
  cbm: number;
  kg: number;
  wm: number;
  quoted: number | null;
  invoiced: number;
  /** Revenue counted: the invoices once any is issued, else the accepted quotation. */
  revenue: number;
  onQuote: boolean;
  ownCost: number;
  /** Its share of the console's own bills. */
  sharedCost: number;
  gp: number;
  margin: number | null;
  /** A cost in it is a draft bill: known, the vendor's invoice not in. */
  provisional: boolean;
}

export interface ConsolePnl {
  houses: HouseLine[];
  revenue: number;
  invoiced: number;
  /** Houses counted at their quotation because nothing is invoiced on them yet. */
  onQuote: number;
  cost: number;
  /** The console's own bills: the box, the CFS, the co-loader. */
  consoleCost: number;
  gp: number;
  margin: number | null;
  provisional: boolean;
  space: {
    coload: boolean;
    /** Usable CBM of our box, when its type is known. */
    capacityCbm: number | null;
    soldCbm: number;
    soldWm: number;
    /** Of it, to co-loaders (124). */
    coloaderWm: number;
    /** Sold CBM of usable CBM, per cent. */
    loadFactor: number | null;
    /** The console's own cost over the box's usable CBM. */
    costPerCbm: number | null;
    /** Revenue over the CBM sold. */
    revenuePerCbm: number | null;
    /** The CBM that must be sold at the current revenue per CBM to cover the console's own cost. */
    breakEvenCbm: number | null;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function consolePnl(jobs: PnlJob[], docs: PnlDoc[], opts: { capacityCbm: number | null; coload: boolean }): ConsolePnl {
  const entries = buildEntries(jobs, docs);
  const houses: HouseLine[] = jobs.map((j) => {
    const mine = entries.filter((e) => e.jobId === j.id);
    const invoiced = round2(mine.filter((e) => e.side === "revenue").reduce((n, e) => n + e.amount, 0));
    const anyInvoice = mine.some((e) => e.side === "revenue");
    const onQuote = !anyInvoice && j.quotedRevenue !== null;
    const revenue = anyInvoice ? invoiced : (j.quotedRevenue ?? 0);
    const ownCost = round2(mine.filter((e) => e.side === "cost" && e.share === null).reduce((n, e) => n + e.amount, 0));
    const sharedCost = round2(mine.filter((e) => e.side === "cost" && e.share !== null).reduce((n, e) => n + e.amount, 0));
    const gp = round2(revenue - ownCost - sharedCost);
    const cbm = j.volumeCbm ?? 0;
    const kg = j.weightKg ?? 0;
    return {
      jobId: j.id,
      ref: j.enquiryRef,
      customer: j.customer,
      coloader: Boolean(j.coloader),
      cbm,
      kg,
      wm: wmOf(cbm, kg),
      quoted: j.quotedRevenue,
      invoiced,
      revenue: round2(revenue),
      onQuote,
      ownCost,
      sharedCost,
      gp,
      margin: Math.abs(revenue) > 0.005 ? gp / revenue : null,
      provisional: mine.some((e) => e.provisional),
    };
  });

  const sum = (pick: (h: HouseLine) => number) => round2(houses.reduce((n, h) => n + pick(h), 0));
  const revenue = sum((h) => h.revenue);
  const cost = sum((h) => h.ownCost + h.sharedCost);
  const consoleCost = sum((h) => h.sharedCost);
  const gp = round2(revenue - cost);
  const soldCbm = round3(houses.reduce((n, h) => n + h.cbm, 0));
  const soldWm = round3(houses.reduce((n, h) => n + h.wm, 0));
  const coloaderWm = round3(houses.filter((h) => h.coloader).reduce((n, h) => n + h.wm, 0));
  const capacity = opts.coload ? null : opts.capacityCbm && opts.capacityCbm > 0 ? opts.capacityCbm : null;
  const revenuePerCbm = soldCbm > 0 && revenue > 0 ? round2(revenue / soldCbm) : null;
  return {
    houses,
    revenue,
    invoiced: sum((h) => h.invoiced),
    onQuote: houses.filter((h) => h.onQuote).length,
    cost,
    consoleCost,
    gp,
    margin: Math.abs(revenue) > 0.005 ? gp / revenue : null,
    provisional: houses.some((h) => h.provisional),
    space: {
      coload: opts.coload,
      capacityCbm: capacity,
      soldCbm,
      soldWm,
      coloaderWm,
      loadFactor: capacity ? round1((soldCbm / capacity) * 100) : null,
      costPerCbm: capacity && consoleCost > 0 ? round2(consoleCost / capacity) : null,
      revenuePerCbm,
      breakEvenCbm: !opts.coload && consoleCost > 0 && revenuePerCbm ? round2(consoleCost / revenuePerCbm) : null,
    },
  };
}
