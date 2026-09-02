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

/** The two packs generated from live data. Reference packs are edited by hand. */
const DYNAMIC = {
  customers: "Araxys v2 — customer records",
  space: "Araxys v2 — container space availability",
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

function spacePack(rows: SpaceRow[]): string {
  if (!rows.length) return "No sailings on the board yet. There is no space to offer.";

  const L: string[] = [
    "CONTAINER SPACE. Live figures, republished after every change.",
    "",
    "Groupage space is sold by FLOOR LENGTH, not by volume. The free metres below are",
    "what is actually bookable. A consignment fits only if it fits in three dimensions:",
    "check the height of the tallest piece against the container height before anything",
    "else, because a tall crate can defeat a container that has plenty of cubic metres.",
    "",
  ];

  const byRoute = new Map<string, SpaceRow[]>();
  for (const r of rows) {
    if (!byRoute.has(r.route)) byRoute.set(r.route, []);
    byRoute.get(r.route)!.push(r);
  }

  for (const [route, sailings] of byRoute) {
    const dates = sailings.map((s) => s.sailing_date).sort();
    L.push(`## ${route}`);
    L.push(`Sailings on this route: ${dates.join(", ")}`);
    L.push("");

    for (const s of sailings.sort((a, b) => a.sailing_date.localeCompare(b.sailing_date))) {
      L.push(`### ${s.route} — sailing ${s.sailing_date}`);
      L.push(`- Route: ${s.route} (this sailing serves ONLY this route)`);
      L.push(`- Carrier ${s.carrier || "not set"}, ${s.container_code}, status ${s.status}`);
      if (s.cutoff_date) L.push(`- Cut-off ${s.cutoff_date}`);
      L.push(
        `- Container internals ${s.container_length_m} m long, ${s.container_width_m} m wide, ` +
          `${s.container_height_m} m high`
      );
      L.push(
        `- FREE: ${s.free_length_m} m of floor, ${s.free_cbm} CBM, ${s.free_payload_kg} kg payload`
      );
      L.push(`- Already loaded: ${s.consignments} consignment${s.consignments === 1 ? "" : "s"}`);
      L.push("");
    }
  }

  return L.join("\n");
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
    const [customers, enquiries, quotes, space] = await Promise.all([
      db("customers?select=id,name,company,phones,emails&order=id"),
      db("enquiries?select=ref,customer_id,status,origin,destination,cargo,volume_cbm,gross_weight_kg,piece_count,updated_at&order=updated_at.desc"),
      db("quotes?select=enquiry_ref,amount_inr,status,sailing_date&status=in.(sent,accepted)"),
      db("sailing_space?select=*&order=sailing_date"),
    ]);

    const results = [
      await publish(
        DYNAMIC.customers,
        "Customers and their enquiries",
        customerPack(customers, enquiries, quotes)
      ),
      await publish(DYNAMIC.space, "Live container space", spacePack(space)),
    ];

    return new Response(
      JSON.stringify({
        ok: results.every((r) => r.action !== "failed"),
        customers: customers.length,
        enquiries: enquiries.length,
        sailings: space.length,
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
