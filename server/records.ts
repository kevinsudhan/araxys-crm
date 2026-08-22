/**
 * Single entry point for customer records.
 *
 * Uses Supabase when it is configured, and falls back to the local JSON file otherwise.
 * The fallback is not decoration: it means the demo still runs on a laptop with no
 * network, and a Supabase outage degrades to local storage rather than taking the whole
 * call flow down. Everything above this module is unaware of which one is active.
 */
import * as file from "./realRecords";
import * as db from "./supabase";
import type { RealRecord } from "./realRecords";

export type { RealRecord } from "./realRecords";
export { recordToKbBlock } from "./realRecords";

export function backend(): "supabase" | "file" {
  return db.supabaseConfigured() ? "supabase" : "file";
}

export async function listRecords(): Promise<RealRecord[]> {
  return backend() === "supabase" ? db.listRecords() : file.listRecords();
}

export async function findByAnything(q: string): Promise<RealRecord | undefined> {
  return backend() === "supabase" ? db.findByAnything(q) : file.findByAnything(q);
}

export async function upsertFromCall(input: Partial<RealRecord> & { phone: string }): Promise<RealRecord> {
  return backend() === "supabase" ? db.upsertFromCall(input) : file.upsertFromCall(input);
}

export async function deleteRecord(ref: string): Promise<boolean> {
  return backend() === "supabase" ? db.deleteRecord(ref) : file.deleteRecord(ref);
}

/**
 * The real-customer section of the knowledge base.
 *
 * This is the read path that actually reaches the agent — webhook tool results were
 * verified not to reach the model on the Gemini Live stack, while knowledge-base
 * retrieval demonstrably works.
 */
export async function buildRealRecordsKb(): Promise<string> {
  const recs = await listRecords();
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
  if (!recs.length) {
    out.push("No real customer records yet.");
    return out.join("\n");
  }
  for (const r of recs) {
    out.push(file.recordToKbBlock(r));
    out.push("");
  }
  return out.join("\n");
}
