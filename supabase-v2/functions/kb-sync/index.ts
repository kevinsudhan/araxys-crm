/**
 * Republishes v2's knowledge packs from v2's database.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS ON A SERVER
 *
 * It needs the SnapServe API key and the Supabase service key, and neither can
 * live in a browser bundle. That is the whole reason this is an Edge Function
 * rather than something the CRM does directly.
 *
 * WHY IT UPDATES RATHER THAN RECREATES
 *
 * v1 refreshed a pack by deleting the knowledge source and creating a new one.
 * Deleting detaches it from every agent, so everything rests on the re-attach
 * afterwards -- and when that partly failed, the live agent answered calls with
 * two of its seven packs, once without the rate card, and quoted a figure it
 * had invented.
 *
 * There is also a window in that approach where the source does not exist at
 * all. A call landing inside it gets an agent silently missing a pack.
 *
 * This writes through the entry-level route instead: PATCH on an existing entry
 * changes the content in place. The source id never moves, the attachment is
 * never disturbed, and there is no window.
 * ---------------------------------------------------------------------------
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SNAP_KEY = Deno.env.get("SNAPSERVE_API_KEY")!;
const SNAP_BASE = Deno.env.get("SNAPSERVE_BASE_URL") ?? "https://app.snapserve.ai/api";

/** The packs generated from live data. Reference packs are edited by hand. */
const DYNAMIC = {
  customers: "Araxys v2 — customer records",
  space: "Araxys v2 — container space availability",
  partners: "Araxys v2 — partner network",
};

async function db(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function snap(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SNAP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SNAP_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: r.ok, status: r.status, body };
}

// ---------------------------------------------------------------------------
// Pack: customers
// ---------------------------------------------------------------------------

interface CustomerRow {
  id: string;
  name: string;
  company: string;
  phones: string[];
  emails: string[];
}

interface EnquiryRow {
  ref: string;
  customer_id: string;
  status: string;
  origin: string | null;
  destination: string | null;
  cargo: string | null;
  volume_cbm: string | null;
  gross_weight_kg: string | null;
  piece_count: number | null;
  updated_at: string;
}

interface QuoteRow {
  enquiry_ref: string;
  amount_inr: string;
  status: string;
  sailing_date: string | null;
}

