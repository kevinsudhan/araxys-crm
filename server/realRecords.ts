/**
 * Real customer records — created from actual phone calls, as opposed to the seeded
 * demo data in src/data/mockData.ts.
 *
 * Two things drive the design here:
 *
 * 1. A BL number is NOT the identifier. A first-time caller has no BL — it only exists
 *    once a booking is actually made. So the durable key is the phone number, with the
 *    enquiry reference, name and company all usable as secondary handles. The agent must
 *    be able to recognise a returning caller who never finished the process.
 *
 * 2. These persist to disk. The demo data can reset freely, but a record created from a
 *    real customer call must survive a backend restart — losing it would mean telling a
 *    returning caller we have no idea who they are.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// ARAXYS_DATA_DIR lets a host point this at a mounted volume. Without it the data would
// sit on an ephemeral container filesystem and real customer records would vanish on the
// next deploy — which for a returning caller means we no longer know who they are.
const DATA_DIR = process.env.ARAXYS_DATA_DIR ?? join(__dirname, "..", "data");
const STORE = join(DATA_DIR, "real-records.json");

/** processing = still moving through the pipeline; processed = finished. */
export type RecordStage = "processing" | "processed";

export interface RealRecord {
  /** Enquiry reference, issued immediately — exists before any BL number does. */
  ref: string;
  /** Primary identity. Normalised to last 10 digits for matching. */
  phone: string;
  customerName?: string;
  company?: string;
  /** Only present once a booking is actually confirmed. */
  blNumber?: string;
  stage: RecordStage;
  status: string;
  origin?: string;
  destination?: string;
  cargoDescription?: string;
  volumeCbm?: number;
  containerType?: string;
  quotedAmountInr?: number;
  agreedAmountInr?: number;
  sailingDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Which call created this, for tracing back to a transcript. */
  sourceCallId?: string;
}

let records: RealRecord[] = [];

export function phoneKey(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-10);
}

function load() {
  try {
    if (existsSync(STORE)) records = JSON.parse(readFileSync(STORE, "utf-8"));
  } catch (e) {
    console.warn("[araxys] could not read real-records store:", e);
    records = [];
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE, JSON.stringify(records, null, 2), "utf-8");
  } catch (e) {
    console.error("[araxys] FAILED to persist real records:", e);
  }
}

load();

function nextRef(): string {
  const n = records.length + 1;
  return `ARX-ENQ-${String(n).padStart(4, "0")}`;
}

export function listRecords(): RealRecord[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findByPhone(phone: string): RealRecord | undefined {
  const key = phoneKey(phone);
  if (key.length < 10) return undefined;
  return records.find((r) => phoneKey(r.phone) === key);
}

/** Matches on any handle a caller might actually give: ref, BL, phone, name or company. */
export function findByAnything(q: string): RealRecord | undefined {
  const raw = String(q ?? "").trim();
  if (!raw) return undefined;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const target = norm(raw);

  const byPhone = findByPhone(raw);
  if (byPhone) return byPhone;

  return records.find(
    (r) =>
      norm(r.ref) === target ||
      (r.blNumber && norm(r.blNumber) === target) ||
      (r.customerName && norm(r.customerName) === target) ||
      (r.company && norm(r.company) === target) ||
      (r.company && target.length > 3 && norm(r.company).includes(target))
  );
}

/**
 * Creates a record for a new caller, or updates the existing one for that phone.
 * Matching on phone is what lets a caller who never finished the process be recognised
 * next time without needing any reference number at all.
 */
export function upsertFromCall(input: Partial<RealRecord> & { phone: string }): RealRecord {
  const now = new Date().toISOString();
  const existing = findByPhone(input.phone);

  if (existing) {
    // Only overwrite fields that actually arrived; a later call shouldn't blank earlier facts.
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && v !== null && v !== "" && k !== "ref" && k !== "createdAt") {
        (existing as Record<string, unknown>)[k] = v;
      }
    }
    existing.updatedAt = now;
    persist();
    console.log(`[araxys] real record UPDATED ${existing.ref} (${existing.phone})`);
    return existing;
  }

  const rec: RealRecord = {
    ref: nextRef(),
    phone: input.phone,
    customerName: input.customerName,
    company: input.company,
    blNumber: input.blNumber,
    // Everything is "processing" until the pipeline is actually built out end to end.
    stage: "processing",
    status: input.status ?? "enquiry received",
    origin: input.origin,
    destination: input.destination,
    cargoDescription: input.cargoDescription,
    volumeCbm: input.volumeCbm,
    containerType: input.containerType,
    quotedAmountInr: input.quotedAmountInr,
    agreedAmountInr: input.agreedAmountInr,
    sailingDate: input.sailingDate,
    notes: input.notes,
    sourceCallId: input.sourceCallId,
    createdAt: now,
    updatedAt: now,
  };
  records.push(rec);
  persist();
  console.log(`[araxys] real record CREATED ${rec.ref} (${rec.phone})`);
  return rec;
}

