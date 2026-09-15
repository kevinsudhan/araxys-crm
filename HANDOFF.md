# Handoff — Araxys CRM v2

The freight desk for **Aashish Logistics Global**. This file covers `araxys-crm-v2` only —
v1 (`../araxys-crm`) is a separate, older codebase and is not to be touched.

Written 14 September 2026. Read the **Do these first** section before anything else.

---

## 1. Do these first

### Rotate four credentials

These were pasted into a chat transcript during development and must be treated as
compromised:

| Credential | Where to rotate |
|---|---|
| Gemini API key `AQ.Ab8RN6Iq…` | aistudio.google.com → then update the `GEMINI_API_KEY` secret in Supabase |
| SnapServe `sk_live_705b5d…` | SnapServe account (v1 only — v2 does not use it) |
| Anthropic `sk-ant-api03-YN9atg…` | console.anthropic.com (not used by v2) |
| Azure client secret `JX38Q~…` | Entra ID → app registration → Certificates & secrets |

Only the first is live in v2. The others belong to v1 but were exposed in the same
transcript.

### Decide on the Gemini billing question

The `classify-enquiry` function runs on Gemini's **free tier against live customer mail**.
That was a deliberate, informed choice — it is written into the function's header comment —
but it means Google's unpaid terms apply: submitted content is used "to provide, improve,
and develop Google products", and human reviewers may see it. India is not covered by the
EEA/UK/Swiss carve-out.

What passes through is real: rate cards, quotations, and the names, addresses and phone
numbers of customers who have not been asked about it. Under the DPDP Act that makes
Aashish Logistics the data fiduciary for the transfer.

**Enabling billing on the Google Cloud project flips those terms with no code change** — no
key change, nothing to edit. At this volume it is a few hundred rupees a month, and it also
removes the free-tier 503s (roughly one request in four during testing, which is why the
function retries).

---

## 2. What it is

An operations CRM built around the mailbox. A customer emails; the desk reads it, files it
against a permanent reference, puts it on a container, asks partners for a rate, quotes the
customer, books it, and issues shipping documents.

**Stack.** React 18 + TypeScript + Vite + Tailwind. Supabase for Postgres, RLS, and Edge
Functions. Microsoft Graph for mail, called directly from the browser with a delegated
token. Gemini for three specific jobs (see §5).

**No backend of its own.** `server/` and `server-v2/` are v1 leftovers. v2 talks to Supabase
and Graph directly; `services/backend.ts` still defaults to an in-memory mock unless
`VITE_MOCK_BACKEND=off`.

### Routes

```
/login  /admin/login  /admin
/                     Overview
/mail                 Outlook, in the CRM
/intake               "Enquiries" — the queue before a reference is allocated
/enquiries            "Inbound enquiries" — the board
/enquiries/:ref       The case file
/my-enquiries         What one person has taken on
/containers           Containers the desk has booked
/space-containers     The 3D stowage planner (v1 feature, still works)
/shipments/in-process /shipments/completed /shipments/:id
/documentation  /partners  /complaints  /billing  /analytics
/oversight            Admin only, password-gated
```

---

## 3. The flow it supports

1. **Mail arrives** → `/mail`. **Read this** classifies it and extracts the fields.
2. **Send to enquiries** (queue it) or **My enquiries** (queue, promote and claim in one).
3. On the case file: **Ask partners** sends a rate request to each selected partner
   separately. **Check for replies** finds their answers and reads the rate out of them.
4. Quote the customer, mark accepted, **Promote to shipment**.
5. `/shipments/in-process` → **Fill in the missing details** → all 12 documents issue.

A seeded case exists for demonstrating this end to end:

```bash
node supabase-v2/seed-showcase.mjs you@example.com
```

Idempotent — every row upserts on a `DEMO-` id. The partner is created at whatever address
you pass, so the rate request can actually be answered and watched coming back.

---

## 4. Commands

```bash
npm run dev            # http://localhost:5174
npm run build          # tsc -b, vite build, then a bundle secret scan
npm test               # all seven suites

node supabase-v2/run-sql.mjs 029-clean-signatures.sql
node supabase-v2/deploy-function.mjs classify-enquiry --verify-jwt
```

**`--verify-jwt` is not optional** for anything the browser calls. Without it the function
URL is open to anyone who finds it, and `classify-enquiry` spends money per request.

There is no Supabase CLI on these machines. Migrations go through the Management API via
`run-sql.mjs`, which reads `SUPABASE_ACCESS_TOKEN` from
`../araxys-crm/snapserve-setup/.env`. Project ref: `izgbrdeybhbepftloxgk`.

---

## 5. Where the model is, and where it deliberately is not

One Edge Function, `classify-enquiry`, with four modes:

