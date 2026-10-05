import { deliveryNeeds } from "../../src/lib/arrivalNotice";
import { RELEASE_SHORT } from "../../src/lib/consoleManifest";
import { hblFileName } from "../../src/lib/documents/hblPdf";
import { emptyHbl, missingForIssue, paperless, titleOf } from "../../src/lib/hbl";
import { releaseSteps, releaseSummary, type OurRelease } from "../../src/lib/hblRelease";
import { releaseChecklist } from "../../src/lib/receivedHbl";
import { eblPlatform, ownMto, regAlerts, regProblems, regState, stateText, type Registration } from "../../src/lib/registrations";

/** The company's registrations, house B/Ls under its own MTO, and the electronic B/L (132, 6 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const TODAY = "2026-10-06";
const reg = (over: Partial<Registration>): Registration => ({
  id: over.kind ?? "x",
  kind: "mto",
  title: "",
  number: "MTO/DGS/1234/2026",
  authority: "Directorate General of Shipping",
  issued_on: "2026-01-10",
  valid_until: "2029-01-09",
  amount_inr: null,
  notes: "",
  active: true,
  ...over,
});

console.log("in force, running out, run out");
is("years away: in force", regState(reg({}), TODAY).state, "in_force");
is("inside 60 days: running out", regState(reg({ valid_until: "2026-11-20" }), TODAY), { state: "running_out", daysLeft: 45 });
is("60 days to the day: running out", regState(reg({ valid_until: "2026-12-05" }), TODAY).state, "running_out");
is("yesterday: run out", regState(reg({ valid_until: "2026-10-05" }), TODAY), { state: "run_out", daysLeft: -1 });
is("no end date on file", regState(reg({ valid_until: null }), TODAY).state, "no_end_date");
is("retired", regState(reg({ active: false }), TODAY).state, "retired");
is("said", [stateText(reg({ valid_until: "2026-11-20" }), TODAY), stateText(reg({ valid_until: "2026-10-05" }), TODAY), stateText(reg({ valid_until: TODAY }), TODAY)], [
  "Runs out 20 Nov 2026 (45 days)",
  "Ran out on 5 Oct 2026",
  "Runs out today",
]);

console.log("\nwhat the console desk is told");
const regs = [
  reg({ id: "mto" }),
  reg({ id: "bond", kind: "customs_bond", title: "Customs bond", number: "B/2026/77", valid_until: "2026-10-26", amount_inr: 500000 }),
  reg({ id: "bg", kind: "bank_guarantee", title: "", number: "BG-1", valid_until: "2026-09-30" }),
  reg({ id: "old", kind: "bank_guarantee", number: "BG-0", valid_until: "2025-01-01", active: false }),
];
is("run out first, then running out; a retired one not at all", regAlerts(regs, TODAY), [
  { id: "bg", urgent: true, text: "Bank guarantee BG-1: ran out on 30 Sep 2026" },
  { id: "bond", urgent: false, text: "Customs bond B/2026/77: runs out 26 Oct 2026 (20 days)" },
]);
is("nothing when all is in order", regAlerts([reg({})], TODAY), []);

console.log("\nour own MTO on a house B/L");
is("in force: our legal name and the number", ownMto([reg({ number: "mto/dgs/1234/2026" })], TODAY), {
  name: "AASHISH LOGISTICS GLOBAL PVT LTD",
  registration: "MTO/DGS/1234/2026",
  usable: true,
  problem: null,
  validUntil: "2029-01-09",
});
is("run out: not usable, and why", ownMto([reg({ valid_until: "2026-10-01" })], TODAY)?.problem, "ran out on 1 Oct 2026");
is("no number: not usable", ownMto([reg({ number: "" })], TODAY)?.usable, false);
is("none on file", ownMto([reg({ active: false })], TODAY), null);
is("the eBL platform on file", [eblPlatform([reg({ kind: "ebl_platform", title: "WAVE BL" })]), eblPlatform(regs)], ["WAVE BL", null]);

console.log("\nbefore a registration is saved");
is("a number, and dates the right way round", regProblems(reg({ number: " ", issued_on: "2026-05-01", valid_until: "2026-04-01" })), ["its number", "an end date after the date it was issued"]);
is("a platform is named, not numbered", regProblems(reg({ kind: "ebl_platform", title: "", number: "" })), ["the platform's name"]);

console.log("\nthe electronic B/L, issued by us");
is("no paper originals", [paperless("ebl"), paperless("express"), paperless("telex")], [true, true, false]);
is("still a bill of lading, said to be electronic", titleOf("ebl"), { title: "BILL OF LADING", subtitle: "ELECTRONIC · MULTIMODAL TRANSPORT DOCUMENT" });
const d = emptyHbl();
is("not asked how many originals", missingForIssue(d, "ebl", 0).includes("how many originals"), false);
is("the print is named for what it is", hblFileName({ hblNo: "HBL/26-27/0001", print: "original", release: "ebl", amendment: 0 }), "HBL-26-27-0001-ebl-print.pdf");
is("on the manifest", RELEASE_SHORT.ebl(0), "ELECTRONIC B/L");

const r: OurRelease = {
  status: "issued",
  release_mode: "ebl",
  originals: 0,
  issued_at: "2026-10-06T10:00:00Z",
  charges_received_on: "2026-10-06",
  originals_released_on: null,
  originals_released_to: "",
  originals_returned: 0,
  originals_returned_on: null,
  release_sent_on: null,
  release_sent_to: "",
  released_on: null,
  ebl_platform: "WAVE BL",
  ebl_ref: "",
  ebl_issued_on: null,
  ebl_holder: "",
  ebl_surrendered_on: null,
};
is("its steps", releaseSteps(r).steps.map((s) => s.key), ["charges_received_on", "ebl_issued_on", "ebl_surrendered_on", "released_on"]);
is("next: issue it on the platform", releaseSteps(r).next?.label, "eBL issued on WAVE BL");
const out = { ...r, ebl_ref: "EBL-77", ebl_issued_on: "2026-10-06", ebl_holder: "STATE BANK OF INDIA" };
is("issued: where it is, and with whom", [releaseSteps(out).steps[1].detail, releaseSummary(out)], [
  "ref EBL-77 · held by STATE BANK OF INDIA",
  "eBL with STATE BANK OF INDIA on WAVE BL; waiting for it to be surrendered to our agent.",
]);
is("surrendered: release is next", releaseSteps({ ...out, ebl_surrendered_on: "2026-10-20" }).next?.key, "released_on");
is("released: done", releaseSteps({ ...out, ebl_surrendered_on: "2026-10-20", released_on: "2026-10-21" }).complete, true);

console.log("\nan agent's eBL, on an import");
const base = { stage: "final" as const, issuer_name: "Gulf Agency", freight_terms: "prepaid" as const, telex_received_on: null, charges_cleared_on: "2026-10-20" };
const list = releaseChecklist({ ...base, release_mode: "ebl", originals_surrendered_on: null });
is("its surrender to us is on the list", list.items.map((i) => i.label), ["Final B/L received from the agent", "The eBL surrendered to us on its platform", "Local charges paid"]);
is("not ready until it is", [list.ready, releaseChecklist({ ...base, release_mode: "ebl", originals_surrendered_on: "2026-10-20" }).ready], [false, true]);
is("the arrival notice says how to surrender it", deliveryNeeds({ release: "ebl", freightCollect: false })[0], "An electronic B/L: surrender it to us on the platform it was issued on");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
