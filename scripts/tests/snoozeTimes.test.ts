import { snoozeChoices, snoozeLabel } from "../../src/lib/snoozeTimes";

/** Snooze's times, as Outlook offers them (29 Sep 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
const stamp = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

console.log("a Tuesday morning (29 Sep 2026, 10:20)");
const tue = snoozeChoices(local(2026, 9, 29, 10, 20));
is("four choices", tue.map((c) => c.key), ["later", "tomorrow", "weekend", "nextWeek"]);
is("later today is three hours on, on the hour", stamp(tue[0].at), "2026-9-29 13:00");
is("tomorrow is 8 in the morning", stamp(tue[1].at), "2026-9-30 8:00");
is("the weekend is Saturday morning", stamp(tue[2].at), "2026-10-3 8:00");
is("next week is Monday morning", stamp(tue[3].at), "2026-10-5 8:00");

console.log("\nlate on a Friday (2 Oct 2026, 20:30)");
const fri = snoozeChoices(local(2026, 10, 2, 20, 30));
is("no later today after 9 pm", fri.some((c) => c.key === "later"), false);
is("the weekend is tomorrow", stamp(fri.find((c) => c.key === "weekend")!.at), "2026-10-3 8:00");

console.log("\na Sunday (4 Oct 2026)");
const sun = snoozeChoices(local(2026, 10, 4, 9));
is("no weekend choice at the weekend", sun.some((c) => c.key === "weekend"), false);
is("next week is tomorrow, Monday", stamp(sun.find((c) => c.key === "nextWeek")!.at), "2026-10-5 8:00");

console.log("\nlabels");
const now = local(2026, 9, 29, 10);
is("today", snoozeLabel(local(2026, 9, 29, 17), now).startsWith("Today"), true);
is("tomorrow", snoozeLabel(local(2026, 9, 30, 8), now).startsWith("Tomorrow"), true);
is("this week, by day", /^Sat /.test(snoozeLabel(local(2026, 10, 3, 8), now)), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
