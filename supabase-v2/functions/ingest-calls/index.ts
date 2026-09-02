/**
 * Pulls completed calls from SnapServe into v2, and gives each one an enquiry.
 *
 * ---------------------------------------------------------------------------
 * HOW A CALLER IS IDENTIFIED
 *
 * In order, because the confidence differs and the record says which was used:
 *
 *   1. PHONE. The number matches a customer we already have. Certain.
 *
 *   2. REFERENCE. The caller read out a reference we had put in an email --
 *      "I mailed you, it's ARX-C0042-E01". That identifies the customer, and
 *      the number is then written onto their record, so the next call from it
 *      matches on phone alone. This is the bridge between somebody who mailed
 *      first and the same person ringing from a number nobody has seen.
 *
 *   3. NEITHER. A provisional customer is created from the number. Whoever
 *      picks the enquiry up can merge it once they know who called; guessing
 *      would attach a stranger's call to somebody else's file.
 *
 * The enquiry itself is only opened when the call is long enough to have been
 * a conversation. A twelve-second wrong number should not create a reference
 * and sit in the pipeline forever.
 * ---------------------------------------------------------------------------
 */

import { extractFromTranscript, fillBlanks, lastExtractionError } from "./extract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SNAP_KEY = Deno.env.get("SNAPSERVE_API_KEY")!;
const SNAP_BASE = Deno.env.get("SNAPSERVE_BASE_URL") ?? "https://app.snapserve.ai/api";

/** v2's agents. Calls to anything else belong to the live desk and are left alone. */
const V2_AGENTS = new Set([1071, 1072]);

/** Below this a call did not establish anything worth opening a file for. */
const MIN_SECONDS = 20;

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
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  return db(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
}

async function snap(path: string) {
  const r = await fetch(`${SNAP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${SNAP_KEY}` },
  });
  if (!r.ok) throw new Error(`snapserve ${r.status} on ${path}`);
  return r.json();
}

const digits = (s: string) => s.replace(/\D/g, "").slice(-10);

/** Our own reference, as a caller would read it out. */
const REF_RE = /ARX[\s-]*C\s*(\d{4})\s*-?\s*E\s*(\d{2})/i;

function referenceIn(text: string): string | null {
  const m = text.match(REF_RE);
  return m ? `ARX-C${m[1]}-E${m[2]}` : null;
}

