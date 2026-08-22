/**
 * Generates the live-shipments knowledge-base document from the CRM's shipment records.
 *
 * Why this exists: on the Gemini Live voice stack, webhook tool results are not reaching
 * the model (verified across many calls — the tool fires, returns correct data, and the
 * agent still invents). Retrieval from the knowledge base demonstrably DOES work on that
 * stack, so putting shipment facts into the knowledge base is the route that actually
 * reaches the agent.
 *
 * Written to be retrieved well: the BL number leads every block, appears in the heading,
 * and each block ends with a ready-made one-line answer the agent can speak verbatim.
 *
 *   npm run kb:shipments
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shipments } from "../src/data/mockData";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildShipmentKb(): string {
  const out: string[] = [];
  out.push("# Live shipment records — Araxys Logistics");
  out.push("");
  out.push(
    "Authoritative status for every shipment on our books. When a caller gives a BL number, " +
      "find that exact BL number below and answer only from its block. If a BL number is not " +
      "listed here, we have no record of it — say so and ask them to re-read the number. Never " +
      "answer about one shipment using another shipment's details, and never state a route, " +
      "status or date that does not appear in that shipment's own block."
  );
  out.push("");

  for (const s of shipments) {
    // Skip half-captured leads. A record with no real customer, a "TBD" carrier and no
    // real ETA is not a shipment the agent should ever recite — and this one is a Chennai
    // to Singapore placeholder, which is precisely the wrong thing to put in front of a
    // model that already has a habit of inventing Singapore.
    const placeholder =
      /unidentified|not captured|unknown/i.test(`${s.customerName} ${s.company}`) ||
      /tbd|pending/i.test(s.carrier) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.etaDate);
    if (placeholder) continue;

    const delivered = s.stage === "completed" && s.deliveredDate;
    const missing = s.documents.filter((d) => d.status === "missing");
    const received = s.documents.filter((d) => d.status === "received");

    out.push(`## BL number ${s.blNumber}`);
    out.push(`Shipment ${s.blNumber}. Also written ${s.blNumber.replace(/(.{4})/, "$1 ")}.`);
    out.push(`- Customer: ${s.customerName} (${s.company})`);
    out.push(`- Route: ${s.origin} to ${s.destination}`);
    out.push(`- Destination port: ${s.destination}`);
    out.push(`- Carrier: ${s.carrier}`);
    if (s.containerId) out.push(`- Container: ${s.containerId}`);
    out.push(`- Status: ${s.status.replace(/_/g, " ")}`);
    out.push(delivered ? `- Delivered on: ${s.deliveredDate}` : `- ETA: ${s.etaDate}`);
    if (s.freeDaysRemaining !== undefined) out.push(`- Free days remaining: ${s.freeDaysRemaining}`);
    if (s.demurrageStartDate) out.push(`- Demurrage starts: ${s.demurrageStartDate}`);
    out.push(
      missing.length
        ? `- Documents OUTSTANDING: ${missing.map((d) => d.name + (d.dueDate ? ` (due ${d.dueDate})` : "")).join(", ")}`
        : "- Documents outstanding: none"
    );
    if (received.length) out.push(`- Documents received: ${received.map((d) => d.name).join(", ")}`);
    if (s.quoteAmount) out.push(`- Agreed freight rate: Rs. ${s.quoteAmount.toLocaleString("en-IN")}`);
    out.push(
      `- Say this to the caller: ${s.blNumber} for ${s.company}, ${s.origin} to ${s.destination} on ${s.carrier}. ` +
        `Status ${s.status.replace(/_/g, " ")}. ` +
        (delivered ? `Delivered ${s.deliveredDate}.` : `ETA ${s.etaDate}.`) +
        (missing.length ? ` Outstanding: ${missing.map((d) => d.name).join(", ")}.` : "")
    );
    out.push("");
  }
  return out.join("\n");
}

const text = buildShipmentKb();
writeFileSync(join(__dirname, "..", "snapserve-setup", "kb-06-live-shipments.md"), text, "utf-8");
console.log(text);
