import { readFileSync } from "node:fs";
import { arrivalDue, arrivalHouseFrom, arrivalHtml, arrivalSubject, consigneeEmail, deliveryNeeds } from "../../src/lib/arrivalNotice";
import { COMPANY } from "../../src/lib/company";
import { outturnHtml, outturnIssues, outturnState, outturnSubject, outturnSummary, type OutturnHouse } from "../../src/lib/outturn";

/** An import console at destination: arrival notices, the outturn (126, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log("when the scheduler sends");
const now = new Date("2026-10-18T04:00:00Z"); // 18 Oct, 09:30 in India
is("two days out with two days set: due", arrivalDue("2026-10-20", 2, now), true);
is("three days out: not yet", arrivalDue("2026-10-21", 2, now), false);
is("on the day, and a few days after", [arrivalDue("2026-10-18", 0, now), arrivalDue("2026-10-14", 2, now)], [true, true]);
is("more than a week after: too late to say", arrivalDue("2026-10-10", 2, now), false);
is("no ETA: never", arrivalDue(null, 2, now), false);

console.log("\nthe notice, from the records");
const rows = {
  job: { enquiry_ref: "ALG09041-26", consignee_name: "Chennai Motors Pvt Ltd", piece_count: 20, package_type: "CTNS", gross_weight_kg: "1950", volume_cbm: 6.2, forwarders_bl_no: null, bl_number: null },
  received: { hbl_no: "SHA-H-2201", release_mode: "telex", data: { description: "AUTO PARTS <BRAKES>", packages: "20", package_type: "CARTONS", freight_terms: "COLLECT" } },
  boxes: [
    { container_no: "pciu 1234567", size_type: "40hc" },
    { container_no: "PCIU1234567", size_type: "40HC" },
  ],
  console: { mbl_number: "PILSHA0099887", vessel: "Kota Lestari", voyage: "0127W", pol: "Shanghai", pod: "Chennai", eta: "2026-10-20", igm_no: "2345678", igm_date: "2026-10-18", cfs_name: "Sical CFS" },
};
const h = arrivalHouseFrom(rows);
is("the house: their B/L, the master, one box however it was written, their packages, collect", [h.hblNo, h.mblNo, h.containers, h.packages, h.release, h.freightCollect], ["SHA-H-2201", "PILSHA0099887", ["PCIU1234567 40HC"], "20 CARTONS", "telex", true]);
is("subject", arrivalSubject(h), "[ALG09041-26] ARRIVAL NOTICE — HBL SHA-H-2201 — KOTA LESTARI 0127W — ETA 20 OCT 2026");
is("what they need, for a telex release and freight collect", deliveryNeeds(h).slice(0, 2), [
  "The B/L is released by telex: no original is needed; we confirm the release once it is with us",
  "Payment of the freight (collect) and our delivery order charges",
]);
is("an original to surrender when nothing else is said", deliveryNeeds({ release: null, freightCollect: false })[0], "One original house B/L, duly endorsed, surrendered to us");
const html = arrivalHtml(h, COMPANY, "Aarathy");
is(
  "the mail: the consignee, the ETA, the IGM, the box, the CFS, escaped, signed",
  ["Dear Chennai Motors Pvt Ltd", "<strong>20 Oct 2026</strong>", "2345678 dated 18 Oct 2026", "PCIU1234567 40HC", "SICAL CFS", "AUTO PARTS &lt;BRAKES&gt;", "Aarathy", COMPANY.legalName].map((t) => html.includes(t)),
  [true, true, true, true, true, true, true, true]
);
is("where it goes: the job's consignee, else the customer", [consigneeEmail({ consignee_email: "imports@cm.example" }, { emails: ["a@b"] }), consigneeEmail({ consignee_email: null }, { emails: [], billing_email: "ac@cm.example" }), consigneeEmail({}, null)], ["imports@cm.example", "ac@cm.example", ""]);

console.log("\nthe function sends this same mail");
const norm = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
is("supabase-v2/functions/arrival-notices/arrivalNotice.ts is src/lib/arrivalNotice.ts", norm("supabase-v2/functions/arrival-notices/arrivalNotice.ts") === norm("src/lib/arrivalNotice.ts"), true);
is("supabase-v2/functions/arrival-notices/company.ts is src/lib/company.ts", norm("supabase-v2/functions/arrival-notices/company.ts") === norm("src/lib/company.ts"), true);

console.log("\nthe outturn");
const o = (id: string, over: Partial<OutturnHouse>): OutturnHouse => ({ shipmentId: id, ref: `ALG-${id}`, hblNo: `SHA-${id}`, consignee: `Consignee ${id}`, manifestedPkgs: 20, packageType: "CTNS", landedPkgs: 20, landedKg: null, conditions: ["good"], remarks: "", ...over });
const houses = [o("1", {}), o("2", { landedPkgs: 19, remarks: "1 carton short" }), o("3", { conditions: ["wet"] }), o("4", { landedPkgs: null, conditions: [] }), o("5", { landedPkgs: 21 })];
is("clean, short, damaged, not tallied, excess", houses.map(outturnState), ["clean", "short", "damaged", "not_tallied", "excess"]);
is("the console in one line", outturnSummary(houses), { tallied: 4, clean: false, exceptions: 3 });
is("all landed as manifested is a clean outturn", outturnSummary([o("1", {}), o("2", {})]).clean, true);
const oc = { console_no: "CON/26-27/0021", mbl_number: "PILSHA0099887", vessel: "Kota Lestari", voyage: "0127W", pol: "Shanghai", pod: "Chennai", cfs_name: "Sical CFS", destuffed_on: null, containers: ["PCIU1234567 40HC"] };
is("subject", outturnSubject(oc, houses), "[CON/26-27/0021] OUTTURN REPORT — MBL PILSHA0099887 — 3 EXCEPTIONS");
is("what it lacks", outturnIssues(oc, houses), ["The box is not recorded as destuffed", "Not tallied: ALG-4"]);
const oh = outturnHtml(oc, houses, "Orient <Agent>", true);
is("the mail: the exceptions marked, escaped", ["Dear Orient &lt;Agent&gt;", "3 exceptions", "1 carton short", "Damaged (wet)", "Short", "Excess", "Not tallied"].map((t) => oh.includes(t)), [true, true, true, true, true, true, true]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
