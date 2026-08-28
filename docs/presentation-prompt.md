# Presentation prompt — Araxys (voice-agent focused)

Paste everything below the line into a presentation generator (Gamma, Claude, Copilot, etc.).

---

You are building a **12–14 slide presentation** for **Araxys**, an end-to-end freight-forwarding
automation platform. The centre of the story is the **voice agents** — everything else is
supporting cast. Roughly 70% of the deck is the agents and what they can do; 30% is the CRM that
makes their work permanent.

**Audience:** a mixed room — freight-forwarding operators who care whether it actually books
cargo, and technical evaluators who care how it holds up. Assume both are sceptical of AI demos.

**Tone:** confident, concrete, unhyped. Every claim carries a number or an example. No
"revolutionary", no "seamless", no "leveraging AI". Short sentences. If a slide could survive
being pasted into a competitor's deck unchanged, it is too generic — rewrite it.

---

## THE ARGUMENT THE DECK MUST MAKE

A freight forwarder's front desk is a phone. Customers ring, describe cargo in whatever language
they think in, ask what it costs, and hang up — and everything they said dies in someone's
notepad. Araxys puts two voice agents on that phone, and makes the call itself the input to the
whole operational system: quote, space allocation, booking, and twelve shipping documents.

The single most important idea in the deck: **the agents don't call tools mid-conversation.
Everything they know is published into their knowledge base between calls.** Explain why this is
a design decision and not a limitation — mid-call tool calls add latency the customer hears as
dead air, and fail in ways the customer experiences as the agent stalling. Instead, the moment a
call ends the system re-derives the world and republishes it, so the next call opens with an
agent that already knows. Give this its own slide.

---

## THE TWO AGENTS — the spine of the deck

**Priya — the forwarder desk (customer-facing).**
Greets: *"Hi, this is Priya from the Araxys forwarder desk. How can I help you today?"*
Takes the enquiry, works out the route, checks real container space, quotes a real rate from a
published rate card, negotiates inside a defined band, fixes a sailing date, closes the booking.
Her operating instructions run to ~28,800 characters across nine explicit rule blocks.

**Arun — the documentation desk.**
Greets: *"Hi, this is Arun from the Araxys documentation desk. Priya's passed me your shipment —
I just need a few more details to get your documents generated."*
Collects shipper legal name, consignee, HS code, package and weight detail — the fields a
commercial invoice and packing list legally need. Lets customers ring back for what they don't
have to hand.

**The handoff is a real squad, not a prompt trick.** "Chennai desk squad", Priya as the entry
member, warm handoff with a briefing so the customer never repeats themselves:
*"I've been briefed on your conversation so far."*

---

## WHAT THE AGENTS CAN ACTUALLY DO — build 4–5 slides from these

**1. They speak the customer's language, and remember which one it was.**
Tamil and English, including natural mid-sentence code-switching — an English word dropped into a
Tamil sentence gets answered in English, naturally, without flipping the whole call. The language
a caller used is stored against their number, so a customer who spoke mostly Tamil last time is
greeted in Tamil next time — not English-by-default with a language menu.

**2. They ask one question at a time.**
Call this out as a craft decision. The failure mode of every voice agent is the shopping-list
question — "can you give me the dimensions, weight, piece count and preferred sailing date?" —
which callers answer partially and the agent then has to unpick. Priya asks one thing,
acknowledges the answer, then asks the next. There is a dedicated pre-speech check in her
instructions that stops her stacking questions when the conversation speeds up.

**3. They quote real money from a real rate card.**
Rate per lane, LCL vs full-container logic, and a negotiation band she may move inside — with a
hard rule that she may never invent a number. If a lane has no published rate she says so on the
first ask and offers a callback, rather than stalling. Contrast this with the alternative: an
agent that hallucinates a freight rate creates a commercial liability the moment the customer
repeats it back.

**4. They check space in three dimensions, not by volume.**
The best single slide in the deck. 30 CBM of cargo "fits" a 33 CBM container on paper — but one
2.6 m crate does not fit a 2.39 m-high 20GP in any orientation. The engine tries every
axis-aligned orientation, respects stackability and this-way-up cargo, checks payload, and works
out how much container *floor length* the consignment really consumes, because floor length is
how groupage space is actually sold. So when Priya says there is space, there is space.

**5. They know who they're talking to — and only that person.**
Every customer record in the knowledge pack names the phone number it belongs to, and the agent
is bound to the caller-memory block injected for the number on the line. This exists because it
had to: an early call had Priya read one customer another customer's reference number and
destination. Present it as a fixed defect with a named guard, not as a feature that was always
there. It is the most credible slide in the deck precisely because it admits something.

**6. They can be made to forget.**
A number can be wiped — from the CRM and from the agents' memory — with the cutoff written before
the deletion, so a background job running mid-wipe can't quietly re-import what was just erased.

