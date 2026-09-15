import { greetingHtml, salutationName } from "../../src/lib/greeting";

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

console.log("\nthe names on this desk's real mail");
is("Syed Farmanullah A", salutationName("Syed Farmanullah A", "syed@dashray.com"), "Syed");
is("L.Parasuraman", salutationName("L.Parasuraman", "parasu@aashishlogistics.com"), "L.Parasuraman");
is("Wei Chen", salutationName("Wei Chen", "wei@qingdaoexports.cn"), "Wei");
is("AAS INT is not shouted back", salutationName("AAS INT", "intlsales@aakarshfreight.com"), "Aas");
is("one word", salutationName("Priya", "priya@sunrise.in"), "Priya");

console.log("\ntitles are not the person");
is("Mr. Wei Chen", salutationName("Mr. Wei Chen", "x@y.com"), "Wei");
is("Dr Raghavan", salutationName("Dr Raghavan", "x@y.com"), "Raghavan");
is("M/s Lanka Consol", salutationName("M/s Lanka Consol", "x@y.com"), "Lanka");
is("a title alone gives nothing", salutationName("Mr.", "x@y.com"), null);

console.log("\nsurname-first directories");
is("Chen, Wei", salutationName("Chen, Wei", "x@y.com"), "Wei");
is("Raghavan, Priya S", salutationName("Raghavan, Priya S", "x@y.com"), "Priya");

console.log("\ninitials are not a salutation");
is("A Syed", salutationName("A Syed", "x@y.com"), "Syed");
is("A. B. Kumar", salutationName("A. B. Kumar", "x@y.com"), "Kumar");
is("a lone initial gives nothing", salutationName("A", "x@y.com"), null);

console.log("\nnothing usable");
is("no name at all", salutationName("", "ops@qingdaoexports.cn"), null);
is("null name", salutationName(null, "ops@qingdaoexports.cn"), null);
is(
  "an address in the name slot is not a name",
  salutationName("ops@qingdaoexports.cn", "ops@qingdaoexports.cn"),
  null
);
is("the address is never mined for a name", salutationName(null, "intlsales@x.com"), null);

console.log("\nmixed case is left as its owner writes it");
is("McBride", salutationName("Fiona McBride", "x@y.com"), "Fiona");
is("van Dijk", salutationName("van Dijk", "x@y.com"), "van Dijk");
is("O'Brien", salutationName("O'Brien Shipping", "x@y.com"), "O'Brien");

console.log("\nthe greeting itself");
is(
  "named",
  greetingHtml("Syed Farmanullah A", "s@d.com"),
  "<div>Dear Syed,</div><div><br></div><div>Good day to you.</div><div><br></div>"
);
is(
  "unnamed falls back rather than guessing",
  greetingHtml(null, "ops@qingdaoexports.cn"),
  "<div>Dear Sir/Madam,</div><div><br></div><div>Good day to you.</div><div><br></div>"
);
is(
  "no honorific is ever invented",
  greetingHtml("Priya Raghavan", "p@s.in").includes("Mr.") ||
    greetingHtml("Priya Raghavan", "p@s.in").includes("Ms."),
  false
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
