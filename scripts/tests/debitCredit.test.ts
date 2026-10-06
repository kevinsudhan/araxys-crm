import { byJob, byMonth, byParty, monthLabel, periodDays, standing, totals, within, type DcDoc, type DcJob } from "../../src/lib/debitCredit";

/** Debit and credit per shipment and per party (7 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const doc = (id: string, side: DcDoc["side"], kind: string, amount: number, settled: number, o: Partial<DcDoc> = {}): DcDoc => ({
  id,
  side,
  kind,
  number: id.toUpperCase(),
  date: "2026-09-10",
  status: "issued",
  shipmentId: "S1",
  consoleId: null,
  partyKey: "c:ravi",
  partyName: "Ravi Exports",
  partyType: "Customer",
  amount,
  settled,
  ...o,
});
const carrier = { partyKey: "p:msc", partyName: "MSC", partyType: "Carrier / line" };
const agent = { partyKey: "p:gulf", partyName: "Gulf Agency", partyType: "Overseas agent" };

const docs: DcDoc[] = [
  doc("inv1", "debit", "tax_invoice", 11800, 6000),
  doc("cn1", "debit", "credit_note", -1180, 0),
  doc("b1", "credit", "carrier_invoice", 7000, 7000, carrier),
  doc("adn1", "credit", "agent_debit_note", 2000, 0, { ...agent, date: "2026-07-02" }),
  doc("acn1", "credit", "agent_credit_note", -500, 0, { ...agent, date: "2026-07-02" }),
  doc("dn2", "debit", "debit_note", 4000, 4000, { ...agent, shipmentId: "S2", date: "2026-10-01" }),
  doc("mb1", "credit", "carrier_invoice", 3000, 0, { ...carrier, shipmentId: null, consoleId: "K1" }),
];
const jobs: DcJob[] = [
  { id: "S1", ref: "ALG10001-26", customer: "Ravi Exports", route: "Chennai → Jebel Ali", mode: "sea_fcl", consoleId: null, consoleNo: null },
  { id: "S2", ref: "ALG10002-26", customer: "Gulf Linen", route: "Kaohsiung → Chennai", mode: "sea_lcl", consoleId: "K1", consoleNo: "C-001" },
];

console.log("\nthe book");
is("debit less our credit note; credit less the agent's credit note", totals(docs), {
  debit: 14620,
  credit: 11500,
  difference: 3120,
  received: 10000,
  paid: 7000,
  toCollect: 4620,
  toPay: 4500,
});

console.log("\nby shipment");
const rows = byJob(jobs, docs, (id) => (id === "K1" ? "C-001" : null));
is("biggest first, the console's own documents a row of their own", rows.map((r) => [r.key, r.label, r.debit, r.credit, r.count]), [
  ["S1", "ALG10001-26", 10620, 8500, 3],
  ["S2", "ALG10002-26", 4000, 0, 1],
  ["console:K1", "Console C-001", 0, 3000, 1],
]);
is("a shipment's line: customer and route", rows[0].sub, "Ravi Exports · Chennai → Jebel Ali");

console.log("\nby party");
const parties = byParty(docs);
is("each party both ways, on how many shipments", parties.map((p) => [p.label, p.sub, p.debit, p.credit, p.count]), [
  ["Ravi Exports", "Customer", 10620, 0, 1],
  ["MSC", "Carrier / line", 0, 10000, 2],
  ["Gulf Agency", "Overseas agent", 4000, 1500, 2],
]);
is("where each stands: they owe us, we owe them", parties.map((p) => standing(p)), [4620, -3000, -1500]);

console.log("\nmonths");
is("every month in the range, empty ones too", byMonth(docs, "2026-06-01", "2026-10-07").map((m) => [m.month, m.debit, m.credit]), [
  ["2026-06", 0, 0],
  ["2026-07", 0, 1500],
  ["2026-08", 0, 0],
  ["2026-09", 10620, 10000],
  ["2026-10", 4000, 0],
]);
is("all time runs from the first document to the last", byMonth(docs, null, null).map((m) => m.month), ["2026-07", "2026-08", "2026-09", "2026-10"]);
is("month label", monthLabel("2026-10"), "Oct 26");

console.log("\nperiods");
is("this month", periodDays("month", "2026-10-07"), { from: "2026-10-01", to: "2026-10-07" });
is("last 3 months, this one included", periodDays("3m", "2026-10-07"), { from: "2026-08-01", to: "2026-10-07" });
is("the financial year from April", periodDays("fy", "2026-10-07"), { from: "2026-04-01", to: "2026-10-07" });
is("in February, the year that began last April", periodDays("fy", "2027-02-10"), { from: "2026-04-01", to: "2027-02-10" });
is("three months back across a new year", periodDays("3m", "2027-01-15"), { from: "2026-11-01", to: "2027-01-15" });
is("in the period", docs.filter((d) => within(d, periodDays("month", "2026-10-07"))).map((d) => d.id), ["dn2"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
