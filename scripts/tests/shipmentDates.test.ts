import { dateClashes } from "../../src/lib/shipmentDates";

/** Dates on a job that cannot all be true (30 Sep 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const none = { ready: null, cutoff: null, siCutoff: null, etd: null, eta: null };

is("ARX-SHP-0006: ready the day after it sails", dateClashes({ ...none, ready: "2026-10-01", etd: "2026-09-30", stage: "booked" }), [
  "The cargo is ready on 1 Oct, after the ETD (30 Sep): it cannot make this departure.",
]);
is("ready after the cut-off, before the ETD", dateClashes({ ...none, ready: "2026-10-03", cutoff: "2026-10-02", etd: "2026-10-05" }), [
  "The cargo is ready on 3 Oct, after the cargo cut-off (2 Oct).",
]);
is("a cut-off after the sailing, and an SI cut-off too", dateClashes({ ...none, cutoff: "2026-10-06", siCutoff: "2026-10-07", etd: "2026-10-05" }), [
  "The cargo cut-off (6 Oct) is after the ETD (5 Oct).",
  "The SI cut-off (7 Oct) is after the ETD (5 Oct).",
]);
is("arriving before it leaves", dateClashes({ ...none, etd: "2026-10-05T10:00:00Z", eta: "2026-10-01" }), ["The ETA (1 Oct) is before the ETD (5 Oct)."]);
is("once sailed, the cargo side no longer matters; the ETA still does", dateClashes({ ready: "2026-10-09", cutoff: null, siCutoff: null, etd: "2026-10-05", eta: "2026-10-01", stage: "sailed" }), [
  "The ETA (1 Oct) is before the ETD (5 Oct).",
]);
is("a job whose dates agree says nothing", dateClashes({ ready: "2026-10-01", cutoff: "2026-10-03", siCutoff: "2026-10-02", etd: "2026-10-05", eta: "2026-10-20" }), []);
is("nothing known, nothing said", dateClashes(none), []);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