---

## WHAT HAPPENS AFTER THE CALL — 2–3 slides

Draw this as a pipeline:

**call ends → transcript → extraction → customer record → auto-promote → space allocated →
knowledge republished → documents**

- **Extraction.** Claude reads the transcript and pulls **39 structured fields** — 19 booking,
  14 documentation, 6 handling — into separate columns. Tamil answers come out as English
  values. A pattern extractor runs alongside the model and the two are merged field by field
  with explicit ownership: the model owns who the customer is, patterns own volume and container
  type, and neither side is allowed to overwrite the other with a blank.
- **Promotion.** An enquiry with a named sailing date and an accepted quote *is* a booking. It
  moves itself into the in-process pipeline; nobody drags a card.
- **Allocation.** Becoming a booking is what earns the space. The cargo is placed in a real
  container on a real sailing — and if it won't fit, the booking still stands and the desk is
  told why. A refusal to allocate never silently undoes a booking the customer made.
- **Republish.** Four packs are rewritten: customer records, per-caller memory, container space
  availability, and the reference documents. This runs the instant a call ends, not on a timer.
  **117 calls** have gone through this pipeline to date.

**Then: 12 documents, generated.** Quotation · Booking confirmation · Shipping instructions · VGM
declaration · Draft B/L · Final B/L particulars · Cargo receipt (FCR) · Arrival notice · Delivery
order · Commercial invoice & packing list · Freight invoice · Proof of delivery. Each one knows
which fields it requires; if a field is missing the document renders as a **DRAFT** with the gap
visible rather than quietly filling in a plausible value. A wrong number on a bill of lading is
worse than a blank one.

---

## THE STACK — one slide, for the technical half of the room

- **Speech in:** Sarvam `saaras:v3`, tuned for Indian English and Tamil, background denoising on.
- **Conversation:** Gemini 3.1 Flash Live, temperature 0.4 — measured ~**790 ms** to first token.
- **Speech out:** Cartesia Sonic-3.5, a distinct voice per agent — ~**590 ms** to first audio.
- **Telephony:** Vobiz. 8-minute call ceiling, 45-second silence timeout, backchannelling on so
  the agent says "mm-hm" while the customer is still talking.
- **Post-call intelligence:** Claude, on Supabase Edge Functions, with Postgres as the record.
- **Knowledge:** 7 shared sources — container specs, route pricing & negotiation bands, documents
  required by cargo type, destination customs & regulations, shipment details, plus two that are
  regenerated automatically: live customer records and live container space.

---

## THE CRM — 2 slides, no more

It is the system of record, not the star. Inbound requests, in-process and completed shipments,
container space, documentation, live calls, billing, compliance. Two things worth showing:

- **Every shipment opens as a full page with a slowly rotating 3D container**, that shipment's
  cargo lit up inside it. Rearrange a stow on the space board and the shipment page reflects it —
  because occupancy is *derived* from the consignments actually loaded, never stored as a
  separate total, so the picture on screen and the figure quoted on a call cannot drift apart.
- **Captured fields, live.** The 39 extracted fields sit on the request, sourced from real calls.

---

## SLIDE SPINE

1. Title — Araxys: the freight desk that answers the phone
2. The problem — the enquiry dies on the call
3. Meet Priya and Arun (one line each, the greetings verbatim)
4. A real call, start to finish (narrative timeline, one slide)
5. Language — Tamil, English, and remembering which
6. One question at a time — why pacing is the product
7. Real rates, and the rule against inventing one
8. Space in three dimensions (the tall-crate slide)
9. Knowing the caller — and the guard that keeps records apart
10. **No tool calls. Knowledge republished after every call.** (the architecture slide)
11. From transcript to booking — 39 fields, auto-promotion, allocation
12. Twelve documents, and why a DRAFT beats a guess
13. The stack, and the latency numbers
14. Close — what a forwarder's front desk looks like now

---

## RULES FOR THE GENERATOR

- Use only the numbers given here: 39 fields (19/14/6), 12 documents, 7 knowledge sources,
  117 calls, ~790 ms LLM, ~590 ms TTS, 2 agents, 1 squad, 8-minute ceiling. **Invent no others** —
  no made-up cost savings, no "40% faster", no fictional customer counts.
- Quote the two greetings and the handoff line verbatim; they are real.
- Slide 9 must keep its honesty. A deck that admits a fixed defect gets believed; one that
  doesn't gets audited by the room instead.
- Visual direction: freight-industrial. Container blues and steel greys, isometric container
  diagrams, monospace for references and numbers. No stock photos of robots, no glowing brains,
  no waveform-into-lightbulb metaphors.
- Speaker notes on every slide: two or three sentences a human can actually say out loud.
