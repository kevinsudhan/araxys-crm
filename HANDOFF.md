# Handoff — Araxys CRM v2

The freight desk for **Aashish Logistics Global**. This file covers `araxys-crm-v2` only.
v1 (`../araxys-crm`) is a separate, older codebase on a different Supabase project and a
different branch; it is not to be touched from here.

Written 14 September 2026, revised 21 and 24 September, **last revised 28 September 2026**
(customer milestones, 102; the audit and its fixes, 103; signatures and pictures, 104). A new
session should read this whole file before changing anything. §0 is the short version.

---

## 0. Start here (new session)

- **Live site:** https://logisticsdemosif.netlify.app. It is **in real use**, with real
  enquiries and shipments created by the desk. Treat the database as production.
- **Deploy:** `git push logistics-v3 v2:main`. Netlify builds `main` of
  `github.com/kevinsudhan/logistics-v3` on every push. There is no other deploy step.
- **Before every push:** `npm test` (58 suites) and `npm run build` (typecheck, bundle and
  secret scan) must both pass.
- **Run SQL against live data:** `node supabase-v2/run-sql.mjs "select …"`, or pass a
  migration filename (§6). The last migration is **115**, so the next one is `116-….sql`.
- **Where things stand:** the code is at the head in §11, everything is pushed and live, and
  §9 lists what is open.
- **How the user works:** they want short, direct replies and a push after each feature.
  Verify on the running system (preview screenshots, then grep the deployed chunks) before
  saying something is done. §7 covers how.

---

## 1. Do these first

### Rotate credentials

These were pasted into a chat transcript during development and must be treated as
compromised:

| Credential | Where to rotate |
|---|---|
| **Supabase personal access token** (in `server-v2/.keys.json`) | supabase.com/dashboard/account/tokens: revoke it, create a new one, put it back in `.keys.json` |
| Gemini API key `AQ.Ab8RN6Iq…` | aistudio.google.com, then update the `GEMINI_API_KEY` function secret |
| Azure client secret `JX38Q~…` | Entra ID → app registration → Certificates & secrets |
| Azure client secret made on 25 Sep for mail-sync (`MS_CLIENT_SECRET`) | Same place: add a new one, put it in `.keys.json` as `ms_client_secret`, run `node supabase-v2/set-mail-sync-secret.mjs`, then delete the old one in Azure |
| SnapServe `sk_live_705b5d…` | SnapServe account (v1 only; v2 does not use it) |
| Anthropic `sk-ant-api03-YN9atg…` | console.anthropic.com (not used by v2) |

The Supabase token is issued against the **account**, so it can reach v1 as well. That makes
it the most urgent of these. `TRACK_CRON_SECRET` is stored in three places: the function
secrets, Vault, and `.keys.json`. Rotate all three together with
`node supabase-v2/set-track-secret.mjs`.

### Decide on the Gemini billing question

`classify-enquiry` runs on Gemini's **free tier against live customer mail**. Under Google's
unpaid terms, submitted content may be used to improve their products and may be seen by
human reviewers. India is not covered by the EEA/UK/Swiss carve-out, and under the DPDP Act
Aashish Logistics is the data fiduciary for the transfer.

**Enabling billing on the Google Cloud project changes those terms with no code change.** It
costs a few hundred rupees a month at this volume, and it also removes the free-tier 503s.
Until then the function falls back to `GEMINI_FALLBACK_MODELS` and then its built-in list.

On 28 Sep 2026 the free tier stopped the mail autofill altogether: every Gemini model answered
503 "high demand" (Gemma timed out), and the old last resort, `gemini-2.5-flash`, now answers
404 "no longer available to new users". The function now tries each model once with a 20-second
timeout inside a 60-second budget, and answers 200 with `error` saying which it was (overloaded,
out of quota, refused); the case file shows that on the fill strip instead of swallowing it. The
fix that makes it dependable is billing.

---

## 2. What it is, and where the data lives

A React + TypeScript + Vite + Tailwind front end for a freight forwarder and consolidator:

- enquiry intake from mail, with quoting and approval;
- shipments, run as a tabbed job file;
- tracking with a customer page;
- documents and mail;
- job P&L;
- a full accounts ledger.

It installs to an iPhone home screen as an app (§12).

### Backend

v2 has its own Supabase project, `izgbrdeybhbepftloxgk`. v1's project is
`wremiarcmppuncgfzrqb`, and nothing here should ever point at it.

- The browser holds **only the anon key**, and every call runs through **RLS as the
  signed-in user**. The client is built in `src/lib/supabase.ts`.
- Anything that needs more privilege is either a `SECURITY DEFINER` RPC in a migration or an
  Edge Function.
- `scripts/check-bundle-secrets.mjs` fails the build if a service-role key reaches the bundle.
- `WORKSPACE-V2.md` still says "v2 has no backend". **That is stale.** It dates from 28
  August, when everything ran on the in-memory mock.
- `services/backend.ts` still routes a handful of legacy paths (the space and records
  surface) to `mockBackend.ts`. `netlify.toml` keeps `VITE_MOCK_BACKEND=on` and
  deliberately leaves `VITE_API_BASE` unset, so nothing can reach v1.

### Edge Functions (8)

