import { planApply } from "../../src/services/applyPlan";
import type { Intake } from "../../src/services/intake";

const row = (o: Partial<Intake>): Intake =>
  ({
    id: "i1",
    status: "new",
    channel: "email",
    contact_name: null,
    company: null,
    phone: null,
    email: null,
    origin: null,
    destination: null,
    cargo: null,
    notes: null,
    call_id: null,
    message_id: null,
    conversation_id: null,
    subject: null,
    enquiry_ref: null,
    dismissed_reason: null,
    received_at: "2026-09-10T08:00:00Z",
    captured_by: null,
    settled_at: null,
    settled_by: null,
    updated_at: "2026-09-10T08:00:00Z",
    ...o,
  }) as Intake;

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

const READING = {
  contact_name: "Wei Chen",
  company: "Qingdao Exports Ltd",
  email: "wei.chen@qingdaoexports.cn",
  phone: "+86 532 8888 1234",
  origin: "Qingdao",
  destination: "Chennai",
  cargo: "2x20' FCL ceramic tiles",
};

console.log("\nan empty row takes everything");
const empty = planApply(row({}), READING);
is("all seven filled", empty.count, 7);
is("nothing in conflict", empty.conflicts, []);
is("the values are the reading's", empty.fill.origin, "Qingdao");

console.log("\na row that already answers is not overwritten");
const partial = planApply(
  row({ contact_name: "Somebody Else", origin: "Ningbo" }),
  READING
);
is("only the blanks are filled", partial.count, 5);
is("the answered fields are untouched", "contact_name" in partial.fill, false);
is("and are reported", partial.conflicts, ["Name", "Origin"]);

console.log("\nagreement is not a conflict");
is(
  "same value, different case and spacing",
  planApply(row({ origin: "  qingdao " }), READING).conflicts,
  []
);
is(
  "and it is not re-written either",
  "origin" in planApply(row({ origin: "  qingdao " }), READING).fill,
  false
);

console.log("\nnothing is invented");
is(
  "a reading with no fields fills nothing",
  planApply(row({}), {}).count,
  0
);
is(
  "nulls are skipped",
  planApply(row({}), { origin: null, destination: "Chennai" }).count,
  1
);
is(
  "so are empty strings and whitespace",
  planApply(row({}), { origin: "   ", destination: "" }).count,
  0
);

console.log("\na fully answered row has nothing to do");
const full = planApply(
  row({
    contact_name: "Wei Chen",
    company: "Qingdao Exports Ltd",
    email: "wei.chen@qingdaoexports.cn",
    phone: "+86 532 8888 1234",
    origin: "Qingdao",
    destination: "Chennai",
    cargo: "2x20' FCL ceramic tiles",
  }),
  READING
);
is("nothing to fill", full.count, 0);
is("and nothing disagrees", full.conflicts, []);

console.log("\nblank-looking values on the row count as blank");
is(
  "whitespace in the row is not an answer",
  planApply(row({ origin: "   " }), READING).fill.origin,
  "Qingdao"
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
