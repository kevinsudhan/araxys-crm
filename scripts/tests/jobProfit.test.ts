import { chargeKey, jobProfit, profitQuoteOf, type BuyLine, type SellLine } from "../../src/lib/jobProfit";

/** The profit on a job: the partner's original rate against the quotation, charge by charge (128, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log("one charge, however it is written");
is(
  "the trade's abbreviations, brackets and the word 'charges' set aside",
  ["O/F", "Ocean Freight Charges", "OF", "THC", "Terminal handling charges", "D/O charges", "Delivery order fee", "B/L fee", "Documentation", "EXW charges (at actuals)", "Ex-works", "AF", "Air freight"].map(chargeKey),
  ["ocean freight", "ocean freight", "ocean freight", "thc", "thc", "do", "do", "bl", "bl", "exw", "exw", "air freight", "air freight"]
);
is("'of' inside a name stays a word", [chargeKey("Bill of lading"), chargeKey("Cost of handling")], ["bl", "cost handling"]);

console.log("\na sea FCL job, two containers");
const buy: BuyLine[] = [
  { section: "freight", description: "O/F", currency: "USD", unit: "Container", quantity: 1, rate: 1200 },
  { section: "destination", description: "THC", currency: "INR", unit: "Container", quantity: 1, rate: 9000 },
  { section: "destination", description: "Documentation", currency: "INR", unit: "B/L", quantity: 1, rate: 1500 },
  { section: "other", description: "Insurance", currency: "INR", unit: "Shipment", quantity: 1, rate: 2000 },
  { section: "destination", description: "Customs examination", currency: "INR", unit: "Shipment", quantity: 1, rate: 0, note: "at actuals" },
];
const sell: SellLine[] = [
  { section: "freight", description: "Ocean freight", currency: "USD", unit: "Container", quantity: 2, rate: 1400, fx_rate: 84, amount_inr: 235200 },
  { section: "destination", description: "Terminal handling charges", currency: "INR", unit: "Container", quantity: 2, rate: 10000, fx_rate: 1, amount_inr: 20000 },
  { section: "destination", description: "B/L fee", currency: "INR", unit: "B/L", quantity: 1, rate: 2500, fx_rate: 1, amount_inr: 2500 },
  { section: "destination", description: "Our handling", currency: "INR", unit: "Shipment", quantity: 1, rate: 3000, fx_rate: 1, amount_inr: 3000 },
];
const p = jobProfit(buy, { USD: 84 }, sell);
is(
  "each charge on the quotation's quantity: the partner's rate for the 2 containers quoted",
  p.rows.map((r) => [r.name, r.kind, r.buyInr, r.sellInr, r.profitInr]),
  [
    ["Ocean freight", "both", 201600, 235200, 33600],
    ["Terminal handling charges", "both", 18000, 20000, 2000],
    ["B/L fee", "both", 1500, 2500, 1000],
    ["Our handling", "sell_only", 0, 3000, 3000],
    ["Insurance", "buy_only", 2000, 0, -2000],
    ["Customs examination", "buy_only", 0, 0, 0],
  ]
);
is("the job: cost, charged, profit, margin", [p.buyInr, p.sellInr, p.profitInr, Math.round((p.margin ?? 0) * 1000) / 10], [223100, 260700, 37600, 14.4]);

console.log("\nquoted below the partner's rate");
const under = jobProfit([{ section: "freight", description: "Ocean freight", currency: "USD", unit: "Container", quantity: 1, rate: 1500 }], { USD: 84 }, [
  { section: "freight", description: "O/F", currency: "USD", unit: "Container", quantity: 1, rate: 1450, fx_rate: 84, amount_inr: 121800 },
]);
is("a loss, said as one", [under.profitInr, under.margin !== null && under.margin < 0], [-4200, true]);

console.log("\ndifferent units, different currencies");
const units = jobProfit([{ section: "freight", description: "Air freight", currency: "EUR", unit: "Shipment", quantity: 1, rate: 1800 }], { EUR: 111.7 }, [
  { section: "freight", description: "AF charges", currency: "EUR", unit: "Kg", quantity: 578, rate: 3.6, fx_rate: 111.7, amount_inr: 232425.36 },
]);
is("the partner per shipment, the desk per kilo: each on its own quantity", [units.rows[0].kind, units.rows[0].buyInr, units.profitInr], ["both", 201060, 31365.36]);
const noRoe = jobProfit([{ section: "freight", description: "Ocean freight", currency: "USD", unit: "Container", quantity: 1, rate: 1500 }], {}, [
  { section: "freight", description: "Ocean freight", currency: "INR", unit: "Container", quantity: 1, rate: 130000, fx_rate: 1, amount_inr: 130000 },
]);
is("no rate of exchange for the partner's dollars: said, and not counted as free", [noRoe.missingRoe, noRoe.rows[0].buyInr, noRoe.rows[0].profitInr], [["USD"], null, null]);

console.log("\nmatching within the group first");
const groups = jobProfit(
  [
    { section: "ex_works", description: "THC", currency: "INR", unit: "Container", quantity: 1, rate: 7000 },
    { section: "destination", description: "THC", currency: "INR", unit: "Container", quantity: 1, rate: 9000 },
  ],
  {},
  [
    { section: "destination", description: "THC", currency: "INR", unit: "Container", quantity: 1, rate: 10000, fx_rate: 1, amount_inr: 10000 },
    { section: "ex_works", description: "Origin THC", currency: "INR", unit: "Container", quantity: 1, rate: 8000, fx_rate: 1, amount_inr: 8000 },
  ]
);
is("destination THC against destination THC, origin against origin", groups.rows.map((r) => [r.name, r.buyInr]), [["THC", 9000], ["Origin THC", 7000]]);

console.log("\nwhich quotation");
is("the accepted one", profitQuoteOf([{ status: "superseded", version: 1 }, { status: "accepted", version: 2 }, { status: "draft", version: 3 }])?.version, 2);
is("else the latest in play", profitQuoteOf([{ status: "sent", version: 1 }, { status: "draft", version: 2 }])?.version, 2);
is("none in play", profitQuoteOf([{ status: "declined", version: 1 }]), null);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