| Mode | Used by | Returns |
|---|---|---|
| `classify` | **Read this** on mail and queued rows | JSON via `responseSchema` |
| `draft` | **Draft a reply** in compose | Prose |
| `quote` | **Check for replies** | JSON — amount, currency, transit, validity |
| `rfq` | **Write it with AI** in the partner request | Prose |

**The partner rate request is a deterministic template by default.** `draftRequest()` in
`services/rfq.ts` copies every figure straight off the enquiry row and cannot get one wrong.
The AI version is opt-in, requires a written brief, and one press reverts to the template.
This was an explicit decision — do not quietly make AI the default.

Every prompt carries the same rule: **never state a figure that is not in the source**. It
is tested. Notable verified behaviours:

- A partner reply listing charges with no total returns `amount: null` with the components
  in the notes — it does **not** add them up.
- "Please confirm the gross weight" is **not** read as a decline.
- A figure the operator types into their own brief *is* allowed — that is their statement,
  not a fabrication.
- No fill-in placeholders (`[vessel name]`) — the prompt forbids them, because that text is
  sent as written.

### Deterministic on purpose

- **`lib/greeting.ts`** — the reply salutation. Never writes *Mr.* or *Ms.*: that means
  guessing gender from a name, and the desk writes to agents across a dozen countries.
- **`services/forwardChain.ts`** — who forwarded a mail and who originally sent it, read
  from Exchange headers (`X-MS-Exchange-Inbox-Rules-Loop`) and the body's forward block.
- **`services/webEnquiry.ts`** — website form submissions, parsed by regex.

---

## 6. Migrations

`001`–`015` are v1. v2's are:

| | |
|---|---|
| `016`–`018` | The intake queue; capturing mail and website forms into it |
| `019`–`020`, `024`–`025` | Assignment, claiming, assigning to others |
| `021` | Oversight password (bcrypt via pgcrypto, `app_locks`, no RLS policies at all) |
| `022` | `enquiries.received_at` — arrival, distinct from when somebody claimed it |
| `023` | Unscheduled the voice-agent cron jobs |
| `026` | Containers — extends `sailings`, adds `enquiries.sailing_id` |
| `027` | `partner_quotes` — the rate-request tracking |
| `028` | Consignee, packing and commercial columns on `shipments` |
| `029` | Repaired signatures the editor had corrupted |

### Two schema decisions worth knowing

**A container *is* a sailing.** `026` extends the existing `sailings` table rather than
adding a `containers` one — a second table for the same four facts would let the containers
page and the stowage planner disagree about what space exists. New ids are `sl-1`, `sl-2`;
the seeded ones are `sl-cmb-1` style and are deliberately excluded from the id generator's
`max`, which is safe precisely because they can never collide.

**Before `028`, only 3 of 12 documents could ever be issued.** Not for want of typing — the
`shipments` table had no consignee, packing or invoice columns at all, so a complete booking
still could not produce a final B/L. The columns exist now and `BookingDocumentDetails.tsx`
is the form.

---

## 7. Traps that cost real time

Read this section before debugging anything that smells similar.

**Heredocs mangle backslashes.** Writing TypeScript through a bash heredoc turns `\n` into a
literal newline, which broke a regex and two `.join("\n")` calls and produced errors far from
the cause. Use the Write/Edit tools for code containing escapes.

**supabase-js sends four headers, not one.** An Edge Function CORS preflight must allow
`authorization, x-client-info, apikey, content-type`. Allowing less makes the browser refuse
the request before it leaves, surfacing as *"Failed to send a request to the Edge Function"* —
which reads like the function is down when it was never reached. `classify-enquiry` now
reflects whatever the browser asks for.

**Graph threading needs `createReply`, not `sendMail`.** `/me/sendMail` starts a new
conversation and sets no `In-Reply-To` or `References`, so replies landed outside the thread
however right the "Re:" subject looked. `/createReply` returns a draft already carrying the
threading headers; PATCH its body and send. `/reply` would also thread but appends Graph's
own quoted copy, duplicating the one the compose box already built.

**`internetMessageHeaders` is not in Graph's default field set,** and `$select` *replaces*
the default rather than adding to it — so `getMessage` must name every field it needs,
including `body`.

**DOMPurify's `ALLOWED_URI_REGEXP` applies to every attribute value,** not just URIs. Setting
it stripped `border="1"` and `bgcolor="#FFFF00"` and took the colour out of rate cards. It is
deliberately not set; the default was measured and blocks what matters.

**Sanitising an attribute by name is not sanitising it.** The rich-text editor allowed
`style` and never read it, so a paste carried Tailwind's whole `--tw-*` block through and
*replaced* `max-width:220px` on a signature image — which is why Parasu's signature arrived
enormous. Now the declarations are whitelisted and every image gets a `max-width` regardless.

**`.card` must live in `@layer components`.** Written as bare CSS after `@tailwind
utilities`, it silently beats `bg-surface-2` or `border-dashed` on the same element.

