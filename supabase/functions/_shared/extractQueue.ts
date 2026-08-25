/**
 * The extraction queue, and the knowledge refresh that has to follow it.
 *
 * Pulled out of the extract-fields endpoint so the call webhook can run the same work the
 * moment a call ends. Previously extraction only ever ran on its own five-minute cron,
 * which meant a customer could hang up and the agent would keep greeting them from a
 * knowledge pack that predated the conversation they just had.
 *
 * The refresh at the end is the point. Extraction writes new fields onto a customer
 * record and can move that record into the booking pipeline — both of which change what
 * the agent should know about this caller. Publishing that back is not an optimisation;
 * without it the agent's memory is stale exactly when it matters most, on the callback.
 */
import { extractRequestDetails, lastExtractionError } from "./extractFields.ts";
import { regexFieldsFor } from "./ingest.ts";
import { upsertRecord, autoPromote, syncKb, syncCallerMemory, syncSpaceKb, ensureReferenceSources } from "./records.ts";
import { autoBookSpace, type BookOutcome } from "./autoBook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${t}`);
  return t ? JSON.parse(t) : null;
}

const PENDING =
  "call_logs?select=call_id,from_number,transcript,duration_secs,direction,started_at" +
  "&direction=eq.inbound&transcript=not.is.null&duration_secs=gte.20" +
  "&or=(extracted.is.null,extracted->>extracted_by.not.like.llm*)";

export interface ExtractResult {
  extracted: number;
  recordsTouched: number;
  promoted: number;
  /** One line per promotion: whether space was allocated, or why it was not. */
  bookings: Array<{ ref: string } & BookOutcome>;
  remaining: number;
  refreshed: string[];
  extractionError: string | null;
}

/**
 * Reads the next batch of un-extracted calls, then republishes everything they changed.
 *
 * @param batch how many transcripts to read this run.
 * @param refresh whether to republish the knowledge packs afterwards. The cron leaves it
 *   on; a caller draining a large backlog can turn it off and refresh once at the end
 *   rather than rewriting the same documents after every batch.
 */
export async function extractPending(batch = 4, refresh = true): Promise<ExtractResult> {
  const pending = await db(`${PENDING}&order=started_at.desc&limit=${batch}`);

  let extracted = 0;
  let recordsTouched = 0;
  let promoted = 0;
  const bookings: Array<{ ref: string } & BookOutcome> = [];

  for (const row of pending ?? []) {
    const transcript = row.transcript as string;
    const callDate = row.started_at ? String(row.started_at).slice(0, 10) : undefined;

    const details = await extractRequestDetails(transcript, regexFieldsFor(transcript), callDate);

    await db(`call_logs?call_id=eq.${encodeURIComponent(row.call_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ extracted: details }),
    });
    extracted++;

    const phone = row.from_number ?? "";
    if (phone && !/^webcall/i.test(phone) && Object.keys(details.fields).length) {
      /**
       * The model's name and company overwrite the pattern extractor's.
       *
       * The regex reads "I am shipping machinery parts" and takes "Shipping Machinery
       * Parts" as a name, because "I am" is one of the phrases people introduce
       * themselves with. It landed on a real record that way. The model had Kevin right
       * in the same call, so where it has a value it wins -- the record column and the
       * extracted field should never disagree about who the customer is.
       */
      const f = details.fields;
      const rec = await upsertRecord({
        phone,
        source_call_id: String(row.call_id),
        request_details: f,
        source_language: details.source_language,
        ...(typeof f.customer_name === "string" ? { customer_name: f.customer_name } : {}),
        ...(typeof f.company === "string" ? { company: f.company } : {}),
        ...(typeof f.origin === "string" ? { origin: f.origin } : {}),
        ...(typeof f.destination === "string" ? { destination: f.destination } : {}),
        ...(typeof f.cargo_description === "string" ? { cargo_description: f.cargo_description } : {}),
      });
      recordsTouched++;

      // An enquiry with a named sailing date and an accepted quote is a booking. The
      // merged details are read from the record rather than this call's extraction: the
      // date may have come from one call and the acceptance from the next.
      const ref = (rec as { ref?: string } | null)?.ref;
      const merged = (rec as { request_details?: Record<string, unknown> } | null)?.request_details;
      if (ref && merged) {
        const p = await autoPromote(ref, merged, callDate);
        if (p.promoted) {
          promoted++;
          // Becoming a booking is what earns the space. Attempted here rather than inside
          // autoPromote so a refusal to allocate never undoes the promotion -- the call
          // did establish a booking even if the cargo will not fit that sailing, and the
          // desk needs to see it in the pipeline to act on it.
          const record = p.record as Record<string, unknown>;
          try {
            const outcome = await autoBookSpace({
              reference: ref,
              clientName: String(record.company ?? record.customerName ?? ref),
              origin: record.origin as string | undefined,
              destination: record.destination as string | undefined,
              sailingDate: String(record.sailingDate ?? ""),
              details: merged,
            });
            bookings.push({ ref, ...outcome });
            console.log(
              outcome.booked
                ? `[araxys] ${ref} allocated ${outcome.lengthM}m on ${outcome.slotId}`
                : `[araxys] ${ref} not allocated — ${outcome.reason}`,
            );
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            bookings.push({ ref, booked: false, reason });
            console.error(`[araxys] ${ref} allocation failed:`, reason);
          }
        }
      }
    }
  }

  const refreshed = refresh && recordsTouched > 0 ? await refreshKnowledge() : [];

  const remaining = await db(`${PENDING}&select=call_id&limit=200`);

  return {
    extracted,
    recordsTouched,
    promoted,
    bookings,
    remaining: (remaining ?? []).length,
    refreshed,
    extractionError: lastExtractionError(),
  };
}

/**
 * Republishes every pack the agent reads, so nothing it knows predates the last call.
 *
 * Three separate things, because they go stale for different reasons and one failing must
 * not silence the others:
 *
 *   customer records  — what the caller told us, and what stage their shipment is at.
 *   caller memory     — the per-number block injected before the agent speaks, including
 *                       the language they use with us.
 *   space availability — sailings and remaining floor, which a promotion can change and
 *                       which drifts on its own as cut-offs pass.
 *
 * Each is attempted independently and failures are reported rather than thrown: a call
 * has already happened and its data is already stored, so a knowledge-base hiccup should
 * not make the whole ingest look like it failed.
 */
export async function refreshKnowledge(): Promise<string[]> {
  const done: string[] = [];

  for (const [name, fn] of [
    ["customer-records", syncKb],
    ["caller-memory", syncCallerMemory],
    ["space-availability", syncSpaceKb],
    // Last, and every time: the packs above are rewritten here, and the reference packs
    // have twice been found detached from an agent by something outside this codebase.
    ["reference-packs", ensureReferenceSources],
  ] as const) {
    try {
      await fn();
      done.push(name);
    } catch (e) {
      console.error(`[araxys] refresh ${name} failed:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[araxys] knowledge refreshed: ${done.join(", ") || "nothing"}`);
  return done;
}
