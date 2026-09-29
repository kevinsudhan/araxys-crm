import {
  cleanServices,
  defaultServices,
  greetingName,
  mainCarriage,
  personalise,
  requestSubject,
  serviceCatalogue,
  serviceContext,
  withReference,
  type RequestJob,
} from "../../src/lib/rateRequest";
import { mailKind, refInSubject } from "../../src/lib/mailLog";


/** A rate request for one job, each partner for the services chosen for them (107; 29 Sep 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const job: RequestJob = {
  ref: "ALG99001-26",
  origin: "Chennai",
  destination: "Hamburg",
  cargo: "12 wooden pallets of textile machinery",
  transport_mode: "sea_lcl",
  trade_direction: "export",
  pickup_location: "Ambattur",
  delivery_location: null,
};

console.log("services");
is("the freight leg in the job's mode", [mainCarriage("sea_fcl"), mainCarriage("air"), mainCarriage("road"), mainCarriage(null)], ["Ocean freight", "Air freight", "Road freight", "Freight"]);
is("door to door, freight in the middle", serviceCatalogue(job).slice(2, 5), ["Origin charges", "Ocean freight", "Destination charges"]);
is("an overseas agent on an export: the far end", defaultServices("overseas_agent", job), ["Destination charges", "Import customs clearance", "Delivery to consignee"]);
is("an overseas agent on an import: their end, and the freight", defaultServices("overseas_agent", { ...job, trade_direction: "import" }), ["Origin charges", "Ocean freight"]);
is("a line: the freight", defaultServices("carrier", { transport_mode: "air" }), ["Air freight"]);
is("a CHA on an export: export clearance", defaultServices("cha_customs", job), ["Export customs clearance"]);
is("a transporter on an export: the pickup", defaultServices("cfs_transport", job), ["Pickup and trucking"]);
is("'other': nothing assumed", defaultServices("other", job), []);
is("where each applies", [serviceContext("Ocean freight", job), serviceContext("Pickup and trucking", job), serviceContext("Destination charges", job), serviceContext("Cargo insurance", job)], ["Chennai to Hamburg", "pick-up address to Chennai", "at Hamburg", null]);
is("no route, no place claimed", serviceContext("Ocean freight", { ...job, destination: null }), null);
is("a delivery address is pointed to, not repeated", serviceContext("Delivery to consignee", { ...job, delivery_location: "Some street 1, Frankfurt" }), "Hamburg to the delivery address");
is("cleaned: trimmed, blanks and repeats in any case dropped, order kept", cleanServices([" Ocean freight ", "", "ocean  FREIGHT", "BL fee"]), ["Ocean freight", "BL fee"]);

console.log("\nthe subject");
const subject = requestSubject(job);
is("rate request, lane, mode, cargo, reference", subject, "Rate request · Chennai → Hamburg · Sea LCL · 12 wooden pallets of textile machinery [ALG99001-26]");
is("files as a rate request in Team oversight", mailKind(subject), "rfq");
is("carries the job's reference for filing", refInSubject(subject), "ALG99001-26");
is("an edited subject gets its reference back", withReference("Rates please", job.ref), "Rates please [ALG99001-26]");
is("…but not twice", withReference(subject, "alg99001-26"), subject);
is("a long cargo is shortened", requestSubject({ ...job, cargo: "x".repeat(90) }).includes("x".repeat(57) + "…"), true);

console.log("\neach partner's mail");
is("greets by first name", greetingName({ name: "Omar Al Farsi", organisation: "Gulf Freight" }), "Omar");
is("no contact: their team", greetingName({ name: "", organisation: "Gulf Freight" }), "Gulf Freight team");
const message = "<p>Dear partner,</p><p>The shipment:</p><table></table>";
const mail = personalise(message, { name: "Omar Al Farsi", organisation: "Gulf Freight" }, ["Destination charges", "Delivery to consignee"], job);
is("their greeting replaces the message's own", [mail.startsWith("<p>Dear Omar,</p>"), mail.includes("Dear partner")], [true, false]);
is("their services, each with where it applies", mail.includes("<li><strong>Destination charges</strong> — at Hamburg</li><li><strong>Delivery to consignee</strong> — at Hamburg</li>"), true);
is("then the message about the shipment", mail.endsWith("<p>The shipment:</p><table></table>"), true);
is("a partner's name is escaped", personalise("", { name: "", organisation: "A<b>" }, ["X"], job).includes("A&lt;b&gt; team"), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
