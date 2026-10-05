import { mergeBuyLines, pasteSummary, type StoredBuyLine } from "../../src/lib/buyRate";
import type { BuyLine } from "../../src/lib/jobProfit";

/** The partner's original rate built up over several pastes: revised, added to, replaced (129, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const line = (section: string, description: string, currency: string, unit: string, rate: number, quantity = 1): BuyLine => ({ section, description, currency, unit, quantity, rate });

console.log("the first paste: the freight only");
const first = mergeBuyLines([], [line("freight", "O/F", "USD", "Container", 1200)], { from: "Orient", at: "2026-10-05T09:00:00Z", pastedText: "OF USD 1200" });
is("it becomes the original rate, marked whose and when", first.lines.map((l) => [l.description, l.from, l.at, l.was]), [["O/F", "Orient", "2026-10-05T09:00:00Z", null]]);
is("said as added", pasteSummary(first.entry), "1 added");

console.log("\nthe rest of the charges, a day later");
const second = mergeBuyLines(first.lines, [line("destination", "THC", "INR", "Container", 9000), line("destination", "Documentation", "INR", "B/L", 1500)], {
  from: "Orient",
  at: "2026-10-06T10:00:00Z",
  pastedText: "THC 9000, DOC 1500",
});
is("added to what was there; the freight stays", second.lines.map((l) => [l.description, l.rate]), [["O/F", 1200], ["THC", 9000], ["Documentation", 1500]]);
is("said", pasteSummary(second.entry), "2 added");

console.log("\nthe partner revises the freight, written differently");
const third = mergeBuyLines(second.lines, [line("freight", "Ocean freight", "USD", "Container", 1150), line("destination", "THC", "INR", "Container", 9000)], {
  from: "Orient",
  at: "2026-10-07T11:00:00Z",
  pastedText: "Revised: Ocean freight USD 1150, THC 9000",
});
const of = third.lines[0] as StoredBuyLine;
is("the freight updated in place, its old figure kept", [third.lines.length, of.description, of.rate, of.was, of.at], [3, "Ocean freight", 1150, { currency: "USD", rate: 1200, unit: "Container" }, "2026-10-07T11:00:00Z"]);
is("what it changed, and what it did not", [pasteSummary(third.entry), third.entry.updated], ["1 charge updated, 1 as before", [{ name: "O/F", from: "USD 1,200 / Container", to: "USD 1,150 / Container" }]]);
is("a charge not in this paste stays", third.lines[2].description, "Documentation");

console.log("\nanother partner, another charge");
const fourth = mergeBuyLines(third.lines, [line("ex_works", "Pickup", "INR", "Trip", 4500)], { from: "Kovai Trucking", at: "2026-10-07T12:00:00Z", pastedText: "Pickup 4500" });
is("each charge says whose it is", fourth.lines.map((l) => (l as StoredBuyLine).from), ["Orient", "Orient", "Orient", "Kovai Trucking"]);

console.log("\nthe same name in another group is another charge");
const groups = mergeBuyLines([line("ex_works", "THC", "INR", "Container", 7000)] as StoredBuyLine[], [line("destination", "THC", "INR", "Container", 9000)], { from: "X", at: "t", pastedText: "" });
is("origin THC and destination THC both kept", groups.lines.map((l) => [l.section, l.rate]), [["ex_works", 7000], ["destination", 9000]]);

console.log("\na whole new rate");
const fresh = mergeBuyLines(fourth.lines, [line("freight", "O/F", "USD", "Container", 1100)], { from: "Orient", at: "t2", pastedText: "new" }, true);
is("replaces everything when said", [fresh.lines.length, pasteSummary(fresh.entry)], [1, "Replaced the original rate: 1 charge"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
