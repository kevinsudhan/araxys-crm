# Araxys — freight-forwarding ops CRM + voice agents

An operations CRM for a freight forwarder, wired to a two-agent voice desk built on
[SnapServe](https://app.snapserve.ai). Customers phone in and speak to an agent that
quotes real rates, checks real container space in three dimensions, and hands off to a
documentation desk — while the CRM stays the system of record for everything said.

## What's here

**CRM (React + TypeScript + Vite + Tailwind).** Inbound requests, in-process and completed
shipments, container space, documentation, live calls, complaints, billing, agents,
knowledge base, analytics, compliance. Light theme, route-based code splitting.

**Backend (`supabase/functions/`, Deno on Supabase Edge Functions).** Hosted, so nothing
depends on a laptop being awake. Exists because the SnapServe API key must never reach a
browser, and because the voice agent needs a URL it can call mid-conversation that is
still there tomorrow. Data lives in Postgres; `pg_cron` drives transcript ingestion.

`server/` still holds the original Express implementation. It is the same logic and works
locally, but the hosted functions are what production uses.

**Voice agents (`snapserve-setup/`).** Two agents configured against the live SnapServe
account — Priya (customer-facing forwarder rep) and Arun (documentation desk) — with their
system prompts, knowledge-base sources, and the scripts that applied them.

## The container space engine

`server/spaceEngine.ts` decides whether cargo fits. It deliberately does **not** compare
volumes: 30 CBM of cargo "fits" a 33 CBM container by volume, but a single 2.6m-tall crate
does not fit a 2.39m-high 20GP in any arrangement. So it works in three dimensions —
trying every axis-aligned orientation, respecting stackability and "this way up" cargo,
checking payload, and reasoning about how much container *floor length* a consignment
actually consumes, which is how groupage space is really sold.

Covered by `server/spaceEngine.test.ts` (`npm run test:space`), including the tall-crate
case volume math gets wrong.

Occupancy is **derived** from the individual consignments loaded in each container
(`server/placements.ts`), never stored as a separate total — so the load plan drawn on
screen and the remaining-space figure quoted on a call are computed from one source and
cannot drift apart.

## Load plan visualisation

Clicking a sailing opens a hybrid 2D/3D view: an isometric projection of the container
with every consignment drawn where it sits, colour-coded and labelled per client, beside a
top-down floor plan and a side elevation — those two flat views answer "how much floor is
left" and "how high is it stacked" better than the 3D view does.

## Running it

The frontend talks to the hosted Supabase functions by default, so it runs on its own:

```bash
npm install
npm run dev                             # CRM on :5173, against hosted Supabase
```

To point it at a local backend instead, set `VITE_API_BASE=http://localhost:8787` and run
`npm run server`. The CRM degrades gracefully when the API is unreachable — space data
falls back to static values and the live-call indicator goes quiet, rather than erroring.

| Script | What it does |
| --- | --- |
| `npm run dev` | CRM dev server |
| `npm run build` | Production build (reads `VITE_API_BASE`) |
| `npm run server` | Local Express backend, if you want one |
| `npm run test:space` | Space engine test suite |
| `npm run sync:kb` | Regenerates the agent knowledge-base docs from CRM data |
| `node scripts/verify-hosted.mjs` | End-to-end check of the hosted stack (33 assertions) |

### Deploying

Frontend goes to Netlify — `netlify.toml` sets the build, the SPA redirect (without it
every deep link 404s on refresh) and `VITE_API_BASE`. Set the base directory to
`araxys-crm`.

Backend functions deploy with the Supabase CLI:

```bash
npx supabase functions deploy api --project-ref <ref> --no-verify-jwt
npx supabase functions deploy ingest --project-ref <ref> --no-verify-jwt
npx supabase secrets set SNAPSERVE_API_KEY=sk_live_... --project-ref <ref>
```

Schema lives in `supabase/schema.sql` and `supabase/schema-space.sql`.

## Knowledge base stays in sync

`npm run sync:kb` regenerates every `snapserve-setup/kb-*.md` from `src/data/knowledgeBase.ts`,
so container specs, pricing, cargo document rules and port regulations live in exactly one
place. SnapServe's public API has no endpoint to create or update a knowledge source's
content (only list, attach and search), so pasting the regenerated text into the dashboard
is the one manual step — everything upstream of it is automated.

## Known gaps

These are real and deliberately not papered over:

- **Tool results do not reach the model on the Gemini Live voice stack.** Verified over
  many calls: the webhook fires with the right arguments, returns correct data, and the
  agent still answers from something else. `lookup_shipment` was removed for this reason —
  shipment recognition goes through the knowledge base instead, which does work. The
  space-check tool is still registered, but treat its in-call reliability as unproven.
- **Whether the agent grounds itself in the knowledge base is untested.** Every step up to
  it is verified; nobody has yet called and confirmed the agent reads a customer back
  correctly. Until that happens, the end-to-end claim is unproven.
- **SnapServe's own extraction never fires.** `dispositionResult` and `callSummary` are
  null on every call, so transcripts are parsed and summarised here instead
  (`extractCustomer.ts`, `summarise.ts`). That parsing is regex-based and conservative:
  fields it cannot read stay blank rather than being guessed.
- **Squads and WhatsApp have no public API.** Agent-to-agent handoff and the WhatsApp
  channel are dashboard-only, and the handoff is not wired — the agent will say it is
  transferring with nothing behind it.
- **Most CRM modules are still mock data** — documentation, complaints, billing, analytics.
  Customers, calls and container space are real.
- **Transcripts contain run-together words** (`thisis Priyafromthe`) from the ASR. Spacing
  is repaired only where unambiguous; splitting the rest needs dictionary segmentation, and
  guessing wrong would corrupt what a customer actually said.
