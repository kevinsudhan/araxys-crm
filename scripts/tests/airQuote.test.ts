import { normalisePasted, withShares, chargesLayout, lineValue, sectionsByHeading, statedWeight, withStatedWeight, type PastedLine } from "../../src/lib/pastedQuote";
import { airTable, airText, airTitle } from "../../src/lib/airQuote";
import { airTableHtml, quotationHtml } from "../../src/lib/quotationMail";
import { tableRows } from "../../src/lib/pastedTable";

/** A pasted air quotation as the desk's rate table (115), on the desk's own HEL - IST - MAA sheet (1 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// What the AI returns for the desk's sheet (see classify-enquiry, paste_quote).
const raw = {
  lines: [
    { section: "freight", description: "AF charges", currency: "EUR", unit: "Kg", quantity: 578, rate: 3.2, gst_rate: 0 },
    { section: "freight", description: "EXW charges", currency: "EUR", unit: "Shipment", quantity: 1, rate: 795, gst_rate: 18 },
    { section: "destination", description: "CC charges", currency: "INR", unit: "Shipment", quantity: 1, rate: 0, gst_rate: 18, percent: 3, percent_of: [0, 1], rate_text: "3% on OF+EXW" },
    { section: "destination", description: "Aashish DO charges", currency: "INR", unit: "Shipment", quantity: 1, rate: 2500, gst_rate: 18 },
    { section: "destination", description: "Airline DO charges", currency: "INR", unit: "Shipment", quantity: 1, rate: 0, gst_rate: 18, note: "at receipted" },
  ],
  terms: [],
  valid_until: null,
  exchange_rates: [{ currency: "EUR", inr: 111.7 }],
  routing: "HEL-IST-MAA",
  carrier: "TK",
  transit_time: "2-3 days",
};
const job = { origin: "Helsinki", destination: "Chennai", incoterm: "EXW", piece_count: 1, gross_weight_kg: 578 };

console.log("what the AI sent");
const q = normalisePasted(raw);
is("the groups as the sheet has them", q.lines.map((l) => l.section), ["freight", "freight", "destination", "destination", "destination"]);
is("GST as quoted", q.lines.map((l) => l.gst), [0, 18, 18, 18, 18]);
is("a percentage keeps its wording and what it is of", [q.lines[2].percent, q.lines[2].percentOf, q.lines[2].note], [3, ["l1", "l2"], "3% on OF+EXW"]);
is("routing, carrier and transit time", [q.routing, q.carrier, q.transitTime], ["HEL-IST-MAA", "TK", "2-3 days"]);
is("a percentage of itself or of nothing that exists is dropped", normalisePasted({ lines: [{ description: "x", percent: 5, percent_of: [0, 7] }] }).lines[0].percentOf, []);
is("a GST over 28 is not a GST", normalisePasted({ lines: [{ description: "x", rate: 1, gst_rate: 180 }] }).lines[0].gst, null);

console.log("\nthe desk's own headings");
const sheet = [
  "EX. HEL - IST - MAA//EXW//NO OF PKGS:01//GWT:578 KGS//CARRIER:TK ///TT:2-3DAY// AASHISH LOGISTICS PVT LTD",
  "CHARGES\tCURRENCY/QUANTUM\tRATES\tINR\tGST\tTOTAL VALUE IN INR",
  "FREIGHT CHARGES",
  "AF CHARGES\tEURO/KGS\t3.2\t206600.32\t-\t206600.32\t1 EUR = INR 111.7",
  "EXW CHARGES\tEURO/SHPT\t795\t88801.5\t15984.27\t104785.77",
  "DESTINATION CHARGES",
  "CC CHARGES\tINR/SHIPMENT\t3% ON OF+EXW\t8862.05\t1595.169\t10457.219",
].join("\n");
const read: PastedLine[] = [
  { section: "freight", description: "AF charges", currency: "EUR", unit: "Kg", quantity: 578, rate: 3.2, note: null },
  { section: "ex_works", description: "EXW charges", currency: "EUR", unit: "Shipment", quantity: 1, rate: 795, note: null },
  { section: "other", description: "CC charges", currency: "INR", unit: "Shipment", quantity: 1, rate: 0, note: null },
  { section: "other", description: "Insurance", currency: "INR", unit: "Shipment", quantity: 1, rate: 500, note: null },
];
is("EXW charges under FREIGHT CHARGES stay freight; a charge not in the text keeps its group", sectionsByHeading(sheet, read).map((l) => l.section), ["freight", "freight", "destination", "other"]);
is(
  "headings with a colon and a hyphen",
  sectionsByHeading("FREIGHT CHARGES :\nOcean freight USD 45\nEX- WORKS CHARGES :\nPickup 4500", [
    { section: "other", description: "Ocean freight", currency: "USD", unit: "W/M", quantity: 1, rate: 45, note: null },
    { section: "other", description: "Pickup", currency: "INR", unit: "Trip", quantity: 1, rate: 4500, note: null },
  ]).map((l) => l.section),
  ["freight", "ex_works"]
);
const cellPerLine = "FREIGHT CHARGES\n \nAF CHARGES\nEURO/KGS\n3.2\nEXW CHARGES\nEURO/SHPT\n795\n \nDESTINATION CHARGES\n \nCC CHARGES\nINR/SHIPMENT\n3% ON OF+EXW";
is("a table pasted a cell per line: EXW CHARGES on its own line is the charge, not a heading", sectionsByHeading(cellPerLine, read.slice(0, 3)).map((l) => l.section), ["freight", "freight", "destination"]);
is("no headings: as read", sectionsByHeading("AF 3.2/kg\nEXW 795", read).map((l) => l.section), read.map((l) => l.section));
is("a charge line with figures is not a heading", sectionsByHeading("Destination charges INR 4500\nAF charges 3.2", read.slice(0, 1)).map((l) => l.section), ["freight"]);

is("a pasted table read as rows of cells", tableRows("TITLE\n\nAF CHARGES\tEURO/KGS\t3.2\n\t\tTOTAL\t306763.87"), [["TITLE"], ["AF CHARGES", "EURO/KGS", "3.2"], ["", "", "TOTAL", "306763.87"]]);
is("text with no tab is not a table", tableRows("AF 3.2/kg\nEXW 795"), null);

console.log("\nthe weight the rate states");
is("GWT in the title line", statedWeight("EX. HEL - IST - MAA//EXW//NO OF PKGS:01//GWT:578 KGS//CARRIER:TK"), 578);
is("the chargeable weight over the gross", statedWeight("Gross weight 520 kg, chargeable weight 600 kg"), 600);
is("none stated", statedWeight("AF EUR 3.2/kg"), null);
const perKg = (quantity: number): PastedLine => ({ section: "freight", description: "AF", currency: "EUR", unit: "Kg", quantity, rate: 3.2, note: null });
is("the enquiry's weight gives way to the rate's", withStatedWeight([perKg(2520)], "GWT:578 KGS", [2520]).map((l) => l.quantity), [578]);
is("so does a bare 1", withStatedWeight([perKg(1)], "GWT:578 KGS", [2520]).map((l) => l.quantity), [578]);
is("a count the rate gives the charge stays", withStatedWeight([perKg(600)], "GWT:578 KGS", [2520]).map((l) => l.quantity), [600]);
is("not per kg: untouched", withStatedWeight([{ ...perKg(1), unit: "Shipment" }], "GWT:578 KGS", [2520]).map((l) => l.quantity), [1]);

is("the table's first line takes the rate's weight over the enquiry's", airTitle({ ...job, gross_weight_kg: 2520 }, { lines: [perKg(578)], routing: null, carrier: null, transitTime: null, weightKg: 578 }).includes("GWT: 578 KGS"), true);

console.log("\nthe percentage worked out");
const w = withShares(q);
is("3% of the freight and ex works in rupees", w.lines[2].rate, 8862.05);
is("in rupees, as one figure", [w.lines[2].currency, w.lines[2].quantity], ["INR", 1]);
is("no rate of exchange, no figure", withShares({ ...q, roe: {} }).lines[2].rate, 0);
is("a charge with no figure reads as its condition", lineValue(w.lines[4]), "at receipted");

console.log("\nthe table");
const t = airTable(w, job);
is("its first line", t.title, "EX HEL - IST - MAA // EXW // NO OF PKGS: 1 // GWT: 578 KGS // CARRIER: TK // TT: 2-3 DAYS");
is("freight, then destination", t.groups.map((g) => g.title), ["FREIGHT CHARGES", "DESTINATION CHARGES"]);
const [af, exw] = t.groups[0].rows;
const [cc, ado, airline] = t.groups[1].rows;
is("air freight: per kg, no GST", [af.basis, af.rate, af.inr, af.gst, af.value], ["EUR/KG", "3.20 × 578", 206600.32, null, 206600.32]);
is("ex works: per shipment, GST 18", [exw.basis, exw.rate, exw.inr, exw.gst, exw.value], ["EUR/SHPT", "795", 88801.5, 15984.27, 104785.77]);
is("the percentage shows its wording as the rate", [cc.basis, cc.rate, cc.inr, cc.gst, cc.value], ["INR/SHPT", "3% ON OF+EXW", 8862.05, 1595.17, 10457.22]);
is("DO", [ado.inr, ado.gst, ado.value], [2500, 450, 2950]);
is("at receipted across the figures, counting for nothing", [airline.instead, airline.inr, airline.value], ["AT RECEIPTED", null, null]);
is("the totals", [t.inr, t.gst, t.value], [306763.87, 18029.44, 324793.31]);
is("the rate of exchange", t.roe, [{ currency: "EUR", inr: 111.7 }]);
is("charged on more than it weighs: the chargeable weight too", airTitle({ ...job, gross_weight_kg: 520 }, { ...w, lines: w.lines }).includes("GWT: 520 KGS // CHWT: 578 KGS"), true);
is("no routing: the enquiry's places", airTitle(job, { lines: [], routing: null, carrier: null, transitTime: null }), "EX HELSINKI - CHENNAI // EXW // NO OF PKGS: 1 // GWT: 578 KGS");

console.log("\nin the mail");
const html = airTableHtml(t);
is("the columns", ["CHARGES", "CURRENCY / QUANTUM", "RATES", ">INR<", ">GST<", "TOTAL VALUE IN INR"].every((h) => html.includes(h)), true);
is("figures to the paisa, Indian grouping", ["2,06,600.32", "15,984.27", "1,04,785.77"].every((f) => html.includes(f)), true);
is("no TOTAL row: the quotation is its charges", [html.includes(">TOTAL</td>"), html.includes("3,06,763.87"), html.includes("3,24,793.31")], [false, false, false]);
is("no GST is a dash", html.includes(">-</td>"), true);
is("at receipted spans the four figure columns", html.includes('colspan="4"') && html.includes(">AT RECEIPTED</td>"), true);
is("the rate of exchange on the yellow mark", html.includes("background:#ffff00") && html.includes("1 EUR = INR 111.70"), true);
is("a name with markup is escaped", airTableHtml({ ...t, groups: [{ title: "G", rows: [{ ...af, name: "A<B" }] }] }).includes("A&lt;B"), true);
const letter = quotationHtml({
  enquiry: { ref: "ALG-T", origin: "Helsinki", destination: "Chennai", transport_mode: "air" } as never,
  customer: { id: "c", name: "Test", company: "Test Imports", phones: [], emails: [] },
  quote: { id: "q", version: 1, amount_inr: 306763.87, created_at: "2026-10-01T10:00:00Z", valid_until: null } as never,
  lines: [],
  terms: [],
  charges: chargesLayout(w),
  airCharges: t,
});
is("the letter carries the table, not the text layout", [letter.includes("TOTAL VALUE IN INR"), letter.includes("FREIGHT CHARGES :")], [true, false]);
is("as text, kept on the quotation", airText(t).split("\n").slice(-3), ["TOTAL | | | 3,06,763.87 | 18,029.44 | 3,24,793.31", "", "1 EUR = INR 111.70"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
