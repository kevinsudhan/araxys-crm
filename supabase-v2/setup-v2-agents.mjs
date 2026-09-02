/**
 * Stands up v2's voice desk: Vaishnavi and Pranay, with their own knowledge.
 *
 *   node supabase-v2/setup-v2-agents.mjs
 *
 * Idempotent. Re-running updates the prompts and re-attaches anything that has
 * come loose, and never touches Priya, Arun, or the sources they read.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SOURCES ARE CREATED ONCE AND NEVER RECREATED
 *
 * v1 refreshed a pack by DELETEing the source and POSTing a new one. Deleting a
 * source detaches it from every agent, so the whole thing rests on the
 * re-attach succeeding afterwards -- and when it did not, Priya was left
 * answering calls with two of her seven packs, once without the rate card,
 * which is how a customer got a fabricated dollar figure.
 *
 * There is a window in that approach where a source genuinely does not exist,
 * and a call landing inside it gets an agent missing a pack, silently.
 *
 * The entry-level routes remove the window: PATCH on an entry updates content
 * in place, so the source id never changes and the attachment is never
 * disturbed. Sources here are created on first run and only ever have their
 * entries rewritten.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const api = async (path, init = {}) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: r.ok, status: r.status, body };
};

/** v2's agents. Named so nobody confuses them with the live desk. */
const V2 = {
  desk: { id: 1071, name: "Vaishnavi", copyFrom: 717, role: "forwarder desk" },
  docs: { id: 1072, name: "Pranay", copyFrom: 758, role: "documentation desk" },
};

/**
 * The packs, all suffixed (v2).
 *
 * The four reference packs carry starting content that the desk edits. The two
 * marked dynamic are rewritten from v2's database on every sync and should not
 * be edited by hand -- anything typed into them is overwritten on the next run.
 */
const SOURCES = [
  {
    key: "container_specs",
    name: "Container specifications (v2)",
    title: "Standard container internals",
    dynamic: false,
    content: `Internal dimensions and payload limits. All figures are internal, not external.

20GP  — 5.90 m long, 2.35 m wide, 2.39 m high, max payload 28,200 kg
40GP  — 12.03 m long, 2.35 m wide, 2.39 m high, max payload 26,700 kg
40HC  — 12.03 m long, 2.35 m wide, 2.69 m high, max payload 28,600 kg

Height is the figure that catches people out. A 2.6 m crate does not enter a
20GP or a 40GP in any orientation, whatever the cubic metres say. Check the
height of the tallest piece before anything else.

Groupage space is sold by floor length, not by volume. What matters is how many
metres of container floor a consignment consumes once it is stacked the way it
can actually be stacked.`,
  },
  {
    key: "pricing",
    name: "Route pricing & negotiation bands (v2)",
    title: "Rate card and how far it may move",
    dynamic: false,
    content: `Rates are per CBM unless stated. Quote from this card and nothing else.

Chennai to Jebel Ali    ₹4,800/CBM   minimum ₹38,000   floor ₹4,200/CBM   transit 8-10 days
Chennai to Singapore    ₹4,200/CBM   minimum ₹34,000   floor ₹3,700/CBM   transit 6-8 days
Chennai to Colombo      ₹3,400/CBM   minimum ₹24,000   floor ₹2,950/CBM   transit 3-4 days
Chennai to Jeddah       ₹6,100/CBM   minimum ₹52,000   floor ₹5,400/CBM   transit 12-14 days

The floor is the lowest you may go without asking the desk. Below it, say you
will confirm and call back.

IF THE ROUTE IS NOT ON THIS LIST there is no rate for you to find, and no amount
of looking will produce one. Say so on the first ask -- "we don't have a
published rate for that lane, let me get it from the desk and call you back" --
take the details, and move on. Never adapt a rate from a different lane because
the distance seems similar. Never invent a number to fill a silence.`,
  },
  {
    key: "documents",
    name: "Documents required by cargo type (v2)",
    title: "What each kind of cargo needs",
    dynamic: false,
    content: `Every export needs: commercial invoice, packing list, shipping bill,
bill of lading, and the shipper's IEC.

Textiles and garments — certificate of origin for preferential duty.
Food and agricultural — phytosanitary certificate, health certificate, and the
  FSSAI licence number on the invoice.
Machinery and parts — country of origin marking; a fumigation certificate where
  wooden crating or pallets are used.
Chemicals — MSDS, dangerous goods declaration where classified, UN number.
Pharmaceuticals — drug licence, batch certificate of analysis.

ISPM-15 applies wherever wood packaging is involved, whatever the cargo is.
Ask whether pallets or crates are wooden; people forget to mention them.`,
  },
  {
    key: "customs",
    name: "Destination customs & regulations (v2)",
    title: "Destination requirements",
    dynamic: false,
    content: `United Arab Emirates (Jebel Ali) — consignee must hold a valid trade licence.
  Certificate of origin attested where a preferential rate is claimed. Cargo must
  be cleared within the free period or storage begins.

Singapore — no import duty on most goods; GST applies at import. Strict controls
  on food, pharmaceuticals and anything battery-powered.

Sri Lanka (Colombo) — import control licence for restricted categories. Original
  bill of lading usually required unless surrendered at origin.

Saudi Arabia (Jeddah) — SABER conformity certificate and a Certificate of
  Conformity for regulated products. Arabic labelling on consumer goods.
  Documentation errors here are expensive and slow to correct.`,
  },
  {
    key: "customers",
    name: "Araxys v2 — customer records",
    title: "Customers and their enquiries",
    dynamic: true,
    content: "No customer records yet.",
  },
  {
    key: "space",
    name: "Araxys v2 — container space availability",
    title: "Live container space",
    dynamic: true,
    content: "No sailings on the board yet.",
  },
];