**`surface-inset` is a CSS variable but not in the Tailwind config** — `bg-surface-inset`
renders nothing. Only `surface-0/1/2` exist as utilities.

---

## 8. Testing

```
test:space   Cargo fitting in 3D, incl. the tall crate volume maths gets wrong
test:web     Website form parsing without inventing a field
test:fwd     Forward chain; refusing to call an ordinary reply a forward   (22)
test:apply   Applying a reading fills blanks, never overwrites             (14)
test:greet   Salutations — titles, initials, particles, surname-first      (24)
test:scene   3D projection
test:fields  The field catalogue
```

Pure logic only; the UI is not tested. `applyPlan.ts` was split out of `intake.ts`
specifically so it could be tested — `intake.ts` builds the Supabase client at import time,
which needs Vite's `import.meta.env` and cannot load under plain Node.

### Testing database behaviour

Run SQL in a `do $$ … $$` block that ends with `raise exception 'RESULTS %', r::text` — the
work rolls back and the findings come out in the error message. Impersonate a role with:

```sql
perform set_config('request.jwt.claims',
  json_build_object('sub', uid::text, 'role','authenticated')::text, true);
set local role authenticated;
```

That is how RLS was verified for `partner_quotes`, `sailings` and `shipments`.

### What was never verified

**Nothing signed-in was checked in a browser.** Sign-in requires entering a password, which
the assistant that built this does not do. Every signed-in screen was verified through
temporary harness routes rendering the real components with fake data, plus live SQL against
the database. Specifically unconfirmed against a real mailbox:

- A reply actually nesting in an Outlook thread (headers are correct; not watched landing)
- The repaired signature rendering at the right size in a received message
- Microsoft YaHei applying in the recipient's client

Send yourself one reply on an existing thread and check all three at once.

---

## 9. Known gaps

Ordered by what actually bites.

### Billing — the largest hole

There is a Billing page and an invoice generator, but **no money model**. No invoices table,
no line items, no payments, no receivables. `shipments.agreed_inr` is one number.

For a consolidator the business *is* the gap between what the shipper pays and what the line
and agents charge, and none of that exists:

- **Sell side** — invoice line items (freight, THC, documentation, BL fee, DO, CFS), each
  with its own tax treatment
- **Buy side** — what the carrier and overseas agent bill you; without it there is no margin
  per shipment
- **Receivables** — payments, ageing, statements, "don't release the DO, they're 90 days over"
- **GST** — gapless per-series invoice numbering, HSN/SAC per line, place of supply,
  CGST/SGST vs IGST. Compliance, not a nicety.

### Consol-specific

- **No console as an object** — no manifest, no master-vs-house B/L. The registry issues one
  B/L; a consolidator issues an MBL and N HBLs on its own series.
- **Chargeable weight** (w/m) is computed nowhere. Every LCL quote turns on it. Small job.
- **No load factor or profitability per container.**

### Operational

- **Documents are not stored** — regenerated on demand, so there is no record of what was
  issued to whom and when. A B/L reprinted after a correction differs silently from the one
  the customer holds.
- **No attachments** anywhere — packing lists and MSDS arrive by mail and cannot be filed.
- **Milestones are a stage, not dated events**, so there is no tracking to show a customer.
- **No free-time / demurrage clock.**

### Smaller

- Every document prints `Document no: ARX-…` and enquiry refs are `ARX-C0001-E02`. `ARX` is
  the vendor's prefix on the customer's paperwork. Changing it means changing both together.
- The partner-quote panel is on the case file, not on board rows. Deliberate — six partner
  rows plus twelve document rows on forty board rows would bury the board.
- `scripts/shot-sink.mjs` exists only to refresh the README screenshots. Not part of the app.

**If picking one thing: build invoices with line items and a payments table.** It unlocks
receivables, ageing, margin and the GST work, and it is the thing a freight business
genuinely cannot run without. Everything else on this list is an improvement; billing is an
absence.

---

## 10. Standing constraints

- **Do not touch v1** (`../araxys-crm`). Shared Supabase project and SnapServe account.
- **Voice agents are out of v2.** The cron jobs were unscheduled in `023`; the pages and
  services are deleted. Priya and Arun's prompts in `snapserve-setup/` are the user's own
  work and must not be edited without explicit instruction.
- **No dummy data in v2** beyond what `seed-showcase.mjs` creates, and everything it creates
  is prefixed `DEMO-`.
- The build fails if a credential reaches the bundle — `scripts/check-bundle-secrets.mjs`
  runs as part of `build`, not as a step that can be skipped.

---

## 11. Uncommitted

Branch `v2`, last commit `686122d`. At the time of writing `git status` shows **153 changed
files** — the whole of this session's work is uncommitted, including the deletion of the
voice-agent surface. Nothing has been pushed. Committing it in coherent pieces (mail,
containers, RFQ, documents, greeting, UI) is still to do.
