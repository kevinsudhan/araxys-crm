# Araxys — hackathon submission answers

Copy-paste ready. Fields marked **VERIFIED** were pulled from the live SnapServe/Supabase
account, not written from memory.

---

## Agent Architecture Type

**Multi Agent (Squad)** — VERIFIED: squad 15 "Chennai desk squad", entry member Priya (717),
specialist Arun (758), handoff enabled, tested on a live call.

## Team Name

    Araxys

## Agent Name

    Priya

## Agent Phone Number

    +91 79658 54267

VERIFIED: Vobiz-purchased local number, id 24, assigned to agent 717.

## Provider Stack

    STT: Sarvam  (saaras:v3, en-IN, background denoising on)
    LLM: Google Gemini  (3.1 Flash Live, temperature 0.4)
    TTS: Cartesia  (Sonic-3.5, distinct voice per agent)

---

## Project Title

    Araxys — The Freight Desk That Answers the Phone

---

## What are you building?

**Short version (if the field enforces 1–2 sentences):**

    Araxys is a voice-run freight forwarding desk: two AI agents answer the hotline in Tamil
    and English, quote real rates, verify container space in three dimensions, and close a
    booking on the call. Everything said on the phone flows into a CRM that allocates the
    cargo to a sailing and generates all twelve shipping documents — with no human re-typing
    a single field.

**Long version (if the field allows more):**

    Araxys turns a freight forwarder's phone line into its operating system.

    Two voice agents work the desk as a squad. Priya takes the inbound enquiry — route,
    cargo, dimensions, weight — checks whether it physically fits an available container,
    quotes from a published rate card, negotiates inside a defined band, and fixes a sailing
    date. When commercial terms are settled she hands off warm to Arun, the documentation
    desk, who collects the shipper legal name, consignee, HS code and package detail that a
    commercial invoice and packing list legally require. The customer never repeats
    themselves; Arun opens with "Priya's passed me your shipment."

    Behind them sits the CRM that makes the call permanent. The moment a call ends the
    transcript is read into 39 structured fields, the customer record updates, an enquiry
    with an agreed date and an accepted quote promotes itself into the booking pipeline,
    real container space is allocated on a real sailing, and all twelve forwarder documents
    become available — quotation through to proof of delivery.

---

## What problem does your agent solve?

### The problem

    A freight forwarder's front desk is a phone, and it leaks.

    Cargo enquiries arrive when the exporter is free, not when the desk is staffed —
    evenings, weekends, and during the mid-morning crush when every line is already busy.
    Every unanswered ring is a quote request that goes to the next forwarder on the list.
    The enquiries that DO get answered land in a notepad, then get re-typed into the CRM,
    then into the booking system, then into a document set — the same 39 facts keyed three
    or four times, each pass a fresh chance to transpose a weight or drop a digit from an
    HS code.

    And the desk only serves the customers it can talk to. A large share of India's SME
    exporters do business in their regional language. An English-only desk filters them out
    silently: they either don't call back, or they under-describe their cargo, which is how
    a container gets planned around dimensions nobody actually confirmed.

