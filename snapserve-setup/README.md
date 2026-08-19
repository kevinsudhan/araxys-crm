# SnapServe go-live checklist

**Status as of 19 Aug 2026 — two-agent squad configured, real document generation built.**

## Done (live, verified against the real SnapServe account via API)
- Agent 717 (was the blank draft "Aashish") is now **Priya**, `status: active`, the customer-facing forwarder-rep:
  - Full system prompt applied, including the call-behavior/turn-taking section and the tone/anti-cringe section — see `system-prompt-priya.md`.
  - Bilingual Tamil + English properly configured (`isMultilingual: true`, `ta-IN` + `en-IN`, `languageAutoDetect: true`).
  - ASR tuned for patience after real-call testing: `asrEndpointingSilenceMs: 900`, `wordsForInterruption: 6`, generous `startSpeakingPlan`/`stopSpeakingPlan` waits.
  - `dispositionSchema` configured — 13 fields extracted per call via LLM (customer, cargo, volume, container, price asked/negotiated, outcome, etc.).
  - **New: handoff decision logic** — once place/dimensions/space/cost are all covered, Priya asks whether the customer wants to finish document generation now, and hands off to Arun if yes.
- **Agent 758 ("Arun") created via API** — the documentation-desk agent. Same bilingual/tone/turn-taking config as Priya. `dispositionSchema` has 14 fields matching a real commercial invoice: shipper name/GSTIN-IEC, consignee name/address/country, HS code, invoice value, package count/type, net/gross weight, documentation status, missing fields. System prompt explicitly allows "call back later" for anything the customer can't answer yet — see `system-prompt-arun.md`.
- **Phone number assigned**: +91 79658 54267 routes inbound to Priya.
- **Real inbound call tested and pulled into the CRM**: call `10908` (280s) — Priya quoted real KB pricing, cited the real negotiation band, and correctly escalated instead of inventing a price. Full transcript and extracted fields live in the CRM at `/shipments/sh-7`.
- **Four knowledge sources attached to both agents** (ids 364-367): container specs, pricing/negotiation, documents-by-cargo, destination regulations. Plus the sailing-schedule/space-availability doc, pending re-upload (see prior thread — same account-visibility quirk as before).
- **Real document generation built in the CRM**: `src/lib/generateInvoicePdf.ts` produces an actual downloadable PDF (jsPDF) — a Commercial Invoice & Packing List under the Araxys Logistics letterhead, populated from real shipment + call + doc-gen data, with honest "TBD" for anything not yet collected rather than invented values. "Generate documents" button on every shipment detail page. Verified working end to end (`/shipments/sh-2`, Coral Exports — has full demo doc-gen data attached).

## Live container space (backend + 3D fit engine)

There is now a real backend (`server/`, run with `npm run server` on port 8787). It exists because three things genuinely cannot live in the browser: the SnapServe API key, a URL for SnapServe webhooks to POST to, and an endpoint the voice agent can call mid-conversation.

**The fit engine does not use volume math.** `server/spaceEngine.ts` works in three dimensions: it tries every axis-aligned orientation, works out how many pieces fit across the container width and how high they stack, and computes how much container *floor length* a consignment actually consumes. It handles non-stackable cargo and "this way up" cargo that cannot be laid down. This matters because a consignment can sit well under a container's cubic capacity and still not fit — a 2.6m-tall upright crate does not go into a 2.39m-high 20GP at any volume. `npm run test:space` covers that case and 20-odd others; all pass.

