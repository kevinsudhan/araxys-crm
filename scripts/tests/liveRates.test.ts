import { readFileSync } from "node:fs";
import { COMPANY } from "../../src/lib/company";
import { mailKind } from "../../src/lib/mailLog";
import { dayLabel, greetingFor, istDate, nextSendAt, rateRequestMail, rateRequestSubject, weekAsked } from "../../src/lib/liveRates";

/**
 * Live rates (101): when the Sunday mail goes, which week it asks about, and
 * the mail itself — the same file the live-rates function sends from.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
/** An instant given on India's clock. */
const ist = (s: string) => new Date(`${s}+05:30`);

console.log("when it goes");
is("from a Saturday: the Sunday after, 8:30 pm IST", nextSendAt(ist("2026-09-26T12:00:00")).toISOString(), "2026-09-27T15:00:00.000Z");
is("a minute before, on the Sunday: that evening", nextSendAt(ist("2026-09-27T20:29:00")).toISOString(), "2026-09-27T15:00:00.000Z");
is("at 8:30 pm exactly: the next Sunday", nextSendAt(ist("2026-09-27T20:30:00")).toISOString(), "2026-10-04T15:00:00.000Z");
is("later that Sunday evening: the next Sunday", nextSendAt(ist("2026-09-27T22:30:00")).toISOString(), "2026-10-04T15:00:00.000Z");
is("from a Monday: six days on", nextSendAt(ist("2026-09-28T09:00:00")).toISOString(), "2026-10-04T15:00:00.000Z");
is("8:30 pm IST is 15:00 GMT, the cron's clock", [nextSendAt(new Date("2026-09-26T00:00:00Z")).getUTCHours(), nextSendAt(new Date("2026-09-26T00:00:00Z")).getUTCMinutes(), nextSendAt(new Date("2026-09-26T00:00:00Z")).getUTCDay()], [15, 0, 0]);
// 117 moved the schedule from 101's 17:00 GMT; the screen and the cron must agree.
const migration = readFileSync("supabase-v2/117-live-rates-8-30.sql", "utf8");
is("the cron runs at 15:00 GMT on Sundays, then every ten minutes to 15:50", migration.includes("'0,10,20,30,40,50 15 * * 0'"), true);
is("India's date, not the server's: 00:15 IST on Monday is Monday", istDate(new Date("2026-09-27T18:45:00Z")), "2026-09-28");

console.log("\nthe week it asks about");
is("sent on Sunday night: Monday to the Sunday after", weekAsked(ist("2026-09-27T22:30:00")), { from: "2026-09-28", to: "2026-10-04" });
is("sent by hand on a Wednesday: that day to Sunday", weekAsked(ist("2026-09-30T11:00:00")), { from: "2026-09-30", to: "2026-10-04" });
is("on a Monday: the whole week", weekAsked(ist("2026-09-28T10:00:00")), { from: "2026-09-28", to: "2026-10-04" });
is("on a Saturday: today and tomorrow", weekAsked(ist("2026-10-03T10:00:00")), { from: "2026-10-03", to: "2026-10-04" });
is("days as the mail writes them", [dayLabel("2026-09-28"), dayLabel("2026-10-04", true)], ["Mon 28 Sep", "Sun 4 Oct 2026"]);

console.log("\nthe mail");
const sunday = ist("2026-09-27T22:30:00");
const req = { service: "  FCL 20' / 40' · Chennai → Jebel Ali ", details: "Ocean freight per container\n\n  THC & DO charges  \nFree days" };
const omar = { name: "Omar", organisation: "Gulf Freight Partners LLC" };
const m = rateRequestMail(req, omar, COMPANY, sunday);
is("the subject: the service and the week", m.subject, "Rate request · FCL 20' / 40' · Chennai → Jebel Ali · week of 28 Sep");
is("filed as a rate request on Team oversight", mailKind(m.subject), "rfq");
is("the subject the function logs is the one sent", rateRequestSubject(req, sunday), m.subject);
is("addressed to the contact", m.html.includes("Dear Omar,"), true);
is("the week, with the year at the end", m.html.includes("<b>Mon 28 Sep to Sun 4 Oct 2026</b>"), true);
is("the service, trimmed and escaped", m.html.includes(">FCL 20&#39; / 40&#39; · Chennai → Jebel Ali<") || m.html.includes(">FCL 20' / 40' · Chennai → Jebel Ali<"), true);
is("what to quote, a line each, blanks dropped, & escaped", m.html.includes("Ocean freight per container<br/>THC &amp; DO charges<br/>Free days"), true);
is("signed from the letterhead", m.html.includes(COMPANY.legalName) && m.html.includes(COMPANY.address[1]) && m.html.includes(`Tel: ${COMPANY.phone}`), true);
const bare = rateRequestMail({ service: "LCL <b>x</b>", details: "   " }, { name: "", organisation: "" }, COMPANY, sunday);
is("markup in a name cannot get into the mail", bare.html.includes("LCL &lt;b&gt;x&lt;/b&gt;") && !bare.html.includes("<b>x</b>"), true);
is("no details, no empty box line", bare.html.includes('margin-top:6px'), false);
is("greeting: the contact, else the company's team, else Sir / Madam", [greetingFor(omar), greetingFor({ name: " ", organisation: "GFP" }), greetingFor({ name: "", organisation: "" })], ["Omar", "GFP team", "Sir / Madam"]);

console.log("\nthe function sends this same mail");
const norm = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
is("supabase-v2/functions/live-rates/liveRates.ts is src/lib/liveRates.ts", norm("supabase-v2/functions/live-rates/liveRates.ts") === norm("src/lib/liveRates.ts"), true);
is("supabase-v2/functions/live-rates/company.ts is src/lib/company.ts", norm("supabase-v2/functions/live-rates/company.ts") === norm("src/lib/company.ts"), true);
is("neither imports anything (the function has only its own folder)", /^import /m.test(norm("src/lib/liveRates.ts")) || /^import /m.test(norm("src/lib/company.ts")), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
