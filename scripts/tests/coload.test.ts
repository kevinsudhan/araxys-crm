import { bookingHtml, bookingSubject, coloadFreight, coloaderBilled, coloadIssues, csnFiler, csnListHtml, csnListIssues, csnListSubject, wmOf, type ColoadConsole, type CsnListHouse } from "../../src/lib/coload";
import { copyIssues, releaseInHand, stepsFor, type ImportConsole, type MasterCopy } from "../../src/lib/importMaster";
import { defaultTerms, issuerOf, siData, siHtml, siIssues, type MasterConsole } from "../../src/lib/masterBill";
import { emptyHbl } from "../../src/lib/hbl";
import { releaseChecklist } from "../../src/lib/receivedHbl";

/** Space bought from another consolidator: W/M, the rate, their bills, the booking request, and the master steps with them (121, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log("W/M and the rate");
is("the measure when it is more", wmOf(12.3, 4500), 12.3);
is("the tonnes when they are more", wmOf(2.1, 3400), 3.4);
const terms = { coloader: "Shipco Transport", rate: 35, currency: "USD", minWm: 1 };
is("freight on the houses' W/M", coloadFreight(terms, { cbm: 12.3, grossKg: 4500 }), { wm: 12.3, charged: 12.3, amount: 430.5 });
is("the minimum when the cargo is under it", coloadFreight(terms, { cbm: 0.4, grossKg: 300 }), { wm: 0.4, charged: 1, amount: 35 });
is("no rate, no figure", coloadFreight({ ...terms, rate: null }, { cbm: 5, grossKg: 0 }), null);

console.log("\nwhat the co-loader has billed");
const bills = [
  { partner_id: "SHIPCO", kind: "vendor_invoice", status: "received", currency: "USD", total_amount: 470, total_inr: 39010 },
  { partner_id: "SHIPCO", kind: "vendor_invoice", status: "paid", currency: "INR", total_amount: 5900, total_inr: 5900 },
  { partner_id: "SHIPCO", kind: "agent_credit_note", status: "received", currency: "USD", total_amount: 20, total_inr: 1660 },
  { partner_id: "SHIPCO", kind: "vendor_invoice", status: "cancelled", currency: "USD", total_amount: 999, total_inr: 82917 },
  { partner_id: "LINE", kind: "carrier_invoice", status: "received", currency: "INR", total_amount: 12000, total_inr: 12000 },
];
is("theirs only, by currency, a credit taking off, a cancelled bill not counted", coloaderBilled(bills, "SHIPCO"), { count: 3, byCurrency: { USD: 450, INR: 5900 }, inr: 43250 });
is("no co-loader chosen: nothing", coloaderBilled(bills, null).count, 0);

console.log("\nthe booking request");
const cc: ColoadConsole = { console_no: "CON/26-27/0014", carrier_booking_no: "", pol: "Chennai", pod: "Hamburg", place_of_delivery: "", etd: "2026-10-18", vessel: "", voyage: "" };
const cargo = { bills: 3, packages: 42, grossKg: 4500, cbm: 12.3 };
is("all there", coloadIssues({ ...terms, coloaderId: "SHIPCO", email: "bookings@shipco.example" }, cc, cargo), []);
is(
  "what is missing",
  coloadIssues({ ...terms, rate: null, coloaderId: "SHIPCO", email: "" }, { ...cc, pod: "" }, { ...cargo, bills: 0 }),
  ["The co-loader has no email on the partner directory", "No rate per W/M", "No route", "No cargo on the console yet"]
);
is("no co-loader", coloadIssues({ ...terms, coloaderId: null, email: "" }, cc, cargo), ["Choose the co-loader"]);
is("subject", bookingSubject(cc, cargo), "[CON/26-27/0014] LCL BOOKING REQUEST — CHENNAI-HAMBURG — ETD 2026-10-18 — 12.3 CBM");
const html = bookingHtml(cc, terms, cargo, ["Auto parts", "Textiles <cotton>"], "Hanse Logistik GmbH");
is(
  "the request: the co-loader, the cargo as one, the commodity, our agent, the rate, the ask",
  ["Dear Shipco Transport team", "42", "4,500 KGS", "12.3 CBM", "AUTO PARTS; TEXTILES &lt;COTTON&gt;", "HANSE LOGISTIK GMBH", "USD 35 PER W/M, MINIMUM 1 W/M", "booking number"].map((t) => html.includes(t)),
  [true, true, true, true, true, true, true, true]
);

console.log("\nthe instruction to a co-loader (119 on a co-load)");
const company = { legalName: "Aashish Logistics Global Pvt Ltd", address: ["No.55, Anna Nagar", "Chennai 600040"] };
const mc: MasterConsole = { console_no: "CON/26-27/0014", direction: "export", carrier: "Hapag-Lloyd", carrier_booking_no: "", mbl_number: null, vessel: "", voyage: "", pol: "Chennai", pod: "Hamburg", place_of_delivery: "", etd: null, cutoff_date: null, coload: true, coloader: "Shipco Transport" };
const boxes = [{ container_no: "HLXU1234567", size_type: "40HC", seal_no: "", packages: 10, gross_kg: 900, cbm: 4, houses: 1 }];
const dt = defaultTerms(mc, { name: "Hanse Logistik GmbH", address: "Hamburg" }, company);
const si = siData(mc, dt, boxes, { packages: 42, grossKg: 4500, cbm: 12.3 });
is("LCL/LCL, no box of ours, not shipper's load, the houses' totals", [si.service_type, si.containers.length, si.shippers_load, si.packages, si.gross_weight_kg, si.measurement_cbm], ["LCL/LCL", 0, false, "42", "4500", "12.3"]);
is("the checks name the co-loader and ask for no box or seal", siIssues(mc, si, [], []), ["No booking number from the co-loader", "No vessel"]);
const sh = siHtml(mc, si, dt, ["the house list"]);
is("addressed to them, no box table, no shipper's load clause", [sh.includes("Dear Shipco Transport team"), sh.includes("<th"), sh.includes("SHIPPER'S LOAD"), sh.includes("draft B/L for our approval")], [true, false, false, true]);
is("who it goes to", [issuerOf(mc), issuerOf({ ...mc, coload: false })], ["Shipco Transport", "Hapag-Lloyd"]);
is("our own box is unchanged", siData({ ...mc, coload: false }, dt, boxes, { packages: 0, grossKg: 0, cbm: 0 }).service_type, "FCL/FCL");

console.log("\nthe master at this end, on a co-load (120 on a co-load)");
const ic = { console_no: "C", coload: true, carrier: "", mbl_number: null, mbl_date: null, vessel: "", voyage: "", pol: "", pod: "", eta: null, igm_no: "", igm_date: null, mbl_copy_at: null, mbl_release: "telex", release_in_hand_at: null, release_in_hand_ref: "", line_invoice_no: "", line_charges_inr: null, line_paid_at: null, line_do_no: "", line_do_at: null, line_do_valid_till: null, cfs_name: "", cfs_nominated_at: null, cfs_nominated_to: "", destuffed_on: null } as ImportConsole;
const bill = emptyHbl();
bill.consignee_name = "TO ORDER";
bill.freight_terms = "collect";
const copy: MasterCopy = { bill, bl_no: "SHP123", issuer: "SHIPCO", originals: null };
is("the co-loader in the line's place", copyIssues(ic, copy, [], "AASHISH LOGISTICS GLOBAL PVT LTD"), [
  'The master is consigned "TO ORDER": the co-loader wants it endorsed to us before it gives the DO',
  "Freight collect: the freight is paid to the co-loader here, with its charges",
]);
is("their telex release", releaseInHand(ic, "telex").label, "Telex release confirmed by the co-loader");
is("the steps as a co-load names them", stepsFor(ic).map((x) => x.label), ["Their B/L copy", "Their CFS", "Release in hand", "Co-loader paid", "Their DO", "Destuffed"]);
const house = { stage: "final" as const, release_mode: "telex" as const, issuer_name: "A", freight_terms: "prepaid" as const, originals_surrendered_on: null, telex_received_on: "2026-10-21", charges_cleared_on: "2026-10-21" };
is("a house's DO waits for the co-loader's DO", releaseChecklist({ ...house, console: { console_no: "C", line_do_at: null, destuffed_on: null, coload: true } }).items.find((i) => i.key === "console_do")?.label, "Co-loader's DO collected for their B/L (C)");

console.log("\nwho files the CSN (122)");
is("our own box: we do, whatever was said", [csnFiler({ space_from: "line", csn_by: "coloader" }), csnFiler({ space_from: "line", csn_by: "us" }), csnFiler({})], ["us", "us", "us"]);
is("a co-load: as the desk said", [csnFiler({ space_from: "coloader", csn_by: "us" }), csnFiler({ space_from: "coloader", csn_by: "coloader" })], ["us", "coloader"]);
const houses: CsnListHouse[] = [
  { hblNo: "ALGH0011", shipper: "Sri Auto", consignee: "Hanse Parts", packages: 20, packageType: "ctns", grossKg: 2000, cbm: 6, description: "auto parts", sbNo: "1234567", sbDate: "2026-10-14" },
  { hblNo: "ALGH0012", shipper: "Kovai Tex", consignee: "Nord <Mode>", packages: 12, packageType: "bales", grossKg: 1500, cbm: 4, description: "textiles", sbNo: null, sbDate: null },
  { hblNo: "", shipper: "X", consignee: "Y", packages: null, packageType: "", grossKg: null, cbm: null, description: "", sbNo: null, sbDate: null },
];
is("export: a house without its B/L number, one without its shipping bill", csnListIssues(houses, true, "ops@shipco.example"), ["1 house has no B/L number yet", "No shipping bill on ALGH0012"]);
is("import: no shipping bills asked for", csnListIssues(houses.slice(0, 2), false, "ops@shipco.example"), []);
is("no email, no houses", csnListIssues([], false, ""), ["The co-loader has no email on the partner directory", "No house bills on the console yet"]);
is("subject", csnListSubject({ console_no: "CON/26-27/0014", mbl_number: "shp-hbl-889" }, true), "[CON/26-27/0014] OUR HOUSE B/Ls FOR YOUR CSN (EXPORT) — YOUR B/L SHP-HBL-889");
const list = csnListHtml({ console_no: "CON/26-27/0014", mbl_number: "SHP-HBL-889", vessel: "Kota Lestari", voyage: "0127W" }, houses.slice(0, 2), "Shipco Transport", true, ["Manifest.pdf", "Manifest.xlsx"]);
is(
  "the list: their B/L, every house, each shipping bill, escaped, the ask",
  ["Dear Shipco Transport team", "2 house B/Ls under your B/L <strong>SHP-HBL-889</strong>", "ALGH0011", "1234567 dt 2026-10-14", "20 CTNS", "NORD &lt;MODE&gt;", "Shipping bill", "CSN number and date"].map((t) => list.includes(t)),
  [true, true, true, true, true, true, true, true]
);
is("an import list has no shipping bill column", csnListHtml({ console_no: "C", mbl_number: "M", vessel: "", voyage: "" }, houses.slice(0, 1), "S", false, []).includes("Shipping bill"), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
