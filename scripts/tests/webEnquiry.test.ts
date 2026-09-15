import { looksLikeWebEnquiry, parseWebEnquiry } from "../../src/services/webEnquiry";
import type { MailMessage } from "../../src/services/backend";

const base = { conversationId:"c1", mailbox:"aashish@aashishlogistics.com", folder:"inbox" as const,
  toRecipients:[{emailAddress:{name:"",address:"info@aashishlogistics.com"}}], ccRecipients:[],
  receivedDateTime:"2026-09-01T06:21:00Z", isRead:false, isDraft:false, hasAttachments:false,
  attachments:[], importance:"normal" as const };

const mk = (o: Partial<MailMessage>): MailMessage => ({ ...base, id:"m1", subject:"", bodyPreview:"",
  from:{emailAddress:{name:"",address:""}}, body:{contentType:"text",content:""}, ...o } as MailMessage);

let pass = 0, fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// ---- the real one, exactly as it arrives ----
const real = mk({
  subject: "Form submission from quote form:",
  from: { emailAddress: { name: "aashishlogisticsglobal.com", address: "formresponses@netlify.com" } },
  body: { contentType: "text", content:
    "Name:\nKevin Sudhan\n\nPhone:\n+918939153390\n\nEmail:\nkevinsudhan31@gmail.com\n\nMessage:\nEnquiry test\n" },
});

console.log("\nthe live Netlify submission");
is("recognised", looksLikeWebEnquiry(real), true);
const p = parseWebEnquiry(real);
is("name", p.contact_name, "Kevin Sudhan");
is("phone", p.phone, "+918939153390");
is("email is the visitor, not netlify", p.email, "kevinsudhan31@gmail.com");
is("message becomes the notes", p.notes, "Enquiry test");
is("nothing invented for company", p.company, null);
is("nothing invented for route", [p.origin, p.destination], [null, null]);

console.log("\nrecognition");
is("by sender alone", looksLikeWebEnquiry(mk({ subject:"anything",
  from:{emailAddress:{name:"",address:"formresponses@netlify.com"}} })), true);
is("by subject alone, if the form moves host", looksLikeWebEnquiry(mk({
  subject:"Form submission from quote form:", from:{emailAddress:{name:"",address:"forms@web.example"}} })), true);
is("ordinary mail is not a form", looksLikeWebEnquiry(mk({ subject:"Re: your quote",
  from:{emailAddress:{name:"Meera",address:"meera@kavitha.example"}} })), false);

console.log("\nother shapes the form might take");
const inline = mk({ subject:"Form submission from quote form:", body:{contentType:"text",
  content:"Name: Priya R\nCompany: Vanni Exports\nEmail: priya@vanni.example\nOrigin: Chennai\nDestination: Jebel Ali\nCargo: 12 pallets\n"}});
const q = parseWebEnquiry(inline);
is("label and value on one line", [q.contact_name, q.company, q.email], ["Priya R","Vanni Exports","priya@vanni.example"]);
is("route read", [q.origin, q.destination, q.cargo], ["Chennai","Jebel Ali","12 pallets"]);

const html = mk({ subject:"Form submission from quote form:", body:{contentType:"html",
  content:"<div><p>Name:</p><p>Arun K</p><p>Email:</p><p>arun@x.example</p><p>Message:</p><p>Need a rate<br>for 3 crates</p></div>"}});
const h = parseWebEnquiry(html);
is("html body", [h.contact_name, h.email], ["Arun K","arun@x.example"]);
is("multi-line message survives", h.notes, "Need a rate\nfor 3 crates");

const noLabels = mk({ subject:"Form submission from quote form:", body:{contentType:"text",
  content:"Hello, please quote me. Reach me on sundar@navarasa.example thanks"}});
const n = parseWebEnquiry(noLabels);
is("falls back to an address in the body", n.email, "sundar@navarasa.example");
is("and claims no name it did not read", n.contact_name, null);

const ourAddr = mk({ subject:"Form submission from quote form:", body:{contentType:"text",
  content:"Sent to info@aashishlogistics.com by formresponses@netlify.com about a shipment"}});
is("never picks one of our own addresses", parseWebEnquiry(ourAddr).email, null);

const routeTrap = mk({ subject:"Form submission from quote form:", body:{contentType:"text",
  content:"From: someone@else.example\nTo: info@aashishlogistics.com\nName:\nRaj\n"}});
const rt = parseWebEnquiry(routeTrap);
is("mail headers are not a route", [rt.origin, rt.destination], [null, null]);
is("but the real field still reads", rt.contact_name, "Raj");

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
if (fail) process.exit(1);