### How voice AI solves it

    Priya answers every call, in the caller's language, immediately.

    She speaks Tamil and English including natural mid-sentence code-switching, and the
    language each caller used is stored against their number — so a customer who spoke
    mostly Tamil last time is greeted in Tamil next time, not routed through an English
    language menu. She asks one question at a time and waits for the answer before asking
    the next, because the shopping-list question ("dimensions, weight, piece count and
    sailing date please") is what makes most voice agents unusable on a real phone line.

    She quotes real money from a real rate card, with a hard rule that she may never invent
    a number: if a lane has no published rate she says so on the first ask and offers a
    callback, rather than stalling. And before she quotes space, the cargo is checked in
    three dimensions — every axis-aligned orientation, stackability, this-way-up
    constraints, payload, and how much container FLOOR LENGTH the consignment actually
    consumes. Volume arithmetic says 30 CBM fits a 33 CBM container; a single 2.6m crate
    does not fit a 2.39m-high 20GP in any arrangement. Floor length is how groupage space
    is really sold, so that is what the engine computes.

    The agents make no tool calls mid-conversation. That is a deliberate design decision,
    not a limitation: a mid-call lookup is latency the customer hears as dead air, and it
    fails in the way customers experience as the agent going quiet. Instead, the instant a
    call ends, the system re-derives the world — records, per-caller memory, live container
    space, reference documents — and republishes the agents' entire knowledge base. The
    next call opens with an agent that already knows.

### Business impact

    WHERE THE MONEY ACTUALLY MOVES — six levers, in rough order of size.

    1. ENQUIRIES THAT NEVER BECAME QUOTES.
       A staffed desk answers what it can pick up. Araxys answers every call, at any hour,
       with no queue — concurrency costs nothing per seat. For a forwarder, inbound capture
       rate moves from "whoever was free" to 100%. This is the single largest lever,
       because an enquiry that was never answered has a 0% win rate by definition.

    2. SPEED TO QUOTE — THE FIRST CREDIBLE NUMBER USUALLY WINS.
       The exporter is calling three forwarders. A manual quote is a callback: check the
       rate sheet, check space with operations, ring back — hours at best, next day
       typically. Priya quotes on the call, with space already verified. Turnaround
       collapses from hours to the length of the conversation, which converts directly
       into win rate against forwarders still quoting by callback.

    3. THE RE-KEYING TAX — 39 FIELDS, TYPED ZERO TIMES.
       Every booking today is keyed three or four times across notepad, CRM, booking
       system and documents. Araxys extracts all 39 fields once from the transcript and
       renders the same values into all 12 documents. Documentation work drops from
       data entry to review-and-approve. Transcription errors do not reduce — they cease
       to have a source, because there is no transcription step left.

    4. SPACE SOLD CORRECTLY — THE LARGEST RUPEE NUMBER PER SHIPMENT.
       Estimating groupage space by volume is wrong in both directions, and both are
       expensive. Overestimate and you leave sellable floor empty on a container that
       sails anyway — pure margin forgone on a fixed-cost slot. Underestimate and the
       cargo does not fit at the CFS: it gets rolled to the next sailing, and you absorb
       storage, re-handling, a late delivery and a customer who now has a reason to call
       someone else. Araxys computes true floor consumption before the price is quoted, so
       containers sail full and bookings that were confirmed actually load.

    5. DOCUMENTS THAT DON'T COST YOU AN AMENDMENT.
       A wrong figure on a bill of lading is not a typo — it is a carrier amendment fee, a
       customs hold, or demurrage accruing while it is corrected. Araxys will not guess: a
       document with a missing required field renders as a visible DRAFT with the gap shown,
       rather than a confident-looking wrong number that clears internal review and fails
       at the port. The failure is moved from the terminal, where it costs money, to the
       desk, where it costs a phone call.

    6. LANGUAGE AS MARKET ACCESS, NOT AS A FEATURE.
       Serving Tamil-speaking exporters in Tamil does not make an existing customer
       marginally happier — it makes a customer who would not otherwise have transacted.
       The addressable base becomes the whole SME exporter market rather than the
       English-comfortable slice of it.

    COST STRUCTURE. A staffed desk scales linearly and is sized for peak, not average:
    headcount is set by the busiest hour and idle the rest of the day. Araxys has no per-seat
    cost — the marginal cost of one more call is a few seconds of speech recognition, one
    model pass and a post-call extraction. The desk cost curve goes from linear to nearly flat.

    WHAT IS MEASURED VS PROJECTED — stated plainly, because a judge will ask.
    Measured on the live system: 117 calls ingested end-to-end, 39 fields extracted per call,
    12 documents generating, ~790 ms to first LLM token, ~590 ms to first audio chunk, warm
    squad handoff verified on a real call, container space allocated automatically on booking.
    Projected: the revenue effects above follow from those mechanics applied to a forwarder's
    own call volume and margin. We have deliberately not invented a percentage uplift — the
    arithmetic is the forwarder's to run on their own numbers, and any figure we supplied
    would be a guess dressed as evidence.

---

## Presentation Drive URL

Generate from `docs/presentation-prompt.md`, export to PDF, upload to Drive, set sharing to
**Anyone with the link**.