// ---------------------------------------------------------------------------

async function main() {
  console.log("── prompts ──");
  for (const a of Object.values(V2)) {
    const source = await api(`/agents/${a.copyFrom}`);
    if (!source.ok) {
      console.log(`  FAILED to read agent ${a.copyFrom}`);
      continue;
    }

    /**
     * The prompt is taken verbatim, with only the name swapped.
     *
     * Those prompts carry a lot of hard-won correction -- the one-question-at-a-time
     * pacing, the refusal to invent a rate, the rule about whose record is whose.
     * Rewriting them for a new name would quietly discard all of it.
     */
    const prompt = (source.body.systemPrompt ?? "")
      .replace(/\bPriya\b/g, V2.desk.name)
      .replace(/\bArun\b/g, V2.docs.name);

    const greeting = (source.body.greetingMessage ?? "")
      .replace(/\bPriya\b/g, V2.desk.name)
      .replace(/\bArun\b/g, V2.docs.name);

    const r = await api(`/agents/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ systemPrompt: prompt, greetingMessage: greeting }),
    });
    console.log(
      `  ${a.name} (${a.id}) ← ${source.body.name} — ${r.ok ? `${prompt.length} chars` : `FAILED ${r.status}`}`
    );
  }

  console.log("\n── knowledge sources ──");
  const list = await api("/knowledge-sources");
  const existing = Array.isArray(list.body) ? list.body : [];
  const ids = {};

  for (const s of SOURCES) {
    const found = existing.find((x) => x.name === s.name);

    if (found) {
      // Update the entry rather than replacing the source, so the agents that
      // read it never lose it, even for an instant.
      const full = await api(`/knowledge-sources/${found.id}`);
      const entry = full.body?.entries?.[0];
      if (entry) {
        await api(`/knowledge-sources/${found.id}/entries/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: s.title, content: s.content }),
        });
      }
      ids[s.key] = found.id;
      console.log(`  updated  ${found.id}  ${s.name}`);
    } else {
      const made = await api("/knowledge-sources", {
        method: "POST",
        body: JSON.stringify({
          name: s.name,
          type: "text",
          entries: [{ title: s.title, content: s.content }],
        }),
      });
      if (!made.ok) {
        console.log(`  FAILED   ${s.name} → ${made.status}`);
        continue;
      }
      ids[s.key] = made.body.id;
      console.log(`  created  ${made.body.id}  ${s.name}`);
    }
  }

  console.log("\n── attach ──");
  for (const a of Object.values(V2)) {
    for (const [key, id] of Object.entries(ids)) {
      const r = await api(`/knowledge-sources/${id}/attach-agent/${a.id}`, { method: "POST" });
      // Already attached is success, not an error worth reporting as one.
      const fine = r.ok || r.status === 409;
      if (!fine) console.log(`  ${a.name} ✗ ${key} (${r.status})`);
    }
    const after = await api(`/agents/${a.id}`);
    console.log(`  ${a.name}: ${(after.body.knowledgeSourceIds ?? []).length} sources attached`);
  }

  console.log("\n── untouched ──");
  for (const id of [717, 758]) {
    const a = await api(`/agents/${id}`);
    console.log(`  ${a.body.name} (${id}): ${(a.body.knowledgeSourceIds ?? []).length} sources, unchanged`);
  }

  console.log(`\nv2 source ids: ${JSON.stringify(ids)}`);
}

await main();
