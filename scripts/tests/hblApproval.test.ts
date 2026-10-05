import { emptyContainer, emptyHbl, type HblData } from "../../src/lib/hbl";
import { approvalLine, changedSinceSent, hblDraftHtml, hblDraftSubject, issueWarning, stableJson, type ApprovalRow } from "../../src/lib/hblApproval";
import { checkHouseAgainstMaster, houseProblems, problemText, type MasterFacts } from "../../src/lib/houseMaster";
import { hblFileName } from "../../src/lib/documents/hblPdf";

/** The shipper's approval of our house B/L draft, a correction as an amendment, and each house against its master (123, 5 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const d: HblData = {
  ...emptyHbl(),
  shipper_name: "SRI AUTO COMPONENTS",
  consignee_name: "HANSE PARTS <GMBH>",
  vessel: "KOTA LESTARI",
  voyage: "0127W",
  port_of_loading: "CHENNAI",
  port_of_discharge: "HAMBURG",
  containers: [{ ...emptyContainer(), container_no: "PCIU1234567", seal_no: "PIL55667", size_type: "40HC" }],
  packages: "20",
  package_type: "CTNS",
  description: "AUTO PARTS",
  gross_weight_kg: "2000",
  measurement_cbm: "6",
};

console.log("one B/L, however it was stored");
is("keys in any order serialise alike", stableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), stableJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));

const base: ApprovalRow = { hbl_no: "HBL/26-27/0001", release_mode: "original", originals: 3, data: d, approval: "none", draft_sent: null, draft_sent_at: null, draft_sent_to: "", approval_at: null, approval_by: "", approval_note: "" };
// The copy as Postgres hands it back: the same B/L, its keys in another order.
const sent = { data: JSON.parse(stableJson(d)), hbl_no: "HBL/26-27/0001", release_mode: "original" as const, originals: 3, amendment: 0 };

console.log("\nwhere the approval stands");
is("not sent", [approvalLine(base).tone, issueWarning(base)], ["muted", "The shipper has not been sent this draft to approve"]);
const waiting = { ...base, approval: "sent" as const, draft_sent: sent, draft_sent_to: "exports@sriauto.example" };
is("sent, waiting", [approvalLine(waiting).text, issueWarning(waiting)], ["Sent to the shipper (exports@sriauto.example): waiting for their approval", "The shipper has not approved the draft yet"]);
const approved = { ...waiting, approval: "approved" as const, approval_by: "Ravi" };
is("approved this very draft: nothing to ask", [approvalLine(approved).text, changedSinceSent(approved), issueWarning(approved)], ["Approved by Ravi", false, null]);
const edited = { ...approved, data: { ...d, voyage: "0128W" } };
is("changed after approval: send it again", [changedSinceSent(edited), approvalLine(edited).tone, issueWarning(edited)], [true, "warn", "The B/L has changed since the shipper was sent it"]);
is("originals changed counts too", changedSinceSent({ ...approved, originals: 2 }), true);
const changes = { ...waiting, approval: "changes" as const, approval_note: "Consignee address: 14 Hafenstrasse" };
is("corrections asked", [approvalLine(changes).text, issueWarning(changes)], ["The shipper asks for corrections", 'The shipper asked for corrections: "Consignee address: 14 Hafenstrasse"']);

console.log("\nthe mail to the shipper");
is("subject", hblDraftSubject({ hblNo: "HBL/26-27/0001", ref: "ALG09014-26", amendment: 0 }), "[ALG09014-26] DRAFT HOUSE B/L HBL/26-27/0001 — FOR YOUR APPROVAL");
is("subject, amended", hblDraftSubject({ hblNo: "HBL/26-27/0001", ref: "ALG09014-26", amendment: 2 }), "[ALG09014-26] DRAFT HOUSE B/L HBL/26-27/0001 — AMENDMENT 2 — FOR YOUR APPROVAL");
const html = hblDraftHtml({ hblNo: "HBL/26-27/0001", data: d, url: "https://crm.example/b/abc", amendment: 0, fromName: "Kevin", sentAt: new Date("2026-10-05T06:00:00Z") });
is(
  "the brief, both buttons to the page, the ask",
  ["SRI AUTO COMPONENTS", "HANSE PARTS &lt;GMBH&gt;", "PCIU1234567 seal PIL55667", "KOTA LESTARI / 0127W", "https://crm.example/b/abc?approve=1", "https://crm.example/b/abc?correct=1", "Approve the draft", "Ask for a correction", "before we issue the originals"].map((t) => html.includes(t)),
  [true, true, true, true, true, true, true, true, true]
);
const noLink = hblDraftHtml({ hblNo: "HBL/26-27/0001", data: d, url: null, amendment: 1 });
is("no reachable link: no buttons; amended wording", [noLink.includes("approve=1"), noLink.includes("corrected draft"), noLink.includes("DRAFT B/L — AMENDED")], [false, true, true]);

console.log("\nthe amendment on paper");
is("file names", [hblFileName({ hblNo: "HBL/26-27/0001", print: "original", release: "original" }), hblFileName({ hblNo: "HBL/26-27/0001", print: "original", release: "original", amendment: 1 })], ["HBL-26-27-0001-original.pdf", "HBL-26-27-0001-original-amendment1.pdf"]);

console.log("\na house against its master");
const m: MasterFacts = { console_no: "CON/26-27/0014", mblNo: "PILMAA0099887", vessel: "Kota Lestari", voyage: "0127W", pol: "Chennai, India", pod: "Hamburg", boxes: [{ container_no: "PCIU 1234567", seal_no: "PIL55667" }] };
const rows = checkHouseAgainstMaster(d, "HBL/26-27/0001", m);
is("everything agrees", [rows.map((r) => r.key), houseProblems(rows).length], [["vessel", "voyage", "pol", "pod", "seal:PCIU1234567"], 0]);
const off = checkHouseAgainstMaster({ ...d, voyage: "0128W", containers: [{ ...emptyContainer(), container_no: "PCIU1234567", seal_no: "PIL55668" }, { ...emptyContainer(), container_no: "TGHU7654321" }] }, "pilmaa0099887", m);
is(
  "the master's number, a voyage, a seal, a box not on the master",
  houseProblems(off).map(problemText),
  [
    "The house B/L carries the master's number PILMAA0099887: Customs refuses that",
    "Voyage: 0128W on the house, 0127W on the master",
    "Seal on PCIU1234567: PIL55668 on the house, PIL55667 on the master",
    "Container TGHU7654321 is not one of the master's boxes",
  ]
);
is("what the master does not have yet is not checked", checkHouseAgainstMaster(d, null, { ...m, voyage: "", boxes: null }).map((r) => r.key), ["vessel", "pol", "pod"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
