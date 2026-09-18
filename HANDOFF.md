# araxys-crm (v1) — handoff

**Written 18 Sep 2026.** Everything below was checked against the running
services on that date, not recalled. Where I could not check something, it says
so rather than guessing.

This file covers **v1 only** — the original CRM in this directory, on branch
`main`. The rewrite lives in `../araxys-crm-v2` on branch `v2` and has its own
handoff. The two are more separate than the old notes claimed; see
[v1 and v2 are not the same system](#v1-and-v2-are-not-the-same-system).

`README.md` explains what v1 *is* and how to run it, and it is accurate — read
it first. This file is the other half: what state the thing is actually in right
now, and what will bite whoever picks it up.

---

## The short version

v1 is **dormant, not dead.** Last commit 28 Aug 2026. The code is complete and
the working tree is clean. But:

- **Its Supabase project is paused.** `wremiarcmppuncgfzrqb` ("logistics crm",
  ap-southeast-2) reports `INACTIVE`. The database does not answer — a
  Management-API query against it times out. Every Edge Function reads the
  database, so the whole backend is effectively down.
- **The voice agents are still live and still answering.** Priya (717) and Arun
  (758) both report `status: active` on the SnapServe account right now. The
  setup notes record +91 79658 54267 routing inbound to Priya.
- So a customer can still phone in and be answered by an agent whose CRM is
  switched off. Nothing that call produces will be recorded anywhere.

If v1 is meant to be retired, the agents should be deactivated. If it is meant
to keep running, the project needs unpausing. It should not stay as it is,
because the current state is the one combination that loses data silently.

---

## Read this before pointing it at real customers again

### The Edge Function API has no authentication

This is the thing to fix first if v1 ever comes back up.

`supabase/functions/api/index.ts` is deployed with `verify_jwt=false`, sets
`Access-Control-Allow-Origin: *`, and does every database read with the
**service_role key**, which bypasses RLS by design. I grepped the whole function
for an authorization check — for `Authorization`, `token`, `401`, `403` — and
there is none. The only `Authorization` header it constructs is its own, to
Postgres and to SnapServe.

The routes it exposes without a credential include:

```
GET    /records          every customer record — names, phone numbers, cargo
GET    /calls/logs       call history
GET    /calls/live       live-call feed, proxied with the SnapServe key
DELETE /records/:id      deletion
POST   /space/book       commits container space
```

All five deployed functions are the same:

```
api             ACTIVE  v25  verify_jwt=false
call-webhook    ACTIVE  v13  verify_jwt=false
extract-fields  ACTIVE  v17  verify_jwt=false
ingest          ACTIVE  v24  verify_jwt=false
save-customer   ACTIVE  v3   verify_jwt=false
```

The base URL is not secret and was never meant to be — it is in `netlify.toml`,
in the public GitHub repo, and in the shipped JavaScript bundle. So "nobody
knows the URL" is not a control.

The database itself is configured correctly and is not the problem.
`supabase/schema.sql:90` turns RLS on for `real_records` and `call_logs` with no
policies at all, so the anon key can read nothing directly. The comment there
says exactly why. That protection is real — and then the `api` function steps
around it with service_role and lets anyone in the front door.

Two honest caveats. First, `--no-verify-jwt` is deliberate for `call-webhook`
and `ingest`: SnapServe's servers POST to those and cannot carry a user JWT.
Those need a shared-secret header, not a JWT. `api` is the one that is a
browser-facing API and should simply require a session. Second, **I did not
confirm this with a live unauthenticated request** — the sandbox blocked the
outbound call under its exfiltration rule and I did not work around it. The
finding rests on the deployed `verify_jwt=false` flag and on the function source.
One curl with no `Authorization` header against `/records` will settle it:

```bash
curl -i https://wremiarcmppuncgfzrqb.supabase.co/functions/v1/api/records
```

(The project is paused, so unpause it first or you will just get an error from
the platform rather than an answer about auth.)

### The sign-in is a demo gate, and says so

`src/lib/auth.tsx` checks a hardcoded list of accounts in the browser. The
usernames and passwords are in the bundle in plain text. The file's own header
comment is blunt about this and is worth reading before anyone assumes the last
commit — "Put the CRM behind a sign-in" — secured anything:

> it is not authentication and must not be treated as any

It keeps the two roles apart and gives the app a sign-in flow to demo. That is
all it does. Combined with the open API above, assume every page and every
record in v1 is public.

The fix is the one the comment names: Supabase Auth, role in a profiles table,
RLS policies, and a JWT the `api` function actually verifies. v2 already does
this, so there is a worked example next door.

### Credentials

`snapserve-setup/.env` is gitignored and holds `SNAPSERVE_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `ARAXYS_CRON_SECRET` and
`ANTHROPIC_API_KEY`. It is the only copy. Do not commit it, and do not delete
the directory — that exact mistake destroyed the equivalent file in v2 and broke
five seed scripts that still cannot run.

Separately, four credentials went through a chat transcript earlier and are due
for rotation: the Gemini, SnapServe, Anthropic and Azure keys. The SnapServe one
is in this project's `.env`, so rotating it means updating that file **and** the
Supabase function secret:

```bash
npx supabase secrets set SNAPSERVE_API_KEY=<new> --project-ref wremiarcmppuncgfzrqb
```

`npm run build` runs `scripts/check-bundle-secrets.mjs` and fails if a
credential reaches the bundle. Leave that in place.

---

## v1 and v2 are not the same system

Earlier notes said the two share a Supabase project. **They do not.** Checked:

| | v1 | v2 |
| --- | --- | --- |
| Branch | `main` | `v2` |
| Supabase project | `wremiarcmppuncgfzrqb` — paused | `izgbrdeybhbepftloxgk` — healthy |
| Region | ap-southeast-2 | ap-south-1 |
| Auth | hardcoded demo accounts | Supabase Auth + RLS |
| Backend | 5 open Edge Functions | `classify-enquiry` (`verify_jwt=true`) |

Same GitHub remote, different branches. What they **do** share is the SnapServe
account — Priya and Arun are one pair of agents, and both projects' setup notes
refer to them.

Two loose threads that cross the boundary, both currently harmless:

- `../araxys-crm-v2/netlify.toml` still sets `VITE_API_BASE` to **v1's** API
  URL. v2's `src/services/backend.ts` defaults to an in-memory mock and only
  uses that base when `VITE_MOCK_BACKEND=off`, so today it is dead config
  pointing at a paused project. It should be removed from v2 before someone
  flips that flag.
- The header comment in v2's `backend.ts` still says the two share a Supabase
  project and a SnapServe account. Half right, and the wrong half is the
  reassuring one.

Neither is a v1 change. Noted here because this file is where the boundary gets
written down.

---

## What is real and what is mock

From the README's own accounting, still accurate:

**Real** — customers, calls, container space. These are backed by Postgres and
by the fit engine, and the space engine is genuinely good: `server/spaceEngine.ts`
works in three dimensions rather than comparing volumes, so it correctly refuses
a 2.6m crate for a 2.39m-high 20GP that volume math would accept. Covered by
`npm run test:space`.

**Mock** — documentation, complaints, billing, analytics, compliance. These are
`src/data/mockData.ts`. Anyone demoing v1 should know which pages are which.

Occupancy is derived from the consignments in each container
(`server/placements.ts`), never stored as a total, so the drawn load plan and the
quoted remaining space cannot drift apart. That decision is worth preserving in
anything that replaces this.

---

## Layout

```
src/                 React 18 + TS + Vite + Tailwind, route-split
  lib/auth.tsx       demo gate — read the header comment
  lib/scene3d.ts     isometric load-plan projection (npm run test:scene)
  data/mockData.ts   the mock half of the CRM
supabase/functions/  Deno, deployed — this is production
  api/               the whole backend as one function
  _shared/           space engine, extraction, ingest, records
  schema*.sql        5 tables: real_records, call_logs, caller_resets,
                     space_slots, space_placements
server/              the original Express backend; same logic, runs locally,
                     superseded by the functions but kept and still tested
snapserve-setup/     agent prompts, KB sources, and the scripts that applied them
scripts/             one-shot prompt-fix scripts, KB generation, deploy helpers
```

`server/` being retained is deliberate, not dead code: `npm run test:space` and
`npm run test:fields` run against it, and it is the readable copy of logic that
is otherwise split across Deno modules.

### Running it

```bash
npm install
npm run dev        # :5173, against the hosted functions
npm test           # space engine + scene3d + request fields
```

This will not do much until the Supabase project is unpaused. The frontend
degrades rather than erroring — space falls back to static values, the live-call
indicator goes quiet — which is good behaviour but also means a paused backend
looks a lot like a working one at a glance.

---

## Known gaps

The README's "Known gaps" section is honest and still correct — tool results not
reaching the model on the Gemini Live stack, SnapServe's own extraction never
firing, no public API for squads or WhatsApp, ASR run-together words. Read it
there rather than trusting a paraphrase here.

Two things to add from this pass:

- **No tools are registered on either agent.** I queried both live: the agent
  configs contain no tool hostnames at all. The last recorded snapshot
  (`snapserve-setup/agent-current-7.json`) points `check-space` and
  `lookup-shipment` at `full-glory-hash-sentence.trycloudflare.com` — an
  ephemeral Cloudflare quick-tunnel that has long since died. So whatever the
  README says about the space-check tool, right now the agents have no tools and
  answer from the knowledge base alone. Given the README also reports that tool
  results never reach the model on this stack, that may be the intended end
  state — but it should be a decision, not a dead hostname.
- **`pg_cron` ingestion is unverified.** The README says cron drives transcript
  ingestion, but there is no cron definition in any `schema*.sql` file, so it was
  configured directly in the database. With the project paused I could not read
  `cron.job` to confirm what is scheduled. Check this before assuming calls are
  being ingested.

---

## Do not

- **Do not touch v2 from here**, or assume a change in one lands in the other.
  Different projects, different databases, different branches.
- **Do not edit Priya's or Arun's system prompts** without Kevin saying so
  explicitly. They are his own work, tuned against real calls, and the scripts in
  `scripts/` that applied them are one-shot — rerunning one will overwrite a
  prompt with an older revision.
- **Do not delete `snapserve-setup/.env`** or the directory containing it.
- **Do not commit anything from `data/`** — it is the local fallback store and
  holds real customer names and phone numbers pulled off actual calls.

---

## If you are picking this up

In order:

1. **Decide whether v1 is retired or maintained.** Everything else follows from
   that, and the current half-state — live agents, dead backend — is the worst
   option.
2. If **retired**: deactivate agents 717 and 758 so nobody reaches a desk that
   records nothing, and delete the five Edge Functions. Leaving the project
   paused is fine; leaving the functions deployed is not, because unpausing for
   any reason brings the open API back with it.
3. If **maintained**: unpause the project, then fix the `api` function's
   authentication *before* anything else. Confirm the cron ingestion is still
   scheduled. Then re-point or remove the agents' dead tool URLs.
4. Either way, rotate the four exposed credentials and remove the stale
   `VITE_API_BASE` from v2's `netlify.toml`.
