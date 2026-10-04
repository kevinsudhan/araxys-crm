import { emptyContainer, emptyHbl } from "../../src/lib/hbl";
import {
  blanksFromCopy,
  cfsHtml,
  cfsIssues,
  cfsSubject,
  checkMasterCopy,
  copyIssues,
  importProgress,
  lineDoState,
  nextImportStep,
  type ImportConsole,
  type MasterCopy,
} from "../../src/lib/importMaster";
import type { ConsoleBox } from "../../src/lib/masterBill";
import { releaseChecklist } from "../../src/lib/receivedHbl";

/** An import console's master B/L at this end: the copy checked, the CFS, the release, the line's DO, the destuffing (120, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const us = "AASHISH LOGISTICS GLOBAL PVT LTD";
const blank: ImportConsole = {
  console_no: "CON/26-27/0012",
  carrier: "",
  mbl_number: null,
  mbl_date: null,
  vessel: "Kota Lestari",
  voyage: "",
  pol: "Shanghai",
  pod: "Chennai",
  eta: "2026-10-20",
  igm_no: "",
  igm_date: null,
  mbl_copy_at: null,
  mbl_release: null,
  release_in_hand_at: null,
  release_in_hand_ref: "",
  line_invoice_no: "",
  line_charges_inr: null,
  line_paid_at: null,
  line_do_no: "",
  line_do_at: null,
  line_do_valid_till: null,
  cfs_name: "",
  cfs_nominated_at: null,
  cfs_nominated_to: "",
  destuffed_on: null,
};
const boxes: ConsoleBox[] = [{ container_no: "PCIU1234567", size_type: "40HC", seal_no: "PIL55667", packages: 40, gross_kg: 9000, cbm: 50, houses: 3 }];
const houses = { packages: 40, grossKg: 9000, cbm: 50 };

const bill = emptyHbl();
bill.consignee_name = "AASHISH LOGISTICS GLOBAL PRIVATE LIMITED";
bill.vessel = "KOTA LESTARI";
bill.voyage = "0127W";
bill.port_of_loading = "SHANGHAI, CHINA";
bill.port_of_discharge = "CHENNAI";
bill.containers = [{ ...emptyContainer(), container_no: "PCIU1234567", seal_no: "PIL55668" }];
bill.packages = "40";
bill.gross_weight_kg = "9004";
bill.measurement_cbm = "50.4";
bill.date_of_issue = "2026-10-02";
const copy: MasterCopy = { bill, bl_no: "PILSHA0099887", issuer: "PIL", originals: 3 };

console.log("progress, read from the console");
is("nothing done: every step open, the copy first", [Object.values(importProgress(blank)).map((p) => p.done), nextImportStep(blank)], [[false, false, false, false, false, false], "copy"]);
is("a sea waybill has no release to wait for", importProgress({ ...blank, mbl_release: "seaway" }).release, { done: true, on: null });
is("a telex release waits for its confirmation", importProgress({ ...blank, mbl_release: "telex" }).release.done, false);
const all = { ...blank, mbl_copy_at: "x", cfs_nominated_at: "x", release_in_hand_at: "x", line_paid_at: "x", line_do_at: "x", destuffed_on: "2026-10-22" };
is("every step done: nothing next", nextImportStep(all), null);
is("the first not done is next, whatever is done after it", nextImportStep({ ...all, line_paid_at: null }), "paid");

console.log("\nthe copy against the console and its houses");
const rows = checkMasterCopy({ ...blank, voyage: "127W" }, copy, boxes, houses, us);
const st = (k: string) => rows.find((r) => r.key === k)?.state;
is("consignee: us, however the suffix is written", st("consignee"), "same");
is("the master's number: on the copy, not yet on the console", st("mbl"), "not_on_job");
is("vessel and port with the country added agree", [st("vessel"), st("pol"), st("pod")], ["same", "same", "same"]);
is("a voyage with a leading zero is a different voyage", st("voyage"), "differs");
is("the seal on the copy differs from the job's", st("seal:PCIU1234567"), "differs");
is("totals within rounding agree", [st("packages"), st("kg"), st("cbm")], ["same", "same", "same"]);
const extra = checkMasterCopy(blank, { ...copy, bill: { ...bill, containers: [] } }, boxes, { packages: 41, grossKg: 9000, cbm: 50 }, us);
is("a box on our jobs missing from the copy; a package short", [extra.find((r) => r.key === "box:PCIU1234567")?.state, extra.find((r) => r.key === "packages")?.state], ["missing_on_bill", "differs"]);

console.log("\nwhat the line or Customs stops on");
is("all well but the release not said", copyIssues(blank, copy, ["SHA-H-001"], us), ["Say how the master is released: originals, telex, sea waybill or eBL"]);
is(
  "to order, a house carrying the master's number, freight collect",
  copyIssues({ ...blank, mbl_release: "telex" }, { ...copy, bill: { ...bill, consignee_name: "TO ORDER OF HDFC BANK", freight_terms: "collect" } }, ["pilsha0099887"], us),
  [
    'The master is consigned "TO ORDER OF HDFC BANK": the line wants it endorsed to us before it gives the DO',
    "House B/L pilsha0099887 has the master's number: Customs refuses that",
    "Freight collect: the freight is paid to the line here, with its charges",
  ]
);
is("another consignee", copyIssues({ ...blank, mbl_release: "telex" }, { ...copy, bill: { ...bill, consignee_name: "GLOBAL CARGO PVT LTD" } }, [], us), [
  "The master names GLOBAL CARGO PVT LTD as consignee, not us: the line gives its DO only to the consignee",
]);

console.log("\nthe console's blanks filled from the copy");
const filled = blanksFromCopy(blank, copy);
is("only the blanks, never what the console says", filled.filled, ["MBL number", "MBL date", "carrier", "voyage"]);
is("the values", filled.values, { mbl_number: "PILSHA0099887", mbl_date: "2026-10-02", carrier: "PIL", voyage: "0127W" });

console.log("\nthe line's DO");
is("none yet", lineDoState(blank, "2026-10-21").state, "none");
const withDo = { ...blank, line_do_at: "2026-10-20T10:00:00Z", line_do_valid_till: "2026-10-23" };
is("good for two more days", lineDoState(withDo, "2026-10-21"), { state: "valid", days: 2 });
is("last day", lineDoState(withDo, "2026-10-23").state, "last_day");
is("lapsed with the box unopened", lineDoState(withDo, "2026-10-25"), { state: "expired", days: -2 });
is("lapsed after destuffing does not matter", lineDoState({ ...withDo, destuffed_on: "2026-10-22" }, "2026-10-25").state, "used");

console.log("\nthe CFS nomination");
is("what it still needs", cfsIssues(blank, "", []), ["Name the CFS", "No master B/L number", "No container number on any job yet", "No IGM number yet: the line may ask for it"]);
const ready = { ...blank, carrier: "PIL", mbl_number: "PILSHA0099887", voyage: "0127W", igm_no: "2345678", igm_date: "2026-10-18" };
is("nothing missing", cfsIssues(ready, "Sical Logistics CFS", boxes), []);
is("subject", cfsSubject(ready), "[CON/26-27/0012] CFS NOMINATION — MBL PILSHA0099887 — KOTA LESTARI 0127W — IGM 2345678");
const html = cfsHtml(ready, boxes, "Sical <CFS>", us, true);
is(
  "the letter: us as consignee, the CFS, the bill, the box and seal, the ask",
  [`We, ${us}, consignee`, "SICAL &lt;CFS&gt;", "2345678 dated 2026-10-18", "PCIU1234567", "PIL55667", "issue the delivery order in its favour", "letter is attached"].map((t) => html.includes(t)),
  [true, true, true, true, true, true, true]
);

console.log("\na house's DO waits for its console");
const house = { stage: "final" as const, release_mode: "telex" as const, issuer_name: "Agent", freight_terms: "prepaid" as const, originals_surrendered_on: null, telex_received_on: "2026-10-21", charges_cleared_on: "2026-10-21" };
is("not on a console: ready", releaseChecklist(house).ready, true);
const on = releaseChecklist({ ...house, console: { console_no: "CON/26-27/0012", line_do_at: "2026-10-21T09:00:00Z", destuffed_on: null } });
is("on a console not yet destuffed: not ready", [on.ready, on.items.map((i) => i.key)], [false, ["final", "telex_received_on", "console_do", "console_destuffed", "charges_cleared_on"]]);
is("the line's DO dated the day it was collected", on.items.find((i) => i.key === "console_do")?.on, "2026-10-21");
is("destuffed: ready", releaseChecklist({ ...house, console: { console_no: "C", line_do_at: "2026-10-21T09:00:00Z", destuffed_on: "2026-10-22" } }).ready, true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
