import { laneFromSubjects } from "../../supabase-v2/functions/classify-enquiry/lane";

/**
 * The lane copied out of a subject line when the reader leaves it blank (30 Sep 2026):
 * the shapes this desk's subjects actually take. Customer names and numbers invented.
 */
const cases: Array<[string, unknown]> = [
  ["FW: SEA SHIPMENT FROM XIAMEN TO CHENNAI//AAS//ENQ NO: 0217//26-27//AASHISH LOGISTICS", { origin: "Xiamen", destination: "Chennai", air: false }],
  ["FW: MSQ0643 // CL1659 // FOB SHIPMENT FROM SHANGHAI TO CHENNAI // AASHISH LOGISTICS", { origin: "Shanghai", destination: "Chennai", air: false }],
  ["Re: 13747/ IMPORT SEA FREIGHT RATE FROM VIETNAM TO CHENNAI//ENQ NO: 0339//AAS//26-27", { origin: "Vietnam", destination: "Chennai", air: false }],
  ["Re: Re: REG // CONSOL CONFIRMATION FROM EX-SHANGHAI TO CHENNAI // WEEK 40 // AASHISH", { origin: "Shanghai", destination: "Chennai", air: false }],
  ["Re: RFQ - AIR FREIGHT //SEP 26//DUBAI//EXW//25-26//AAS", { origin: null, destination: null, air: true }],
  ["Quote from Ho Chi Minh to Nhava Sheva, 2x40HC", { origin: "Ho Chi Minh", destination: "Nhava Sheva", air: false }],
  ["Rates please", { origin: null, destination: null, air: false }],
];
let bad = 0;
for (const [s, want] of cases) {
  const got = laneFromSubjects([s]);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", s.slice(0, 60), JSON.stringify(got));
}
console.log(`
${cases.length - bad} passed${bad ? `, ${bad} FAILED` : ""}`);
process.exit(bad ? 1 : 0);