export function deleteRecord(ref: string): boolean {
  const i = records.findIndex((r) => r.ref === ref);
  if (i < 0) return false;
  records.splice(i, 1);
  persist();
  return true;
}

/** One block per record, written so retrieval can hit on phone, name, company, ref or BL. */
export function recordToKbBlock(r: RealRecord): string {
  const digits = phoneKey(r.phone);
  const lines: string[] = [];
  lines.push(`## Customer ${r.company ?? r.customerName ?? r.ref} — reference ${r.ref}`);
  lines.push(
    `Identifiers for this customer: reference ${r.ref}; phone ${r.phone}; phone ${digits}; phone +91${digits}` +
      (r.blNumber ? `; BL number ${r.blNumber}` : "; no BL number issued yet")
  );
  if (r.customerName) lines.push(`- Contact name: ${r.customerName}`);
  if (r.company) lines.push(`- Company: ${r.company}`);
  lines.push(`- Reference number: ${r.ref}`);
  lines.push(r.blNumber ? `- BL number: ${r.blNumber}` : `- BL number: not issued yet (booking not completed)`);
  lines.push(`- Stage: ${r.stage}`);
  lines.push(`- Status: ${r.status}`);
  if (r.origin && r.destination) lines.push(`- Route: ${r.origin} to ${r.destination}`);
  if (r.cargoDescription) lines.push(`- Cargo: ${r.cargoDescription}`);
  if (r.volumeCbm !== undefined) lines.push(`- Volume: ${r.volumeCbm} CBM`);
  if (r.containerType) lines.push(`- Container type: ${r.containerType}`);
  if (r.quotedAmountInr) lines.push(`- Quoted: Rs. ${r.quotedAmountInr.toLocaleString("en-IN")}`);
  if (r.agreedAmountInr) lines.push(`- Agreed rate: Rs. ${r.agreedAmountInr.toLocaleString("en-IN")}`);
  if (r.sailingDate) lines.push(`- Sailing date: ${r.sailingDate}`);
  if (r.notes) lines.push(`- Notes: ${r.notes}`);
  lines.push(`- First contact: ${r.createdAt.slice(0, 10)}, last updated: ${r.updatedAt.slice(0, 10)}`);

  const who = r.customerName ?? r.company ?? "this caller";
  const route = r.origin && r.destination ? `${r.origin} to ${r.destination}` : "route not yet confirmed";
  lines.push(
    `- Say this to the caller: ${who}, reference ${r.ref}. ${route}. ` +
      `Currently ${r.stage}, ${r.status}.` +
      (r.blNumber ? ` BL number ${r.blNumber}.` : ` No BL number yet — booking not completed.`)
  );
  return lines.join("\n");
}

/** The whole real-customer section of the knowledge base. */
export function buildRealRecordsKb(): string {
  const out: string[] = [];
  out.push("# Real customer records — Araxys Logistics");
  out.push("");
  out.push(
    "These are live customers who have actually contacted us. IMPORTANT: recognise a caller by " +
      "ANY of these — their phone number (the number they are calling from), their reference number, " +
      "their company name, their contact name, or a BL number if one has been issued. Most customers " +
      "here have NO BL number yet because their booking is not finished; never tell such a caller we " +
      "have no record of them just because they cannot give a BL number. Match on the phone number " +
      "they are calling from first."
  );
  out.push("");
  const recs = listRecords();
  if (!recs.length) {
    out.push("No real customer records yet.");
    return out.join("\n");
  }
  for (const r of recs) {
    out.push(recordToKbBlock(r));
    out.push("");
  }
  return out.join("\n");
}
