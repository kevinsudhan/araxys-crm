import { measureHouse, measureSummary, quotedPerWm } from "../../src/lib/cfsMeasure";
import { loadPlan, smallestBox, type HouseCargo } from "../../src/lib/loadPlan";
import { stuffedBoxes, stuffingHtml, stuffingIssues, stuffingSubject, type HouseFacts } from "../../src/lib/stuffingReport";

/** The console at the CFS: the load plan, declared against measured, the stuffing report (125, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log("the load plan");
const pallets: HouseCargo = { houseId: "A", house: "Sri Auto", cbm: 18, kg: 6000, groups: [{ count: 10, lengthCm: 120, widthCm: 100, heightCm: 150, kgEach: 600, stackable: false }] };
const cartons: HouseCargo = { houseId: "B", house: "Kovai Tex", cbm: 4.8, kg: 1500, groups: [{ count: 40, lengthCm: 60, widthCm: 40, heightCm: 50, kgEach: 37.5, stackable: true }] };
const unsized: HouseCargo = { houseId: "C", house: "Bluewave", cbm: 5, kg: 1800, groups: [] };
const p40 = loadPlan([pallets, cartons, unsized], "40GP");
is("ten pallets that may not be stacked: two across, five deep, 6 m", p40.placements.filter((x) => x.houseId === "A").map((x) => [x.x, x.y]).slice(0, 4), [[0, 0], [0, 100], [120, 0], [120, 100]]);
is("cartons stacked four high in a 239 cm box, five across, two rows", [p40.placements.filter((x) => x.houseId === "B").length, p40.placements.filter((x) => x.houseId === "B")[0].pieces], [10, 4]);
is("five high in a high cube", loadPlan([cartons], "40HC").placements[0].pieces, 5);
is("heaviest first, each house together, the unsized drawn from its CBM", p40.houses.map((h) => [h.house, h.floorM, h.estimated]), [["Sri Auto", 5.11, false], ["Bluewave", 1.07, true], ["Kovai Tex", 1.02, false]]);
is("it fits a 40GP, using 8.27 m", [p40.fits, p40.floorLengthCm, p40.floorPct], [true, 827, 68.7]);
const p20 = loadPlan([pallets, cartons, unsized], "20GP");
is("not a 20GP: the floor runs out", [p20.fits, p20.problems[0]], [false, "Needs 8.27 m of floor; the 20GP has 5.89 m"]);
is("the smallest box it fits", smallestBox([pallets, cartons, unsized]), "40GP");
const tall = loadPlan([{ houseId: "T", house: "Tall", cbm: 3, kg: 900, groups: [{ count: 1, lengthCm: 150, widthCm: 120, heightCm: 245, kgEach: 900, stackable: false }] }], "40GP");
is("a crate taller than the door does not go", [tall.fits, tall.problems], [false, ["Tall: pieces 245 cm high do not pass the 228 cm door"]]);
is("but it goes in a high cube", loadPlan([{ houseId: "T", house: "Tall", cbm: 3, kg: 900, groups: [{ count: 1, lengthCm: 150, widthCm: 120, heightCm: 245, kgEach: 900, stackable: false }] }], "40HC").fits, true);
const heavy = loadPlan([{ houseId: "H", house: "Steel", cbm: 10, kg: 29000, groups: [] }], "20GP");
is("over the payload", [heavy.fits, heavy.problems[0]], [false, "29,000 kg is over the 20GP's 28,000 kg payload"]);
is("a long piece is turned to take the least floor", loadPlan([{ houseId: "L", house: "Pipes", cbm: 4, kg: 800, groups: [{ count: 4, lengthCm: 600, widthCm: 50, heightCm: 50, kgEach: 200, stackable: false }] }], "40GP").floorLengthCm, 600);

console.log("\ndeclared against measured");
const declared = { pieces: 20, grossKg: 1800, volumeCbm: 4.2 };
const m = measureHouse({ shipmentId: "J1", ref: "ALG1", customer: "Sri Auto", declared, received: { pieces: 20, grossKg: 1950, volumeCbm: 5.4 }, conditions: [], quotedWm: 4.2, perWmInr: 3500 });
is("bigger than declared: 1.2 W/M more, ₹4,200 more on the invoice", [m.state, m.volume.verdict, m.weight.verdict, m.measuredWm, m.wmChange, m.inrChange], ["differs", "over", "over", 5.4, 1.2, 4200]);
const same = measureHouse({ shipmentId: "J2", ref: "ALG2", customer: "x", declared, received: { pieces: 20, grossKg: 1805, volumeCbm: 4.23 }, conditions: [], quotedWm: 4.2, perWmInr: 3500 });
is("within the warehouse's tolerances: as declared, no change", [same.state, same.wmChange, same.inrChange], ["agrees", 0, null]);
const damaged = measureHouse({ shipmentId: "J3", ref: "ALG3", customer: "x", declared, received: { pieces: 19, grossKg: 1800, volumeCbm: 4.2 }, conditions: ["damaged"], quotedWm: null, perWmInr: null });
is("a carton short and damaged", [damaged.state, damaged.pieces.verdict, damaged.inrChange], ["differs", "short", null]);
const none = measureHouse({ shipmentId: "J4", ref: "ALG4", customer: "x", declared, received: null, conditions: [], quotedWm: 4.2, perWmInr: 3500 });
is("nothing received yet is not a difference", [none.state, none.measuredWm, none.wmChange], ["not_received", null, null]);
is("the console in one line", measureSummary([m, same, damaged, none]), { received: 3, differ: 2, wmChange: 1.2, inrChange: 4200 });
is(
  "the quotation's per-W/M basis: its W/M lines' rupee rates together",
  quotedPerWm([
    { unit: "W/M", quantity: 4.2, rate: 35, fx_rate: 84, currency: "USD" },
    { unit: "CBM", quantity: 4.2, rate: 560, fx_rate: 1, currency: "INR" },
    { unit: "B/L", quantity: 1, rate: 1500, fx_rate: 1, currency: "INR" },
  ]),
  { quotedWm: 4.2, perWmInr: 3500 }
);
is("no per-W/M charge: no basis", quotedPerWm([{ unit: "Shipment", quantity: 1, rate: 9000, fx_rate: 1, currency: "INR" }]), { quotedWm: null, perWmInr: null });

console.log("\nthe stuffing report");
const facts = (id: string, over: Partial<HouseFacts> = {}): HouseFacts => ({ shipmentId: id, ref: `ALG-${id}`, hblNo: `HBL/${id}`, shipper: `Shipper ${id}`, marks: "N/M", packageType: "CTNS", packages: 20, kg: 1800, cbm: 4.2, declaredPkgs: 20, receivedPkgs: 20, condition: "good", ...over });
const lines = [
  { shipment_id: "J1", container_no: "TCLU 1234567", size_type: "40hc", seal_no: "wh9988", package_count: 20, weight_kg: "1800", volume_cbm: 4.2 },
  { shipment_id: "J2", container_no: "TCLU1234567", size_type: null, seal_no: null, package_count: 6, weight_kg: 900, volume_cbm: 2 },
  { shipment_id: "J2", container_no: "TGHU7654321", size_type: "20GP", seal_no: "", package_count: 4, weight_kg: 600, volume_cbm: 1.5 },
];
const boxes = stuffedBoxes(lines, [facts("J1"), facts("J2", { receivedPkgs: 9, declaredPkgs: 10 }), facts("J3")]);
is("one box per container, a split house in both, a house in none listed as such", boxes.map((b) => [b.containerNo, b.sealNo, b.houses.map((h) => h.ref), b.packages]), [
  ["TCLU1234567", "WH9988", ["ALG-J1", "ALG-J2"], 26],
  ["TGHU7654321", "", ["ALG-J2"], 4],
  ["", "", ["ALG-J3"], 20],
]);
is("what is missing", stuffingIssues(boxes, null), ["No seal on TGHU7654321", "1 house is not in a box: ALG-J3", "Packages received differ from declared on ALG-J2", "No stuffing date"]);
const sc = { console_no: "CON/26-27/0014", carrier: "Hapag-Lloyd", vessel: "Kota Lestari", voyage: "0127W", pol: "Chennai", pod: "Hamburg", etd: "2026-10-18", cfs_name: "Sical CFS", mbl_number: "HLCUMAA2610001" };
is("subject", stuffingSubject(sc, "2026-10-15"), "[CON/26-27/0014] STUFFING REPORT — KOTA LESTARI 0127W — CHENNAI-HAMBURG — STUFFED 2026-10-15");
const html = stuffingHtml(sc, boxes, "2026-10-15", "Hanse <Agent>", true);
is(
  "the mail: each box, its seal, the tally, escaped",
  ["Dear Hanse &lt;Agent&gt;", "TCLU1234567 40HC · seal WH9988", "TGHU7654321 20GP · no seal", "Not in a box yet", "9 of 10 declared", "20 as declared", "also attached as PDF"].map((t) => html.includes(t)),
  [true, true, true, true, true, true, true]
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
