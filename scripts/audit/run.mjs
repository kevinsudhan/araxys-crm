/**
 * The whole-system audit: `npm run audit`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT RUNS, AGAINST WHAT
 *
 *   1  schema drift   every table, column, RPC (and its parameter names),
 *                     bucket, edge function and realtime table the code
 *                     names, against the live catalogue          (reads)
 *   2  dead links     every in-app link against App.tsx's routes (code only)
 *   3  functions      every PL/pgSQL body checked by plpgsql_check against
 *                     the live schema                            (rolled back)
 *   4  integrity      sequences, stage / step / milestone agreement,
 *                     pipeline, people, files, RLS, views         (reads)
 *   5  business flow  enquiry → quote → approval → customer accepts → booked
 *                     → milestones → HBL → invoice → receipt → cost →
 *                     delivered → sign-off, as the real roles     (rolled back)
 *   6  operations     cron runs, mailboxes the server copy cannot read,
 *                     last night's backup                         (reads)
 *   7  advisors       Supabase's security and performance lints  (reads)
 *   8  latency        the slowest app queries in pg_stat_statements, and the
 *                     API's round trip from this machine          (reads)
 *
 * Against the live v2 project, because that is what the desk uses. Nothing
 * here changes data: the checks that write do so inside one transaction that
 * ends in a RAISE, so it is all rolled back; the one sequence the business
 * flow draws from (a booking's ARX number) is put back only if nobody else
 * drew from it meanwhile.
 *
 * The unit suites (`npm test`) and the build (`npm run build`) are separate.
 * The UI has no automated run here: it needs a signed-in browser.
 * ---------------------------------------------------------------------------
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, PROJECT } from "../../supabase-v2/token.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const api = `https://api.supabase.com/v1/projects/${PROJECT}`;
const auth = { Authorization: `Bearer ${accessToken()}` };
let failures = 0;

const head = (n, t) => console.log(`\n── ${n}. ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`);
const fail = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};
const ok = (msg) => console.log(`  ok   ${msg}`);
const note = (msg) => console.log(`  note ${msg}`);

async function sql(query) {
  const r = await fetch(`${api}/database/query`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  const text = await r.text();
  if (r.ok) return JSON.parse(text);
  const i = text.indexOf("RESULTS ");
  if (i >= 0) {
    const msg = JSON.parse(text).message;
    const m = msg.slice(msg.indexOf("RESULTS ") + 8).trim();
    return { rolledBack: JSON.parse(m.slice(0, Math.max(m.lastIndexOf("}"), m.lastIndexOf("]")) + 1)) };
  }
  throw new Error(`${r.status} ${text.slice(0, 400)}`);
}
const file = (name) => readFileSync(join(here, name), "utf-8");
const node = (script) => spawnSync(process.execPath, [join(here, script)], { cwd: root, encoding: "utf-8" });

// 1, 2 ---------------------------------------------------------------------
for (const [n, title, script] of [
  [1, "schema drift", "schema-drift.mjs"],
  [2, "dead links", "routes.mjs"],
]) {
  head(n, title);
  const r = node(script);
  const lines = (r.stdout + r.stderr).trim().split("\n");
  if (r.status === 0) ok(lines.join(" · "));
  else {
    note(lines[0]);
    for (const l of lines.slice(1).filter((l) => l.trim().startsWith("src") || l.includes("realtime") || l.includes("supabase-v2"))) fail(l.trim());
  }
}

// 3 --------------------------------------------------------------------------
head(3, "function bodies (plpgsql_check)");
{
  const { rolledBack } = await sql(file("plpgsql-check.sql"));
  const byFn = {};
  for (const f of rolledBack.findings) (byFn[f.fn] ??= []).push(f.msg);
  if (!rolledBack.findings.length) ok(`${rolledBack.checked} functions, no broken references`);
  else {
    note(`${rolledBack.checked} functions checked`);
    for (const [fn, msgs] of Object.entries(byFn)) fail(`${fn}: ${[...new Set(msgs)].join("; ")}`);
  }
}

// 4 --------------------------------------------------------------------------
head(4, "integrity");
{
  const [{ report }] = await sql(file("integrity.sql"));
  const informational = new Set(["sequences_checked", "enquiry_statuses", "realtime_tables"]);
  for (const [k, v] of Object.entries(report)) {
    if (informational.has(k)) continue;
    if (v === null || (Array.isArray(v) && !v.length)) continue;
    fail(`${k.replace(/_/g, " ")}: ${JSON.stringify(v).slice(0, 300)}`);
  }
  ok(`${report.sequences_checked} sequences, ${report.realtime_tables} realtime tables; enquiry statuses ${JSON.stringify(report.enquiry_statuses)}`);
}

// 5 --------------------------------------------------------------------------
head(5, "business flow, enquiry to sign-off (rolled back)");
{
  const { rolledBack: steps } = await sql(file("e2e-flow.sql"));
  // Refusals the flow expects: an employee's sign-off before every follow-up is done.
  const expectedRefusal = new Set(["employee signs off"]);
  for (const s of steps) {
    const ms = s.ms !== undefined ? ` (${s.ms} ms)` : "";
    if (s.ok === true) ok(`${s.step}${ms}${s.said ? ` — refused: “${s.said}”` : ""}`);
    else if (s.ok === false && expectedRefusal.has(s.step)) ok(`${s.step} — refused as it should be: “${s.said}”`);
    else if (s.ok === false) fail(`${s.step}: ${s.error ?? s.said}`);
    else note(`${s.step} ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== "step")))}`);
  }
}

// 6 --------------------------------------------------------------------------
head(6, "operations");
{
  const cron = await sql(`select j.jobname, count(d.*) filter (where d.start_time > now() - interval '3 days') runs,
      count(d.*) filter (where d.status <> 'succeeded' and d.start_time > now() - interval '3 days') failed
    from cron.job j left join cron.job_run_details d on d.jobid = j.jobid group by j.jobname order by 1`);
  for (const j of cron) (Number(j.failed) ? fail : ok)(`cron ${j.jobname}: ${j.runs} runs in 3 days, ${j.failed} failed`);
  const boxes = await sql(`select mailbox, server_error, server_error_at, last_synced_at from public.mail_log_mailboxes order by 1`);
  for (const b of boxes)
    if (b.server_error) fail(`mail copy ${b.mailbox}: “${b.server_error}” (last copied ${b.last_synced_at ?? "never"})`);
  if (!boxes.some((b) => b.server_error)) ok(`mail copy: ${boxes.length} mailboxes, no errors`);
  const [bk] = await sql(`select taken_at, ok, round(extract(epoch from now() - taken_at) / 3600) hours from public.backup_runs order by taken_at desc limit 1`);
  (bk && bk.ok && Number(bk.hours) <= 26 ? ok : fail)(`last backup ${bk ? `${bk.hours} h ago, ${bk.ok ? "ok" : "FAILED"}` : "none"}`);
}

// 7 --------------------------------------------------------------------------
head(7, "Supabase advisors");
for (const kind of ["security", "performance"]) {
  const r = await fetch(`${api}/advisors/${kind}`, { headers: auth });
  if (!r.ok) {
    note(`${kind}: ${r.status}`);
    continue;
  }
  const j = await r.json();
  const by = {};
  for (const l of j.lints ?? []) by[`${l.level} ${l.name}`] = (by[`${l.level} ${l.name}`] ?? 0) + 1;
  // Accepted by design: the customer pages' three functions, and staff functions behind sign-in.
  const accepted = new Set(["WARN anon_security_definer_function_executable", "WARN authenticated_security_definer_function_executable"]);
  for (const [k, n] of Object.entries(by).sort()) (k.startsWith("ERROR") ? fail : note)(`${kind}: ${n}× ${k}${accepted.has(k) ? " (by design)" : ""}`);
}

// 8 --------------------------------------------------------------------------
head(8, "latency");
{
  const slow = await sql(`select round(s.mean_exec_time::numeric, 1) mean_ms, s.calls, left(regexp_replace(s.query, '\\s+', ' ', 'g'), 110) q
      from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid
     where r.rolname in ('authenticated', 'anon') and s.calls > 2 order by s.mean_exec_time desc limit 5`);
  for (const q of slow) (Number(q.mean_ms) > 500 ? fail : note)(`${q.mean_ms} ms avg × ${q.calls}: ${q.q}`);
  const env = Object.fromEntries(
    readFileSync(join(root, ".env.local"), "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/shipment_tracking`, {
      method: "POST",
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: "audit-not-a-token" }),
    });
    await r.text();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p50 = Math.round(times[5]);
  (p50 > 400 ? fail : ok)(`API round trip from here: p50 ${p50} ms, max ${Math.round(times[9])} ms`);
}

console.log(`\n${failures ? `${failures} finding(s)` : "all clear"}`);
process.exit(failures ? 1 : 0);
