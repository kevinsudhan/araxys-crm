import { audienceOf, documentMailBody, documentMailSubject, documentSentSummary, recipientsFor } from "../../src/lib/documentMail";

/** Sending a document from the Documents list: who to, the subject, the words around the PDF (6 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const d = { reference: "ALG10001-26", origin: "Chennai", destination: "Jebel Ali" };
const booking = { id: "booking-confirmation", title: "BOOKING CONFIRMATION", shortName: "Booking confirmation" };
const vgm = { id: "vgm-declaration", title: "VGM", shortName: "VGM declaration" };
const blDraft = { id: "bl-draft", title: "DRAFT B/L", shortName: "Draft B/L" };

console.log("who it is for");
is("the customer's, the consignee's, the line's", ["booking-confirmation", "arrival-notice", "shipping-instructions", "something-new"].map((id) => audienceOf({ id })), ["customer", "consignee", "carrier", "customer"]);

const ctx = {
  customer: { name: "Ravi Kumar", company: "Ravi Exports", emails: ["ravi@raviexports.in", "RAVI@raviexports.in", "not-an-address"] },
  consignee: { name: "Gulf Traders", email: null },
  parties: [
    { role: "client", name: "Accounts", organisation: "Ravi Exports", emails: ["accounts@raviexports.in"] },
    { role: "carrier", name: "Maersk desk", organisation: "Maersk", emails: ["inbkg@maersk.com"] },
    { role: "overseas_agent", name: "Omar", organisation: "Gulf Agency", emails: ["omar@gulfagency.ae"] },
  ],
};
is("the customer: theirs first, once each, only real addresses", recipientsFor("customer", ctx).map((r) => r.address), ["ravi@raviexports.in", "accounts@raviexports.in"]);
is("the consignee with no address: the customer's", recipientsFor("consignee", ctx)[0].address, "ravi@raviexports.in");
is("the consignee's own when there is one", recipientsFor("consignee", { ...ctx, consignee: { name: "Gulf Traders", email: "ops@gulftraders.ae" } }).map((r) => r.address), ["ops@gulftraders.ae"]);
is("the line: the carrier on the job", recipientsFor("carrier", ctx).map((r) => r.address), ["inbkg@maersk.com"]);
is("no line on the job: nobody guessed", recipientsFor("carrier", { ...ctx, parties: [] }), []);

console.log("\nthe subject");
is("ready", documentMailSubject(booking, d, true), "Booking confirmation — Chennai to Jebel Ali");
is("a draft says so", documentMailSubject(booking, d, false), "DRAFT — Booking confirmation — Chennai to Jebel Ali");

console.log("\nthe words around it");
const ready = documentMailBody(booking, d, { ready: true, missing: [], to: { name: "Ravi Kumar", address: "ravi@raviexports.in" } });
is("greets them, names the document and the job", [ready.includes("Dear Ravi,"), ready.includes("the booking confirmation for our reference <strong>ALG10001-26</strong> (Chennai to Jebel Ali)")], [true, true]);
is("an acronym keeps its capitals", documentMailBody(vgm, d, { ready: true, missing: [], to: { name: null, address: null } }).includes("the VGM declaration"), true);
const draft = documentMailBody(booking, d, { ready: false, missing: ["Container type", "Vessel"], to: { name: null, address: null } });
is("a draft is called one and asks for what it needs", [draft.includes("a draft of the booking confirmation"), draft.includes("still to be confirmed — Container type, Vessel")], [true, true]);
is("the draft B/L is not 'a draft of the draft'", documentMailBody(blDraft, d, { ready: false, missing: ["Consignee address"], to: { name: null, address: null } }).includes("attached the draft B/L"), true);
is("no name: a general greeting", draft.includes("Dear Sir/Madam,"), true);
is("escaped", documentMailBody(booking, { ...d, reference: "<b>X</b>" }, { ready: true, missing: [], to: { name: null, address: null } }).includes("&lt;b&gt;X&lt;/b&gt;"), true);

console.log("\non the timeline");
is("sent, and as what", [documentSentSummary(booking, ["ravi@raviexports.in"], true, []), documentSentSummary(booking, ["ravi@raviexports.in"], false, ["Container type"])], [
  "Booking confirmation sent to ravi@raviexports.in",
  "Booking confirmation sent to ravi@raviexports.in (as a draft: container type still missing)",
]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
