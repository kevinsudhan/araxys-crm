import { lineText, normalisePasted, plainTextHtml, quoteMailText, quoteText, sumByCurrency, totalInInr } from "../../src/lib/pastedQuote";

/** A pasted quotation, laid out for the mail with totals the app works out (29 Sep 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// What the AI returned for the test quotation (see classify-enquiry, paste_quote).
const raw = {
  lines: [
    { section: "ex_works", description: "Pickup from Ambattur factory", currency: "INR", unit: "Trip", quantity: 1, rate: 4500 },
    { section: "ex_works", description: "Export customs clearance", currency: "inr", unit: "shipment", quantity: 1, rate: "2,500" },
    { section: "other", description: "Ocean freight", currency: "USD", unit: "Container", quantity: 2, rate: 1150 },
    { section: "other", description: "BL fee", currency: "INR", unit: "B/L", quantity: 1, rate: 1500 },
    { section: "other", description: "DO charges at destination", currency: "AED", unit: "B/L", quantity: 1, rate: 450, note: "at actuals" },
    { section: "odd", description: "  ", currency: "XYZ", unit: "?", quantity: 0, rate: 1 },
  ],
  terms: ["Rates subject to space availability.", " "],
  valid_until: "2026-10-14",
  exchange_rates: [{ currency: "usd", inr: 84 }, { currency: "INR", inr: 1 }],
};

console.log("what the AI sent, held to what the quotation accepts");
const q = normalisePasted(raw);
is("a line with no name is dropped", q.lines.length, 5);
is("currency and unit case put right", [q.lines[1].currency, q.lines[1].unit], ["INR", "Shipment"]);
is("a figure written with a comma is read", q.lines[1].rate, 2500);
is("an exchange rate kept by currency, rupees ignored", q.roe, { USD: 84 });
is("an empty term dropped", q.terms, ["Rates subject to space availability."]);
is("an unknown section is Other", normalisePasted({ lines: [{ section: "x", description: "a", currency: "INR", unit: "B/L", quantity: 1, rate: 1 }] }).lines[0].section, "other");
is("an unknown unit is Lumpsum, an unknown currency INR", (() => { const l = normalisePasted({ lines: [{ description: "a", currency: "XYZ", unit: "pallet", quantity: 1, rate: 1 }] }).lines[0]; return [l.unit, l.currency]; })(), ["Lumpsum", "INR"]);

console.log("\nlines and totals");
is("a count is shown with its product", lineText(q.lines[2]), "Ocean freight: USD 1,150 per container × 2 = USD 2,300");
is("a per-shipment charge reads as one figure", lineText(q.lines[1]), "Export customs clearance: INR 2,500");
is("a note follows the figure", lineText(q.lines[4]), "DO charges at destination: AED 450 per B/L (at actuals)");
is("totals by currency, rupees first", sumByCurrency(q.lines.filter((l) => l.section === "other")), [{ currency: "INR", amount: 1500 }, { currency: "USD", amount: 2300 }, { currency: "AED", amount: 450 }]);
is("no rupee total while AED has no rate", totalInInr(q.lines, q.roe), null);
is("with it, the whole in rupees", totalInInr(q.lines, { ...q.roe, AED: 22.9 }), 4500 + 2500 + 2300 * 84 + 1500 + 450 * 22.9);

console.log("\nthe mail text");
const text = quoteText({ ...q, roe: { ...q.roe, AED: 22.9 } }, "Quotation TEST-0001");
const lines = text.split("\n");
is("it starts with the heading", lines[0], "Quotation TEST-0001");
is("ex works first, under its title", lines[2], "EX WORKS CHARGES");
is("with its own total", lines.includes("Ex works total: INR 7,000"), true);
is("then the other charges", lines.includes("OTHER CHARGES"), true);
is("their total by currency", lines.includes("Other charges total: INR 1,500 + USD 2,300 + AED 450"), true);
is("the whole in rupees with its rates", lines.find((l) => l.startsWith("TOTAL:")), "TOTAL: INR 2,12,005 (USD at 84, AED at 22.90)");
is("validity in words", lines.includes("Valid until 14 Oct 2026."), true);
is("terms as a list", lines.slice(-2), ["Terms", "- Rates subject to space availability."]);
is("without every rate, the total stays by currency", quoteText(q, "Q").split("\n").find((l) => l.startsWith("TOTAL:")), "TOTAL: INR 8,500 + USD 2,300 + AED 450");

console.log("\nthe mail around it");
const mail = quoteMailText({ name: "Meena Rajan", text: "X", acceptUrl: null });
is("greets by first name", mail.split("\n")[0], "Dear Meena,");
is("no name, a polite default", quoteMailText({ name: "", text: "X" }).split("\n")[0], "Dear Sir/Madam,");
is("says how to accept", mail.split("\n").pop(), "To accept, please reply to this mail.");
is("plain text to a mail body, escaped", plainTextHtml("A < B\n\nC"), "<div>A &lt; B</div><div><br></div><div>C</div>");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