function customerPack(
  customers: CustomerRow[],
  enquiries: EnquiryRow[],
  quotes: QuoteRow[]
): string {
  if (!customers.length) return "No customer records yet.";

  const L: string[] = [
    "CUSTOMER RECORDS. Each block below belongs to ONE customer and one phone number.",
    "",
    "Every record here is a different customer. Do NOT read any part of one to a caller",
    "it does not belong to. If the caller-memory block injected at the start of the call",
    "names a reference, that one is the caller's and none of these others are.",
    "",
  ];

  for (const c of customers) {
    const theirs = enquiries.filter((e) => e.customer_id === c.id);
    if (!theirs.length) continue;

    L.push(`### ${c.company || c.name}`);
    L.push(`- WHOSE RECORD THIS IS: ${c.name}, calling from ${c.phones.join(" or ") || "an unlisted number"}.`);
    L.push(`  Say this ONLY to the owner named on this line, and to nobody else.`);
    if (c.emails.length) L.push(`- Email: ${c.emails.join(", ")}`);

    for (const e of theirs) {
      const route = [e.origin, e.destination].filter(Boolean).join(" to ") || "route not yet given";
      const q = quotes.find((x) => x.enquiry_ref === e.ref);

      const bits = [`reference ${e.ref}`, route];
      if (e.cargo) bits.push(e.cargo);
      if (e.piece_count) bits.push(`${e.piece_count} pieces`);
      if (e.volume_cbm) bits.push(`${e.volume_cbm} CBM`);
      if (e.gross_weight_kg) bits.push(`${e.gross_weight_kg} kg gross`);

      L.push(`- ${bits.join(", ")}. Currently ${e.status}.`);

      if (q) {
        const money = `₹${Number(q.amount_inr).toLocaleString("en-IN")}`;
        L.push(
          q.status === "accepted"
            ? `  Quoted ${money} and the customer accepted${q.sailing_date ? `, sailing ${q.sailing_date}` : ""}.`
            : `  Quoted ${money}, ${q.status}. This is not a booking until they accept.`
        );
      } else {
        L.push(`  Not yet quoted.`);
      }
    }
    L.push("");
  }

  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Pack: partners
//
// What the desk can actually service, and through whom.
//
// A caller asking "do you handle textiles into Singapore?" is asking whether we
// have an agent there. Until now the agents had no way to know, so the honest
// answer was always "let me check with the desk" -- for a question the CRM
// could already answer.
//
// CONTACT DETAILS ARE DELIBERATELY LEFT OUT. Emails and phone numbers are what
// turn a leaked name into a customer going direct next time, and a voice agent
// has no use for them: it never writes to a partner. Names are included, because
// coverage without them is not the partner list the desk asked for, and the
// prompt below is explicit that they are not to be spoken.
// ---------------------------------------------------------------------------

interface PartnerRow {
  id: string;
  name: string;
  organisation: string;
  role: string;
  tags: string[];
  notes: string;
  active: boolean;
}

interface AssignmentRow {
  enquiry_ref: string;
  role: string;
}

const ROLE_WORDS: Record<string, string> = {
  overseas_agent: "overseas agent",
  consol_partner: "consol partner",
  carrier: "carrier / shipping line",
  cha_customs: "CHA / customs broker",
  cfs_transport: "CFS / transport",
  other: "other",
};

function partnerPack(partners: PartnerRow[], assignments: AssignmentRow[]): string {
  const live = partners.filter((p) => p.active);
  if (!live.length) {
    return [
      "PARTNER NETWORK",
      "",
      "No partners are on file yet. Do not claim we have an agent anywhere.",
      "If a caller asks whether we cover a lane, say the desk will confirm and come back to them.",
    ].join("\n");
  }

  const lines: string[] = [
    "PARTNER NETWORK -- WHAT WE CAN SERVICE, AND THROUGH WHOM",
    "",
    "HOW TO USE THIS ON A CALL:",
    "- You may confirm we handle a place, a cargo or a service when it appears below. That is what this list is for.",
    "- NEVER give a caller a partner name, email or phone number, and never offer to put them in touch. They are our counterparties, not the customer's. A customer handed our agent's details goes direct next time.",
    "- If a lane or a cargo is NOT below, we have nobody for it. Say the desk will confirm and call back. Do not invent an agent, and do not assume coverage from a nearby port.",
    "- This list says who we work with. It does not say a booking exists, and it is never the answer to a question about a shipment status.",
    "",
    "WHAT WE COVER:",
  ];

  // Aggregated first, because a caller asks about a place or a cargo, not about
  // a company. The tags are the desk's own words for what each partner is good
  // for, so they are exactly the vocabulary a caller will use.
  const byTag = new Map<string, Set<string>>();
  for (const p of live) {
    for (const t of p.tags) {
      const key = t.trim();
      if (!key) continue;
      const k = key.toLowerCase();
      if (!byTag.has(k)) byTag.set(k, new Set());
      byTag.get(k)!.add(ROLE_WORDS[p.role] ?? p.role);
    }
  }

  if (byTag.size) {
    for (const [tag, roles] of [...byTag.entries()].sort()) {
      lines.push(`- ${tag}: covered by our ${[...roles].sort().join(" and ")}.`);
    }
  } else {
    lines.push("- Nothing tagged yet, so no lane or cargo can be confirmed from this list.");
  }

  lines.push("", "WHO WE WORK WITH (internal -- do not say these names to a caller):");
  const byRole = new Map<string, PartnerRow[]>();
  for (const p of live) {
    const r = ROLE_WORDS[p.role] ?? p.role;
    if (!byRole.has(r)) byRole.set(r, []);
    byRole.get(r)!.push(p);
  }
  for (const [role, rows] of [...byRole.entries()].sort()) {
    lines.push(`${role.toUpperCase()}:`);
    for (const p of rows.sort((a, b) =>
      (a.organisation || a.name).localeCompare(b.organisation || b.name)
    )) {
      const who = p.organisation || p.name;
      const good = p.tags.length ? ` -- ${p.tags.join(", ")}` : "";
      const note = p.notes.trim() ? ` (${p.notes.trim()})` : "";
      lines.push(`- ${who}${good}${note}`);
    }
  }

  /**
   * Which enquiries already have somebody on them, by role only.
   *
   * Enough for "yes, that is with our overseas agent now" without naming them,
   * and it stops the agent implying nothing has happened on a shipment that has
   * in fact been handed on.
   */
  if (assignments.length) {
    const byRef = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!byRef.has(a.enquiry_ref)) byRef.set(a.enquiry_ref, new Set());
      byRef.get(a.enquiry_ref)!.add(ROLE_WORDS[a.role] ?? a.role);
    }
    lines.push("", "ENQUIRIES ALREADY WITH A PARTNER (say the role, never the company):");
    for (const [ref, roles] of [...byRef.entries()].sort()) {
      lines.push(`- ${ref}: with our ${[...roles].sort().join(" and ")}.`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Pack: space
// ---------------------------------------------------------------------------

interface SpaceRow {
  id: string;
  route: string;
  carrier: string;
  container_code: string;
  sailing_date: string;
  cutoff_date: string | null;
  status: string;
  container_length_m: string;
  container_width_m: string;
  container_height_m: string;
  consignments: number;
  free_length_m: string;
  free_payload_kg: string;
  free_cbm: string;
}

/**
 * The sailing board, as one entry per route.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SPLIT
 *
 * SnapServe's embedding provider is rejecting our key, so these packs fall back
 * to keyword search ("Smart matching paused" in the console). Keyword search
 * matches whole ENTRIES, and the whole board was a single entry -- so a question
 * about a Singapore sailing matched on words like "sailing" and "cut-off",
 * which appear identically under every route, and the agent got whichever block
 * came first. Colombo sat at the top, and Colombo's dates are what a Singapore
 * caller was told, twice.
 *
 * One entry per route gives keyword search something to discriminate on: the
 * destination is in the title, in the keywords, and on every line of the body.
 * A separate index entry carries the whole timetable for "what dates do you
 * have" questions that name no port.
 *
 * This is a workaround for a provider outage, not a better design in principle.
 * When embedding resumes it does no harm -- the entries stay correct and simply
 * get matched more intelligently.
 * ---------------------------------------------------------------------------
 */
function spaceEntries(rows: SpaceRow[]): Array<{ title: string; content: string; keywords: string }> {
  if (!rows.length) {
    return [
      {
        title: "Sailings by destination",
        content: "No sailings on the board yet. There is no space to offer.",
        keywords: "sailing, sailings, schedule, space, cut-off",
      },
    ];
  }

  const byRoute = new Map<string, SpaceRow[]>();
  for (const r of rows) {
    if (!byRoute.has(r.route)) byRoute.set(r.route, []);
    byRoute.get(r.route)!.push(r);
  }
  for (const list of byRoute.values()) {
    list.sort((a, b) => a.sailing_date.localeCompare(b.sailing_date));
  }

  const routes = [...byRoute.entries()].sort();

  /** "Chennai to Singapore" -> "Singapore", which is what a caller actually says. */
  const destOf = (route: string) => route.split(/\s+to\s+/i).pop()?.trim() ?? route;

  const index = [
    "SAILINGS BY DESTINATION. Live, republished after every change.",
    "",
    "Find the caller's DESTINATION on this list and use only the line that names it.",
    "Each route is a different ship to a different port. A date listed under one",
    "destination is never available for another.",
    "",
    ...routes.map(([route, sailings]) => {
      const parts = sailings.map(
        (s) => `sails ${s.sailing_date}${s.cutoff_date ? ` (book by ${s.cutoff_date})` : ""}`
      );
      return `- ${route}: ${parts.join("; ")}`;
    }),
    "",
    "If a destination is not on this list, we have no sailing for it and you say so.",
  ].join("\n");

  const entries = [
    {
      title: "Sailings by destination — all routes",
      content: index,
      keywords: [
        "sailing",
        "sailings",
        "schedule",
        "dates",
        "cut-off",
        "cutoff",
        "when",
        ...routes.map(([r]) => destOf(r)),
      ].join(", "),
    },
  ];

  for (const [route, sailings] of routes) {
    const dest = destOf(route);
    const L: string[] = [
      `${route.toUpperCase()} — SAILINGS AND SPACE`,
      "",
      `Every line below is for ${route} and no other route.`,
      "",
      "Groupage space is sold by FLOOR LENGTH, not by volume. The free metres are what",
      "is actually bookable, and a consignment fits only if it fits in three dimensions:",
      "check the tallest piece against the container height before anything else.",
      "",
    ];
    for (const s of sailings) {
      const tag = `[${route}]`;
      L.push(
        `${tag} sailing ${s.sailing_date}` +
          `${s.cutoff_date ? ` — booking cut-off ${s.cutoff_date}` : ""}` +
          ` — ${s.carrier || "carrier not set"} ${s.container_code} — status ${s.status}`
      );
      L.push(
        `${tag} sailing ${s.sailing_date} — FREE ${s.free_length_m} m of floor, ` +
          `${s.free_cbm} CBM, ${s.free_payload_kg} kg payload, ` +
          `${s.consignments} consignment${s.consignments === 1 ? "" : "s"} already loaded`
      );
      L.push(
        `${tag} sailing ${s.sailing_date} — container internals ${s.container_length_m} m long, ` +
          `${s.container_width_m} m wide, ${s.container_height_m} m high`
      );
      L.push("");
    }
    entries.push({
      title: `${route} — sailings and space`,
      content: L.join("\n"),
      keywords: [
        dest,
        route,
        `to ${dest}`,
        "sailing",
        "cut-off",
        "space",
        ...new Set(sailings.map((s) => s.carrier).filter(Boolean)),
      ].join(", "),
    });
  }

  /**
   * Destinations we hold no board for.
   *
   * Without this the agent hits a dead end on any lane outside the four we
   * publish, and a demonstration stalls. It is a documented fallback rather
   * than a licence to improvise: the dates live here, in the knowledge, so she
   * is READING them. Her prompt's "never invent sailing dates" rule stays
   * exactly as strict as it was.
   *
   * Scoped hard in the body — usable only when the destination is absent from
   * the index — because keyword search will happily return this entry for a
   * lane we do cover.
   */
  entries.push({
    title: "Destinations not listed above — provisional sailings",
    content: [
      "PROVISIONAL SAILINGS — FOR DESTINATIONS NOT IN THE INDEX ONLY.",
      "",
      "Check the index first. If the caller's destination appears there, use its own",
      "entry and ignore this one completely. This is not a general schedule and it",
      "never overrides a route we publish.",
      "",
      "For a destination we do not yet publish a board for:",
      "- Provisional sailing 12 September, and a second on 17 September.",
      "- Say plainly that these are provisional and the desk will confirm the exact",
      "  sailing and cut-off before anything is booked.",
      "- Do not quote a rate for such a lane. The pricing document governs that, and",
      "  a lane absent from it needs the desk to confirm the rate separately.",
      "- Never present these as confirmed space.",
    ].join(String.fromCharCode(10)),
    keywords: [
      "other destination", "not listed", "another port", "elsewhere", "provisional",
      "Malaysia", "Indonesia", "Vietnam", "Thailand", "Bangladesh", "Myanmar",
      "Philippines", "China", "Japan", "Korea", "Oman", "Qatar", "Kuwait", "Bahrain",
      "Africa", "Europe", "UK", "USA", "Australia", "New Zealand", "Brazil", "Egypt",
    ].join(", "),
  });

  return entries;
}



// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Writes content into an existing source without disturbing it.
 *
 * Creates the source only if it is genuinely absent. Once it exists this only
 * ever PATCHes the entry, which is what keeps the agent attachment intact.
 */
/**
 * Publishes a source that holds several entries, matched by title.
 *
 * Existing titles are patched in place, new ones added, and anything left over
 * removed -- so a route dropped from the board does not linger as a sailing the
 * agent can still quote.
 */
async function publishEntries(
  name: string,
  wanted: Array<{ title: string; content: string; keywords: string }>
) {
  const list = await snap("/knowledge-sources");
  const sources = Array.isArray(list.body) ? (list.body as Array<{ id: number; name: string }>) : [];
  let found = sources.find((s) => s.name === name);

  if (!found) {
    const made = await snap("/knowledge-sources", {
      method: "POST",
      body: JSON.stringify({ name, type: "text", entries: [wanted[0]] }),
    });
    if (!made.ok) return { name, action: "failed", status: made.status };
    found = { id: (made.body as { id: number }).id, name };
  }

  const full = await snap(`/knowledge-sources/${found.id}`);
  const existing =
    ((full.body as { entries?: Array<{ id: number; title: string }> })?.entries ?? []).map((e) => ({
      id: e.id,
      title: e.title,
    }));

  let added = 0;
  let updated = 0;
  const keep = new Set<number>();

  for (const w of wanted) {
    const match = existing.find((e) => e.title === w.title);
    if (match) {
      keep.add(match.id);
      await snap(`/knowledge-sources/${found.id}/entries/${match.id}`, {
        method: "PATCH",
        body: JSON.stringify(w),
      });
      updated++;
    } else {
      const r = await snap(`/knowledge-sources/${found.id}/entries`, {
        method: "POST",
        body: JSON.stringify(w),
      });
      if (r.ok) {
        keep.add((r.body as { id: number }).id);
        added++;
      }
    }
  }

  let removed = 0;
  for (const e of existing) {
    if (keep.has(e.id)) continue;
    await snap(`/knowledge-sources/${found.id}/entries/${e.id}`, { method: "DELETE" });
    removed++;
  }

  return {
    name,
    action: "entries synced",
    id: found.id,
    entries: wanted.length,
    added,
    updated,
    removed,
  };
}

async function publish(name: string, title: string, content: string) {
  const list = await snap("/knowledge-sources");
  const sources = Array.isArray(list.body) ? (list.body as Array<{ id: number; name: string }>) : [];
  const found = sources.find((s) => s.name === name);

  if (!found) {
    const made = await snap("/knowledge-sources", {
      method: "POST",
      body: JSON.stringify({ name, type: "text", entries: [{ title, content }] }),
    });
    return made.ok
      ? { name, action: "created", id: (made.body as { id: number }).id, chars: content.length }
      : { name, action: "failed", status: made.status };
  }

  const full = await snap(`/knowledge-sources/${found.id}`);
  const entries = (full.body as { entries?: Array<{ id: number }> })?.entries ?? [];

  if (!entries.length) {
    const added = await snap(`/knowledge-sources/${found.id}/entries`, {
      method: "POST",
      body: JSON.stringify({ title, content }),
    });
    return added.ok
      ? { name, action: "entry added", id: found.id, chars: content.length }
      : { name, action: "failed", status: added.status };
  }

  const patched = await snap(`/knowledge-sources/${found.id}/entries/${entries[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({ title, content }),
  });

  // Anything beyond the first entry is left over from an older shape and would
  // otherwise sit alongside the fresh content, contradicting it.
  for (const extra of entries.slice(1)) {
    await snap(`/knowledge-sources/${found.id}/entries/${extra.id}`, { method: "DELETE" });
  }

  return patched.ok
    ? { name, action: "updated in place", id: found.id, chars: content.length }
    : { name, action: "failed", status: patched.status };
}

/** The desk and documentation agents. A new pack must reach both. */
const AGENTS = [717, 758]; // Priya, Arun

/** Add one knowledge source to both agents, leaving whatever they already have. */
async function attach(sourceId: number) {
  for (const agentId of AGENTS) {
    const got = await snap(`/agents/${agentId}`);
    const current = ((got.body as { knowledgeSourceIds?: number[] })?.knowledgeSourceIds ?? []).map(
      Number
    );
    if (current.includes(sourceId)) continue;
    await snap(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ knowledgeSourceIds: [...current, sourceId] }),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const [customers, enquiries, quotes, space, partners, assignments] = await Promise.all([
      db("customers?select=id,name,company,phones,emails&order=id"),
      db("enquiries?select=ref,customer_id,status,origin,destination,cargo,volume_cbm,gross_weight_kg,piece_count,updated_at&order=updated_at.desc"),
      db("quotes?select=enquiry_ref,amount_inr,status,sailing_date&status=in.(sent,accepted)"),
      db("sailing_space?select=*&order=sailing_date"),
      db("partners?select=id,name,organisation,role,tags,notes,active&order=organisation"),
      db("partner_assignments?select=enquiry_ref,role"),
    ]);

    const results = [
      await publish(
        DYNAMIC.customers,
        "Customers and their enquiries",
        customerPack(customers, enquiries, quotes)
      ),
      await publishEntries(DYNAMIC.space, spaceEntries(space)),
      await publish(DYNAMIC.partners, "Partner network", partnerPack(partners, assignments)),
    ];

    /**
     * A source created just now is attached to nobody.
     *
     * publish() makes the source when it is missing, which is what lets a new
     * pack appear without anyone touching the SnapServe console -- but an
     * unattached source is invisible to the agents, so the pack would sync
     * perfectly and change nothing. Only on creation; re-PATCHing both agents
     * every five minutes would be noise.
     */
    for (const r of results) {
      // publish() returns a different shape on failure, which carries no id.
      if (r.action === "created" && "id" in r && r.id) await attach(r.id);
    }

    return new Response(
      JSON.stringify({
        ok: results.every((r) => r.action !== "failed"),
        customers: customers.length,
        enquiries: enquiries.length,
        sailings: space.length,
        partners: partners.length,
        published: results,
        at: new Date().toISOString(),
      }),
      { headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: cors }
    );
  }
});
