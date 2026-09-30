import { missingRate, quoteProblems, rateInUse } from "../../src/lib/quoteChecks";

/** What stops a quotation going to the customer (109; 30 Sep 2026) — the same list the database refuses with. */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const inr = { currency: "INR", fx_rate: 1 };
const line = (position: number, description: string, currency: string, fx_rate: number | string, amount_inr: number | string) => ({ position, description, currency, fx_rate, amount_inr });

console.log("what was found on the desk's quotations");
is(
  "USD 15 left at a rate of 1, in a quotation presented in USD at 1 (ALG09011-26)",
  quoteProblems({ currency: "USD", fx_rate: "1" }, [line(1, "Ocean freight", "USD", "1", "15.00"), line(2, "LCL", "INR", 1, 300), line(3, "Delivery order fee", "INR", 1, 1000)]),
  ["Ocean freight is in USD with no rate of exchange.", "The quotation is in USD with no rate of exchange."]
);
is("a quotation adding up to nothing (ALG09009-26)", quoteProblems(inr, [line(1, "Ocean freight", "INR", 1, 0)]), ["It adds up to nothing (Rs 0)."]);
is("a charge row left without a name (ALG09008-26), numbered as on screen", quoteProblems(inr, [line(2, "Container seal", "INR", 1, 1), line(1, " ", "INR", 1, 0)]), ["Charge 1 has no name."]);
is("no charges at all", quoteProblems(inr, []), ["It has no charges."]);

console.log("\nwhat is allowed");
is("a charge at nothing beside real ones (at actuals)", quoteProblems(inr, [line(1, "Ocean freight", "INR", 1, 2000), line(2, "Duty (at actuals)", "INR", 1, 0)]), []);
is("a foreign charge with its rate", quoteProblems(inr, [line(1, "Ocean freight", "USD", 84, 1260)]), []);
is("a quotation presented in USD with its rate", quoteProblems({ currency: "USD", fx_rate: 84 }, [line(1, "Freight", "INR", 1, 100)]), []);

console.log("\nthe rate of exchange");
is("missing: foreign at 1, at nothing, unreadable; rupees never", [missingRate({ currency: "EUR", fx_rate: 1 }), missingRate({ currency: "EUR", fx_rate: 0 }), missingRate({ currency: "EUR", fx_rate: "x" }), missingRate({ currency: "INR", fx_rate: 1 })], [true, true, true, false]);
is("a line switched to USD starts at the USD rate the quotation already uses", rateInUse([line(1, "A", "USD", 1, 0), line(2, "B", "USD", 83.5, 0), line(3, "C", "EUR", 91, 0)], "USD"), 83.5);
is("none in use: none guessed", rateInUse([line(1, "A", "INR", 1, 0)], "AED"), null);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
