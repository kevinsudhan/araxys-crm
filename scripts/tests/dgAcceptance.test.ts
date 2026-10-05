import { boxPairs, canAccept, classOf, dgSummary, houseChecks, segregation, SEG_ORDER, unOf, type DgHouse } from "../../src/lib/dgAcceptance";

/** Dangerous goods accepted into a console: the papers, the class, and who may share the box (131, 6 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const TODAY = "2026-10-06";
const house = (id: string, over: Partial<DgHouse> = {}): DgHouse => ({
  shipmentId: id,
  ref: id,
  customer: "Shipper",
  unNumber: "UN1263",
  imoClass: "3",
  packingGroup: "II",
  flashPointC: 23,
  msdsProvided: true,
  msdsDate: "2025-01-10",
  declarationAt: "2026-10-05T10:00:00Z",
  lineRef: "MSK-DG-1",
  acceptedAt: null,
  acceptNote: null,
  ...over,
});
const states = (h: DgHouse, others: DgHouse[] = [], coload = false) => houseChecks(h, others, { coload, today: TODAY }).map((c) => `${c.key}:${c.state}`);
const stops = (h: DgHouse, others: DgHouse[] = []) => houseChecks(h, others, { coload: false, today: TODAY }).filter((c) => c.state === "stop").map((c) => c.key);

console.log("the IMDG segregation table");
let symmetric = true;
for (const a of SEG_ORDER) for (const b of SEG_ORDER) if (segregation(a, b) !== segregation(b, a)) symmetric = false;
is("is symmetric", symmetric, true);
is("flammable liquid with an oxidizer: separated from", segregation("3", "5.1"), "2");
is("flammable liquid with a corrosive: nothing", segregation("3", "8"), "X");
is("toxic with an oxidizer: away from", segregation("6.1", "5.1"), "1");
is("class 9 with anything: nothing", SEG_ORDER.map((k) => segregation("9", k)).every((c) => c === "X"), true);
is("organic peroxide with infectious: compartment", segregation("5.2", "6.2"), "3");

console.log("\nreading the class and the UN number");
is("Class 3", classOf("Class 3"), { cls: "3", key: "3", problem: null });
is("9.0 is 9", classOf("9.0").key, "9");
is("1.4S is explosives 1.4", classOf("1.4S"), { cls: "1.4", key: "1.4", problem: null });
is("2 needs its division", classOf("2").problem, "Class 2 needs its division: 2.1, 2.2 or 2.3");
is("nonsense is said", classOf("10").problem, '"10" is not an IMO class');
is("UN numbers however written", [unOf("un 1263"), unOf("1263"), unOf("UN0000"), unOf("UN12")], ["UN1263", "UN1263", null, null]);

console.log("\na flammable liquid with its papers");
const good = house("A");
is("every check passes", states(good), ["class:ok", "un:ok", "pg:ok", "fp:ok", "msds:ok", "decl:ok", "line:ok"]);
is("may be accepted", canAccept(houseChecks(good, [], { coload: false, today: TODAY })), true);

console.log("\nwhat stops it");
is("no declaration, no line approval", stops(house("A", { declarationAt: null, lineRef: " " })), ["decl", "line"]);
is("no safety data sheet", stops(house("A", { msdsProvided: false })), ["msds"]);
is("a safety data sheet over five years old", stops(house("A", { msdsDate: "2021-10-05" })), ["msds"]);
is("five years to the day is still current", stops(house("A", { msdsDate: "2021-10-06" })), []);
is("a flammable liquid with no flash point or packing group", stops(house("A", { flashPointC: null, packingGroup: null })), ["pg", "fp"]);
is("an explosive's UN number on a class 3", stops(house("A", { unNumber: "UN0336" })), ["un"]);
is("radioactive: never in a consolidation", stops(house("A", { imoClass: "7", unNumber: "UN2910", packingGroup: null, flashPointC: null })), ["class"]);
is("infectious: never", stops(house("A", { imoClass: "6.2", unNumber: "UN3373", packingGroup: null })), ["class"]);
is("explosives: never", stops(house("A", { imoClass: "1.4S", unNumber: "UN0336", packingGroup: null })), ["class"]);

console.log("\nwhat only warns");
const undated = states(house("A", { msdsDate: null }));
is("an undated safety data sheet", undated.includes("msds:warn"), true);
is("a flash point above 60 °C", states(house("A", { flashPointC: 75 })).includes("fp:warn"), true);
is("toxic: often refused in LCL, and kept from foodstuffs", states(house("A", { imoClass: "6.1", unNumber: "UN2810", flashPointC: null })).filter((s) => s.endsWith("warn")), ["class:warn", "food:warn"]);
is("a packing group on a gas", states(house("A", { imoClass: "2.2", unNumber: "UN1950", flashPointC: null })).includes("pg:warn"), true);
is("class 9 without one", states(house("A", { imoClass: "9", unNumber: "UN3077", packingGroup: null, flashPointC: null })).includes("pg:warn"), true);
is("on a co-load the co-loader accepts it", houseChecks(house("A", { lineRef: null }), [], { coload: true, today: TODAY }).find((c) => c.key === "line")?.text, "No DG acceptance from the co-loader yet");

console.log("\nsharing the box");
const oxidizer = house("B", { imoClass: "5.1", unNumber: "UN1942", packingGroup: "III", flashPointC: null });
const toxic = house("C", { imoClass: "6.1", unNumber: "UN2810", packingGroup: "III", flashPointC: null });
const corrosive = house("D", { imoClass: "8", unNumber: "UN1789", packingGroup: "II", flashPointC: null });
is("a flammable liquid and an oxidizer: not in the same container", stops(good, [good, oxidizer]), ["seg:B"]);
is("both ways", stops(oxidizer, [good, oxidizer]), ["seg:A"]);
is("an oxidizer and a toxic: away from, a warning", states(oxidizer, [oxidizer, toxic]).filter((s) => s.startsWith("seg")), ["seg:C:warn"]);
is("a flammable liquid and a corrosive: fine", states(good, [good, corrosive]).filter((s) => s.startsWith("seg")), []);
is("each pair said", boxPairs([good, oxidizer, corrosive]).map((p) => `${p.a.ref}-${p.b.ref}:${p.code}`), ["A-B:2", "A-D:X", "B-D:2"]);
is("a house with no class pairs as unknown", boxPairs([good, house("E", { imoClass: null })])[0].code, null);

console.log("\nthe console in a line");
is("accepted and waiting", dgSummary([{ ...good, acceptedAt: "2026-10-06T09:00:00Z" }, oxidizer]), "2 DG houses: 1 accepted, 1 waiting");
is("none", dgSummary([]), "No dangerous goods");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
