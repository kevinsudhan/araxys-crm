/**
 * Tells the agents who is ringing, and which language to open in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Both prompts already say "the CRM update block injected at the start of this
 * call may name the language this caller speaks with us -- if it does, open in
 * that language, greeting included". Nothing in v2 was writing that block, so
 * the sentence had nothing to read and every call opened in English. A caller
 * who rang in Tamil on Tuesday was greeted in English on Wednesday and had to
 * ask for Tamil again, which is the thing the rule exists to prevent.
 *
 * SnapServe keeps a per-number memory (POST /agents/{id}/caller-memory/{phone}
 * /facts). This fills it from what the calls table already knows.
 *
 * WHICH LANGUAGE WINS
 *
 * The most recent call that has one. Not a majority across their history --
 * a caller who switches to English has switched, and out-voting them with three
 * older Tamil calls would be the same failure in the other direction. The
 * transcript extraction records what the CALLER mostly spoke, not what the
 * agent answered in, so a call the agent got wrong still records it correctly.
 *
 * Mixed Tamil and English counts as Tamil. That is not a shortcut: mixing is
 * how people speak here, and both prompts already say a mixed call is a Tamil
 * call. Recording it as English would undo that on the next call.
 *
 * WHAT IS DELIBERATELY NOT SENT
 *
 * Anything about another customer, and anything not established. The note names
 * only this number's own caller, their own reference and their own route -- the
 * same scoping rule the prompts enforce from the other side.
 * ---------------------------------------------------------------------------
 */

const SNAP_BASE = Deno.env.get("SNAPSERVE_BASE_URL") ?? "https://app.snapserve.ai/api";
const SNAP_KEY = Deno.env.get("SNAPSERVE_API_KEY")!;

/** The two desks, so the documentation desk opens in the right language too. */
const AGENTS = [717, 758]; // Priya, Arun

type Spoken = "Tamil" | "Hindi" | "English";

/**
 * What the extraction wrote, reduced to something an agent can act on.
 *
 * The model returns free text ("Tamil / English", "Tamil and English"), so this
 * matches on the language being present rather than on an exact string.
 */
export function normaliseLanguage(raw: string | null | undefined): Spoken | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("tamil")) return "Tamil";
  if (s.includes("hindi")) return "Hindi";
  if (s.includes("english")) return "English";
  return null;
}

interface CallRow {
  language: string | null;
  customer_id: string | null;
  enquiry_ref: string | null;
  started_at: string | null;
}

interface CustomerRow {
  id: string;
  name: string | null;
  company: string | null;
}

interface EnquiryRow {
  ref: string;
  status: string;
  origin: string | null;
  destination: string | null;
  cargo: string | null;
  piece_count: number | null;
  piece_length_cm: number | null;
  piece_width_cm: number | null;
  piece_height_cm: number | null;
  weight_per_piece_kg: number | null;
  ready_date: string | null;
}

/**
 * What is still not known about this enquiry, in the words the agent will use.
 *
 * The point of a second call is usually the details the first one did not get.
 * Without this the agent opens knowing who is ringing and nothing about what is
 * outstanding, so it either starts again from the top or misses the gap
 * entirely -- both of which the caller experiences as us not listening the
 * first time.
 *
 * Deliberately the same list the CRM uses to decide an enquiry can be priced,
 * so what the agent chases and what the desk is waiting for cannot drift apart.
 */
function stillNeeded(e: EnquiryRow): string[] {
  const need: Array<[unknown, string]> = [
    [e.origin, "where it is shipping from"],
    [e.destination, "where it is going"],
    [e.cargo, "what the cargo is"],
    [e.piece_count, "how many pieces"],
    [e.piece_length_cm, "the length of one piece"],
    [e.piece_width_cm, "the width of one piece"],
    [e.piece_height_cm, "the height of one piece"],
    [e.weight_per_piece_kg, "the weight of one piece"],
    [e.ready_date, "when the cargo is ready"],
  ];
  return need.filter(([v]) => v === null || v === undefined || v === "").map(([, label]) => label);
}

/**
 * @param phones  Numbers touched by this ingest run, in any format.
 * @param db      The function's PostgREST helper -- returns parsed rows, and
 *                throws on a non-2xx, which is why each caller is wrapped
 *                separately below: one bad number must not abandon the rest.
 */