| Function | What it does | Secrets |
|---|---|---|
| `classify-enquiry` | Gemini reads a mail and extracts enquiry fields; mode `hbl` reads a B/L PDF or scan into boxes (088, high media resolution) | `GEMINI_API_KEY`, `GEMINI_FALLBACK_MODELS` |
| `track-shipment` | Flight, vessel and container positions; hourly cron sweep (073). Files what it hears for the desk; **applies nothing** since 102 (a person records the milestone) | `AISSTREAM_API_KEY`, `AERODATABOX_KEY`, `AERODATABOX_VIA=direct`, `TRACK_CRON_SECRET` |
| `staff-accounts` | The admin console's Staff accounts: list, add (email confirmed, role in app_metadata), role, may-approve and may-assign flags, password, disable and enable. Admin callers only; refuses to disable or demote yourself or the last admin | none beyond the defaults |
| `db-backup` | The nightly backup into the `backups` bucket, 30 days kept, each run in `backup_runs`; for an admin, the run list with download links and "Back up now" | `BACKUP_SECRET` (`set-backup-secret.mjs`) |
| `outlook-token` | Keeps Outlook connected past Microsoft's hour (094). `link`: the browser hands over the Microsoft refresh token once after the Microsoft sign-in; it is redeemed and the rotated one kept, sealed, against that Supabase sign-in. `token`: a fresh access token from it. 409 `{reconnect}` when Microsoft has ended the connection | `OUTLOOK_TOKEN_KEY` (`set-outlook-key.mjs`), and the three `MS_*` below |
| `outlook-connect` | "Connect Outlook" on the Mail page (095), for a login of any kind. POST `start` (checks the caller itself) answers Microsoft's sign-in URL with the login's address filled in; Microsoft returns the browser to the GET, which connects the mailbox **only if it is the login's own** (`lib/outlookConnect.ts`, copied into the function) and goes back to the Mail page with `#outlook=connected / refused / failed`. **verify_jwt OFF** (Microsoft's redirect has no Supabase token): deploy without `--verify-jwt`. Its address must be a Web redirect URI on the Azure app | `OUTLOOK_REDIRECT_URI` (pinned), `OUTLOOK_TOKEN_KEY`, the three `MS_*`; optional `OUTLOOK_APP_ORIGINS` for another site to return to |
| `mail-sync` | Every CRM login's Sent Items into `mail_log`, app-only Graph; cron every 5 minutes (087), or an admin's button | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_SYNC_SECRET` |
| `live-rates` | The Sunday rate requests (101): `weekly` from pg_cron (Sun 22:30 IST, re-runs every 10 minutes to 23:20), and from the Live rates page `now`, `test` (to the caller only) and `check` (whether Microsoft lets the app send; sends nothing). App-only Graph `sendMail` from the request's mailbox, one mail per partner, 2 s apart | the three `MS_*`, and `MAIL_SYNC_SECRET` as the scheduler's secret (header `x-scheduler-secret`) |

Deploy a function with `node supabase-v2/deploy-function.mjs <slug>` (`--verify-jwt` for
`track-shipment`, `mail-sync` and `live-rates`: the cron sends the anon key and the shared secret).
`node supabase-v2/set-mail-sync-secret.mjs` sets mail-sync's tenant, client id and scheduler
secret (and `MS_CLIENT_SECRET` from `ms_client_secret` in `server-v2/.keys.json`, if present).

`kb-sync` and `ingest-calls` (the voice-agent era) were deleted on 26 Sep. They were deployed
with no sign-in check, and `kb-sync` republished the voice agents' knowledge pack through
SnapServe, so anyone who found the address could have run it. Their deployed code is saved
locally in `backups/functions/` (gitignored). **Their four secrets are still set, for the user
to remove** (the session was not allowed to delete secrets): `SNAPSERVE_API_KEY`,
`SNAPSERVE_BASE_URL`, `ANTHROPIC_API_KEY` and `EXTRACTION_DISABLED`, under Supabase → Edge
Functions → Secrets. Nothing in the repo reads them.

### Flags (`netlify.toml` → `src/lib/features.ts`)

| Flag | Default in code | Set on the live site |
|---|---|---|
| `VITE_ACCOUNTS_DESK` | off | `on` |
| `VITE_CASE_FILE` | mail only | `full` |

**Check `netlify.toml` before saying a feature is off in production.**

---

## 3. Routes — 57 page components

### Sidebar, in order

| Section | Pages |
|---|---|
| (top) | Overview |
| Pipeline | **Enquiries** `/intake` · Inbound enquiries `/enquiries` · My enquiries · Quote approvals `/approvals` · In-process shipments · Completed shipments |
| (separate item) | **Job closing** `/job-closing` |
| Operations | **Sailing schedule** `/sailing-schedule` · Consoles · Documentation · Rate master `/rates` · Mail · Complaints |
| Customers | Directory `/customers` |
| Agents & partners | Partner mail · Live rates `/partners/live-rates` · Directory `/partners` |
| Accounts (flag) | 14 pages under `/accounts/*` |
| Insights | Analytics |
| Admin (admins only) | Team oversight |

- **`/intake`** is an overview of how many enquiries are inbound, in process and completed,
  with the Excel register download and the mails still waiting to be sent to inbound.
- **`/sailing-schedule`** is the only sailings page. Each departure's containers are listed
  under it. `/containers` and `/space-containers` redirect here.

### Public pages (no sign-in)

- `/q/:token`: the customer accepts a quotation.
- `/t/:token`: the customer tracking page. Since 102 it shows only the booking's details and
  the milestones the desk recorded on the job's Tracking tab (§9, "Customer milestones").

### The shipment job file

`/shipments/:id` has these tabs: overview · mail · parties · cargo · bill · documents ·
pickup-delivery · warehouse · customs · tracking · sign-off · containers. With the accounts
flag on, it also has invoices and costs.

---

## 4. Data model — 107 migrations

`supabase-v2/001…115`, applied in order with `run-sql.mjs` (each file runs as one
transaction).

| Range | What it establishes |
|---|---|
| `001–029` | profiles and signatures, mail linking, partners, intake, web enquiry, assignment, oversight, containers, partner RFQ |
| `030–042` | **the money model**: invoices, lines, series, payments and allocations, bills, agent statements, quote lines, consoles, gapless numbering. `041` dropped the voice-agent tables |
| `043–049` | shipment numbering, ALG/PALG references, reply log, consol details, enquiry files |
| `050–058` | customers directory, rate master, **quote approval**, the acceptance link, quote grid |
| `059–066` | checkpoints, service details, cargo dimensions, edits reset approval, in-process shipment, **progress model** (dated steps with owners) |
| `067–071` | pickup/delivery, warehouse receipts, tracking links, sign-off, sailing schedules |
| `072–078` | live tracking plus cron, customer tracking page, HAWB, route map, customs clearance, pre-alert |
| `079` | pickup and delivery desk: multiple movements per job, with attempts, LR, e-way bill and proof |
| `080` | `quotes` added to the `supabase_realtime` publication |
| `081` | `enquiries`, `shipments`, `intake` and `shipment_checkpoints` added to it too |
| `082` | the console's master B/L copied to its jobs (`mainline_no`); console and numbering functions closed to `anon` |
| `083` | free time: the job's free days and D&D rates (`shipments`), six clock dates per box (`shipment_containers`) |
| `084` | every other table on an enquiry or a job added to the realtime publication (28 tables in all) |
| `085` | the house B/L as a document (`house_bills`, history, `number_hbl`, lock); partners get `mto_registration` and `address` |
| `086` | `mail_log` (every mail each mailbox sent: recipients, subject, preview, job, kind) and `mail_log_mailboxes` (when each was last checked); `record_sent_mail`, `mail_log_since`; both live |
| `087` | the server's copy of every mailbox: `mail_log_upsert` (the one writer), `record_sent_mail_server`, `mail_sync_error`, `mail_sync_targets` (service role only); `server_error` per mailbox; cron `araxys-v2-mail-sync` every 5 minutes |
| `088` | a house B/L somebody else issued, received on our job (`received_house_bills`: issuer, their number and reference, draft → confirmed → final, corrections, release mode, the boxes, their PDF, release ticks and our DO); their number copied to `shipments.forwarders_bl_no`; `shipment_customs` gets `igm_subline`, `csn_no`, `csn_filed_on`, `cfs_code` |
| `089` | releasing our own house B/L: `house_bills` gets charges received, originals handed over (to whom), originals back (how many), release sent (to whom), released at destination, a note; `house_bill_write` refuses a release before issue, a telex release before every original is back, and reopening while an original is out; history action `released`; timeline events |
| `090` | the console's cargo manifest sent: `consoles.manifest_sent_at`, `manifest_sent_to`, `manifest_bills`, `manifest_provisional` |
| `091` | self-approval of a quotation: `quotes.self_approved`, `self_approval_reason`, `self_approval_reviewed_at/by`, `self_approval_review_note`; `self_approve_quote(id, reason)` (reason ≥ 10 chars, not over a rejection) and `review_self_approval(id, withdraw, note)` (admins; withdraw only while unsent); `require_approval_to_send` lets the first through by a transaction-local flag `app.self_approving` |
| `092` | **the anonymous key reaches nothing but the customer's two pages.** Revoked from `anon` on every public table, view and sequence. Revoked from `public, anon` on every function except `quote_by_token`, `accept_quote_by_token`, `shipment_tracking`, `shipment_track_points` and `shipment_customs_public`; `authenticated` keeps what it had, granted by name. Default privileges changed so new objects are closed too |
| `115` | **A pasted air quotation as the desk's rate table.** `quote_lines.section` gains `freight` and `destination` (beside `ex_works`, `other`); `quote_lines.gst_rate` (per cent as quoted, 0 = none, null = not stated, 0–28); `quotes.routing / carrier / transit_time`. `copy_quote_lines_to_invoice` charges `coalesce(gst_rate, 18)`; `quote_lines_reset_approval` also un-approves on a change of `gst_rate` or `section`. Checked rolled back |
| `114` | **The customer's quotation page answers back.** `quote_links` gains `revision_requested_at / revision_note / revision_name` and `shipper` (jsonb) / `shipper_at`; `enquiries` gains `shipper_name / shipper_address / shipper_contact / shipper_email`, copied onto a new shipment by `shipment_from_enquiry`. Anonymous, token-keyed, security definer: `request_revision_by_token` (open or expired, not accepted/revoked/declined; a repeat within 10 minutes is not recorded twice; timeline `revision_requested`) and `shipper_by_token` (only after acceptance; fills the enquiry's and the shipment's shipper fields where blank, never over the desk's; timeline `shipper_given`). `quote_by_token` returns both. Checked rolled back as `anon` |
| `113` | **Rates find the enquiry's lane.** `rates_for` matched places by exact text, so a rate for "Chennai" never met an enquiry reading "Chennai (MAA)". `place_words` / `place_matches`: every word of one place is among the other's, either way round ("Dubai" matches "Jebel Ali / Dubai, UAE"; "MAA" matches "Chennai (MAA)"; "Chennai" does not match "Kochi"). Ranking unchanged. Checked rolled back |
| `112` | **What can go on a console.** `attach_to_console` took an air job onto a sea console, an import onto an export console, cancelled and signed-off jobs; a move between consoles was logged as a plain "Put on". Now sea only, directions must agree (cross-trade takes either), not cancelled or signed off, the same console again is a no-op, and a move says "Moved from X to Y" (the old console's master bill leaves with it). Checked rolled back |
| `111` | **Revert only an untouched booking.** `revert_shipment` deletes the shipment, and everything cascades with it (milestones, receipts, pickups, customs, issued house bills) while vendor `bills` went to no job (ON DELETE SET NULL). Now refused when signed off, cancelled, past booked, with a bill recorded, a house bill or HAWB issued, cargo received into the warehouse, or a pickup/delivery done — cancel instead. Checked rolled back |
| `110` | **Enquiry and intake fixes.** `create_customer` takes an advisory lock and counts only ids shaped `C0001` (a `DEMO-` id made the cast fail and every new customer with it); `create_enquiry` sets `received_at` (a manual enquiry had none; `promote_intake` still sets the intake's); `promote_intake` logs `mail_linked` only when the conversation was actually bound, and `mail_elsewhere` naming the enquiry it stays on when it was already filed. Checked rolled back: sequences and `reference_series` unchanged afterwards |
| `109` | **A quotation that cannot be right does not go.** `quote_problems(quote)` lists, in sentences: no charges; adds up to nothing; a charge with no name; a foreign charge (or the quotation itself) in a foreign currency at a rate of exchange of 1, 0 or none. `quote_ready_or_raise` refuses with that list from `submit_quote_for_approval`, `self_approve_quote` and `require_approval_to_send` (new rule 4: draft → sent/accepted, whoever sends). A charge at nothing is allowed when the whole adds up to something. Both helpers internal (no grant). Checked rolled back on the real drafts |
| `108` | **The customer's DSR.** `shipment_dsr_notes` (per shipment: the REASON and STATUS the desk writes for the report; its own table because a signed-off shipment is locked; stamped with who and when; staff read, insert, update, never delete) and `customer_dsr_sends` (every DSR mailed: to, cc, subject, the shipments on it; staff add as themselves, nothing rewritten). Both on realtime. Checked rolled back: forged sender, edit or delete of the log, delete of a note and anon all refused |
| `107` | **Rate requests per partner, for chosen services.** `partner_quotes.services` (what that partner was asked to price), `sent_from` (the sender's mailbox: the thread and reply are there), `source` ('case_file' / 'live_rates'). `record_rfq_sent` takes `p_services` and `p_source` (old calls still work) and, in the same transaction, binds the conversation to the enquiry (`enquiry_threads`), adds the partner to `enquiry_parties` under their directory role unless that address is already there, and logs `partner_asked` once per partner per batch. Staff only; anon refused. Checked rolled back |
| `106` | **A pasted quotation.** `quote_lines.section` ('ex_works' / 'other'; the PDF prints each group under its title with a subtotal), `quotes.mail_text` (set on a pasted quotation: it goes out as plain text) and `quotes.pasted_text` (the source). `require_approval_to_send` also un-approves on a change to `mail_text`. Checked rolled back: a bad section refused, the total still from the lines, approval reset |
| `105` | **Mail snooze.** `mail_snoozes`: one row per snoozed message (its id in the Snoozed folder, when it comes back, `returned_at`, `seen_at`), visible and changeable only by its owner (RLS checked as two employees, rolled back). Outlook's snooze is not in Graph, so `services/snooze.ts` moves the message to a Snoozed folder and the Mail page brings due ones back on open and on its minute refresh |
| `104` | **Your own profile: the signature, and nothing else.** 103's `(select auth.uid())` in `profiles_select_own`, together with 003's self-update policy that read `profiles` to pin the role, made every signature save fail with "infinite recursion detected in policy for relation profiles" (28 Sep, about a day). The self-update policy now only says "your own row"; the trigger `profiles_guard_self_update` refuses a browser (`current_user = 'authenticated'`) changing anything but `signature`. That also closes a hole older than 103: the pin covered `role` only, so an employee could set their own `can_approve_quotes` / `can_assign` through the API. Staff accounts (service role) and migrations are not held to it |
| `103` | **The audit's fixes.** `shipment_margin` and `console_margin` count **before GST**, as Job closing does (`invoice_net_inr`, `bill_net_inr`: lines in rupees, else the taxable value; credit notes negative). **Cancel and reopen a shipment:** `cancel_shipment(id, reason)` / `reopen_shipment(id, reason)`, with `shipments.cancelled_at/by`, `cancel_reason`; refused on a signed-off job; reopening goes back to where the milestones say; both on the timeline. `set_shipment_stage` dropped. Voice-era `capture_call_as_intake` and `forget_call` dropped, and `promote_intake`'s `public.calls` branch removed. Ten policies read `(select auth.uid())` once per query; every foreign key in `public` has an index (`…_fkx`) |
| `102` | **Customer milestones.** `milestone_templates` (per mode; customs per direction) and `shipment_milestones` (per job: day, time as told, where, a note for the customer, hidden, `added` for the desk's own updates). Staff read; written only by `save_shipment_milestone`, `add_shipment_update`, `delete_shipment_update`. A milestone that marks a stage ticks that workflow step (`milestone_to_step`), and **a stage step can be ticked no other way** (`guard_milestone_step`, flag `app.milestone_write`). The warehouse-receipt trigger is dropped; movements no longer tick stage steps; `apply_tracking_event` needs a person and records the milestone (`set_shipment_stage` went in 103). `shipment_tracking` rebuilt to the booking plus visible milestones; `shipment_track_points` and `shipment_customs_public` dropped, so the anonymous key reaches three functions. Seeded on every new booking (booked reached on creation) and backfilled from the ticked stage steps |
| `101` | Live rates: `live_rate_requests` (service, what to quote, mailbox, running), `live_rate_recipients` (partners), `live_rate_sends` (every mail, sent or refused; the function writes it, staff read it). A partner is claimed once per Sunday (unique index). Trigger: the mailbox must be a CRM login and only an admin changes it. Cron `araxys-v2-live-rates` `0,10,20,30,40,50 17 * * 0` (22:30–23:20 IST) with the scheduler's Vault secrets |
| `100` | ICEGATE's replies: `csn_files.reply_status` (accepted / rejected / failed), `reply` (as read), `replied_at/by`; `csn_file_reply(job, status, reply)` writes them (staff; the table stays read-only); `shipment_customs.cin_type/cin_no` for each house's CIN |
| `099` | CSN amendments: `csn_files.draft` keeps the form each file was made from; `csn_file_new` takes it as a fifth argument (the four-argument version is dropped) and accepts the event SCA |
| `098` | `icegate_settings.iec`: the desk's IEC for the export CSN, when it is not the PAN (the CSN uses the PAN when blank) |
| `097` | the CSN for ICEGATE: `icegate_settings` (one row: ICEGATE ID, desk PAN, authorised person's PAN, port of reporting; staff read, admins update), `consoles.csn_draft` (the form as saved), `csn_files` (every file made, job number from `csn_job_seq`, never reused) and `csn_file_new(console, event, indicator, houses)` which numbers and names the file `F_SACHM22_<event>_<ICEGATE ID>_<job>_<yyyymmdd>_DEC.json` on India's date |
| `096` | the last security-advisor findings: the 13 functions without a fixed `search_path` get `''` (each read first: built-ins and `public.`-qualified names only); the 14 reporting views get **`security_invoker = true`**, so they read as the person asking and the tables' RLS holds. Only `partner_reply_log` changed in effect: employees now see their own replies, as 045 and replyLog.ts intended (through the owner-rights view they saw everyone's). Verified by snapshotting every view as each of the 5 staff before and after: no other difference |
| `095` | Connect Outlook from inside the CRM: `private.outlook_pending` (a one-time note per connect: state hash, sign-in, PKCE verifier, page to return to; deleted with its sign-in, refused after 15 minutes, taken once); `outlook_pending_put / _take`, service role only |
| `094` | Outlook stays connected: `private.outlook_links` (one row per Supabase sign-in, keyed by `auth.sessions.id` **on delete cascade**, so a sign-out deletes it; the refresh token sealed by the function); `outlook_link_put / _get / _drop`, service role only; cron `araxys-v2-outlook-links-prune` (22:30 UTC) drops rows unused for 3 days (tabs closed without signing out). The `private` schema is outside the API and the backup |
| `093` | nightly backups: `backup_export()` / `backup_export_text()` (service role only) write every public table, the accounts without passwords and the file list; the private bucket `backups`; `backup_runs` (admins read); cron `araxys-v2-db-backup` at 21:30 UTC (03:00 IST) |

**Everything on an enquiry or a job is live (084).** Whoever has a page open sees another
person's change as it is made.

- **The job file and the case file** each open one channel for the job or enquiry and every
  table under it, filtered to that record (`useLiveVersions` in `src/lib/liveVersions.tsx`,
  with `SHIPMENT_TABLES` and `ENQUIRY_TABLES`). The page re-reads its own header for the
  tables that feed it. Each tab or panel re-reads for its own tables by putting
  `useLiveVersion("table", …)` in its load effect's dependencies.
- **A form with unsaved edits must not reload under the user.** `HawbForm` shows the pattern:
  it reloads only when clean, and otherwise offers "Load theirs".
- **List pages** (Overview, the boards, In-process, Completed, Job closing, Consoles) call
  `useTablesChanges([[table, filter], …], onChange)` from `src/lib/useTableChanges.ts`; the
  callback is told which tables moved.
- **Deletes:** Realtime cannot filter a delete, so a filtered watch also listens for deletes
  on the whole table.
- **To make a new table live:** add it to the publication in a migration (copy 084), then to
  the lists above or the page's watch list.
- **A loader must not write to a table it listens to,** or every open copy of the page
  refreshes itself in a loop. Every loader was checked for this on 25 September.

**Team oversight (`/oversight`, 086)** is the admin's live view of the desk, behind the
admin role and the oversight password.

- **Tabs:** Activity (one feed of mail sent, enquiry events and job steps ticked, grouped by
  day), Mail sent (per mailbox, with the recipients, kind, job and preview), People (counts
  per person, enquiries held, jobs in process, the companies they wrote to), and Enquiries
  (the older view: arrival, taken on, timeline).
- **Filters:** the period (today, yesterday, 7 days, 30 days, this month), the person and a
  search narrow every tab. The pure logic is `lib/oversight.ts` and `lib/mailLog.ts`.
- **Where the mail comes from:** each mailbox's Outlook **Sent Items**, which covers mail
  sent from Outlook itself too. Two copiers write to `mail_log`:
  - **The server (087).** The `mail-sync` edge function signs in as the CRM's Azure app
    (app-only, client credentials) and copies every CRM login's mailbox
    (`mail_sync_targets()` = every profile email) every 5 minutes by pg_cron. The first copy
    goes back 31 days. Its rows have `synced_by` null, so only admins read them.
    **Running since 25 September.** The first run copied 510 mails: parasu@ 438, info@ 69,
    aashish@ 3, aarathy@ and imports@ none in 31 days. When Microsoft refuses a mailbox, the
    refusal goes in `server_error` and the Mail sent tab shows it.
    The Graph permission granted returns an empty `bodyPreview`, so server rows have no
    preview.
  - **Each person's browser (086)**, via `services/mailLog.ts`: 4 s after the app opens,
    every 5 minutes, when the tab comes back into view, and 8 s after each send from the CRM.
    The first copy goes back 14 days. It is the only source of Outlook's preview line,
    because `Mail.ReadBasic.All` excludes it; the server's upsert never blanks a preview.
  - The Mail sent tab lists each mailbox with when it was last checked and by whom (a
    session or the server), in amber after a day, and any server error.
    **Copy sent mail now** runs both copiers.
- **Who owns a mail:** it belongs to the person whose login is that mailbox. A shared
  mailbox (info@) is credited to whoever's session copied it, and the mailbox is shown
  beside it.
- **Only the essentials are kept:** subject, recipients and Outlook's 255-character preview,
  not the body. RLS lets admins read all rows and anyone else only rows their own session
  recorded. Rows arrive only through `record_sent_mail`.

---

## 5. Services and libraries

`src/services/` holds 47 modules. The ones added since 21 September are:

- `attachments` · `autoFill` · `charges` · `checkpoints` · `customers` · `customs`
- `enquiryDimensions` · `enquiryRegister` · `geocode` · `hawb` · `jobPnl` · `liveTracking`
- `movements` · `paging` · `publicQuote` · `quoteApproval` · `rateMaster` · `replyLog`
- `schedules` · `shipmentExtras` · `signoff` · `threadRefs` · `tracking` · `warehouse`

Pure logic lives in `src/lib/` so that it can be tested under Node:

- **Mail:** `brandedMail` (the letterhead), `quotationMail`, `confirmationMail`,
  `preAlertMail`, `trackingLinkMail`, `shipmentUpdateMail`.
- **Reports:** `jobPnl`, `enquiryRegister`, `xlsx` (a hand-written xlsx writer with a
  `report` layout), `xlsxRead`.
- **Operations:** `movements`, `customs`, `hawb`, `progress`, `worklist`, `routeModel`,
  `seaRoute`.

`src/services/paging.ts` provides `all()` and `whereIn()` for reading more than PostgREST's
1000-row page.

---

## 6. Commands

```bash
npm run dev                          # :5174
npm run build                        # tsc -b && vite build && check-bundle-secrets
npm test                             # 58 suites, pure logic
npm run preview -- --port 4173       # the built app, service worker included
node supabase-v2/run-sql.mjs 081-something.sql      # apply a migration
node supabase-v2/run-sql.mjs "select count(*) from public.enquiries"   # quick query
node supabase-v2/deploy-function.mjs track-shipment
git push logistics-v3 v2:main        # deploy
```

The workspace root `.claude/launch.json` (one level up, outside this repo) has
`araxys-crm-v2-build` for serving the build in the preview pane.

---

## 7. Testing and verification

### Unit tests

There are 58 suites in `scripts/tests/*.test.ts`, run with tsx. Each is registered as its
own script and chained into `npm test`. When you add a suite, add it to both.

The UI has no automated tests. It is verified by hand in the way described below.

### The whole-system audit: `npm run audit` (28 Sep)

`scripts/audit/run.mjs` runs, against the live project, in about a minute:

1. **Schema drift** (`schema-drift.mjs`): every table, column, RPC and its parameter names,
   bucket, edge function and realtime table the code names, read from the TypeScript AST and
   checked against the live catalogue. Catches a renamed column or a dropped function before a
   screen does.
2. **Dead links** (`routes.mjs`): every in-app link against `App.tsx`'s routes.
3. **Function bodies** (`plpgsql-check.sql`): `plpgsql_check` over every PL/pgSQL function,
   installed for one transaction and rolled back.
4. **Integrity** (`integrity.sql`): sequences ahead of their data, stage / step / milestone
   agreement, pipeline states, people, files, RLS on every table, views with security_invoker.
5. **Business flow** (`e2e-flow.sql`): enquiry → quote → approval gate → customer accepts by
   link → booked → milestones → HBL → invoice → receipt → cost → delivered → sign-off, as an
   employee who needs approval, the admin and the anonymous customer; timed per step; **rolled
   back**, and the booking sequence put back only if nobody else drew from it.
6. **Operations**: cron failures, mailboxes the server copy cannot read, last backup.
7. **Supabase advisors**, and 8. **latency**: the slowest app queries and the API round trip.

It exits non-zero while anything is found. The UI is not in it (it needs a signed-in browser):
on 28 Sep every route was rendered in a local harness with a stubbed client (realistic
anonymised data, then empty data, admin and employee, 375 px), with no console errors, no blank
page and no horizontal overflow; see the findings in §9.

### How features were verified (keep doing this)

1. **Preview harness.**
   - Add a temporary `__Preview…` route in `App.tsx` that stubs `supabase.from` and
     `supabase.rpc` with fake rows and renders the real page.
   - Screenshot it with headless Edge:
     `"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --screenshot=out.png --window-size=1440,900 <url>`.
   - Edge will not go below about 500px wide. For phone views, render the page inside an
     iframe from a temporary page in `public/`.
   - **Delete the route and any temporary files before committing.**
2. **Live data, read-only.** Use `run-sql.mjs`. For a check that must not change anything,
   run it inside a `do $$ … $$` block ending with `raise exception 'RESULTS %', r::text`. The
   work rolls back and the findings come back in the error. To impersonate a user:
   ```sql
   perform set_config('request.jwt.claims',
     json_build_object('sub', uid::text, 'role','authenticated')::text, true);
   set local role authenticated;
   ```
3. **After the push.** Wait for Netlify, then `curl` the live `index.html`, find the chunk,
   and grep it for a string that only the new code contains. Grep each chunk on its own,
   because a short pattern can match another component.

**Customer milestones (102) were verified** by a dry run of the migration against live data,
rolled back: the guard, recording and clearing, the stage following, every refusal, movements,
a carrier event applied by a person, the customer RPC as `anon` and the privileges; then the
Tracking tab and the customer page in a preview harness, desktop and 375 px.

### Not verified yet

- **Signing in.** It needs a password, which the assistant does not type, so no signed-in
  screen has been checked in a real session.
- **Realtime between two users.** It was checked at the database level: an update delivered
  an UPDATE event with the enquiry filter (080), and a same-value update on `intake` reached
  an unfiltered and a row-filtered subscriber but not one filtered to another row (081). The
  pages were checked in a preview harness with a stubbed channel: each subscribes to the
  right tables and filters, and a burst of events causes one reload. For 084, a same-value
  update on `enquiry_events` reached the enquiry's own subscriber and not another's, and the
  job file and case file were each shown to hold one channel and to re-read only the tab or
  panel whose table moved. Two people watching a change land in real sessions has not been
  observed.
- **Microsoft sign-in inside the iPhone home-screen app.** Standalone mode can open the
  OAuth redirect in Safari.
- **In a real mailbox:** that a reply nests in its Outlook thread, and that the logo
  (inlined by cid) renders in a received quotation or confirmation.

---

## 8. Traps that cost real time

- **Both GitHub repositories are public.** Never commit customer data, keys or passwords.
  `backups/` and `server-v2/.keys.json` are gitignored for that reason. Check with
  `git check-ignore` before adding any new local data folder.

- **Supabase grants `anon` every new table, view and function by default.** 092 changed the
  default privileges. Still, check anything new with `has_function_privilege('anon', …)`.
  A view or `SECURITY DEFINER` function runs past RLS.
- **Sending without Outlook used to "succeed" into the demo mailbox.** `sendMail` and
  `sendTrackedMail` now throw on the live site. The demo mailbox is only for `vite dev`
  (`import.meta.env.DEV`).

- **Small laptops (1366×768, often at Windows' 125%, which leaves the browser about 1093×525).**
The shell and Mail were reworked for them on 28 Sep:
- The sidebar folds to a 64-px icon rail (`AppLayout`, `Sidebar` `rail`), by default below
  1440 px, with names as tooltips; the chevron at its foot toggles it, remembered in this
  browser (`araxys:nav-rail`). The phone drawer always shows names.
- `main`'s padding is smaller below `xl`; Mail's height sums it (`100dvh - 88px` below xl,
  `- 104px` from it). Change one and change the other.
- Tailwind has a `short` screen (`max-height: 820px`). `PageHeader dense` (Mail) keeps its
  heading for screen readers only there.
- Mail: folders sit in the toolbar row; the list is a third of the width (240–360 px);
  "Read at full width" hides the list while a message is open (`araxys:mail-wide`); the page's
  floor is 360 px, not 560, which is what made the whole page scroll and cut the message off.
- `MailBody`'s `FitToWidth` scales a wide mail down with CSS `zoom` to fit the pane (not below
  60%, then it scrolls sideways). `.mail-body table` no longer has `max-width: 100%`, which
  squeezed a rate card's columns until every cell wrapped.
- An element made `sr-only` is absolutely positioned: inside a scrolling list, give the list
  `relative`, or its hidden headings stretch the page (the rail did, until it had one).

**Theme colours are plain `var(--…)`**, so Tailwind's opacity modifier
  (`bg-bg-danger/40`, `border-text-accent/25`) generates nothing and the style silently
  vanishes. Use the full colour; three backgrounds were fixed on 25 Sep.
- **iPad Safari counts the toolbars in `100vh`.** A page exactly `min-h-screen` tall scrolls
  by a toolbar's height. Use `.screen-min` / `.screen-lock-lg` in `index.css` (100vh then
  100dvh in one rule). Tailwind emits `min-h-dvh` *before* `min-h-screen`, so writing both
  classes leaves the vh one winning.

- **The Browser pane downloads a PDF instead of showing it** (the user gets a save dialog),
  and headless Chrome renders PDFs blank. To check a PDF's layout, read its text positions
  with pypdf's `visitor_text`.

- **The Management API returns the Azure sign-in secret as a SHA-256 hash** (64 hex
  characters), not the secret. Copying it anywhere gives `AADSTS7000215`. A client secret
  for app-only use has to be created in Azure.
- **`supabase-v2/functions/mail-sync/mailLog.ts` is a copy of `src/lib/mailLog.ts`**, since
  the deploy uploads only the function's folder. `test:maillog` fails when they differ.
  After editing one, copy it over the other and redeploy the function.

**A workflow step that marks a stage is ticked only through its milestone (102).** The guard
on `shipment_checkpoints` refuses any other change to its `done_at`, so a new trigger or function
that ticks steps must skip `stage is not null` (as `movements_to_checkpoint` does), or it will
fail whatever wrote the row that fired it. Record the milestone instead, or offer it on the
Tracking tab (`suggestionFor` in `lib/milestones.ts`).

**A policy on a table must not read that table** — not directly, and not through a subquery
whose own policies contain a subquery. Postgres answers "infinite recursion detected in policy
for relation …" and refuses the statement outright. 103 did this to `profiles` and stopped every
signature save for a day (104). Pin columns with a trigger instead, and check a change to any
`profiles` policy with the audit's business flow, which saves a signature as an employee.

**A new function is callable by anyone until PUBLIC is revoked.** Postgres grants EXECUTE to
PUBLIC by default, so `grant … to authenticated` alone leaves the anonymous key in the bundle
able to call it. Every migration that creates a function needs
`revoke execute on function … from public, anon;` (075 and 070 do it; 035 did not, see 082).

**Never pass SQL as a PowerShell argument.** PowerShell 5.1 cuts a native argument at an
embedded double quote, so `node run-sql.mjs "$(Get-Content x.sql -Raw)"` sent half of 085 and
committed it (harmless, as it was additive and re-runnable, but not what was meant). Put the
migration in `supabase-v2/` and pass its file name, or send a file's text from Node.

**Heredocs mangle backslashes.** Writing code through a bash heredoc turns `\n` into a real
newline. Use the Edit/Write tools, or write a Python script to the scratchpad and run it.

**Prettier defaults to 80 columns; this repo is 160.** Use `--print-width 160` or leave
formatting alone.

**supabase-js sends four headers.** The CORS preflight for an Edge Function must allow
`authorization, x-client-info, apikey, content-type`. If it allows fewer, the error is
*"Failed to send a request to the Edge Function"*.

**Graph threading needs `createReply`, not `sendMail`.** Also, `internetMessageHeaders` is
not in Graph's default fields, and `$select` replaces the defaults rather than adding to them.

**Mail threads (28 Sep).** The Mail page lists a folder by conversation (one row, its newest
message there, with a count) and reads a whole conversation from every folder
(`MailConversation.tsx`, `graphMail.messagesInConversation`): the opened message expanded,
the others one line each that expand in place with their own Reply / Reply all / Forward.
Deleted, junk and draft messages are left out. Archive moves the conversation's messages in
that folder. The quotation, booking confirmation and tracking-link mails no longer start new
conversations: `services/customerThread.ts` `threadWith` finds the newest message with that
person in the job's correspondence (bound threads plus anything carrying the reference) and
`ComposeMail` answers it (`replyTo` with `initial`), under the thread's own subject plus the
reference, with the thread quoted under it. Gmail splits a thread whose subject changes, which
is why the letter's own subject is not used there. No such message in the signed-in mailbox
(a phoned-in job, or mail that came to a colleague) means a new conversation, and the compose
window says so.

**Mail fixes (29 Sep).** Switching folder clears the list at once (it used to show the old
folder's rows, drawn as the new one's). Search waits for a pause in typing and drops late
answers. Drafts show who they are to and open with "Edit and send", which sends the Outlook
draft itself (`graphMail.sendDraft`). The compose and signature windows ask before discarding
(Escape and a click outside used to close them silently). To/Cc/Bcc take Outlook's
"Name <address>" (`lib/addresses.ts`). Attachments can be downloaded from the Mail page. The
attach limit is checked on the encoded size, as the send checks it. On a phone, tapping a message
scrolls to it. Conversations and the case file leave out drafts.

**Mail search (29 Sep), Outlook's way.** Searches every folder by default ("All folders" /
the current folder), and a result is a message, not a conversation: its folder is tagged,
the words are marked yellow in the name, subject and a line of the body around the first
match (`lib/searchHighlight.ts`), and opening it marks them in the message and scrolls to
the first. Graph: `searchMessages` asks `$search` for plain-text bodies to cut the line from;
each word is quoted (`kqlFor`) so "ALG09012-26" is not read as ALG09012 NOT 26. Enter
searches at once, Escape clears, choosing a folder ends the search.

**Mail, the rest of Outlook's basics (29 Sep).** The list refreshes itself every minute and on
returning to the tab (not while searching or after "Load older mail"). All / Unread / Flagged
above the list (a server `$filter`, with the `receivedDateTime` clause Graph needs beside
`$orderby`). Delete moves to Deleted Items (`graphMail.deleteMessage`); flag, mark unread/read,
and "Open in Outlook" (`webLink`) are icons beside Archive. Keyboard: arrows or j/k, R, A, F, E,
Delete, U, N, / (the keyboard button lists them). Compose suggests recipients from customers,
partners, the desk and recent correspondents (`services/addressBook.ts`, `lib/addressRank.ts`),
and "Save draft" keeps it in Outlook's Drafts (`graphMail.saveDraft`; a reply is started with
createReply so it stays threaded).

**Mail, 29 Sep (later).**
- **Attachments open inside the app** (`AttachmentViewer.tsx`, loaded on first use): PDFs page by
  page with zoom (pdfjs-dist **4.10.38**, pinned: 5+ needs Node 22 — Netlify builds on 20 — and
  newer phones), pictures and text, with Download. Other files download. A new tab was a browser
  tab in the installed app and a blank Safari page on an iPhone.
- **Every folder**: Junk, Deleted Items and the person's own folders (top level and one level
  down) under "More". `FolderId` is the six well-known ones or `id:<graph id>`. Move to, and in
  Deleted Items / Junk, Restore / Not junk in place of Delete. Nothing deletes permanently.
- **Bulk actions**: tick boxes over the avatars (Shift for a run, X from the keyboard); the bar
  marks read/unread, flags, archives, moves, snoozes or deletes, six at a time (Graph throttles).
- **Snooze** (105): see the migration table. Later today, tomorrow, the weekend, next week, or a
  date and time. Mail back from snooze is pinned to the top of the Inbox until opened, because
  Graph keeps a moved message's received date.
- **Rules**: Outlook's own inbox rules (`graphMail.listRules` etc., `RulesDialog.tsx`) — from,
  subject, subject-or-body, attachment → move, mark read, mark important, delete, stop. They need
  the delegated permission **MailboxSettings.ReadWrite**, admin-consented on 29 Sep 2026 and now
  asked for by the sign-in (`auth.tsx`), `outlook-connect` and `outlook-token`. Rules calls are
  "soft" on 403 (`GraphForbiddenError`): a 403 elsewhere clears the Outlook token. `outlook-token`
  asks for the base scopes plus this one, and if Microsoft refuses it (consent withdrawn: it says
  so as invalid_grant, which otherwise ends the connection) asks again without it — so losing the
  consent costs the Rules window, never the mailbox.
- Phone sheets (compose, rules, file to enquiry, add container, ask partners, partner form, rate
  master) had no background below `sm`; the folder tabs now wrap so a phone is not 448 px wide.

**Email HTML must be table-based with inline styles.**

- The rich-text editor's sanitiser (`RichTextEditor.tsx`) allows email tables, `bgcolor`
  and a set of whitelisted style properties. If you narrow it, **a quotation collapses the
  moment someone edits it in the compose box.**
- Do not set DOMPurify's `ALLOWED_URI_REGEXP`. It applies to every attribute, not only URLs.
- Images keep a `max-width`.

**The logo in mail is carried inline by cid.** `lib/inlineBrand.ts` and `graphMail`'s
`outgoing()` swap `/brand/*.jpg` for an inline attachment when the mail is sent. The preview
shows the same-origin URL.

**Month names come from a list, never the locale.** `toLocaleDateString` prints "Sept" in both
`en-IN` and `en-GB`. Use `formatDate(value, { day, month, year, hour, minute, hour12, timeZone })`
from `src/lib/dates.ts`: it takes the same options and spells months itself. Every screen, mail
and PDF was moved onto it on 25 September; a grep for `month: "short"` next to `toLocale`
should find nothing. Rupee amounts use `en-IN` grouping. The financial year runs April to March,
so Q1 is April to June. Days are counted in IST.

**`.card` must live in `@layer components`,** or it overrides utility classes. `surface-inset`
is a CSS variable but not a Tailwind colour; only `surface-0/1/2` exist as utilities.

**A table added to the publication is not live straight away.** The first test after 080
missed the event; a retry a moment later received it.

**Do not click download buttons in the browser pane.** It opens a save dialog on the user's
screen.

---

**The quotation's charges (29 Sep).** `QuoteCharges` was a 74–86rem table in a sideways
scroller: on a laptop a thin strip that scrolled both ways, with the currency and unit menus
clipped inside it (a scroll container clips its absolutely placed children). It now measures its
width and lays the same cells out as one row per charge where it fits, the sell line over the buy
line where it does not, or a labelled card per charge on a phone — the panel grows, nothing
scrolls inside it. A charge just added is scrolled into view with its rate field focused; the
picker has a filter and "another charge". The code column is headed "Code": headed "Charge", it
had prices typed into it (ALG09011-26).

**Paste a quotation (106, 30 Sep).** Quotation → "Paste a quotation": the rate as the desk has
it is read by classify-enquiry's `paste_quote` mode (Gemini) into lines, each under Ex works or
Other charges; the model only copies figures and sorts, it never adds up. `lib/pastedQuote.ts`
holds the values to allowed units and currencies, works out every total and lays out the plain
text; the dialog (`PasteQuoteDialog`) shows the lines to correct, asks for any missing rate of
exchange, then saves them into the draft (its charges replaced) or a new version
(`services/pasteQuote.ts`). A quotation with `mail_text` goes as the usual quotation letter
(letterhead, reference, route box, terms) with its **charges as text instead of the table**:
headings, a bulleted line per charge, the group totals and the whole in rupees in bold
(`chargesText`, rebuilt from the charges at sending by `chargesTextFor`; the user asked for
this on 30 Sep — tables only in the PDF). The PDF groups by `section` and prints the rate of
exchange under the total when any line is foreign. The charges grid shows EXW / OTH on each
line, a press moving it. The sending panel now re-reads the
charges before mailing or downloading — it read them once, so a charge renamed in the grid went
out under its old name until a reload.

**Customer DSR (108, 30 Sep).** Customers → a customer → **DSR** (or the DSR button on the list,
for customers with live shipments). The daily status report in the desk's own 21 columns (from
the sample the user sent: S.NO … REASON, STATUS), one line per shipment in progress plus those
delivered in the last 7 days (`DELIVERED_KEPT_DAYS`); cancelled never. Everything but REASON and
STATUS is read from the job (`services/dsr.ts` → `lib/dsr.ts`): booking no (the carrier's, else
the job number), BL (house bill / HAWB, else the forwarder's, else the master), the far port
(POL on an import, POD on an export), booking received (the quotation accepted, else the job
opened), booking confirmed and pickup (milestones; a pickup only planned says so), packages,
weight, CBM, vessel/voyage or flight, cut-off, ETD, ETA. REASON and STATUS are typed on the page
and saved when the field is left (`shipment_dsr_notes`); a blank STATUS reads from the
milestones ("Booking confirmed on 24 Sep 2026 · next: cargo picked up"). **Download Excel** is
the desk's copy (with the agent); **Email to customer** opens the compose window from the
sender's Outlook, to the customer's addresses, with the company letter carrying one card per
shipment (phone-readable) and the customer's copy of the sheet attached — **no agent column**
(the desk used to hide it; a hidden column is one click from visible). Each send is recorded
(`customer_dsr_sends`) and the page shows the last. ComposeMail's `onSent` now reports the final
To, Cc and subject. Tests: `scripts/tests/dsr.test.ts` (lines, both copies, the workbook read
back, the mail).

**Quotation checks (109, 30 Sep — Enquiries sweep).** Found on the live data: a charge switched to
USD kept the rupee rate of exchange of 1, so USD 15 counted as Rs 15 (ALG09011-26, ALG09012-26);
a quotation at Rs 0 was sent and accepted (ALG09009-26); a nameless charge row sat on an approved
draft (ALG09008-26). Now: the grid shows a foreign line's rate empty and outlined in red
("Rate?") until it is given, and a line switched to a currency starts at the rate another line
on the quotation already uses for it (`lib/quoteChecks.ts` `rateInUse`; none in use, none
guessed). A draft's own currency and rate are editable under its total (`setQuoteCurrency`) —
before, they were fixed when the quotation was opened. The sending panel lists what is wrong
(`quoteProblems`, the same list the database uses) and Send for approval, Approve it myself and
Email the quotation are unavailable until it is right; an admin's send whose clearance is refused
no longer opens the mail anyway. The panel re-reads the charges on every grid edit
(`chargesVersion`), so renaming a charge clears its warning.

**Enquiries sweep, part 2 (110, 30 Sep).**
- *The reader missed lanes given only in the subject.* Both the automatic fill and "Read the
  mail again" passed the enquiry reference as the subject, and the thread text showed each
  subject as a bare `--- …` separator, so "IMPORT SEA FREIGHT RATE FROM VIETNAM TO CHENNAI"
  was read past and four enquiries were marked read with nothing filled. Now the first
  message's subject is passed (`threadSubject`) and each message is labelled From / Subject
  (`messageBlock`). In `classify-enquiry`: the Subject line is the sender's words, not an
  address header; a country given as the place is written as given; when the model still
  leaves the lane blank, "FROM X TO Y" is copied out of a subject line (`lane.ts`, tested by
  `scripts/tests/lane.test.ts`), and "AIR FREIGHT" there means air; `sea_fcl` / `sea_lcl` stand
  only with FCL / LCL evidence in the text (it used to guess FCL from "SEA").
  **To do by hand:** ALG09001, 09003, 09010 and 09011 are still marked read with no lane; press
  "Read the mail again" on each (the database reset of the mark was not made).
- *File to enquiry moved a thread silently.* A conversation already on another enquiry was
  moved by one click and that enquiry lost its mail (ALG09010-26's thread went to ALG09008-26
  on 28 Sep). Now the dialog says where it is filed, marks that row, and asks before moving;
  `bindThread` refuses a move not asked for (`move`), and both timelines record it
  (`mail_moved` / "moved here from"). **Left as found:** ALG09010-26's thread is still on
  ALG09008-26 — the desk decides whether it belongs there.
- *No way to close an enquiry.* Nothing set "lost". The case file's status pill (now in the
  board's colours) has **Close enquiry** with a reason (`lib/enquiryStatus.ts`) and **Reopen**
  (back to quoted if a quotation is out, else new); both are on the timeline. The board opens
  on **Open**, with Closed (lost + declined) and All beside the stages. `declineQuote` now
  stops if the quotation could not be marked.

**Shipments sweep (111, 30 Sep).** Every tab of both jobs and both boards were opened on an
anonymised copy with no errors. Fixed: *Revert* (send the booking back to the enquiry) was offered on
every job and deleted a job's receipts, milestones and issued house bills with it, leaving its vendor
bills attached to nothing — now only an untouched booking can be reverted, on screen and in the
database (111). *Dates that cannot all be true* are said on the job (`lib/shipmentDates.ts`): cargo
ready after the ETD or after the cut-off, a cut-off after the sailing, an ETA before the ETD
(ARX-SHP-0006 is ready 1 Oct on a 30 Sep sailing). An air job no longer shows a Containers tab.
Sign-off no longer says "Ready" before its checklist has been read (or if reading it failed).
The harness (`src/__audit.ts`, never committed) now sorts, joins, limits and upserts like
PostgREST: the old one made "next step" and customer names look wrong when they were not.

**Operations sweep (112, 113, 1 Oct).** The Operations tables are empty (no schedules, boxes,
consoles or rate cards yet), so the create flows were run against the live database in rolled-back
transactions: schedule → container → console → jobs on it, and the rate lookup with invented
rates. Fixed: a console took air jobs, jobs going the other way, and moves without saying so (112;
the air HAWB tab no longer offers a console, and the menu lists only consoles going the job's way);
the rate master never matched the reader's place names (113); a schedule's cut-off after its ETD
was accepted by the form and the Excel import (`scheduleDateProblem`, tested in
`schedules.test.ts`). The test used two `sailing_schedule_seq` numbers; the sequence was set back.

**Quotation page: revise, booking confirmed, shipper (114, 1 Oct).** The customer's page (`/q/:token`,
`pages/QuoteAccept.tsx`) has **Accept this quotation** and **Revise this quote** side by side; revising
takes what they want changed. Accepting reads **Booking confirmed**, and below it asks for the
shipper (company, address, contact, email), shown back once given with "Correct it". An expired
quotation offers "Ask for a new quotation". In the CRM the quotation panel shows the open revision
request until a newer version is sent (`openRevisionRequest`), and the acceptance panel shows the
shipper given. The mail's line under the button now says it can be accepted or revised. Both pages
stay reachable in maintenance mode (App.tsx).
**Also 1 Oct:** `replyTracked` (Mail) put attachments into the PATCH of the reply draft, which Graph
ignores — every reply (a quotation in the customer's thread included) went without its files and
its inline logo. Each file is now posted onto the draft, as forwards already were.

**Pasted charges in the desk's format (1 Oct).** A pasted quotation's charges, in the mail and in
the paste dialog's preview, follow the desk's own layout: each group's heading in red, underlined, on
a yellow highlight ("EX WORKS CHARGES :", "OTHER CHARGES :"); lines in capitals with the colons
aligned ("OCEAN FREIGHT … : USD 42 PER W/M × 8 = USD 336"); a trailing "(…)" note in red; each
group's total in bold, then "TOTAL : INR …" with the exchange rates. `chargesLayout` (lib/pastedQuote)
groups the lines and `chargesHtml` (lib/quotationMail) draws them; `chargesText` (the plain-text
part) is built from the same layout. The branded letter around the charges is unchanged.

**Pasted air quotation as the desk's rate table (115, 1 Oct).** On an air enquiry a pasted rate
(a table copied from Excel, a mail, a WhatsApp line) goes out as the desk's own sheet
(`lib/airQuote.ts` `airTable`, drawn by `airTableHtml` in lib/quotationMail): a first line
"EX HEL - IST - MAA // EXW // NO OF PKGS // GWT [// CHWT] // CARRIER // TT", then CHARGES |
CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE IN INR under FREIGHT / EX WORKS / DESTINATION /
OTHER CHARGES, a TOTAL row, and the ROE on the yellow mark. Every figure is the app's: rupees at
the ROE, GST at the charge's rate, a "3% on OF+EXW" charge worked out from the charges it names
(`withShares`; saved as an INR line whose wording rides on its name as "(3% on OF+EXW)"), and a
charge with no figure ("at receipted") spans the figure columns and counts for nothing. The reader
(classify-enquiry, paste_quote) now returns `gst_rate`, `percent / percent_of / rate_text`,
`routing / carrier / transit_time` and the four groups; where the paste has its own group headings
the app re-files each charge under the heading above it (`sectionsByHeading`) — the model put
"EXW charges" listed under FREIGHT CHARGES back under Ex works every time. GST defaults: 0 on the
freight itself and its surcharges, 18 on the rest; the desk changes it in the paste dialog or in the
charges grid (air only). Sea quotations keep the red-heading text layout, now with the same four
groups (freight first, as the desk writes it). Tests: `scripts/tests/airQuote.test.ts` on the desk's
HEL - IST - MAA sheet (totals 3,06,763.87 / 3,24,793.31).

**A table pasted as a table (1 Oct).** A table copied from Gmail (or Outlook, Word, a page) is on
the clipboard as HTML and as plain text; Gmail's plain text has one cell per line. The paste box
(`PasteQuoteDialog`) now takes the HTML (`lib/pastedTable.ts` `tableTextFromHtml`): a line per row,
cells tab-separated, text around the table kept, a layout table read through to the tables inside
it. The box then shows what was pasted as a grid ("Edit as text" / "Paste something else"). Should
the cell-per-line text arrive anyway, it still reads: `sectionsByHeading` no longer takes a line
that is a charge's own name ("EXW CHARGES" alone on a line) for a heading.

**Charges grid made plain (1 Oct).** `QuoteCharges` is one row per charge — Charge | Cur. | Rate |
Per | Qty | ROE (only while a charge is foreign, and only on that charge) | GST (pasted air
quotations) | Amount ₹ — under group headings with subtotals on a pasted quotation. The buy side,
code, minimum, group and vendor sit on a line under each charge behind **Costs & details**
(remembered per browser, `quoteCharges:costs`). A card per charge below the row's least width.
The paste dialog warns when the rate reads as air (freight by the kilo, "AF") on an enquiry not
marked air — the mail follows the enquiry's mode. The reader now takes a per-kg quantity from the
weight the rate itself states (GWT in the title line) before the enquiry's.

**Pasting is how a quotation is made (1 Oct).** The Quotation card opens with a large paste box at
its top (`components/PasteInput.tsx`, shared with the dialog: table paste, grid view), above any
quotation, in every state short of accepted: it starts one, replaces a draft's charges, or makes a
sent one's next version. "Lay it out" opens the review with the text already being read
(`PasteQuoteDialog initialText`). Building or revising charge by charge is the link beside it.

**Revise button in the quotation mail (1 Oct).** The mail carries two buttons side by side:
**Accept this quotation** and **Revise this quote** (outlined). Both open `/q/:token`; the second
adds `?revise=1`, and the page opens with the "What would you like revised?" box ready.

**A revision reads as one (1 Oct).** `lib/quoteRevision.ts`: version 1 is the quotation, version 2
"Revision 1". A revision's mail is titled REVISED QUOTATION with "ALG09014-26 Rev 1" as its
reference (three header facts, as a phone fits), its covering note says it replaces the earlier
quotation, and a new-conversation subject reads "Revised quotation … (Rev 1)" (a reply keeps the
thread's subject, which Gmail threads on). The PDF: REVISED QUOTATION, Quotation No "… Rev 1",
file "Revised-Quotation-ALG09014-26-Rev1.pdf". The customer's page shows the same. `mail_log.
has_attachments` is Outlook's flag and leaves out inline pictures (the logo), so true means a file
(the PDF) went.

**No totals on the quotation the customer sees (1 Oct).** The mail (built table, the desk's text
layout, the air table), the PDF and the quotation page show each charge and its own figure, and no
group or grand total; the rates of exchange stay. Totals stay inside the CRM (Billing, the paste
review). The customer's page asks for nothing but the two buttons; accepting shows "Thanks for
accepting — please provide the shipper details" and one box (`lib/shipperText.ts`: first line the
name, the rest the address, an email kept as the email; a single line splits at its first comma),
then "We have the shipper details". The faded copy of the quotation under it is gone.

**Accept from the mail asks for the shipper at once (1 Oct).** The mail's "Accept this quotation"
opens `/q/:token?accept=1`: "Thanks for accepting — please provide the shipper details", the
shipper box, and nothing else (no quotation under it). "Confirm and send the shipper details" records the
acceptance and then the shipper (opening the link records nothing: mail scanners open links).
"Accept now, send the shipper details later" and "Revise this quote instead" sit under the box.
Mails sent before this open the page without `?accept=1`, with Accept / Revise as before.

**Gmail folding the Accept button (1 Oct).** Gmail hides whatever a mail in a thread repeats word for
word from an earlier one behind "•••"; a quotation revised or sent again in the customer's thread
repeated its buttons, terms and footer, so Accept went behind the dots. Hidden per-send marks
(display:none) were tried and did nothing — Gmail compares what is visible — and were taken out.
Each send now says when it was sent, visibly: "Sent 1 Oct 2026, 3:05 pm. Accepting ALG… asks…"
under the buttons (same block) and "Quotation ALG… Rev 1 · sent …" as the footer's last line
(`quotationMail.sentLine`, `letter({ stamp })`). That alone did not stop it either. The cause was
the reply itself: ComposeMail put the message being answered — the earlier quotation — quoted under
the new one, and Gmail folded from the first part the two shared. A quotation now goes without the
quoted thread (`ComposeMail quoteThread={false}`, set by QuoteSend); it still threads by its reply
headers (Graph createReply), and ordinary replies still quote. Quotations stay in the customer's
thread (the user does not want revisions split into new conversations).
After that only the button block still folded: it was the one block repeated exactly (the send time
sat in a paragraph beside it). The caption is now a second row of the buttons' own table, and each
button label ends in the send's time as a run of zero-width characters (`sendSignature`) — invisible,
surviving `sanitise` and `forOutlook`, and different on every send.

**A table pasted goes out as a table (1 Oct).** `services/pasteQuote` `tableLayout(enquiry,
pasted_text)`: the desk's rate table (CHARGES | CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE
IN INR) for an air enquiry **or any rate pasted as a table** (a tab in the kept paste), whatever the
enquiry's mode; text pasted on a non-air enquiry keeps the red-heading text layout. GST is kept and
shown (paste review, charges grid via `QuoteCharges withGst`) wherever the table goes. The weight a
rate states ("GWT:578 KGS", chargeable over gross — `statedWeight`) now sets a per-kg charge's
quantity when the AI put the enquiry's weight or 1 (`withStatedWeight`), and the table's first
line's GWT.

## 9. Open items

### Waiting on the user

- Rotating credentials and the Gemini billing decision (§1).
- **Hapag-Lloyd tracking API:** deferred by the user (`HLAG_CLIENT_ID`/`HLAG_CLIENT_SECRET`).
- **AeroDataBox rejects the key as "Invalid or inactive".** Direct plans have no free tier.
  The free Basic plan is only on RapidAPI (`AERODATABOX_VIA=rapidapi`) or API.market
  (`apimarket`), each with its own key. **The assistant must not sign up for accounts.**
- **aisstream works but hears almost nothing.** It has no shore receivers near India or the
  Gulf.
- **The server's mail copy (087)** runs on the Azure app
  `efb90aa6-9404-40d2-be1b-3b6a3d5f5866` with application permission `Mail.ReadBasic.All`
  (admin-consented) and the client secret made on 25 September.
  - The secret expires on whatever date was chosen in Azure. When it does, every mailbox
    shows "Microsoft rejected the CRM app's client secret". Renew it as in §1.
  - Optional: an Exchange `ApplicationAccessPolicy` can limit the app to the desk's
    mailboxes. That is the user's call.
- **Live rates need Microsoft's permission to send (101).** The Azure app above has only
  `Mail.ReadBasic.All`. Add **Mail.Send (application)** and grant admin consent: Azure portal →
  App registrations → the app → API permissions → Add a permission → Microsoft Graph →
  Application permissions → Mail.Send → Grant admin consent. Checked 26 Sep: `canSend` false.
  Until it is granted every Sunday send is refused and logged, and the page says so.
  - Mail.Send (application) can send as any mailbox in the tenant. The CRM only ever sends from
    a CRM login's mailbox (the table's trigger), and only an admin changes which. The
    `ApplicationAccessPolicy` above would narrow Microsoft's side too.
- **Microsoft licences (answered 28 Sep):** Exchange Online Plan 1 per mailbox is enough;
  no separate Entra licence is needed. Entra ID Free comes with the tenant and covers the app
  registration, its secret, delegated sign-in (Connect Outlook), application permissions and
  admin consent. Every mailbox that signs in to the CRM needs its own Plan 1; Live rates only
  sends from a CRM login's mailbox, so that one is licensed anyway. Entra ID P1 is only for
  extras like Conditional Access, which the CRM does not use.
- The voice-era secrets above: remove them in the dashboard.
- (Done 26 Sep: `server/`, the first version's Express backend with the voice-agent import
  code, was removed with `scripts/seed-space.ts` and the packages only it used: express, cors,
  dotenv, cloudflared. The live app never called it. It is in git history.)
- (Done 26 Sep: the test quotation on ALG09004-26, ₹3 against ₹24.6 lakh, was deleted after a
  backup, with its 2 lines and customer link. The rest of that test chain is still there: the
  "TEST EMAIL" enquiry ALG09004-26, its booked shipment ARX-SHP-0004, and the customer
  "kevin imports" (C0004), which is the user's own test address.)
- The old v1 project (`wremiarcmppuncgfzrqb`), which the live voice agents still share: keep it,
  or retire it together with the agents. That is the user's call. Do not touch it until then.
- (Done 26 Sep: the unused 3D planner, `ContainerPlanView`, `ContainerScene`, `lib/scene3d`,
  was removed. It is in git history if it is ever wanted again.)

### Audit findings (28 Sep, `npm run audit` and the UI harness)

Fixed in 103 the same day: the margin counting GST, the missing cancel, the voice-era functions
and `countCalls()`, the per-row `auth.uid()` policies, the unindexed foreign keys, and the rate
card's one-request-per-line insert. What is left:

- **Three mailboxes stopped copying at 07:45 IST on 28 Sep:** aarathy@, imports@ and parasu@
  answer "No Exchange Online mailbox at this address" to the server's copy (087) every five
  minutes. Most likely their Microsoft 365 licences (Exchange Online) changed that morning. Until
  it is put back, Team oversight misses their mail, and sending from the CRM as them will fail.
  The user's action in the Microsoft 365 admin centre.
- Smaller, not done: `btree_gist` and `pg_net` live in `public`; no Content-Security-Policy
  header on the site; `classify-enquiry` and `track-shipment` take 1–2 s to cold-start; five
  tables have two permissive SELECT policies.
- ALG09004-26 is `accepted` with no accepted quote: the test chain whose ₹3 quote was deleted.

### Live data worth knowing (28 September)

- Totals: 10 enquiries, 2 shipments (both at stage `booked`), 3 quotes, 0 invoices, 0 bills.
- The ₹3 test quote on ALG09004-26 was deleted on 26 Sep (see above); the rest of that test
  chain is still there.
- Older intake mails are still waiting on the Enquiries page. Clearing them is the desk's
  job, not a code change.

### Product gaps

- **Customer milestones (102, user's instruction 28 Sep: "the tracking page the customer
  receives should not be automatic; all milestones updated by an employee within the
  shipment").**
  - The job's **Tracking tab** opens with *Customer milestones* (`components/CustomerMilestones.tsx`,
    logic in `lib/milestones.ts`): Record / Edit each with the day, the time if known (the
    place's local time, as told), where, and a note for the customer; "Not reached after all";
    "Not part of this job" (hidden, e.g. delivery on an FOB export); "Add an update" for the
    desk's own line ("Transhipped at Colombo"), whose wording can be corrected and which can be
    deleted.
  - **What the job already knows is offered, never applied:** "Use this" beside a milestone
    fills the form from the delivery or pickup on Pickup & delivery, the first warehouse receipt,
    the LEO / out-of-charge date, or a carrier's, airline's or mail's report.
  - **The customer's page** (`pages/TrackShipment.tsx`): what was recorded, oldest first, then
    what is still to come; a milestone overtaken without a record is left out; "Expected" only
    against the booking's own ETD / ETA; the planned route on the map (no positions); the
    booking's details; no ARX id. The tracking-link mail's status is the last milestone.
  - **The stage follows the milestones.** "Mark sailed…" in the job header, a flagged step on the
    workflow bar and the case file's "Completed" all open the milestone on the Tracking tab;
    "In process" from completed clears the Delivered milestone.
  - The live-tracking panel is labelled for the desk; its "Record …" button records the
    milestone (a person's click). The hourly sweep only files what it hears.
  - Existing jobs were backfilled from their ticked stage steps (both live jobs: booking
    confirmed only).
- **Cancelling a shipment (103).** Shipment details → *Called off?* → Cancel the shipment, with
  a reason (`components/CancelShipment.tsx`). The job and its records stay; it leaves the
  in-process board, its customer page says cancelled, and milestones are refused. Issued
  invoices are not touched: the form counts them and says to raise credit notes. A red banner on
  the job file says when, by whom and why, with **Reopen** (a reason again), which puts it back at
  the stage its milestones say. The case file's state switch shows "Cancelled" and links to the
  job. "Send back to the enquiry" is still the way to undo a booking made too early.
- The customer is not mailed when a milestone is recorded; they see it when they open the
  link. A "tell the customer" mail per milestone would be the next step if the desk wants it.

- **Free time (083)** is counted in `lib/freeTime.ts` from dates the desk types per box. Nothing fills those dates yet: tracking's `discharged`/`gate_out` events (072) and the pickup/delivery moves (079) could suggest them. The tariff is one rate per day; slab tariffs and holiday rules are not modelled. LCL (CFS storage) is not counted.
- **Sea bills (082).** The master B/L is entered once on the console and the database copies it
  to every job on it (`shipments.mainline_no`). A job not on a console has its master typed on
  the Bill tab. The pre-alert, tracking, the worklist search and the arrival notice, delivery
  order and B/L particulars read it. The house B/L is numbered `HBL/26-27/0001`, the FY series.
  **The user chose to keep that format on 25 September** over a port-based one like the HAWB's
  (`MAA/JEA/HBL0000001`); do not change it.
- **House B/L document (085)** — the sea twin of the HAWB (075).
  - The Bill tab of a sea job that issues our own HBL shows `HblForm`, with Fetch details,
    Save (numbers it on the first save that names a consignee), Print, History, release mode,
    originals and Issued, which locks it; only an admin can reopen it.
  - Release modes are original B/Ls (1–3), telex release, and express release. Express is a
    non-negotiable sea waybill with 0 originals, named consignee only; the database enforces it.
  - The PDF is `lib/documents/hblPdf.ts`: a draft, the originals ("ORIGINAL 1 OF 3"), or a
    copy.
  - **It is issued under a partner's MTO registration** (user, 25 Sep): the partner record has
    `mto_registration` and `address`, the form picks the partner, and the name and number are
    copied onto the B/L. When Aashish gets its own MTO number, add it as a partner-like source
    or a company setting.
  - **Decided with the user (25 Sep):** they will file CSN themselves as the console agent for
    Indian imports; they use all three release modes; they will send their own HBL design
    later, and until then it is the standard layout.
  - **Added on 25 Sep, from the user's sample B/L (World Jaguar's QDWJ26093202):**
    - Consignee and notify IEC and GSTIN, and the consignee's contact, printed under the
      address.
    - "Said to contain" as its own tick.
    - A freight table (charge, revenue tons, rate, prepaid, collect; OCEAN FREIGHT / AS
      ARRANGED by default, following the freight terms).
    - Cargo insurance: not covered, or covered by the attached policy.
    - Our form and the received one share the boxes, in `components/HblBoxes.tsx`.
  - **Release (089).** Once our B/L is issued, `components/HblRelease.tsx` shows the steps
    for its mode (logic in `lib/hblRelease.ts`):
    - original: charges received → originals handed over, to whom → released at destination.
    - telex: charges → (originals out, optional) → the full set back, counted → telex release
      sent → released.
    - express: charges → release instructions sent → released.

    "Write the telex release" opens the mail composer, addressed to the destination agent (the
    Party tab's destination agent, else the console's agent, else the routed agent), with the
    release text. Sending it ticks the step.

    Unpaid invoices on the job show beside "charges received". Handing over originals or
    releasing without the charges ticked asks first. "Released" waits for the step that lets
    the agent release.

    The database refuses:
    - a release on a draft;
    - a telex release before all originals are back;
    - reopening, even by an admin, while an original is out.
- **Self-approval of quotations (091, user's request 25 Sep).**
  - Anyone who needs approval can press **Approve it myself** on the quote instead of
    "Send for approval". It needs a reason of a sentence or more, which is stored on the quote
    and on the timeline (`quote_self_approved`).
  - Admins see self-approvals on **Quote approvals** under "Self-approved — for your review",
    with the reason and the sale/buy/profit. They can mark it "Seen — fine", or "Withdraw the
    approval" (with a note, only while the quote is unsent), which makes it rejected.
  - The sidebar's Quote approvals item shows a live count: the queue for approvers, plus the
    unreviewed self-approvals for admins.
  - A quote an approver sent back cannot be self-approved. An edit after approval resets it
    to draft (064), so it needs a new reason.
  - The rule in `require_approval_to_send` still refuses a direct `approval_status` change by
    a non-approver. Only `self_approve_quote` passes, by setting `app.self_approving` for its
    own transaction; a PostgREST request cannot set it.
- **Outlook stays connected (094).** Until 25 Sep the Microsoft access token from the sign-in
  died after about an hour and every send failed until the person signed in with Microsoft
  again. Now:
  - After the Microsoft sign-in, `adoptMicrosoftSession` (graphMail.ts) sends the refresh
    token to `outlook-token` once; the fresh access token it returns (and its expiry) goes into
    sessionStorage as before.
  - Every Graph call goes through `graphFetch`: under two minutes left, it renews first; on a
    401 it renews once and retries (a 401 means nothing was done, so a resend is safe). One
    renewal at a time, however many calls are waiting.
  - Only when Microsoft itself refuses (password changed, access revoked, 90 days unused) does
    the mailbox say "Connect Outlook again". A hiccup renewing keeps the connection.
  - The connection is per sign-in, as before: signing out deletes the Supabase session, which
    deletes the kept token (foreign key). Disabling a person on Staff accounts drops all theirs.
  - Redeeming needs `MS_CLIENT_SECRET`. If that secret expires in Azure, renewals fail with
    "The CRM's Microsoft client secret is wrong or has expired" and mail-sync stops too: make a
    new one and run `set-mail-sync-secret.mjs`.
  - Password sign-ins connect with "Connect Outlook" on the Mail page (095, below), and from
    then on stay connected the same way.
- **Connect Outlook only to the login's own mailbox (095).** Until 25 Sep "Connect Outlook"
  was the Microsoft sign-in itself, which replaced the CRM session with whichever account
  signed in: info@ connecting as aashish@ became aashish@, an admin.
  - Now it is a separate Microsoft sign-in run by `outlook-connect`. The CRM session is never
    touched. Microsoft opens on the login's address (`login_hint`), and on the way back the
    function asks Graph whose mailbox it is: the login's own (primary address or sign-in name,
    not an alias) is connected; anything else is refused and named.
  - The result comes back in the URL fragment and is shown once on the Mail page. A fragment the
    tab did not start (a link somebody sends) is ignored.
  - **The Azure app needs the Web redirect URI**
    `https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/outlook-connect`. Without it Microsoft
    stops after the sign-in with AADSTS50011. Microsoft only checks it after a sign-in, so it
    cannot be probed from outside.
  - "Sign in with Microsoft" on the sign-in page is unchanged: the CRM account there *is* the
    Microsoft account (linked by email), so its mailbox always matches.
- **The mail editor: Outlook's formatting, what-you-see-is-what-they-get (26 Sep).**
  `components/RichTextEditor.tsx` (+ `editor/EditorMenus.tsx`), used by compose, the signature
  and Ask partners.
  - **Toolbar:** undo/redo, font, size (pt), B/I/U/S, sub/superscript, highlight, font colour
    (+ any colour), bullets, numbering, indent, alignment, link (Ctrl+K), pictures, a table grid
    (with row/column actions while in a cell), a rule, clear formatting.
  - **Shortcuts:** Ctrl+] / Ctrl+[ size, Ctrl+Shift+L bullets, Ctrl+Space clear, Tab in lists
    and tables.
  - **Still the browser's own contentEditable, on purpose:** designed mails (the quotation) are
    table layouts that a schema editor would rebuild and break.
  - **The page is the mail.** It is white and set in `lib/mailStyle.ts`'s font, size and colour,
    which are the values `asOutgoingHtml` wraps the send in. `index.css` puts back the mail-client
    defaults that Tailwind's preflight strips inside `.rich-editor` (bullets, p/heading spacing,
    inline images); without them the editor showed a different mail.
  - **Paste and quotes keep their look.** `lib/mailHtml.ts` `inlineForeign` folds a pasted or
    quoted `<style>` (Word's MsoNormal, Excel's .xl65 borders) into the elements before cleaning.
  - **Trap: Chrome's insertHTML rewrites `border:` shorthands and drops the line style,** so the
    cleaner writes every border as four per-side shorthands, which it keeps (`sideBorders`).
    Inserted tables draw right/bottom lines per cell (plus top/left on the edges) because
    insertHTML also strips `border-collapse`.
  - **Pictures** (inserted, pasted or dropped) are reshaped in the browser first (104,
    `lib/mailImage.ts`): scaled to twice the width they are shown at (440 px in a signature,
    1280 px in a mail) and sent as PNG, JPEG or GIF, never WebP or SVG, which Outlook does not
    show; a PNG still over the bucket's 2 MB goes as JPEG. A phone photo of 12 MB becomes about
    20 KB. What the browser cannot read (HEIC outside Safari) is refused with "save it as a JPG or
    PNG". Before this, anything over 2 MB failed with the bucket's own "the object exceeded the
    maximum allowed size".
  - Then they are uploaded to the public `signatures` bucket.
    At send, `outgoing()` carries every picture of ours (logo and bucket) as an inline `cid:`
    attachment while it fits the 3MB, and gives any picture without one a `width`: Outlook
    ignores max-width.
  - **For Outlook, `forOutlook`** writes the inherited font, size and colour onto every table cell
    (Word does not inherit into tables) and gives links Outlook's blue.
  - **Reply, Reply all, Forward** (`lib/mailQuote.ts`) quote under Outlook's
    From/Sent/To/Cc/Subject header. Forward goes through Graph `createForward` (`forwardTracked`),
    so the original's attachments and inline pictures travel. Bcc is on every send path, and the
    compose window can be made bigger.
- **The CSN for ICEGATE, import consoles (097, 26 Sep).** An import console now has a "CSN for
  ICEGATE" panel under its cargo manifest (`components/ConsoleCsn.tsx`). It makes the Cargo Summary
  Notification the desk files as consol agent 72 hours before arrival: the carrier's master B/L as a
  consolidated line (`C`, previous declaration `N`) with every house B/L under it (`H`, `N`),
  reporting event SCE, message SACHM22, version SCE1102, filed as submitter type `ANC` on the desk's
  PAN.
  - **The specification is CBIC's own**, in `docs/icegate-csn/` (the MIG for "Notified Sea Carriers
    other than ASC/ASA", v1.6, 14 Aug 2026, with its schemas and Customs' sample files). Check the
    ICEGATE MIG page for a newer version before changing anything.
  - **`lib/icegateCsn.ts`:**
    - `draftFor` fills the form from the console, each job's house B/L (the received one on an
      import), its CFS code, the boxes, the origin agent, and the desk (`COMPANY.postal`).
    - `buildCsn` writes ICEGATE's JSON.
    - `csnProblems` lists what ICEGATE would refuse. It runs the official schema over the file
      (`schemaErrors`, covering every keyword the schema uses) plus the rules the guide states in
      words: IEC for an import consignee, UN/LOCODEs, HS codes, ZZZZZ/ZZZ for non-hazardous cargo,
      container numbers and ISO size-types.
  - **Tests:** `scripts/tests/icegateCsn.test.ts` checks the checker against Customs' sample files,
    and builds a two-house console into a file that passes the schema.
  - **The file has no `digSign` block:** ICEGATE's signing utility adds it from the filer's Class III
    certificate on their PC. Then it is uploaded on ICEGATE (web upload or SMTP). ICEGATE answers
    with an SFL (structure failed) or an ACK with error codes, listed in section 7 of the guide.
  - **What the desk must still type per console:** the vessel's IMO number and the voyage call number
    (VCN) from the line's agent, plus anything a house B/L lacked (most often the importer's IEC).
    Once, an administrator sets the desk's ICEGATE ID, PAN, authorised person's PAN and port of
    reporting in the panel.
  - **The CSN number that comes back** is recorded in the panel, on the console and every job's import
    customs record, which clears the jobs' "CSN due" alerts (088).
  - **Exports too (SCX, 26 Sep).** An export console gets the same panel, filing the CSN on exit:
    - **Master line:** the desk ships the master B/L with its IEC (`icegate_settings.iec`, else the
      PAN) to the destination agent. It is cleared at the port of reporting (INMAA1), with the next
      port and the final destination given as codes. Movement is TC (foreign transhipment, as in
      Customs' sample), FT or TI.
    - **Each house (EX / H / B):** points at the exporter's shipping bill by its PCIN
      (`prevRef.cinTyp` "PCIN", the guide's and Customs' ACK spelling). The desk types the PCIN,
      which the exporter's CHA has; the SB number and date are shown from the job's export customs.
      The exporter comes from the customer record: IEC and a billing address already split into
      parts.
    - **By movement, per the guide's table:** on TC and TI the house also carries its transport
      document and location; on FT only its reference, PCIN, equipment and measures. There are no
      items or itinerary on an export house.
    - **Transhipper:** the carrier's code and bond go on the master (and the house on TC/TI) when
      given. Otherwise a warning, not an error.
    - **Every container** now carries `cntrAgntCd`, empty when not known, as Customs' own sample
      does. The panel has a column for it.
    - **Recording the CSN number** puts it on each job's export customs record.
    - **The export rules are less spelled out in the guide than the import ones:** `prevDec` "B" and
      the house objects follow Customs' sample and the v1.6 tables. Make the first real SCX a test
      file (T) or check ICEGATE's reply closely.
  - **Amendments (SCA, 27 Sep).** Once the CSN number is recorded, the panel shows "Amend the
    CSN (SCA)": what changed since the last live file, in words, and a button that makes the
    amendment (`buildAmendment`, lib/icegateCsn.ts).
    - **What it compares with:** every file now keeps the form it was made from
    (`csn_files.draft`, 099), as ICEGATE will hold it (`asFiled`). The baseline is the last live
    (P) file for the console, whether the CSN or an earlier amendment. Test files never become
    the baseline.
    - **What it carries:** only what changed, each object flagged U (updated), S (added) or D
    (deleted), plus the header naming the CSN (number and date) and the master line's `supRef`
    back to it, as CBIC's SCA schema requires. Houses are matched by job and keep the sub-line
    they were filed under. A new house gets the next sub-line ever given out (a deleted one is
    not reused), with every object S; a removed house is its reference, D. Containers are
    matched by number.
    - **Checked:** against CBIC's SCA schema (`src/lib/icegate/scaSchema.json`) before the
    button enables, and Customs' own SCA sample passes the same check.
    - **Judgement calls, to confirm on the first real one:**
      - `csnSbmtdTyp` is "ANC" (the guide: the submitter's type), while Customs' sample has "CSN".
      - `versionNo` follows the original event (SCE1102 / SCX1102); the sample amends an SCE.
      - `Amend_det` (a free-text reason) is left out: the schema does not require it.
      - Make the first amendment a test file (T).
    - **A CSN filed before 099** has no kept form, so it cannot be amended from the CRM ("no
    live file on record to compare with"). File that one amendment on ICEGATE directly, or
    download a fresh live CSN file first (not uploaded) to set the baseline.
    - **A rejected live file is not the baseline** once its reply is read in (below): the next
    amendment compares with the last live file ICEGATE did not reject, so it carries the change
    again. A reply not yet read counts as accepted.
  - **ICEGATE's replies (100, 27 Sep).** "Read a reply" on the CSN panel takes the `…_ACK.json` or
    `…_SFL.json` ICEGATE sent back (`readCsnReply`, lib/icegateReply.ts; `applyCsnReply`,
    services/icegateCsn.ts).
    - **Which file it answers:** found by its job number. Refused if the reply is for another
      sender, a job the CRM never made, a file made on another console (named), or a different
      event. The CRM's own `_DEC` file is refused with a pointer to the right one.
    - **The reply is walked, not path-read.** Customs' ACK samples disagree with each other and
      with the guide's ACK schema: `mastrCnsgnmtDec`/`mastrCnsgmtDec`, `houseCargoDec`/`hcargoDec`,
      error arrays beside or inside objects, `{}` placeholders for unchanged houses. The reader
      takes error codes ("000"/"00" = passed), the house sub-line, and the container / item /
      itinerary sequence from wherever they are. Codes without text get the guide's list
      (section 7, `src/lib/icegate/ackCodes.json`, 448 codes).
    - **Each file's status** shows in the panel: awaiting reply, accepted, rejected, structure
      failed. Each error is pinned to the house (by its B/L number and job, from the form kept
      with the file) and the container number.
    - **An accepted live file records on its own:**
      - the CSN number and date (as "Record", on the console and every job);
      - the master line's MCIN/PCIN on the console (`cin_type`, `cargo_identification_no`);
      - each house's CIN on its job's customs record (`cin_type`, `cin_no`; shown on the job's
        manifest section).
    - **Test files:** a test file's reply is kept, and nothing is recorded from it.
    - **SFL:** the CRM checks every file against CBIC's schema first, so an SFL means ICEGATE's
      live format differs from the published one. Keep the reply for whoever maintains the CRM.
    - **Unconfirmed:** the reader follows Customs' 2020 samples. Check the first real ACK reads
      as expected: the CSN number, and the CINs landing on the right jobs.
  - **Recording by hand** stays, for a reply that came some other way.

- **Live rates (101, 26 Sep).** Agents & partners → Live rates. The desk names a service
  ("FCL 20' / 40' · Chennai → Jebel Ali"), says what to quote, and picks the partners.
  - **When:** every Sunday at 10:30 pm IST each partner gets their own mail (nobody sees who else
    was asked). It asks for the Monday to the Sunday after, so the rates are in on Monday
    morning. A mail sent by hand asks from that day to the coming Sunday.
  - **The mail:** `lib/liveRates.ts`, copied into the function with `lib/company.ts` (a test
    keeps both copies identical). The subject starts "Rate request", so Team oversight files it
    as one. It is sent from the request's mailbox (info@ by default), so replies land there and
    show under Partner mail.
  - **Sending:** the `live-rates` function, app-only (nobody signed in), needs Mail.Send (§9).
    Exchange takes about 30 mails a minute from a mailbox, so mails go 2 s apart. A run stops
    after 100 s and the next 10-minute run carries on. Each partner is claimed once per Sunday,
    so re-runs retry only failures and never mail twice. A refusal of the app itself (no
    permission, bad secret) stops the run.
  - **The page:** next send and the week it asks for; whether Microsoft lets the app send (with
    the Azure steps if not); per request, last Sunday's result partner by partner with
    Microsoft's reason for any refusal, a preview of the exact mail, **Send a test to me** (to
    the signed-in person only), **Send now** (after a confirm; a second press within 5 minutes
    skips partners already mailed), Pause, Edit, Delete.
  - **Verified 26 Sep:** the database guard as an employee and an admin (rolled back); the
    function refuses anonymous callers and anything but `weekly` from the scheduler; a real
    `weekly` run with no requests sends nothing and reports `canSend: false`; the page in a
    harness. No mail was sent: the two partners on the directory are real.
  - **Not built:** reading the rates that come back into the Rate master.
  - **For a shipment (107, 30 Sep).** The page's first tab. Choose an open job (any enquiry not
    declined or lost, less bookings delivered or cancelled; `?job=REF` links straight to one),
    the partners, and for each the services to price — ticked from their role
    (`lib/rateRequest.ts` `defaultServices`: an overseas agent the far end, a line the freight, a
    CHA the clearance, a transporter the pickup), changed per partner, or typed in. Each gets
    their own mail **from the sender's Outlook** (delegated, like the case file's Ask partners:
    it works without Mail.Send), opening with their greeting and their services, then the
    message about the shipment built from the enquiry (editable, or written with AI to a brief).
    The subject carries `[REF]`, so the reply files on the job, and starts "Rate request". Each
    send is recorded by `record_rfq_sent` (107), which files the thread on the job and the
    partner among its parties. The case file's Partners tab (Partner quotes) shows each
    partner's services, "from Live rates", and **Read the threads**: the requests and replies
    from the viewer's mailbox, opened and answered there (a request sent by someone else says
    whose mailbox it is in). The case file's own "Ask partners" is the same form
    (`RateRequestForm`) in a dialog. The Sunday requests are unchanged on the second tab.
  - **Verified 30 Sep:** the migration rolled back (services cleaned, one row and one timeline
    entry per partner per batch, thread bound, party added, old call still accepted, anon
    refused); the page in a harness with invented partners (role defaults, a custom service,
    a partner with no service refused, per-partner preview, the record of three sends, the case
    file rows and threads, the dialog, a 375 px phone). No real mail was sent.
- **Passwords (26 Sep).** Auth settings: at least 10 characters, with letters and a number
  (`password_min_length` 10, `password_required_characters` letters:digits). The staff-accounts
  function and the Staff accounts screen check the same rule first, so the admin reads a plain
  sentence. Existing passwords keep working until changed. Leaked-password checking needs the
  Pro plan, which the desk has decided against for now.
- **Views read as the person asking (096).** Every reporting view has `security_invoker = true`.
  **`create or replace view` resets it:** a migration that redefines a view must say
  `create or replace view … with (security_invoker = true) as …`, or the advisor flags it again
  and the view silently ignores RLS. New functions get `set search_path = ''` and write names as
  `public.…`.
- **Backups (093).** Nightly at 03:00 IST: every public table, the accounts (no passwords)
  and the stored-file list, as `db/YYYY-MM-DD.json.gz` in the private `backups` bucket, 30
  days kept. The admin console shows whether last night's ran (red after 26 hours or a
  failure), the files, and "Back up now".
  - **Tested restore:** `node supabase-v2/restore-backup.mjs --test` rebuilds every table
    from today's file in a scratch schema with all 135 foreign keys and compares each with
    live. On 25 Sep, 60 tables loaded and all matched except `backup_runs`, which gains its
    own row after the export.
  - **To restore for real:** a project with the migrations applied and no data, then
    `--restore <file>`. It recreates the accounts with their ids and no password, loads
    parents before children, generated columns computed, identity kept, user triggers off
    during the load, sequences moved past, all in one transaction.
  - **A copy off Supabase:** `node supabase-v2/backup-download.mjs` pulls the backups and
    every stored file into `backups/` on the machine it runs on (gitignored). Run it
    regularly: a lost project takes its bucket with it.
  - The export used to be parsed into JavaScript numbers on the way (48500.00 became
    48500). The function now files Postgres's own text.
  - **The Free plan has no managed backups.** Pro (about $25/month) adds daily snapshots of
    the whole database with schema, as a second line. The user's action in the dashboard.
- **Console cargo manifest (090).** On Consoles, an open console has a manifest section
  (`components/ConsoleManifest.tsx`; logic in `lib/consoleManifest.ts`; PDF in
  `lib/documents/manifestPdf.ts`).
  - It lists one line per job on the console, taken from its house B/L as saved: ours, or
    the received one when the job travels under the origin agent's. A job with no B/L saved
    uses its own fields.
  - Each line has the house B/L, shipper, consignee with IEC/GSTIN, notify, marks and
    container, packages, goods, gross weight, CBM, freight and release mode, with totals at
    the end.
  - Outputs: an A4 landscape PDF (header repeated on each page; the last line always shares
    a page with the totals) and an Excel sheet in the report layout.
  - "Mail it to <agent>" writes to the console's overseas agent with both files attached.
    Sending records when, to whom and how many house bills.
  - The section says "N added since — send it again" when the count has changed since.
  - It is **provisional** (in the title, subject and footer) while any B/L is a draft, a job
    has no B/L, the MBL number or vessel is missing, or a weight is missing. A provisional
    manifest can still be sent; the section lists why.
- **A B/L somebody else issued, received (088).** On a sea job whose Bill tab says "The origin
  agent's house B/L", the tab shows `components/ReceivedHbl.tsx`. An import job with no
  `bl_type` defaults to this.
  1. **Read their B/L.** It files the PDF on the Documents tab ("House B/L (agent's)") and
     reads the boxes through `classify-enquiry` mode `hbl`. On the sample it read every box
     right at high media resolution, in about 10 s. Nothing is saved until Save.
  2. **Check against the job** (`lib/receivedHbl.ts`, `checkAgainstJob`). Names are compared
     without Pvt Ltd, ports by the words they share, weights within a kilo or 0.5%, and CBM
     within 2%.
     - "Copy the corrections for the agent" writes the list and puts it on the clipboard.
     - "Fill the job's blanks from it" writes only empty job fields.
  3. **The stages** are draft → confirmed → final. Each one saves, and confirm and final leave
     a line on the case-file timeline (`hbl_received`, `hbl_confirmed`, `hbl_final`,
     `do_issued`).
  4. **Manifest (CSN), imports only.**
     - The fields: IGM number and date, the master's line, this B/L's sub-line, CFS code, CSN
       number and filed-on date.
     - They are saved on the import customs record, started if there is none. The Customs tab
       shows the same IGM fields.
     - The countdown runs to ETA − 72 hours, IST. **72 hours is the desk's rule as agreed, not
       a quoted regulation.**
  5. **Release, imports only.** The checklist is: the final B/L in; one original surrendered,
     or the telex received, or nothing for express; freight collect and local charges paid.
     When all are done, "Issue the DO" dates it with a validity period. The DO and the arrival
     notice print their number (`documentDataFromBooking` reads `forwarders_bl_no` when
     `bl_type` is `forwarder`).
- On air, the HAWB form's MAWB boxes do not write `shipments.mainline_no`, so an air pre-alert
  has no MAWB unless one is recorded some other way.
- **Security: closed on 25 Sep (092); what is left.**
  - With the public anon key alone, anyone could read the 14 reporting views (customer
    balances, margins) and call 88 `SECURITY DEFINER` functions, 24 of them with no caller
    check. 092 closed all of it. Checked from outside: 401 on the views and on
    `create_customer`, while the customer pages still answer.
  - **Sign-ups are closed (25 Sep):** `disable_signup: true`. Before that, anyone could
    create an account, and `handle_new_user` made it an employee with full access. Staff are
    now added on the admin console (**Staff accounts**, the `staff-accounts` function).
  - **The starter password was public (25 Sep).** Both GitHub repositories
    (`logistics-v3`, `araxys-crm`) are **public**. `seed-users.mjs` had set all five
    accounts to the same starter password, and all five, admin included, still had it.
    - It was replaced with a random one nobody holds, and removed from the script. It
      remains in the git history, where it no longer works.
    - Aashish, Parasu and info@ sign in with Microsoft. Imports@ and Aarathy need Microsoft
      sign-in or a password set on Staff accounts.
    - **Make the repositories private** (the user's action on GitHub). No other secret is
      in the history; the history was scanned on 25 Sep.
  - Also: minimum password length 6, leaked-password protection off, 13 functions without
    a fixed `search_path`, and the 14 views are still security definer (staff-only now).
- Shipment row ids are still `ARX-SHP-0004`. Nothing printed or mailed shows them any more
  (documents are numbered `BKG-ALG09004-26`, see `documentNo` in `lib/documents/data.ts`),
  but the job file header and the enquiry register's booking-number fallback still do.
- No full end-to-end demo has been run yet. A dummy enquiry mail was written for one: send
  it in, push it to inbound, then quote, approve, accept and book.

---

## 10. Standing constraints

- **Do not touch v1** (`../araxys-crm`, project `wremiarcmppuncgfzrqb`). It shares a
  SnapServe account with live voice agents answering real calls.
- **Priya and Arun's prompts** (in v1's `snapserve-setup/`) are the user's own work. Do not
  edit them without an explicit instruction.
- **The service-role key stays in gitignored files** (`server-v2/.keys.json`), never in the
  bundle. Never print secret values.
- **Checks against the database must not change real data.** Roll back or restore. The
  database is now in real use.
- **The assistant does not create accounts, sign up for API keys, or type passwords.**
- **Remove temporary tokens, preview routes and harness files** after testing, and before
  any commit.
- **No dummy data** beyond what `seed-showcase.mjs` creates, which is prefixed `DEMO-`.

---

## 11. Repository state

- Branch **`v2`**. There are two remotes:
  - `logistics-v3` (`github.com/kevinsudhan/logistics-v3`): **the deploy.** Push with
    `git push logistics-v3 v2:main`.
  - `origin` (`github.com/kevinsudhan/araxys-crm`): v1's repo. `origin/v2` is 100 commits
    behind and nothing reads it. **Do not push v2 to `origin/main`,** which is v1's branch.
- The code is at the commit that fixes signatures and pictures (104), pushed to
  `logistics-v3/main` and live, with 104 applied.
- Commit style: a sentence-case subject that describes what the user can now do, a body
  explaining why, and the `Co-Authored-By` trailer.

---

## 12. What changed since 21 September

There are 63 commits. Grouped:

| Area | Commits | What the user can now do |
|---|---|---|
| Inbound desk | `fc00d4e` → `71b42ce` | Consol details, rate master, quoting with approval, a customer directory, service details, cargo dimensions. Editing an approved quote sends it back for approval |
| Quote approvals | `b51a843`, `24f6104` | Sale, buy and profit per quote. **Approvals appear live** for users with lower access |
| In-process job | `fa520d5` → `d6b7de4` | A tabbed job file with a progress model, warehouse, and sign-off with a checklist and lock |
| Tracking | `2a76afd` → `997c132` | Live flight, vessel and container tracking; a customer tracking page with a route map; the link emailed from the job |
| HAWB, customs, pre-alert | `82183f9`, `16a8e18`, `1a87a3d` | The house air waybill as a form; export and import clearance; a pre-alert to the destination agent |
| Worklist | `5fa9346` | In-process search, filters, a table view, Excel export, badges |
| Pickup & delivery | `35f6c1c` | Several movements per job, with attempts, LR, e-way bill, handover, proof and cost, plus a transport order by mail |
| Sailings | `f9d22f0`, `b909da9` | **One sailing schedule page.** Containers sit under their departure |
| Enquiry register | `6b50cd7`, `669cc75` | An Excel report in the style of their `ENQUIRY FILES.xlsx`, with sheets for inbound, in process and completed |
| Enquiries overview | `669cc75` | `/intake` shows the counts per stage, the download, and the mails waiting to be sent to inbound |
| Branded mail | `83bebd7`, `3904a0c` | Quotation and booking confirmation on a navy letterhead with the logo |
| Job closing | `f40ed51` | P&L per job, and per day, week, month, quarter and financial year, with a chart and an Excel export |
| Loading states | `3aa303a` | Skeletons, a start-up screen with the app icon, inline dots |
| Mail | `565c878` | The message list stays in view while a long thread scrolls |
| iPhone app | `24f6104` | Add to Home Screen gives a standalone app with the user's logo as the icon |
| Realtime desk (081) | `a15f629` | Enquiries, shipments, intake and job steps update live on every list and file page |
| Printed documents | `763a153` | PDFs numbered `BKG-ALG09004-26` (no `ARX-`), on the navy letterhead with the mail's logo |
| House B/L (085) | see `git log` | The house B/L as a form on the Bill tab: release mode, originals, issued under a partner's MTO, numbered, locked when issued, history, and a printed draft, originals or copy |
| Live everywhere (084) | see `git log` | Every change on an enquiry or a job, by anybody, shows on everybody's open page: every tab of the job file, every panel of the case file, the boards, Job closing and Consoles |
| Dates | see `git log` | "Sep", never "Sept", on every screen, mail and PDF (`lib/dates.ts`) |
| Free time (083) | see `git log` | Free days and D&D rates per job; each box's clocks on the Containers tab; an alert on the job file header and the worklist (badge, "Free time running out" filter, urgency sort, Excel column); the terms on the arrival notice |
| Team oversight (086, 087) | see `git log` | A live view of the desk: every mail each mailbox sent and to whom (from Outlook too), enquiries taken on, quoted and booked, job steps ticked, per person and per period. A server copy of every mailbox every 5 minutes |
| Sign-ups closed, staff accounts, backups (093) | see `git log` | Only an admin adds staff (Staff accounts); the leaked starter password is dead; a tested nightly backup with a status card, downloads and a restore script |
| Customer milestones (102) | see `git log` | The customer's tracking page shows only what the desk records on the job's Tracking tab: each milestone with its day, time, place and a note, the desk's own updates, nothing from feeds or internal steps. The job's records are offered as "Use this"; the stage follows the milestones |
| Live rates (101) | see `git log` | Name a service, pick the partners: every Sunday 10:30 pm IST each gets their own mail asking for the coming week's rates, from info@, replies under Partner mail. Send now, a test to yourself, preview, pause; every send and Microsoft's reason for any refusal on the page |
| Customer DSR (108) | see `git log` | Each customer's daily status report on their page: live shipments in the desk's columns, REASON/STATUS written there, Excel download, emailed to the customer with the sheet attached (no agent column), every send recorded |
| Live rates for a shipment (107) | see `git log` | Choose a job and partners, and per partner the services to price; one mail each from your Outlook, filed on the job as a thread under Partners, with the partner added to its parties. The case file's Ask partners uses the same form |
| ICEGATE replies (100) | see `git log` | "Read a reply" takes ICEGATE's ACK or SFL, finds the file by job number, shows each error on its house and container in the desk's words, and on an accepted live file records the CSN number and date and the MCIN/PCINs; a rejected file stops being the amendment baseline |
| CSN amendments (SCA, 099) | see `git log` | Once the CSN number is recorded, the panel lists what changed since the last live file and makes the amendment with only that, flagged U/S/D, pointing back at the CSN; houses keep their sub-lines across amendments; checked against CBIC's SCA schema |
| CSN for exports (SCX, 098) | see `git log` | An export console makes the CSN on exit: the desk as shipper with its IEC, each house pointing at its exporter's shipping bill by PCIN, shaped by cargo movement as the guide's table says; checked against CBIC's schema |
| CSN for ICEGATE (097) | see `git log` | An import console makes the CSN file in CBIC's format, checked against the official schema, numbered and named as ICEGATE expects, for the desk to sign and upload; the CSN number is recorded back on every job |
| Mail editor with Outlook's formatting | see `git log` | Font, size, colours, highlight, lists, alignment, links, pictures, tables; the editor shows exactly what the recipient's Outlook shows; paste from Word/Excel/Outlook keeps its look; Reply all, Forward (with the attachments) and Bcc |
| Connect Outlook to your own mailbox (095) | see `git log` | Password logins connect Outlook from the Mail page without signing in again, and only to their own mailbox: info@ cannot connect aashish@ |
| Outlook stays connected (094) | see `git log` | No more "sign in again" an hour after signing in: the server renews the Microsoft token silently for as long as the person stays signed in |
| Quote self-approval (091) | see `git log` | Approve a quotation yourself with a reason; the reason goes to the admins' review list with a sidebar count; admins accept or withdraw while unsent |
| iPad sign-in | see `git log` | The sign-in no longer scrolls or bounces on iPad (dvh) |
| Console manifest (090) | see `git log` | Every house B/L under a console on one PDF and Excel sheet, mailed to the destination agent; provisional until every B/L is final; flags house bills added since it was sent |
| Our B/L's release (089) | see `git log` | After issue: charges received, originals handed over and to whom, the full set back for a telex release, the telex release written to the destination agent and sent, released at destination; each on the history and the timeline, with the rules held by the database |
| Received house B/L (088) | see `git log` | The origin agent's B/L read in from their PDF, checked against the job, corrections for the agent, the job's blanks filled; the CSN with its ETA − 72h countdown; the release checklist and our DO against their number. Our own B/L gained IEC/GSTIN, said to contain, a freight table and cargo insurance |
| Sea master bill (082) | see `git log` | The console's MBL reaches its jobs; master typed on the Bill tab off a console; printed on the arrival notice, DO and B/L particulars |

### Details of the iPhone app (`24f6104`)

- `public/manifest.webmanifest` sets `display: standalone`, a navy background and a white
  theme.
- `public/icons/` holds apple-touch-icon 180, 192, 512, a maskable 512 and a favicon, all made
  from the user's logo (`63.webp`, 2000×2000).
- `public/sw.js` is network-first for pages and cache-first for `/assets/`. It is registered
  in `main.tsx` for production builds only.
- `netlify.toml` serves `sw.js` and the manifest with `no-cache`, so a deploy reaches
  installed apps the next time they open.
- **Bump `VERSION` in `sw.js`** if a change to its caching must replace old caches.
- The safe-area padding lives in `index.css` under `@media (display-mode: standalone)`.
