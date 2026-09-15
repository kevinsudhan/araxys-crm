/**
 * Clears a test caller back to nothing, so the same number can call again.
 *
 *   node supabase-v2/forget-caller.mjs C0002          # show what would go
 *   node supabase-v2/forget-caller.mjs C0002 --apply  # do it
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST forget_call()
 *
 * forget_call() removes an enquiry only while nothing has happened on it -- no
 * quote, no shipment. That is right for the CRM: an enquiry somebody has priced
 * is real work, and a stray call being forgotten must not take it down.
 *
 * A test caller is the case where that guard is in the way. The call ended in
 * an accepted quote, which is exactly what makes it worth testing again, and
 * exactly what stops the built-in path from clearing it.
 *
 * So this walks the whole chain deliberately, prints it first, and only touches
 * the customer named on the command line. It refuses to remove anything that
 * has become a shipment -- at that point it is a booking, not a test.
 *
 * The suppression is written BEFORE the deletes, so the ingest cron cannot
 * re-import the call into the gap.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { id } = JSON.parse(readFileSync(join(root, "server-v2/.project.json"), "utf-8"));
const { service_role } = JSON.parse(readFileSync(join(root, "server-v2/.keys.json"), "utf-8"));
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const base = `https://${id}.supabase.co/rest/v1`;
const H = {
  apikey: service_role,
  Authorization: `Bearer ${service_role}`,
  "Content-Type": "application/json",
};

const get = (path) => fetch(`${base}/${path}`, { headers: H }).then((r) => r.json());
const del = (path) =>
  fetch(`${base}/${path}`, { method: "DELETE", headers: { ...H, Prefer: "return=representation" } })
    .then((r) => r.json())
    .then((rows) => (Array.isArray(rows) ? rows.length : 0));

const customerId = process.argv[2];
const apply = process.argv.includes("--apply");

if (!customerId || customerId.startsWith("--")) {
  console.error("usage: node supabase-v2/forget-caller.mjs <CUSTOMER_ID> [--apply]");
  process.exit(1);
}

const customers = await get(`customers?id=eq.${customerId}&select=*`);
if (!customers.length) {
  console.error(`No customer ${customerId}.`);
  process.exit(1);
}
const customer = customers[0];

const enquiries = await get(`enquiries?customer_id=eq.${customerId}&select=ref,status,source`);
const refs = enquiries.map((e) => e.ref);
const inList = `(${refs.join(",") || "__none__"})`;

const [calls, quotes, shipments, events, parties, threads] = await Promise.all([
  get(`calls?customer_id=eq.${customerId}&select=call_id,from_number,duration_secs`),
  refs.length ? get(`quotes?enquiry_ref=in.${inList}&select=id,enquiry_ref,amount_inr,status`) : [],
  refs.length ? get(`shipments?enquiry_ref=in.${inList}&select=id,enquiry_ref,stage`) : [],
  refs.length ? get(`enquiry_events?enquiry_ref=in.${inList}&select=id`) : [],
  refs.length ? get(`enquiry_parties?enquiry_ref=in.${inList}&select=id`) : [],
  refs.length ? get(`enquiry_threads?enquiry_ref=in.${inList}&select=conversation_id`) : [],
]);

console.log(`\n  customer   ${customer.id} — ${customer.name} / ${customer.company}`);
console.log(`  phones     ${(customer.phones ?? []).join(", ") || "—"}`);
console.log(`  emails     ${(customer.emails ?? []).join(", ") || "—"}`);
console.log(`  enquiries  ${enquiries.map((e) => `${e.ref} (${e.status})`).join(", ") || "—"}`);
console.log(`  calls      ${calls.map((c) => `${c.call_id} (${c.duration_secs}s)`).join(", ") || "—"}`);
console.log(`  quotes     ${quotes.map((q) => `v? ₹${q.amount_inr} ${q.status}`).join(", ") || "—"}`);
console.log(`  events ${events.length} · parties ${parties.length} · threads ${threads.length}`);

/**
 * A shipment means somebody has booked freight. Whatever this started as, it
 * is not a test any more, and no amount of --apply should take it out.
 */
if (shipments.length) {
  console.error(
    `\n  REFUSED — ${shipments.map((s) => s.id).join(", ")} is a live shipment. ` +
      `Cancel it deliberately if that is really what you want.\n`
  );
  process.exit(1);
}