interface SnapCall {
  id: number | string;
  agentId?: number;
  agentName?: string;
  direction?: string;
  fromNumber?: string;
  toNumber?: string;
  status?: string;
  durationSeconds?: number;
  transcript?: string | null;
  callSummary?: string | null;
  createdAt?: string;
  endedAt?: string | null;
}

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const report = {
    seen: 0,
    ingested: 0,
    enquiriesOpened: 0,
    phonesLinked: 0,
    skippedShort: 0,
    skippedSuppressed: 0,
    extracted: 0,
    fieldsFilled: 0,
    matched: { phone: 0, reference: 0, unmatched: 0 },
    errors: [] as string[],
  };

  try {
    const listed = await snap("/calls?limit=50");
    const calls: SnapCall[] = Array.isArray(listed)
      ? listed
      : (listed.calls ?? listed.data ?? []);

    /**
     * Only completed calls, and only v2's agents.
     *
     * A call picked up while it is still running arrives with a duration of
     * zero and no transcript. Storing that and then never looking again -- which
     * is what "skip anything we have already seen" does -- leaves it stuck as
     * an unidentified caller forever, which is exactly what happened to the
     * first real call to this desk.
     */
    const mine = calls.filter(
      (c) => V2_AGENTS.has(Number(c.agentId)) && String(c.status ?? "") === "completed"
    );
    report.seen = mine.length;

    const [existing, suppressed]: [
      Array<{ call_id: string; duration_secs: number; transcript: string | null }>,
      Array<{ call_id: string }>,
    ] = await Promise.all([
      db("calls?select=call_id,duration_secs,transcript"),
      db("suppressed_calls?select=call_id"),
    ]);

    // Complete means we have both a duration and a transcript. Anything less was
    // captured mid-flight and deserves another look now the call has ended.
    const complete = new Set(
      existing
        .filter((r) => Number(r.duration_secs) > 0 && (r.transcript ?? "").length > 0)
        .map((r) => r.call_id)
    );
    const ignored = new Set(suppressed.map((r) => r.call_id));

    for (const c of mine) {
      const callId = String(c.id);
      if (complete.has(callId)) continue;

      // Deliberately kept out. SnapServe will not delete a call, so forgetting
      // one means refusing to import it however many times it comes round.
      if (ignored.has(callId)) {
        report.skippedSuppressed++;
        continue;
      }

      // The list endpoint does not carry the transcript; the detail one does.
      let detail: SnapCall = c;
      try {
        detail = { ...c, ...(await snap(`/calls/${callId}`)) };
      } catch {
        // A transcript that will not load is not a reason to lose the call row.
      }

      const transcript = detail.transcript ?? "";
      const seconds = Number(detail.durationSeconds ?? 0);
      const from = detail.fromNumber ?? "";

      if (seconds < MIN_SECONDS) {
        report.skippedShort++;
        await db("calls", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            call_id: callId,
            agent_name: detail.agentName ?? "",
            direction: detail.direction ?? "inbound",
            from_number: from,
            to_number: detail.toNumber ?? "",
            status: detail.status ?? "",
            duration_secs: seconds,
            transcript,
            summary: detail.callSummary ?? "",
            started_at: detail.createdAt ?? null,
            ended_at: detail.endedAt ?? null,
            matched_by: "unmatched",
          }),
        });
        continue;
      }

      // ---- identify the caller -------------------------------------------
      let customer: { id: string; name: string } | null = null;
      let matchedBy: "phone" | "reference" | "unmatched" = "unmatched";
      let enquiryRef: string | null = null;

      const byPhone = await rpc("customer_by_phone", { p_phone: from });
      if (byPhone && byPhone.id) {
        customer = byPhone;
        matchedBy = "phone";
      }

      if (!customer) {
        /**
         * They mailed first and are ringing from a number we do not know.
         * Reading the reference out is what ties the two together, and the
         * number is written onto their record so it never has to happen twice.
         */
        const spoken = referenceIn(transcript);
        if (spoken) {
          const found: Array<{ ref: string; customer_id: string }> = await db(
            `enquiries?select=ref,customer_id&ref=eq.${encodeURIComponent(spoken)}`
          );
          if (found.length) {
            enquiryRef = found[0].ref;
            const linked = await rpc("link_phone_to_customer", {
              p_customer_id: found[0].customer_id,
              p_phone: from,
            });
            customer = linked;
            matchedBy = "reference";
            report.phonesLinked++;
          }
        }
      }

      if (!customer) {
        // Provisional, named by the number. Merging it later is a deliberate
        // act; attaching an unknown caller to somebody else's file is not.
        customer = await rpc("create_customer", {
          p_name: `Caller ${from || "unknown"}`,
          p_company: "",
          p_email: null,
          p_phone: from || null,
        });
      }

      report.matched[matchedBy]++;

      // ---- give it an enquiry ---------------------------------------------
      if (!enquiryRef && customer) {
        const open: Array<{ ref: string }> = await db(
          `enquiries?select=ref&customer_id=eq.${customer.id}` +
            `&status=in.(new,qualifying,quoted)&order=opened_at.desc&limit=1`
        );

        if (open.length) {
          // A caller with something already open is almost always ringing about
          // it. Opening a second reference would split one conversation in two.
          enquiryRef = open[0].ref;
        } else {
          const made = await rpc("create_enquiry", {
            p_customer_id: customer.id,
            p_source: "call",
            p_origin: null,
            p_destination: null,
            p_cargo: null,
          });
          enquiryRef = made.ref;
          report.enquiriesOpened++;
        }
      }

      /**
       * Read the conversation into the enquiry.
       *
       * This is what turns a call from a phone number and a wall of text into a
       * file somebody can act on. Extraction failing is not a reason to lose the
       * call -- the transcript is stored either way and the desk can read it.
       */
      const found = await extractFromTranscript(transcript, detail.createdAt);
      if (found.summary || found.origin || found.destination || found.cargo) report.extracted++;
      if (lastExtractionError()) report.errors.push(lastExtractionError()!);

      if (enquiryRef) {
        const [current] = await db(
          `enquiries?select=*&ref=eq.${encodeURIComponent(enquiryRef)}`
        );

        /**
         * Only blanks are filled. A second call that mentions the destination in
         * passing must not wipe the dimensions the first one established, and a
         * value somebody typed at the desk outranks one a model heard.
         */
        const patch = fillBlanks(current ?? {}, found as unknown as Record<string, unknown>, [
          "origin",
          "destination",
          "cargo",
          "incoterm",
          "piece_count",
          "piece_length_cm",
          "piece_width_cm",
          "piece_height_cm",
          "weight_per_piece_kg",
          "ready_date",
          "pickup_location",
          "consignee_name",
          "consignee_country",
          "special_handling",
        ]);

        // Volume and weight stay derived, never taken from the transcript.
        const l = (patch.piece_length_cm ?? current?.piece_length_cm) as number | null;
        const w = (patch.piece_width_cm ?? current?.piece_width_cm) as number | null;
        const h = (patch.piece_height_cm ?? current?.piece_height_cm) as number | null;
        const n = (patch.piece_count ?? current?.piece_count) as number | null;
        const kg = (patch.weight_per_piece_kg ?? current?.weight_per_piece_kg) as number | null;

        if (l && w && h && n) patch.volume_cbm = Number(((l * w * h * n) / 1_000_000).toFixed(2));
        if (kg && n) patch.gross_weight_kg = Number((kg * n).toFixed(2));

        // A call that establishes anything has moved the enquiry past "new".
        if (Object.keys(patch).length && current?.status === "new") patch.status = "qualifying";

        if (Object.keys(patch).length) {
          patch.updated_at = new Date().toISOString();
          await db(`enquiries?ref=eq.${encodeURIComponent(enquiryRef)}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(patch),
          });
          report.fieldsFilled += Object.keys(patch).length;
        }

        /**
         * A name the caller gave replaces "Caller 9188...", but only on a
         * provisional record. A customer somebody entered by hand is not
         * renamed because a transcript heard something else.
         */
        if (customer && found.customer_name && String(customer.name).startsWith("Caller ")) {
          await db(`customers?id=eq.${customer.id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              name: found.customer_name,
              ...(found.company ? { company: found.company } : {}),
              updated_at: new Date().toISOString(),
            }),
          });
        }

        // An address heard on the call is the bridge to their mail, so it goes
        // on the customer as soon as it is offered.
        if (customer && found.email) {
          await db("rpc/link_email_to_customer", {
            method: "POST",
            body: JSON.stringify({ p_customer_id: customer.id, p_email: found.email }),
          }).catch(() => {});
        }
      }

      await db("calls", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          call_id: callId,
          enquiry_ref: enquiryRef,
          customer_id: customer?.id ?? null,
          agent_name: detail.agentName ?? "",
          direction: detail.direction ?? "inbound",
          from_number: from,
          to_number: detail.toNumber ?? "",
          status: detail.status ?? "",
          duration_secs: seconds,
          language: found.language ?? "",
          transcript,
          summary: found.summary ?? detail.callSummary ?? "",
          started_at: detail.createdAt ?? null,
          ended_at: detail.endedAt ?? null,
          matched_by: matchedBy,
        }),
      });

      if (enquiryRef) {
        await db("enquiry_events", {
          method: "POST",
          body: JSON.stringify({
            enquiry_ref: enquiryRef,
            kind: "call",
            summary:
              found.summary?.slice(0, 300) ||
              detail.callSummary?.slice(0, 300) ||
              `${Math.round(seconds / 60)} minute call from ${from}`,
            detail: { call_id: callId, matched_by: matchedBy, seconds },
          }),
        });
      }

      report.ingested++;
    }

    // What was just learned should reach the agents before the next call.
    if (report.ingested > 0) {
      await fetch(`${SUPABASE_URL}/functions/v1/kb-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "ingest-calls" }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, ...report }), { headers: cors });
  } catch (e) {
    report.errors.push(e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ ok: false, ...report }), { status: 500, headers: cors });
  }
});