Endpoints:
- `POST /api/tools/check-space` — **the agent tool.** Takes route, date, and per-piece dimensions; returns a real fit decision plus a `spoken_answer` the agent can read out verbatim. Falls back to the next sailing when the requested date is full.
- `GET /api/space/slots` — live remaining space per sailing (drives the CRM's Space & containers page).
- `GET /api/space/slots/:id/plan` — the full load plan: every consignment in that container with its client, size, arrangement and position along the floor.
- `POST /api/space/book` — commits space; remaining length/payload drop and slot status auto-flips to `closing_soon` / `full`.

**Load-plan visualisation.** Clicking any sailing in the CRM opens a hybrid 2D/3D view of that container: an isometric projection showing every consignment as stacked boxes colour-coded and labelled per client, alongside a top-down floor plan and a side elevation (those two answer "how much floor is left" and "how high is it stacked" better than the 3D view does). Occupancy is *derived* from the individual consignments in `server/placements.ts` rather than stored as a separate total, so the picture and the availability figure can never drift apart. Booking through the CRM places the new consignment against the free floor and it appears in the plan immediately.
- `GET /api/calls/live`, `GET /api/calls/:id` — SnapServe proxy for the live-call feature, key stays server-side.
- `POST /api/webhooks/snapserve` — receiver for `call.started` / `call.completed`.

Verified end to end: asking for 16 boxes on a sailing returned "available", then after another 3.5m booking the same question correctly returned "only 1.2m is left… about 4 of the 16 pieces would fit". Committing space in the CRM moved that sailing from 23% to 48% full.

**To connect the tool to the live agent** (one step, needs your call): SnapServe's servers invoke the tool over the internet, so `localhost:8787` is unreachable to them. Expose the backend through a tunnel (Cloudflare Tunnel, ngrok, or deploy it), then run:

```
node snapserve-setup/register-space-tool.cjs https://your-public-host
```

That registers `check_container_space` on Priya pointing at your public URL. The webhook tool schema in that script is already verified against the SnapServe API. Priya's prompt is *already* updated to gather dimensions and call the tool — she just has no tool to call until this is run. I have not started a tunnel myself, since that exposes your machine to the internet and is your call to make.

## One dashboard step left to make the handoff real
**Squads has no public API.** Priya's prompt references a transfer tool that only exists once both agents are in the same Squad in the dashboard (Agent Builder → Squads → create squad → add Priya and Arun). Takes about a minute. Until then, Priya can *say* she's handing off, but there's no working tool behind it yet.

## CRM → SnapServe KB sync (the "infra" layer)
`npm run sync:kb` (from `araxys-crm/`) regenerates all five `kb-*.md` files in this folder directly from `src/data/knowledgeBase.ts` — the CRM's own typed data (`containerSpecs`, `freightRates`, `cargoTypes`, `destinationRegulations`, `sailingSlots`). **The CRM is the single source of truth; these markdown files are generated output, never hand-edited.** When the CRM data changes, re-run the script and the docs regenerate to match.

**The one confirmed platform limit:** SnapServe's Knowledge Base API only exposes `GET /knowledge-sources` (list), `POST /knowledge-sources/{id}/attach-agent/{agentId}` (attach), and a search endpoint — there is no create-or-update-content endpoint. So when the generated text changes, a human still has to paste the new version into the dashboard (Knowledge bases → the existing source → replace text, or create a new one and re-attach). That paste is the one unavoidable manual step; I handle everything else (regeneration, attaching new source IDs to Priya, verifying `knowledgeSourceIds`) via the API.

**The real fix, for later (as agreed — not built yet):** replace the sailing-schedule KB doc with an agent **tool** (an HTTP webhook the LLM calls mid-conversation) that queries the CRM's live container/booking data directly, instead of reading pre-loaded static text at all. That removes the sync problem entirely, since there's nothing to keep in sync — the agent asks a live question and gets a live answer during the call.

## Still needs the dashboard (no public API)
1. **Squads / escalation handoff** — no "Squads" resource exists in the public API at all; the documentation-desk handoff from the system prompt needs to be wired as an actual live transfer in the dashboard's Agent Builder, or it stays a spoken promise without a real handoff behind it.
2. **Live tool/webhook for space availability** — the "properly" version described above; needs a real endpoint on the CRM side plus a Tool definition on the agent, both still to be built.
