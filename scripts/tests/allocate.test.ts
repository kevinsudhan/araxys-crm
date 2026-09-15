import { remainderAfter, spreadOldestFirst } from "../../src/lib/allocate";

/**
 * Applying a receipt across what is owed.
 *
 * Money arithmetic, so the cases that matter are the awkward ones: a receipt
 * bigger than the debt, one smaller, paise, and an invoice that is already
 * settled sitting in the middle of the list.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

const inv = (id: string, outstanding: number) => ({ invoice_id: id, outstanding });

console.log("\nthe screenshot's own case: 17,196 over 17,000 and 196");
is(
  "clears both exactly",
  spreadOldestFirst(17196, [inv("a", 17000), inv("b", 196)]),
  [{ invoice_id: "a", amount: 17000 }, { invoice_id: "b", amount: 196 }]
);
is("nothing left over", remainderAfter(17196, [inv("a", 17000), inv("b", 196)]), 0);

console.log("\nless than is owed stops when the money runs out");
is(
  "part-pays the oldest and never reaches the second",
  spreadOldestFirst(5000, [inv("a", 17000), inv("b", 196)]),
  [{ invoice_id: "a", amount: 5000 }]
);

console.log("\nmore than is owed leaves an advance");
is(
  "takes only what each invoice is short",
  spreadOldestFirst(20000, [inv("a", 17000), inv("b", 196)]),
  [{ invoice_id: "a", amount: 17000 }, { invoice_id: "b", amount: 196 }]
);
is("and the rest sits on account", remainderAfter(20000, [inv("a", 17000), inv("b", 196)]), 2804);

console.log("\ninvoices with nothing owing are skipped, not zero-filled");
is(
  "a settled invoice in the middle",
  spreadOldestFirst(500, [inv("a", 0), inv("b", 300), inv("c", 400)]),
  [{ invoice_id: "b", amount: 300 }, { invoice_id: "c", amount: 200 }]
);
is(
  "a negative outstanding is treated as nothing owing",
  spreadOldestFirst(100, [inv("a", -50), inv("b", 100)]),
  [{ invoice_id: "b", amount: 100 }]
);

console.log("\npaise");
is(
  "lines are rounded to paise and still add up",
  spreadOldestFirst(100.005, [inv("a", 33.333), inv("b", 66.667)]),
  [{ invoice_id: "a", amount: 33.33 }, { invoice_id: "b", amount: 66.67 }]
);
is(
  "a line is never rounded past what the invoice is short",
  spreadOldestFirst(1000, [inv("a", 0.014)]),
  [{ invoice_id: "a", amount: 0.01 }]
);

console.log("\nnothing to do");
is("no invoices", spreadOldestFirst(500, []), []);
is("no money", spreadOldestFirst(0, [inv("a", 900)]), []);
is("all of it stays on account", remainderAfter(500, []), 500);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
