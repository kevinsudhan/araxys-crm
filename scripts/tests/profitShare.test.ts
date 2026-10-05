import { consolePnl } from "../../src/lib/consolePnl";
import type { PnlDoc, PnlJob } from "../../src/lib/jobPnl";
import { inCurrency, noteDescription, shareFigures, statementHtml, termsOf, towardAgent, withoutShares, type SettlingDoc } from "../../src/lib/profitShare";

/** The overseas agent's share of the profit, settled by notes either way (130, 6 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const job = (id: string, cbm: number): PnlJob => ({
  id,
  enquiryRef: id,
  customer: `Customer ${id}`,
  mode: "sea_lcl",
  direction: "export",
  origin: "Chennai",
  destination: "Jebel Ali",
  jobDate: "2026-10-05",
  stage: "booked",
  signedOffAt: null,
  handledBy: null,
  consoleId: "C1",
  consoleNo: "CON/26-27/0001",
  volumeCbm: cbm,
  weightKg: cbm * 300,
  quotedRevenue: null,
  quotedCost: null,
  receivable: 0,
  payable: 0,
  draftInvoices: 0,
  disputedBills: 0,
});
const invoice = (id: string, shipmentId: string | null, amount: number, extra: Partial<PnlDoc> = {}): PnlDoc => ({
  id,
  side: "revenue",
  kind: "tax_invoice",
  number: id,
  date: "2026-10-05",
  status: "issued",
  shipmentId,
  consoleId: shipmentId ? null : "C1",
  party: null,
  fx: 1,
  taxableInr: amount,
  lines: [{ description: "Freight", amount, reimbursement: false }],
  ...extra,
});
const bill = (id: string, amount: number, extra: Partial<PnlDoc> = {}): PnlDoc => ({
  id,
  side: "cost",
  kind: "carrier_invoice",
  number: id,
  date: "2026-10-05",
  status: "received",
  shipmentId: null,
  consoleId: "C1",
  party: "Line",
  fx: 1,
  taxableInr: amount,
  lines: [{ description: "Ocean freight", amount, reimbursement: false }],
  ...extra,
});
const doc = (kind: SettlingDoc["kind"], inr: number, status = "issued", ours = kind === "credit_note" || kind === "debit_note"): SettlingDoc => ({
  id: `${kind}-${inr}`,
  ours,
  kind,
  number: status === "draft" ? null : "N1",
  status,
  date: "2026-10-06",
  inr,
  currency: "USD",
  amount: inr / 84,
});

const jobs = [job("A", 6), job("B", 4)];
const docs = [invoice("I1", "A", 60000), invoice("I2", "B", 40000), bill("B1", 70000)];

console.log("the terms");
is("the agreement on the agent", termsOf({ profit_share_pct: 50, profit_share_losses: true }), { pct: 50, losses: true, source: "agreement" });
is("none agreed", termsOf({ profit_share_pct: null, profit_share_losses: true }).pct, null);
is("this console agreed differently", termsOf({ profit_share_pct: 50, profit_share_losses: false }, 60), { pct: 60, losses: false, source: "console" });
is("0 on the console: no share on it", termsOf({ profit_share_pct: 50, profit_share_losses: true }, 0), { pct: null, losses: true, source: "console" });

console.log("\na profit, half of it theirs");
const pnl = consolePnl(jobs, docs, { capacityCbm: null, coload: false });
const half = shareFigures(pnl, termsOf({ profit_share_pct: 50, profit_share_losses: true }), []);
is("worked on the console's profit", [half.baseInr, half.dueInr, half.toSettleInr, half.next], [30000, 15000, 15000, "credit_note"]);
is("in their currency", inCurrency(15000, "USD", 84), 178.57);
is("no rate of exchange, no figure", inCurrency(15000, "USD", null), null);
is("rupees need none", inCurrency(15000, "inr", null), 15000);

console.log("\nthe share itself is not in the profit it is worked on");
const raised = invoice("OCN1", null, 15000, { kind: "credit_note", profitShare: true });
const theirs = bill("AGT1", 2000, { kind: "agent_debit_note", profitShare: true });
const after = consolePnl(jobs, withoutShares([...docs, raised, theirs]), { capacityCbm: null, coload: false });
is("the base stays where it was", after.gp, 30000);
is("but the P&L itself counts the note", consolePnl(jobs, [...docs, raised], { capacityCbm: null, coload: false }).gp, 15000);

console.log("\nsettled by notes either way");
is("our credit note to them and their debit note on us are what we owe", [towardAgent({ kind: "credit_note", inr: 10 }), towardAgent({ kind: "agent_debit_note", inr: 10 })], [10, 10]);
is("our debit note on them and their credit note to us are what they owe", [towardAgent({ kind: "debit_note", inr: 10 }), towardAgent({ kind: "agent_credit_note", inr: 10 })], [-10, -10]);
const settled = shareFigures(pnl, termsOf({ profit_share_pct: 50, profit_share_losses: true }), [doc("credit_note", 15000)]);
is("once raised, nothing left", [settled.settledInr, settled.toSettleInr, settled.next], [15000, 0, null]);
const draft = shareFigures(pnl, termsOf({ profit_share_pct: 50, profit_share_losses: true }), [doc("credit_note", 15000, "draft")]);
is("a draft counts: no second note", [draft.draftInr, draft.next], [15000, null]);
const cancelled = shareFigures(pnl, termsOf({ profit_share_pct: 50, profit_share_losses: true }), [doc("credit_note", 15000, "cancelled")]);
is("a cancelled one does not", cancelled.next, "credit_note");
const viaThem = shareFigures(pnl, termsOf({ profit_share_pct: 50, profit_share_losses: true }), [doc("agent_debit_note", 15000, "received", false)]);
is("their own debit note settles it too", viaThem.next, null);

console.log("\na late bill moves the profit after the note");
const late = consolePnl(jobs, [...docs, bill("B2", 4000)], { capacityCbm: null, coload: false });
const topUp = shareFigures(late, termsOf({ profit_share_pct: 50, profit_share_losses: true }), [doc("credit_note", 15000)]);
is("the difference comes back the other way", [topUp.dueInr, topUp.toSettleInr, topUp.next], [13000, -2000, "debit_note"]);
is("and the note says it is the balance", noteDescription(topUp, { console_no: "CON/26-27/0001", mbl: "MSK123" }), "Profit share 50% on console CON/26-27/0001, MBL MSK123 (profit ₹26,000): the balance after the notes already raised");

console.log("\na loss");
const lossPnl = consolePnl(jobs, [...docs, bill("B3", 40000)], { capacityCbm: null, coload: false });
const shared = shareFigures(lossPnl, termsOf({ profit_share_pct: 50, profit_share_losses: true }), []);
is("shared: they owe us their half", [shared.baseInr, shared.dueInr, shared.next], [-10000, -5000, "debit_note"]);
const kept = shareFigures(lossPnl, termsOf({ profit_share_pct: 50, profit_share_losses: false }), []);
is("not shared: nothing", [kept.lossKept, kept.dueInr, kept.next], [true, 0, null]);

console.log("\nnot final yet");
const quoted = consolePnl([job("A", 6), { ...job("B", 4), quotedRevenue: 45000 }], [invoice("I1", "A", 60000), bill("B1", 70000, { status: "draft" })], { capacityCbm: null, coload: false });
is("said, not hidden", shareFigures(quoted, termsOf({ profit_share_pct: 50, profit_share_losses: true }), []).notFinal, [
  "1 house is counted at the quotation: not invoiced yet",
  "a cost is a draft bill: the vendor's invoice is not in yet",
]);

console.log("\nthe statement");
const html = statementHtml({ console_no: "CON/26-27/0001", mbl: "MSK123", agentName: "Gulf Agency", hbl: { A: "ALG/HBL/1" } }, pnl.houses, half, []);
is("each house, the share and what is left", [html.includes("ALG/HBL/1"), html.includes("Your share, 50%"), html.includes("30,000.00"), html.includes("INR 15,000.00 due to you")], [true, true, true, true]);
const note = { ...doc("credit_note", 15000), number: "OCN/26-27/0001", amount: 178.57 };
const sent = statementHtml({ console_no: "CON/26-27/0001", agentName: "Gulf Agency" }, pnl.houses, settled, [note]);
is("each note in its own currency and in rupees, nothing left", [sent.includes("Our credit note to you OCN/26-27/0001"), sent.includes("USD 178.57 (INR 15,000.00 at 84)"), sent.includes("Still to settle")], [true, true, false]);
is("a late bill: the note and the balance back", statementHtml({ console_no: "C", agentName: "G" }, late.houses, topUp, [note]).includes("INR 2,000.00 due from you"), true);
is("names escaped", statementHtml({ agentName: "<b>X</b>", job: "J" }, [], half, []).includes("&lt;b&gt;X&lt;/b&gt;"), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
