import { readForwardChain } from "../../src/services/forwardChain";
import type { MailMessage } from "../../src/services/backend";

const base = {
  conversationId: "c1",
  mailbox: "aashish@aashishlogistics.com",
  folder: "inbox" as const,
  toRecipients: [{ emailAddress: { name: "", address: "aashish@aashishlogistics.com" } }],
  ccRecipients: [],
  receivedDateTime: "2026-09-10T08:18:00Z",
  isRead: false,
  isDraft: false,
  hasAttachments: false,
  attachments: [],
  importance: "normal" as const,
};

const mk = (o: Partial<MailMessage>): MailMessage =>
  ({
    ...base,
    id: "m1",
    subject: "",
    bodyPreview: "",
    from: { emailAddress: { name: "", address: "" } },
    body: { contentType: "text", content: "" },
    ...o,
  }) as MailMessage;

const H = (name: string, value: string) => ({ name, value });

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

// ---------------------------------------------------------------------------
// The case this was built for: info@ auto-forwards a customer's mail to aashish@
// ---------------------------------------------------------------------------
const FWD_BODY = [
  "Please handle this one.",
  "",
  "From: Wei Chen <wei.chen@qingdaoexports.cn>",
  "Sent: 10 September 2026 09:12",
  "To: info@aashishlogistics.com",
  "Subject: NEW PURCHASE ORDER//QINGDAO//FOB",
  "",
  "Dear Sir, we wish to move 2x20' FCL of ceramic tiles from Qingdao to Chennai.",
].join("\n");

console.log("\nan Exchange inbox rule forwarded it");
const auto = mk({
  from: { emailAddress: { name: "info", address: "info@aashishlogistics.com" } },
  body: { contentType: "text", content: FWD_BODY },
  internetMessageHeaders: [
    H("X-MS-Exchange-Inbox-Rules-Loop", "info@aashishlogistics.com"),
    H("Return-Path", "<wei.chen@qingdaoexports.cn>"),
  ],
});
const a = readForwardChain(auto);
is("recognised as a forward", a !== null, true);
is("marked automatic", a?.auto, true);
is("forwarded by the rule's mailbox", a?.forwardedBy, "info@aashishlogistics.com");
is("original sender read from the block", a?.originalFrom, "wei.chen@qingdaoexports.cn");
is("original name too", a?.originalName, "Wei Chen");
is("original recipient", a?.originalTo, "info@aashishlogistics.com");
is("says where it looked", a?.via, "inbox-rule");

console.log("\na person pressed Forward");
const byHand = mk({
  from: { emailAddress: { name: "Parasu", address: "parasu@aashishlogistics.com" } },
  body: { contentType: "text", content: FWD_BODY },
});
const b = readForwardChain(byHand);
is("still recognised", b !== null, true);
is("NOT marked automatic", b?.auto, false);
is("forwarded by whoever sent it", b?.forwardedBy, "parasu@aashishlogistics.com");
is("original sender still found", b?.originalFrom, "wei.chen@qingdaoexports.cn");
is("read from the body", b?.via, "forward-block");

console.log("\nother mail systems");
is(
  "Resent-From",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "", address: "info@aashishlogistics.com" } },
      body: { contentType: "text", content: FWD_BODY },
      internetMessageHeaders: [H("Resent-From", "Info Desk <info@aashishlogistics.com>")],
    })
  )?.via,
  "resent-header"
);
is(
  "X-Forwarded-For",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "", address: "info@aashishlogistics.com" } },
      body: { contentType: "text", content: FWD_BODY },
      internetMessageHeaders: [H("X-Forwarded-For", "info@aashishlogistics.com")],
    })
  )?.forwardedBy,
  "info@aashishlogistics.com"
);
is(
  "header names are matched without case",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "", address: "info@aashishlogistics.com" } },
      body: { contentType: "text", content: FWD_BODY },
      internetMessageHeaders: [H("x-ms-exchange-inbox-rules-loop", "info@aashishlogistics.com")],
    })
  )?.auto,
  true
);

console.log("\nordinary mail is not a forward");
is(
  "a plain message",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "Priya", address: "priya@sunrisetextiles.in" } },
      body: { contentType: "text", content: "Please quote LCL Chennai to Colombo." },
    })
  ),
  null
);
is(
  "no headers fetched at all",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "Priya", address: "priya@sunrisetextiles.in" } },
      body: { contentType: "text", content: "Please quote." },
    })
  ),
  null
);
is(
  "a reply quoting the person you are replying to is not a forward",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "Priya", address: "priya@sunrisetextiles.in" } },
      body: {
        contentType: "text",
        content: "Thanks.\n\nFrom: priya@sunrisetextiles.in\nTo: aashish@aashishlogistics.com",
      },
    })
  ),
  null
);

console.log("\nHTML bodies read the same as text");
const html = mk({
  from: { emailAddress: { name: "info", address: "info@aashishlogistics.com" } },
  body: {
    contentType: "html",
    content:
      '<div>Please handle.</div><div id="divRplyFwdMsg"><b>From:</b> Wei Chen ' +
      "&lt;wei.chen@qingdaoexports.cn&gt;<br><b>To:</b> info@aashishlogistics.com</div>",
  },
  internetMessageHeaders: [H("X-MS-Exchange-Inbox-Rules-Loop", "info@aashishlogistics.com")],
});
is("original sender out of HTML", readForwardChain(html)?.originalFrom, "wei.chen@qingdaoexports.cn");
is("and the name", readForwardChain(html)?.originalName, "Wei Chen");

console.log("\nnothing is invented");
is(
  "a rule header with no forward block still reports the forwarder",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "", address: "info@aashishlogistics.com" } },
      body: { contentType: "text", content: "No block here." },
      internetMessageHeaders: [H("X-MS-Exchange-Inbox-Rules-Loop", "info@aashishlogistics.com")],
    })
  ),
  {
    auto: true,
    forwardedBy: "info@aashishlogistics.com",
    originalFrom: null,
    originalName: null,
    originalTo: null,
    via: "inbox-rule",
  }
);
is(
  "a bare address with no display name claims no name",
  readForwardChain(
    mk({
      from: { emailAddress: { name: "", address: "info@aashishlogistics.com" } },
      body: { contentType: "text", content: "x\n\nFrom: wei.chen@qingdaoexports.cn\nTo: info@aashishlogistics.com" },
      internetMessageHeaders: [H("X-MS-Exchange-Inbox-Rules-Loop", "info@aashishlogistics.com")],
    })
  )?.originalName,
  null
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