if (!apply) {
  console.log("\n  dry run — pass --apply to remove all of the above\n");
  process.exit(0);
}

// Suppression first: the ingest cron runs every two minutes and would otherwise
// re-import the call into the hole we are about to make.
for (const c of calls) {
  const r = await fetch(`${base}/suppressed_calls`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ call_id: c.call_id, reason: `test caller ${customerId} cleared` }),
  });
  console.log(`  suppress ${c.call_id} -> ${r.status}`);
}

// Children before parents; the foreign keys would refuse the other order.
if (refs.length) {
  console.log(`  events   -${await del(`enquiry_events?enquiry_ref=in.${inList}`)}`);
  console.log(`  messages -${await del(`enquiry_messages?enquiry_ref=in.${inList}`)}`);
  console.log(`  threads  -${await del(`enquiry_threads?enquiry_ref=in.${inList}`)}`);
  console.log(`  parties  -${await del(`enquiry_parties?enquiry_ref=in.${inList}`)}`);
  console.log(`  quotes   -${await del(`quotes?enquiry_ref=in.${inList}`)}`);
}
console.log(`  calls    -${await del(`calls?customer_id=eq.${customerId}`)}`);

/**
 * Calls from the same number that were never matched to anybody.
 *
 * Short calls -- a ring-off, a wrong number, a line that dropped before anyone
 * spoke -- are stored with a null customer_id, so a wipe keyed on the customer
 * left them behind. On one clear-down that meant seven rows for a number
 * reported as fully removed. Anything sharing a phone_key with this customer
 * goes too, and is suppressed on the way out.
 */
for (const phone of new Set((customer.phones ?? []).map((x) => String(x).replace(/\D/g, "").slice(-10)))) {
  if (phone.length < 10) continue;
  const strays = await get(`calls?phone_key=eq.${phone}&select=call_id`);
  for (const c of strays) {
    await fetch(`${base}/suppressed_calls`, {
      method: "POST",
      headers: { ...H, Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ call_id: String(c.call_id), reason: `unmatched call from ${phone}` }),
    });
  }
  if (strays.length) console.log(`  unmatched-${await del(`calls?phone_key=eq.${phone}`)}`);
}
if (refs.length) console.log(`  enquiry  -${await del(`enquiries?customer_id=eq.${customerId}`)}`);
console.log(`  customer -${await del(`customers?id=eq.${customerId}`)}`);

/**
 * The agents' own memory of this caller.
 *
 * Deleting the CRM rows is not enough. SnapServe keeps a per-number record the
 * agent reads before the call connects -- facts, per-call episodes, a name and
 * its own generated summary -- and it survives everything done above. Left
 * alone, the next test call opens with the agent naming an enquiry that no
 * longer exists.
 *
 * DELETE, not overwrite. The first version of this wrote empty strings over
 * each fact, and SnapServe silently ignores an empty value: ext_reference still
 * read ARX-C0002-E01, and the generated summary still described a fabricated
 * twenty-piece shipment. A record that looks cleared but is not is worse than
 * one nobody tried to clear.
 *
 * Both the ten-digit key and the full number, because a record can exist under
 * either depending on how the call arrived.
 */
const SNAP = "https://app.snapserve.ai/api";
const AGENTS = [717, 758]; // Priya, Arun

const numbers = new Set();
for (const raw of [...(customer.phones ?? []), ...calls.map((c) => c.from_number)]) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length >= 10) {
    numbers.add(digits.slice(-10));
    numbers.add(digits);
  }
}

for (const phone of numbers) {
  for (const agentId of AGENTS) {
    const r = await fetch(`${SNAP}/agents/${agentId}/caller-memory/${phone}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    console.log(`  memory   ${phone} @ agent ${agentId} -> ${r.status}`);
  }
}

// Say what is actually left, rather than trusting the delete.
for (const agentId of AGENTS) {
  for (const phone of numbers) {
    const rec = await fetch(`${SNAP}/agents/${agentId}/caller-memory/${phone}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const n = (rec?.facts ?? []).length + (rec?.episodes ?? []).length;
    if (n) console.log(`  WARNING  ${phone} @ agent ${agentId} still holds ${n} item(s)`);
  }
}

console.log(`\n  ${customerId} cleared. The same number now arrives as a new caller.\n`);