export async function syncCallerMemory(
  phones: Iterable<string>,
  // deno-lint-ignore no-explicit-any
  db: (path: string, init?: RequestInit) => Promise<any>
): Promise<{ synced: number; failed: string[] }> {
  const failed: string[] = [];
  let synced = 0;

  for (const raw of new Set(phones)) {
    const key = raw.replace(/\D/g, "").slice(-10);
    if (key.length < 10) continue;

    try {
      const calls: CallRow[] = await db(
        `calls?phone_key=eq.${key}&order=started_at.desc&limit=10` +
          `&select=language,customer_id,enquiry_ref,started_at`
      );

      if (!calls.length) continue;

      // The most recent call that recorded one. A call with no transcript
      // records nothing, and should not blank what an earlier one established.
      const language = calls.map((c) => normaliseLanguage(c.language)).find(Boolean) ?? null;

      const customerId = calls.map((c) => c.customer_id).find(Boolean) ?? null;
      if (!customerId) continue;

      const [customer]: CustomerRow[] = await db(
        `customers?id=eq.${customerId}&select=id,name,company`
      );
      if (!customer) continue;

      /**
       * The enquiry they are most likely ringing about: the newest one that is
       * still open. A closed enquiry is not what somebody rings back about, and
       * naming it would have the agent confirm details of finished business.
       */
      const open: EnquiryRow[] = await db(
        `enquiries?customer_id=eq.${customerId}&status=in.(new,qualifying,quoted,accepted)` +
          `&order=opened_at.desc&limit=1&select=ref,status,origin,destination,cargo,` +
          `piece_count,piece_length_cm,piece_width_cm,piece_height_cm,weight_per_piece_kg,ready_date`
      );
      const enquiry = open[0] ?? null;

      const who = customer.name || "this caller";
      const parts: string[] = [];

      // Language first. It governs the greeting, which is said before the agent
      // has read anything else.
      if (language === "Tamil") {
        parts.push(
          "This caller speaks TAMIL with us. Greet them in Tamil and hold the whole call in " +
            "Tamil, including the greeting, unless they switch to English themselves. " +
            "Mixing English trade words into Tamil sentences is normal and is not a switch."
        );
      } else if (language === "Hindi") {
        parts.push(
          "This caller speaks HINDI with us. Greet them in Hindi and hold the call in Hindi " +
            "unless they switch themselves."
        );
      } else if (language === "English") {
        parts.push("This caller speaks ENGLISH with us. Open in English.");
      }

      parts.push(
        `You have spoken to ${who}${customer.company ? ` of ${customer.company}` : ""} before` +
          ` — customer ${customer.id}. Do not ask whether they have emailed us; you know who they are.`
      );

      let missing: string[] = [];
      if (enquiry) {
        const route = [enquiry.origin, enquiry.destination].filter(Boolean).join(" to ");
        parts.push(
          `Their open enquiry is ${enquiry.ref}${route ? `, ${route}` : ""}` +
            `${enquiry.cargo ? `, ${enquiry.cargo}` : ""}, currently ${enquiry.status}. ` +
            `That IS their reference — never say a different one. ` +
            `If they ask about a different shipment, these facts do not apply.`
        );

        /**
         * The whole point of a call-back.
         *
         * Phrased as an instruction rather than a list of field names, because
         * the agent reads this aloud in substance and "piece_length_cm" is not
         * a question anybody asks. The "do not ask again" half matters as much
         * as the chase: a caller who gave the weight last week and is asked for
         * it again has learned that telling us things does not work.
         */
        missing = stillNeeded(enquiry);
        if (missing.length) {
          parts.push(
            `STILL MISSING on ${enquiry.ref}: ${missing.join(", ")}. ` +
              `Ask for these, one question at a time, and do NOT ask again for anything ` +
              `not on that list — we already have the rest and asking again tells them we ` +
              `were not listening the first time.`
          );
        } else {
          parts.push(
            `Nothing is outstanding on ${enquiry.ref}. Do not run through the cargo details ` +
              `again unless they want to change something.`
          );
        }
      }

      const note = parts.join(" ");

      const context: Record<string, string> = { known_customer: "yes", customer_id: customer.id };
      if (language) context.preferred_language = language;
      if (customer.name) context.customer_name = customer.name;
      if (customer.company) context.company = customer.company;
      if (enquiry) {
        context.reference = enquiry.ref;
        context.enquiry_status = enquiry.status;
        if (enquiry.origin) context.origin = enquiry.origin;
        if (enquiry.destination) context.destination = enquiry.destination;
        context.outstanding = missing.length ? missing.join("; ") : "nothing";
      }

      // Both agents, so a handoff mid-call does not drop back into English.
      let ok = true;
      for (const agentId of AGENTS) {
        const r = await fetch(
          `${SNAP_BASE}/agents/${agentId}/caller-memory/${encodeURIComponent(key)}/facts`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${SNAP_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ note, context }),
          }
        );
        if (!r.ok) {
          ok = false;
          failed.push(`${key}/${agentId}: ${r.status} ${(await r.text()).slice(0, 120)}`);
        }
      }
      if (ok) synced++;
    } catch (e) {
      failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { synced, failed };
}
