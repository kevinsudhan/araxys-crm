# Araxys — freight-forwarding ops CRM + voice agents

An operations CRM for a freight forwarder, wired to a two-agent voice desk built on
[SnapServe](https://app.snapserve.ai). Customers phone in and speak to an agent that
quotes real rates, checks real container space in three dimensions, and hands off to a
documentation desk — while the CRM stays the system of record for everything said.

## What's here

**CRM (React + TypeScript + Vite + Tailwind).** Inbound requests, in-process and completed
shipments, container space, documentation, live calls, complaints, billing, agents,
knowledge base, analytics, compliance. Light theme, route-based code splitting.

**Backend (`server/`, Express + tsx).** Exists for three reasons the frontend can't cover:
the SnapServe API key must never reach a browser, SnapServe webhooks need somewhere to
POST, and the voice agent needs a URL it can call mid-conversation.

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

```bash
npm install
cp .env.example snapserve-setup/.env   # add your sk_live_ key
npm run server                          # backend on :8787
npm run dev                             # CRM on :5173
```

The CRM degrades gracefully with the backend down — space data falls back to static
values and the live-call indicator goes quiet, rather than erroring.

| Script | What it does |
| --- | --- |
| `npm run dev` | CRM dev server |
| `npm run server` | Backend (space engine, call polling, agent tool endpoint) |
| `npm run test:space` | Space engine test suite |
| `npm run sync:kb` | Regenerates the agent knowledge-base docs from CRM data |

## Knowledge base stays in sync

`npm run sync:kb` regenerates every `snapserve-setup/kb-*.md` from `src/data/knowledgeBase.ts`,
so container specs, pricing, cargo document rules and port regulations live in exactly one
place. SnapServe's public API has no endpoint to create or update a knowledge source's
content (only list, attach and search), so pasting the regenerated text into the dashboard
is the one manual step — everything upstream of it is automated.

## Known gaps

These are real and deliberately not papered over:

- **Disposition extraction has never fired.** `dispositionResult` is null on every call
  regardless of voice stack, so the CRM's structured columns aren't yet auto-populated
  from conversations.
- **Squads and WhatsApp have no public API.** Agent-to-agent handoff and the WhatsApp
  channel are configured through the SnapServe dashboard only.
- **The space tool needs a public URL.** `snapserve-setup/register-space-tool.cjs` registers
  it, but the backend must be reachable from the internet (a tunnel) before the agent can
  call it live.
- **Backend state is in memory.** Restarting resets space bookings to seed data.
