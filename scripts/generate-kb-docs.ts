/**
 * KB doc generator — the CRM is the source of truth; these files are OUTPUT, never hand-edited.
 *
 * Regenerates every snapserve-setup/kb-*.md file directly from src/data/knowledgeBase.ts,
 * so there is exactly one place (the CRM) where container specs, pricing, cargo rules,
 * regulations, and sailing space live. SnapServe's public API has no endpoint to create or
 * update a knowledge source's content (confirmed: only list/attach/search exist) — so a
 * human still has to paste the regenerated text into the dashboard when it changes. That
 * paste is the one remaining manual step; everything upstream of it is now automated.
 *
 * Run: npm run sync:kb
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  containerSpecs,
  freightRates,
  cargoTypes,
  destinationRegulations,
  sailingSlots,
} from "../src/data/knowledgeBase";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "snapserve-setup");

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

function genContainerSpecs() {
  const rows = containerSpecs
    .map((c) => {
      const lines = [`## ${c.name} — code ${c.code}`];
      if (c.internalDimsM) {
        lines.push(`- Internal dimensions: ${c.internalDimsM.length}m long x ${c.internalDimsM.width}m wide x ${c.internalDimsM.height}m high`);
      }
      lines.push(`- Capacity: ${c.capacityCbm !== null ? `${c.capacityCbm} CBM` : "priced per unit (no fixed capacity)"}`);
      if (c.maxPayloadKg !== null) lines.push(`- Max payload: ${c.maxPayloadKg.toLocaleString("en-IN")} kg`);
      if (c.tareWeightKg !== null) lines.push(`- Tare weight: ${c.tareWeightKg.toLocaleString("en-IN")} kg`);
      if (c.tempRangeC) lines.push(`- Temperature range: ${c.tempRangeC.min}C to +${c.tempRangeC.max}C`);
      lines.push(`- Use case: ${c.useCase}`);
      return lines.join("\n");
    })
    .join("\n\n");

  return `# Container specifications

Reference data for container types Araxys books. Use this to answer questions about container size, capacity, weight limits, and which container fits a given cargo type.

${rows}

## Choosing a container -- quick guidance for the agent
- If the customer's cargo volume is under roughly 15 CBM, LCL is usually more economical than a full container.
- If cargo needs refrigeration or temperature control at any point, always route to 20RF or 40RF, never a dry van.
- If cargo is bulky but light (furniture, textiles) and volume exceeds ~60 CBM, prefer 40HC over 40GP for the extra height.
- If unsure which container fits, ask for approximate volume (CBM) and weight (kg), then match against the capacity and max payload figures above -- never let both limits be exceeded.
`;
}

function genPricing() {
  const byRoute = new Map<string, typeof freightRates>();
  for (const r of freightRates) {
    const key = `${r.origin} -> ${r.destination}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), r]);
  }

  const sections = [...byRoute.entries()]
    .map(([route, rates]) => {
      const transit = rates[0].transitDays;
      const table = [
        "| Container | Base rate | Negotiation band |",
        "|---|---|---|",
        ...rates.map((r) => {
          const base = r.unit === "per_cbm" ? `${fmtInr(r.baseRateInr)} / CBM (minimum ${r.minChargeCbm} CBM)` : `${fmtInr(r.baseRateInr)} / container`;
          return `| ${r.containerCode} | ${base} | ${r.negotiationFloorPct}% to +${r.negotiationCeilingPct}% |`;
        }),
      ].join("\n");
      const surcharges = rates[0].surcharges
        .map((s) => `${s.label} ${s.basis === "flat" ? fmtInr(s.amountInr) : `${s.amountInr}% of base`}`)
        .join(", ");
      return `## ${route} (transit ~${transit} days)\n${table}\n\nSurcharges: ${surcharges}.`;
    })
    .join("\n\n");

  return `# Route pricing & negotiation bands

Base freight, surcharges, and negotiation bands by route and container type. All rates in INR. Use this to quote prices and to know how far you're allowed to negotiate on a call without escalating to a human.

Negotiation band is expressed as a percentage off (or on top of) the base rate plus surcharges. Never quote below the floor. Never quote above the ceiling. If the customer pushes for a rate outside the band, tell them you'll need to check with the desk and escalate -- do not invent a number.

${sections}

## How to quote on a call
1. Get origin, destination, cargo volume (CBM) or weight, and whether it needs a full container or can go LCL.
2. Look up the matching route + container row above.
3. Add the listed surcharges to the base rate to get the standard quote.
4. If the customer has shipped with Araxys before, you may offer a discount within the negotiation band -- check their shipment history first; more past shipments justifies moving closer to the floor.
5. If they ask for something outside the band, say you'll confirm with the desk and follow up -- never guess or exceed the ceiling.
`;
}

function genCargoTypes() {
  const sections = cargoTypes
    .map((c) => {
      const docs = c.requiredDocuments
        .map((d) => `- ${d.name} (${d.mandatory ? "mandatory" : "conditional"}${d.notes ? ` -- ${d.notes}` : ""})`)
        .join("\n");
      const extra = [
        c.packagingRequirements ? `- Packaging requirement: ${c.packagingRequirements}` : null,
        c.specialHandling ? `- Special handling: ${c.specialHandling}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return `## ${c.name}\nExamples: ${c.exampleCommodities.join(", ")}.\n${docs}${extra ? `\n${extra}` : ""}`;
    })
    .join("\n\n");

  return `# Documents required by cargo type

Use this to answer "what documents do I need" questions. Always confirm the cargo type first, then list mandatory documents, then mention conditional ones only if relevant.

${sections}

## How to answer a documents question on a call
1. Ask what the cargo is if not already known from the shipment record.
2. Match it to the closest category above.
3. State the mandatory documents first, clearly, one at a time if the customer is writing them down.
4. Mention conditional documents only if they apply to the customer's specific destination or goods.
5. If a document is confirmed missing on the shipment record, tie it to the relevant free-time/demurrage deadline from the destination regulations reference before ending the call.
`;
}

function genDestinationRegulations() {
  const sections = destinationRegulations
    .map((d) => {
      const lines = [
        `## ${d.port}, ${d.country}`,
        `- Free days at terminal: ${d.freeDays}`,
        `- Detention rate after free time: ${fmtInr(d.detentionRateInrPerDay)}/day`,
        `- Demurrage rate: ${fmtInr(d.demurrageRateInrPerDay)}/day`,
        `- Certificates: ${d.certificateRequirements.join(", ")}`,
        `- Customs notes: ${d.customsNotes.join("; ")}`,
      ];
      if (d.restrictedGoodsNotes) lines.push(`- Restricted goods: ${d.restrictedGoodsNotes}`);
      return lines.join("\n");
    })
    .join("\n\n");

  return `# Destination customs & regulations

Free time, detention/demurrage rates, and certificate requirements by destination port. Use this to answer ETA-adjacent questions about customs risk and to calculate demurrage deadlines.

${sections}

## How to use this on a call
1. If a shipment's documents are missing, calculate the demurrage-start date as: arrival date + free days for that port.
2. Quote the detention/demurrage rate per day so the customer understands the cost of delay in concrete rupee terms -- this is the core of the proactive nudge.
3. If the customer asks about a specific certificate for their destination, check this list before answering; don't guess a requirement that isn't listed here.
4. Restricted-goods notes should be raised proactively during intake, before a booking is confirmed, not discovered after the container has departed.
`;
}

function genSpaceAvailability() {
  const byRoute = new Map<string, typeof sailingSlots>();
  for (const s of sailingSlots) {
    byRoute.set(s.route, [...(byRoute.get(s.route) ?? []), s]);
  }

  const sections = [...byRoute.entries()]
    .map(([route, slots]) => {
      const carrier = slots[0].carrier;
      const table = [
        "| Sailing date | Cutoff to book | Container | Mode |",
        "|---|---|---|---|",
        ...slots.map((s) => `| ${s.sailingDate} | ${s.cutoffDate} | ${s.containerCode} | ${s.mode} |`),
      ].join("\n");
      return `## ${route} (${carrier})\n${table}`;
    })
    .join("\n\n");

  return `# Sailing schedule (dates only -- space is checked live, not from this document)

This lists which sailings exist on each route and the booking cutoff for each. It deliberately does NOT list how much space is left, because that changes as bookings come in and any number written here would be stale within hours.

**How space is actually checked:** call the check-space tool with the route, the sailing date, and the cargo's dimensions (length, width, height in cm), quantity, and weight per piece. It answers from live booking state and works in three dimensions -- it accounts for how the pieces actually load into the container's internal envelope, whether they can be stacked, and whether the cargo must stay upright. Never estimate fit yourself by comparing CBM totals; a consignment can be well under the container's cubic capacity and still not fit because one piece is too tall to stand up or too long to turn.

This file is regenerated by \`npm run sync:kb\` from \`src/data/knowledgeBase.ts\` -- do not hand-edit it.

${sections}

## How to answer a space-availability question on a call
1. Get the route and the preferred sailing date (or "as soon as possible").
2. Get the cargo dimensions per piece, the number of pieces, and the weight per piece. Ask whether the pieces can be stacked, and whether the cargo has to stay upright -- both genuinely change the answer.
3. Call the check-space tool. Tell the customer what it returns, including the loading arrangement if it fits, and the booking cutoff date.
4. If it does not fit, say exactly why (too tall for the container, not enough floor length left, over the weight limit) rather than a bare "no", and offer the alternative sailing the tool suggests.
5. Bookings must be confirmed before the cutoff date, not the sailing date -- always state the cutoff.
6. If the tool cannot find the route or returns nothing usable, say you'll confirm with the desk and call back. Never invent a sailing or a space figure.
`;
}

const files: Record<string, () => string> = {
  "kb-01-container-specs.md": genContainerSpecs,
  "kb-02-pricing-negotiation.md": genPricing,
  "kb-03-documents-by-cargo-type.md": genCargoTypes,
  "kb-04-destination-regulations.md": genDestinationRegulations,
  "kb-05-space-availability-dummy.md": genSpaceAvailability,
};

for (const [name, gen] of Object.entries(files)) {
  const content = gen();
  writeFileSync(join(outDir, name), content, "utf-8");
  console.log(`wrote ${name} (${content.length} chars)`);
}
