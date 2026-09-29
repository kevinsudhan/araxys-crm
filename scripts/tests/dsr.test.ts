import { DSR_COLUMNS, dsrFileName, dsrMailHtml, dsrRow, dsrSheet, dsrSubject, sortRows, statusFromMilestones, type DsrSource } from "../../src/lib/dsr";
import { buildWorkbook } from "../../src/lib/xlsx";
import { parseSheet, unzip } from "../../src/lib/xlsxRead";

/** The customer's DSR: lines read from the job, the desk's sheet, the customer's copy and mail (108; 30 Sep 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const milestones = [
  { code: "booked", label: "Booking confirmed", position: 10, reached_on: "2026-09-11" },
  { code: "picked_up", label: "Cargo picked up", position: 20, reached_on: "2026-09-14" },
  { code: "received", label: "Received at the CFS", position: 30, reached_on: null },
  { code: "departed", label: "Vessel sailed", position: 50, reached_on: null },
  { code: "customs_hold", label: "Held for inspection", position: 25, reached_on: null, hidden: true },
];

const src: DsrSource = {
  shipment: {
    id: "SHP-T1",
    enquiry_ref: "ALG99003-26",
    stage: "cargo_received",
    transport_mode: "sea_lcl",
    trade_direction: "import",
    incoterm: "fob",
    booking_number: null,
    bl_number: "MBL1",
    forwarders_bl_no: null,
    vessel: "Sample Vessel",
    voyage: "2608W",
    flight_number: null,
    etd: "2026-09-27",
    eta: "2026-10-14",
    cargo_cutoff: "2026-09-24",
    origin: "Qingdao",
    destination: "Chennai",
    port_of_loading: "Qingdao",
    port_of_discharge: "Chennai",
    package_count: 1,
    package_type: "case",
    piece_count: 1,
    gross_weight_kg: "330.00",
    volume_cbm: "1.000",
    created_at: "2026-09-10T08:00:00Z",
  },
  customerName: "Sample Traders",
  houseBill: "HBL-T1",
  agent: "Sample Agent Co",
  bookingReceived: "2026-09-10T09:30:00Z",
  milestones,
  pickupPlanned: null,
  note: { remark: " Cargo is planned to sail on 27 Sep. ", status: "" },
};

console.log("a shipment's line");
const r = dsrRow(src);
is("references: the job number stands in for a booking number; the house bill first", [r.enquiryRef, r.bookingNo, r.blNo], ["ALG99003-26", "SHP-T1", "HBL-T1"]);
is("terms, mode, and the far port of an import (loading)", [r.term, r.mode, r.port], ["FOB", "SEA LCL", "QINGDAO"]);
is("…and of an export (discharge)", dsrRow({ ...src, shipment: { ...src.shipment, trade_direction: "export" } }).port, "CHENNAI");
is("booking dates from the acceptance and the milestone", [r.bookingReceived, r.bookingConfirmed, r.pickup, r.pickupPlanned], ["2026-09-10", "2026-09-11", "2026-09-14", false]);
is("a pickup only planned says so", (() => { const x = dsrRow({ ...src, milestones: milestones.filter((m) => m.code !== "picked_up"), pickupPlanned: "2026-09-16" }); return [x.pickup, x.pickupPlanned]; })(), ["2026-09-16", true]);
is("packages, weight, volume as the desk writes them", [r.pkg, r.weight, r.cbm], ["1 CASE", "330 KGS", 1]);
is("vessel and voyage; an air job its flight", [r.vessel, dsrRow({ ...src, shipment: { ...src.shipment, transport_mode: "air", flight_number: "ek 543" } }).vessel], ["SAMPLE VESSEL / 2608W", "EK 543"]);
is("the desk's reason, trimmed", r.reason, "Cargo is planned to sail on 27 Sep.");
is("no status written: it reads from the milestones, hidden ones skipped", [r.status, r.statusFromMilestones], ["Cargo picked up on 14 Sep 2026 · next: received at the CFS", true]);
is("a status written wins", dsrRow({ ...src, note: { remark: "", status: "Awaiting draft BL" } }).status, "Awaiting draft BL");
is("nothing reached yet", statusFromMilestones([{ code: "booked", label: "Booking confirmed", position: 10, reached_on: null }]), "Awaiting booking confirmed");
is("oldest job first", sortRows([dsrRow({ ...src, shipment: { ...src.shipment, id: "B", enquiry_ref: "ALG99010-26" } }), r]).map((x) => x.enquiryRef), ["ALG99003-26", "ALG99010-26"]);

console.log("\nthe sheet");
const desk = dsrSheet([r], { customer: "Sample Traders", today: "2026-09-30", forCustomer: false });
const theirs = dsrSheet([r], { customer: "Sample Traders", today: "2026-09-30", forCustomer: true });
is("the desk's columns, in the desk's order", desk.columns.map((c) => c.header), DSR_COLUMNS.map((c) => c.header));
is("21 columns for the desk, 20 for the customer: no agent", [desk.columns.length, theirs.columns.length, theirs.columns.some((c) => c.header === "AGENT NAME")], [21, 20, false]);
is("the agent's name nowhere on the customer's copy", JSON.stringify(theirs.rows).includes("Sample Agent Co"), false);
is("numbered from 1", desk.rows[0][0], 1);
is("dates as dates, so they sort", desk.rows[0][DSR_COLUMNS.findIndex((c) => c.header === "ETD")] instanceof Date, true);

// Built and read back, as Excel would open it.
const files = await unzip(buildWorkbook([theirs]));
const xml = new TextDecoder().decode(files.get("xl/worksheets/sheet1.xml")!);
const cells = parseSheet(xml, []);
const header = cells.find((row) => row[0] === "S.NO");
is("the workbook opens with the title and the header row", [cells[0][0], header?.slice(0, 4)], ["DAILY STATUS REPORT", ["S.NO", "ENQ.NO", "BOOKING NO", "BL NO"]]);
is("…and the line under it", cells[cells.indexOf(header!) + 1].slice(0, 4), [1, "ALG99003-26", "SHP-T1", "HBL-T1"]);

console.log("\nthe mail");
const html = dsrMailHtml({ customer: "Sample Traders", today: "2026-09-30", rows: [r], note: "Please find below.", fromName: "Desk" });
is("the letter, titled, dated, for the customer", ["DAILY STATUS REPORT", "30 Sep 2026", "Sample Traders"].map((t) => html.includes(t)), [true, true, true]);
is("each shipment with its dates and status", ["ALG99003-26", "BL HBL-T1", "27 Sep 2026", "14 Oct 2026", "Cargo picked up on 14 Sep 2026"].map((t) => html.includes(t)), [true, true, true, true, true]);
is("no agent in the mail", html.includes("Sample Agent Co"), false);
is("a note typed with markup is escaped", dsrMailHtml({ customer: "A<b>", today: "2026-09-30", rows: [], note: "x" }).includes("A&lt;b&gt;"), true);
is("subject and file name", [dsrSubject("Sample Traders", "2026-09-30"), dsrFileName('Sample / "Traders"', "2026-09-30")], ["Daily Status Report · Sample Traders · 30 Sep 2026", "DSR Sample Traders 2026-09-30.xlsx"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
