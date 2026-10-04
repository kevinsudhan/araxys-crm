import { boxesFrom, checkMasterDraft, defaultTerms, draftProblems, masterCorrections, siData, siHtml, siIssues, siSubject, stageIndex, termsFrom, type MasterConsole } from "../../src/lib/masterBill";

/** A console's master B/L: the instruction from the jobs, and the line's draft checked against it (119, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const company = { legalName: "Aashish Logistics Global Pvt Ltd", address: ["No.55, Anna Nagar", "Chennai 600040"] };
const c: MasterConsole = {
  console_no: "CON/26-27/0007",
  direction: "export",
  carrier: "Wan Hai",
  carrier_booking_no: "whmaa2609113",
  mbl_number: null,
  vessel: "Wan Hai 326",
  voyage: "W062",
  pol: "Chennai",
  pod: "Jebel Ali",
  place_of_delivery: "",
  etd: "2026-10-12",
  cutoff_date: "2026-10-09",
};

console.log("the console's boxes, from its jobs");
const boxes = boxesFrom([
  { shipment_id: "A", container_no: "TCLU 1234567", size_type: "40hc", seal_no: "", package_count: 12, weight_kg: "1200.5", volume_cbm: 8.25 },
  { shipment_id: "B", container_no: "tclu1234567", size_type: null, seal_no: "wh998877", package_count: 3, weight_kg: 300, volume_cbm: "2.1" },
  { shipment_id: "C", container_no: "", size_type: "20gp", seal_no: "", package_count: 5, weight_kg: 50, volume_cbm: 1 },
]);
is("one box per container number, however it was typed; a line with no number is not a box", boxes.map((b) => b.container_no), ["TCLU1234567"]);
is("its cargo added up, its size and seal from whichever job had them", [boxes[0].packages, boxes[0].gross_kg, boxes[0].cbm, boxes[0].size_type, boxes[0].seal_no, boxes[0].houses], [15, 1500.5, 10.35, "40HC", "WH998877", 2]);

console.log("\nthe terms");
const defaults = defaultTerms(c, { name: "Gulf Star Shipping LLC", address: "Dubai, UAE" }, company);
is("Aashish ships, the agent receives and is notified, prepaid at loading", [defaults.shipper_name, defaults.consignee_name, defaults.notify_name, defaults.freight_terms, defaults.freight_payable_at], ["AASHISH LOGISTICS GLOBAL PVT LTD", "GULF STAR SHIPPING LLC", "SAME AS CONSIGNEE", "prepaid", "CHENNAI"]);
is("consolidated cargo as per the attached list", [defaults.description, defaults.marks_numbers], ["CONSOLIDATED CARGO AS PER ATTACHED LIST", "AS PER ATTACHED LIST"]);
const terms = termsFrom({ consignee_name: "Gulf Star Shipping L.L.C.", freight_terms: "collect", description: "  ", remarks: "Show HS codes" }, defaults);
is("the desk's terms over the defaults; a blank kept field follows the console", [terms.consignee_name, terms.freight_terms, terms.description, terms.remarks], ["Gulf Star Shipping L.L.C.", "collect", "CONSOLIDATED CARGO AS PER ATTACHED LIST", "Show HS codes"]);

console.log("\nthe instruction");
const si = siData(c, defaults, boxes, { packages: 99, grossKg: 9, cbm: 9 });
is("the line's booking, the ports, the vessel", [si.booking_ref, si.port_of_loading, si.port_of_discharge, si.place_of_delivery, si.vessel, si.voyage], ["WHMAA2609113", "CHENNAI", "JEBEL ALI", "JEBEL ALI", "WAN HAI 326", "W062"]);
is("FCL to the line, shipper's load and count, said to contain", [si.service_type, si.shippers_load, si.said_to_contain], ["FCL/FCL", true, true]);
is("totals from the boxes", [si.packages, si.gross_weight_kg, si.measurement_cbm, si.containers.length], ["15", "1500.5", "10.35", 1]);
is("no boxes yet: the houses' totals", (() => { const x = siData(c, defaults, [], { packages: 20, grossKg: 1550, cbm: 11 }); return [x.packages, x.gross_weight_kg, x.measurement_cbm]; })(), ["20", "1550", "11"]);

console.log("\nwhat stops it");
is("a complete one goes", siIssues(c, si, boxes, ["HBL/26-27/0001"]), []);
is(
  "no booking, no consignee, no seal",
  siIssues({ ...c, carrier_booking_no: "" }, siData(c, { ...defaults, consignee_name: "" }, [{ ...boxes[0], seal_no: "" }], { packages: 0, grossKg: 0, cbm: 0 }), [{ ...boxes[0], seal_no: "" }], []),
  ["No booking number from the line", "No consignee: appoint the overseas agent, or name one", "No seal on TCLU1234567"]
);
is("a house B/L with the master's number (ICEGATE 2.0)", siIssues({ ...c, mbl_number: "WHL-55" }, si, boxes, ["whl 55", "HBL/26-27/0002"]), ["House B/L whl 55 has the master's number: Customs refuses that"]);

console.log("\nthe line's draft");
const draft = {
  ...si,
  consignee_name: "GULF STAR SHIPPING L.L.C",
  gross_weight_kg: "1501",
  containers: [
    { ...si.containers[0], seal_no: "WH998878" },
    { ...si.containers[0], container_no: "WHSU7654321", seal_no: "X1" },
  ],
};
const rows = checkMasterDraft(si, draft);
const state = (key: string) => rows.find((r) => r.key === key)?.state;
is("the agent's name with its suffix written differently is the same", state("consignee_name"), "same");
is("a kilo on 1,500 is a rounding", state("gross_weight_kg"), "same");
is("a wrong seal differs", state("seal:TCLU1234567"), "differs");
is("a box on the draft that is not ours is said", state("box:WHSU7654321"), "not_on_job");
is("only the wrong seal stops approval", draftProblems(rows).map((r) => r.key), ["seal:TCLU1234567"]);
is("a box of ours missing from the draft stops it", draftProblems(checkMasterDraft(si, { ...si, containers: [] })).map((r) => r.key), ["box:TCLU1234567"]);
is("the corrections to send", masterCorrections(rows, "WHL-55").split("\n"), ["Please amend the draft B/L WHL-55 as follows:", '- Seal on TCLU1234567: shows "WH998878", should read "WH998877"']);
is("a right draft needs none", [draftProblems(checkMasterDraft(si, si)).length, masterCorrections(checkMasterDraft(si, si), null)], [0, ""]);

console.log("\nthe mail");
is("the subject carries the console, the booking, the voyage and the lane", siSubject(c), "[CON/26-27/0007] SHIPPING INSTRUCTIONS — BKG WHMAA2609113 — WAN HAI 326 W062 — CHENNAI-JEBEL ALI");
const html = siHtml(c, siData(c, { ...defaults, consignee_name: "A <b>" }, boxes, { packages: 0, grossKg: 0, cbm: 0 }), defaults, ["the house list"]);
is("the particulars, the boxes, the ask for the draft", ["SAID TO CONTAIN 15 PACKAGES CONSOLIDATED CARGO", "TCLU1234567", "WH998877", "SHIPPER'S LOAD, STOW, COUNT AND SEAL", "draft master B/L for our approval"].map((t) => html.includes(t)), [true, true, true, true, true]);
is("markup typed into a party is escaped", html.includes("A &lt;B&gt;"), true);
is("the stages in order", [stageIndex("none"), stageIndex("si_sent"), stageIndex("released")], [0, 1, 5]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
