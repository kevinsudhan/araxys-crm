import { consolePnl } from "../../src/lib/consolePnl";
import type { PnlDoc, PnlJob } from "../../src/lib/jobPnl";

/** A console's P&L: space bought and sold, the box's cost per CBM, break-even, the margin on the console and each house (125, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const job = (id: string, over: Partial<PnlJob>): PnlJob => ({
  id,
  enquiryRef: `ALG-${id}`,
  customer: `Customer ${id}`,
  mode: "sea_lcl",
  direction: "export",
  origin: "Chennai",
  destination: "Hamburg",
  jobDate: "2026-10-18",
  stage: "booked",
  signedOffAt: null,
  handledBy: null,
  consoleId: "C1",
  consoleNo: "CON/26-27/0014",
  volumeCbm: null,
  weightKg: null,
  quotedRevenue: null,
  quotedCost: null,
  receivable: 0,
  payable: 0,
  draftInvoices: 0,
  disputedBills: 0,
  ...over,
});
const doc = (id: string, over: Partial<PnlDoc>): PnlDoc => ({
  id,
  side: "cost",
  kind: "vendor_invoice",
  number: id,
  date: "2026-10-18",
  status: "received",
  shipmentId: null,
  consoleId: null,
  party: null,
  fx: 1,
  taxableInr: 0,
  lines: [],
  ...over,
});

const jobs = [
  job("J1", { volumeCbm: 6, weightKg: 2000, quotedRevenue: 30000 }),
  job("J2", { volumeCbm: 4, weightKg: 1500, quotedRevenue: 22000 }),
  job("J3", { volumeCbm: 4.2, weightKg: 1800, quotedRevenue: 15435, coloader: true, customer: "Bluewave Logistics" }),
];
const docs = [
  doc("INV1", { side: "revenue", kind: "tax_invoice", status: "issued", shipmentId: "J1", lines: [{ description: "Ocean freight", amount: 31000, reimbursement: false }] }),
  doc("TRK1", { shipmentId: "J1", lines: [{ description: "Pickup", amount: 4000, reimbursement: false }] }),
  doc("LINE", { kind: "carrier_invoice", consoleId: "C1", lines: [{ description: "Ocean freight 40HC", amount: 1200, reimbursement: false }], fx: 81.25 }),
  doc("CFS", { consoleId: "C1", status: "draft", lines: [{ description: "Stuffing", amount: 6500, reimbursement: false }] }),
  doc("GONE", { consoleId: "C1", status: "cancelled", lines: [{ description: "x", amount: 99999, reimbursement: false }] }),
];

console.log("the console's money");
const p = consolePnl(jobs, docs, { capacityCbm: 65, coload: false });
is("revenue: J1 as invoiced, the others at their quotation", [p.revenue, p.invoiced, p.onQuote], [68435, 31000, 2]);
// Each house's share is rounded to the paisa, as in the job P&L; the panel shows whole rupees.
const rupee = (n: number) => Math.round(n);
is("cost: J1's own bill and the box and console, the cancelled bill not counted", [rupee(p.cost), rupee(p.consoleCost)], [108000, 104000]);
is("gross profit and margin", [rupee(p.gp), p.margin !== null ? Math.round(p.margin * 1000) / 10 : null], [-39565, -57.8]);
is("a draft bill marks it provisional", p.provisional, true);

console.log("\nthe space");
is("sold, W/M, to co-loaders, how full", [p.space.soldCbm, p.space.soldWm, p.space.coloaderWm, p.space.loadFactor], [14.2, 14.2, 4.2, 21.8]);
is("what each usable CBM of the box cost", p.space.costPerCbm, 1600);
is("what the houses pay per CBM, and where it breaks even", [p.space.revenuePerCbm, p.space.breakEvenCbm], [4819.37, 21.58]);

console.log("\neach house");
const [h1, h2, h3] = p.houses;
is("J1: invoiced, its own bill, its share of the box by volume", [h1.revenue, h1.onQuote, h1.ownCost, h1.sharedCost, h1.gp], [31000, false, 4000, 43943.66, -16943.66]);
is("J2: on its quotation", [h2.revenue, h2.onQuote, rupee(h2.sharedCost)], [22000, true, 29296]);
is("J3: a co-loader, its W/M", [h3.coloader, h3.wm, h3.customer], [true, 4.2, "Bluewave Logistics"]);
is("the shares add up to the box", rupee(h1.sharedCost + h2.sharedCost + h3.sharedCost), 104000);

console.log("\nspace bought from a co-loader");
const c = consolePnl(jobs, docs, { capacityCbm: 65, coload: true });
is("no box of ours: no load factor, cost per CBM or break-even", [c.space.capacityCbm, c.space.loadFactor, c.space.costPerCbm, c.space.breakEvenCbm], [null, null, null, null]);
is("the box type not known: no load factor", consolePnl(jobs, docs, { capacityCbm: null, coload: false }).space.loadFactor, null);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
