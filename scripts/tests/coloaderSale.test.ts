import { coloaderIssues, coloaderShare, instructionIssues, instructionsHtml, instructionsSubject, type ColoaderConsole, type ColoaderHouse } from "../../src/lib/coloaderSale";

/** Space on our console sold to another forwarder: the share of the box, what is not right yet, the delivery instructions (124, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const house = (over: Partial<ColoaderHouse> = {}): ColoaderHouse => ({
  shipmentId: "J1",
  ref: "ALG09031-26",
  forwarder: { id: "F1", name: "Bluewave Logistics", email: "ops@bluewave.example", address: "Chennai" },
  hblNo: "HBL/26-27/0007",
  hblIssued: false,
  hblShipper: "BLUEWAVE LOGISTICS PVT LTD",
  grossKg: 1800,
  cbm: 4.2,
  quotedInr: 14700,
  instructionsSentAt: "2026-10-05T06:00:00Z",
  instructionsSentTo: "ops@bluewave.example",
  ...over,
});

console.log("how much of the box went to co-loaders");
is("W/M theirs, of the box's, and what it was quoted at", coloaderShare([house(), house({ shipmentId: "J2", cbm: 1.1, grossKg: 2500, quotedInr: 8000 })], { cbm: 24, grossKg: 9000 }), { houses: 2, wm: 6.7, ofAll: 27.9, quotedInr: 22700 });
is("an empty box says nothing about its share", coloaderShare([house()], { cbm: 0, grossKg: 0 }).ofAll, null);

console.log("\nwhat is not right yet");
is("all in order", coloaderIssues(house()), []);
is(
  "no email, no instructions, our B/L naming somebody else, no accepted quotation",
  coloaderIssues(house({ forwarder: { id: "F1", name: "Bluewave Logistics", email: "", address: "" }, instructionsSentAt: null, hblShipper: "SRI AUTO COMPONENTS", quotedInr: null })),
  ["No email for them", "Delivery instructions not sent", "Our B/L names SRI AUTO COMPONENTS as shipper, not Bluewave Logistics", "No accepted quotation"]
);
is("no B/L yet", coloaderIssues(house({ hblNo: null, hblShipper: "" })), ["No house B/L to them yet"]);

console.log("\nthe delivery instructions");
const c: ColoaderConsole = { console_no: "CON/26-27/0014", vessel: "Kota Lestari", voyage: "0127W", pol: "Chennai", pod: "Hamburg", place_of_delivery: "", etd: "2026-10-18", cutoff_date: "2026-10-15", cfs_name: "Sical Logistics CFS" };
is("ready to send", instructionIssues(c), []);
is("what they need first", instructionIssues({ ...c, cfs_name: " ", cutoff_date: null, etd: null }), ["Name the stuffing CFS", "No cut-off date on the console", "No ETD on the console"]);
is("subject", instructionsSubject(c, house()), "[ALG09031-26] DELIVERY INSTRUCTIONS — CON/26-27/0014 — CHENNAI-HAMBURG — CUT-OFF 15 OCT 2026");
const html = instructionsHtml(c, house({ forwarder: { id: "F1", name: "Blue <wave>", email: "", address: "" } }));
is(
  "the CFS, the cut-off, the sailing, our reference, what to send for our B/L, escaped",
  ["Dear Blue &lt;wave&gt; team", "SICAL LOGISTICS CFS", "15 Oct 2026", "KOTA LESTARI / 0127W", "18 Oct 2026", "<strong>ALG09031-26</strong>", "1,800 KGS / 4.2 CBM", "Shipper: yourselves", "your agent at destination", "HS code", "draft B/L to approve"].map((t) => html.includes(t)),
  [true, true, true, true, true, true, true, true, true, true, true]
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
