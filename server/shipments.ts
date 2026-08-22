/**
 * Shipment lookup — the agent's only legitimate source of shipment facts.
 *
 * The rule this file exists to enforce: the agent may state a status, ETA, document
 * position, free-time figure or charge ONLY if it came from here. Anything not present
 * in a record is returned as an explicit absence, never as an empty string the model
 * might paper over. A caller being told "I don't have that in front of me" is a correct
 * outcome; a caller being told a plausible invented ETA is a serious failure.
 */
import { shipments } from "../src/data/mockData";
import type { Shipment } from "../src/types";

/** Phone numbers arrive as +91 98765 43210, 919876543210, 09876543210 — compare by last 10 digits. */
export function phoneKey(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.slice(-10);
}

function normaliseBl(raw: string): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function findByBl(bl: string): Shipment | null {
  const target = normaliseBl(bl);
  if (!target) return null;
  return shipments.find((s) => normaliseBl(s.blNumber) === target) ?? null;
}

export function findByPhone(phone: string): Shipment[] {
  const key = phoneKey(phone);
  if (key.length < 10) return [];
  return shipments.filter((s) => phoneKey(s.phone) === key);
}

/**
 * What the agent is allowed to say about a shipment, with every field explicitly
 * present-or-absent. `unknown_fields` is deliberately part of the payload so the model
 * is told what it does NOT know, rather than left to guess.
 */
export interface ShipmentFacts {
  found: true;
  bl_number: string;
  customer_name: string;
  company: string;
  origin: string;
  destination: string;
  carrier: string;
  stage: string;
  status: string;
  eta_date: string;
  delivered_date: string | null;
  container_id: string | null;
  free_days_remaining: number | null;
  demurrage_start_date: string | null;
  quoted_amount_inr: number | null;
  documents_received: string[];
  documents_missing: Array<{ name: string; due_date: string | null }>;
  documents_generated: string[];
  latest_milestone: string | null;
  next_milestone: string | null;
  pickup: { date: string; window: string; confirmed: boolean } | null;
  delivery: { date: string; window: string; confirmed: boolean } | null;
  unknown_fields: string[];
  spoken_summary: string;
}

export interface ShipmentNotFound {
  found: false;
  reason: "no_match" | "no_identifier";
  spoken_answer: string;
  /** Present when the model must be stopped from answering out of injected caller memory. */
  hard_stop?: string;
}

export function factsFor(s: Shipment): ShipmentFacts {
  const unknown: string[] = [];
  if (s.freeDaysRemaining === undefined) unknown.push("free days remaining");
  if (!s.demurrageStartDate) unknown.push("demurrage start date");
  if (!s.containerId) unknown.push("container number");
  if (!s.pickup) unknown.push("pickup schedule");
  if (!s.delivery) unknown.push("delivery schedule");

  const done = s.timeline.filter((t) => t.state === "done");
  const latest = done.length ? done[done.length - 1] : null;
  const next = s.timeline.find((t) => t.state === "current") ?? s.timeline.find((t) => t.state === "pending") ?? null;

  const missing = s.documents
    .filter((d) => d.status === "missing")
    .map((d) => ({ name: d.name, due_date: d.dueDate ?? null }));

  const parts: string[] = [
    `${s.blNumber} for ${s.company}, ${s.origin} to ${s.destination} on ${s.carrier}.`,
    `Current status is ${s.status.replace(/_/g, " ")}.`,
  ];
  if (s.stage === "completed" && s.deliveredDate) parts.push(`It was delivered on ${s.deliveredDate}.`);
  else parts.push(`ETA is ${s.etaDate}.`);

  if (missing.length) {
    const m = missing.map((d) => (d.due_date ? `${d.name} (due ${d.due_date})` : d.name)).join(", ");
    parts.push(`Outstanding documents: ${m}.`);
  }
  if (s.freeDaysRemaining !== undefined && s.demurrageStartDate) {
    parts.push(`${s.freeDaysRemaining} free days left; demurrage would start ${s.demurrageStartDate}.`);
  }

  return {
    found: true,
    bl_number: s.blNumber,
    customer_name: s.customerName,
    company: s.company,
    origin: s.origin,
    destination: s.destination,
    carrier: s.carrier,
    stage: s.stage,
    status: s.status,
    eta_date: s.etaDate,
    delivered_date: s.deliveredDate ?? null,
    container_id: s.containerId ?? null,
    free_days_remaining: s.freeDaysRemaining ?? null,
    demurrage_start_date: s.demurrageStartDate ?? null,
    quoted_amount_inr: s.quoteAmount || null,
    documents_received: s.documents.filter((d) => d.status === "received").map((d) => d.name),
    documents_missing: missing,
    documents_generated: s.documents.filter((d) => d.status === "generated").map((d) => d.name),
    latest_milestone: latest ? `${latest.label} (${latest.date})` : null,
    next_milestone: next ? `${next.label} (${next.date})` : null,
    pickup: s.pickup ?? null,
    delivery: s.delivery ?? null,
    unknown_fields: unknown,
    spoken_summary: parts.join(" "),
  };
}

export function lookup(args: { bl_number?: string; phone?: string }): ShipmentFacts | ShipmentNotFound {
  const { phone } = args;
  // The tool schema requires bl_number and tells the model to send "NONE" when the caller
  // genuinely hasn't got one — treat that (and any blank) as "fall back to the phone".
  const raw = String(args.bl_number ?? "").trim();
  const bl_number = /^(none|null|unknown|n\/a|-)$/i.test(raw) ? "" : raw;

  if (bl_number) {
    const hit = findByBl(bl_number);
    if (hit) return factsFor(hit);
    return {
      found: false,
      reason: "no_match",
      spoken_answer: `I'm not finding ${bl_number} on our system. Could you read that number back to me, or give me the company name it was booked under instead?`,
    };
  }

  if (phone) {
    const hits = findByPhone(phone);
    if (hits.length === 1) return factsFor(hits[0]);
    if (hits.length > 1) {
      const active = hits.filter((h) => h.stage === "in_process");
      if (active.length === 1) return factsFor(active[0]);
      return {
        found: false,
        reason: "no_match",
        spoken_answer: `I can see ${hits.length} shipments against this number — ${hits
          .map((h) => h.blNumber)
          .join(", ")}. Which one are you calling about?`,
      };
    }
    return {
      found: false,
      reason: "no_match",
      spoken_answer: `I don't have any shipments against this number. Do you have a BL number handy?`,
    };
  }

  return {
    found: false,
    reason: "no_identifier",
    spoken_answer: "Could you give me the BL number for the shipment you're asking about?",
    hard_stop:
      "You called this tool without a bl_number or phone, so NOTHING was looked up. You have no facts " +
      "about any shipment from this call. Do NOT answer from the CRM update block injected earlier — " +
      "that describes this caller's own most recent shipment, which may be a completely different " +
      "shipment from the one they just asked about. Ask for the BL number and call this tool again " +
      "with it before saying anything about status, route, ETA or documents.",
  };
}

export function allShipments(): Shipment[] {
  return shipments;
}
