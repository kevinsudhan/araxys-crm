/**
 * Fills v1 with coherent dummy data for a demo.
 *
 * Everything here is invented. Phone numbers are in a patterned 9199990xxxx block that
 * belongs to nobody, companies are made up, and the lanes are real ports with fictional
 * cargo on them. The point is that a demo can be run, and recorded, and put in front of
 * strangers, without any of it being someone's actual business.
 *
 *   node scripts/seed-demo.mjs                        # show what it would do
 *   node scripts/seed-demo.mjs --apply                # ADD dummy data, touch nothing else
 *   node scripts/seed-demo.mjs --apply --replace      # also DELETE the existing rows
 *
 * ---------------------------------------------------------------------------
 * --replace DELETES REAL CAPTURED BUSINESS DATA.
 *
 * real_records holds enquiries the voice agents took off actual calls, and call_logs
 * holds the transcripts of those conversations. Both are real people. Back them up first —
 * scripts/backup.mjs writes to data/, which is gitignored — and be sure, because there is
 * one copy and this does not ask twice.
 * ---------------------------------------------------------------------------
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const env = {};
for (const line of fs.readFileSync(path.join(root, "snapserve-setup", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in snapserve-setup/.env");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const replace = process.argv.includes("--replace");

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(pathAndQuery, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${pathAndQuery} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- dates

/** Sailings must be in the future or the cut-off sentinel has nothing to watch. */
const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const hoursFromNow = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

// ---------------------------------------------------------------- partners

/**
 * Seven partners across the lanes below. Tags are what the agent ranks on, so they are
 * written the way a desk would actually type them — some as lanes, some as single ports,
 * some as cargo types.
 *
 * Two are deliberately imperfect: Kaveri has the lane but is a transporter rather than a
 * carrier, and Westline covers Europe only. A partner list where every row is a clean
 * match does not demonstrate ranking, it demonstrates a list.
 */
const PARTNERS = [
  {
    name: "Ravi Subramanian", organisation: "Oceanlink Shipping", role: "carrier",
    emails: ["rates@oceanlink.demo"], phones: ["919999012001"],
    tags: ["Chennai-Singapore", "Chennai-Colombo", "FCL", "20GP", "40HC"],
    notes: "Strong on the Singapore lane, usually replies same day.",
  },
  {
    name: "Meera Iyer", organisation: "Meridian Freight", role: "coloader",
    emails: ["ops@meridianfreight.demo"], phones: ["919999012002"],
    tags: ["Chennai", "Singapore", "LCL", "textiles"],
    notes: "LCL consolidator. Slower to come back.",
  },
  {
    name: "Abdul Rahman", organisation: "Gulf Bridge Lines", role: "carrier",
    emails: ["quotes@gulfbridge.demo"], phones: ["919999012003"],
    tags: ["Chennai-Jebel Ali", "Mundra-Jebel Ali", "Dubai", "FCL", "reefer"],
    notes: "Gulf specialist, competitive on reefer.",
  },
  {
    name: "Thomas Verhoeven", organisation: "Westline Europe", role: "carrier",
    emails: ["india@westline.demo"], phones: ["919999012004"],
    tags: ["Nhava Sheva-Rotterdam", "Mundra-Hamburg", "Europe", "40HC"],
    notes: "Europe only. Does not cover Asia lanes.",
  },
  {
    name: "Priya Nandakumar", organisation: "Southern Star Logistics", role: "coloader",
    emails: ["desk@southernstar.demo"], phones: ["919999012005"],
    tags: ["Chennai", "Colombo", "Singapore", "LCL", "machinery", "electronics"],
    notes: "Good on odd-sized machinery.",
  },
  {
    name: "Kaveri Transports", organisation: "Kaveri Transports", role: "transporter",
    emails: ["booking@kaveritrans.demo"], phones: ["919999012006"],
    tags: ["Chennai", "Chennai-Singapore", "trucking", "haulage"],
    notes: "Road haulage to port. Not a shipping line.",
  },
  {
    name: "Nilesh Shah", organisation: "Anchor Customs House", role: "cha",
    emails: ["clearance@anchorcha.demo"], phones: ["919999012007"],
    tags: ["Chennai", "Nhava Sheva", "customs", "clearance"],
    notes: "CHA, not a rate provider.",
  },
];

// ---------------------------------------------------------------- sailings

const SAILINGS = [
  { id: "sl-d1", route: "Chennai -> Singapore",              carrier: "Oceanlink", container_code: "20GP", mode: "FCL", sail: 7,  cut: 5 },
  { id: "sl-d2", route: "Chennai -> Singapore",              carrier: "MSC",       container_code: "40HC", mode: "FCL", sail: 12, cut: 10 },
  { id: "sl-d3", route: "Chennai -> Singapore",              carrier: "Meridian",  container_code: "LCL",  mode: "LCL", sail: 4,  cut: 2 },
  { id: "sl-d4", route: "Chennai -> Jebel Ali, Dubai",       carrier: "Gulf Bridge", container_code: "20GP", mode: "FCL", sail: 9, cut: 7 },
  { id: "sl-d5", route: "Chennai -> Colombo",                carrier: "Oceanlink", container_code: "20GP", mode: "FCL", sail: 3,  cut: 1 },
  { id: "sl-d6", route: "Nhava Sheva -> Rotterdam",          carrier: "Westline",  container_code: "40HC", mode: "FCL", sail: 15, cut: 12 },
  { id: "sl-d7", route: "Mundra -> Hamburg",                 carrier: "Westline",  container_code: "40HC", mode: "FCL", sail: 18, cut: 15 },
  { id: "sl-d8", route: "Chennai -> Port Klang",             carrier: "MSC",       container_code: "20GP", mode: "FCL", sail: 11, cut: 9 },
];

// ---------------------------------------------------------------- enquiries

/**
 * Ten enquiries spread across the pipeline, so every screen has something on it and the
 * board is not a demo of an empty state.
 *
 * `pipeline` is where the quoting agent has got to; `stage` is v1's own enquiry /
 * processing / processed. One row is deliberately left at 'captured' with nothing else
 * filled in — that is the one to run the live demo against.
 */
const ENQUIRIES = [
  {
    ref: "ARX-ENQ-9001", phone: "919999020001", customer_name: "Sunil Kumar", company: "Arax Traders",
    stage: "enquiry", pipeline: "captured", status: "enquiry received",
    origin: "Chennai", destination: "Singapore", cargo_description: "100 pieces of television sets",
    container_type: "20GP", volume_cbm: 22, sailing_offset: 7,
    notes: "Called in. Wants a rate before confirming with his partner.",
  },
  {
    ref: "ARX-ENQ-9002", phone: "919999020002", customer_name: "Lakshmi Narayanan", company: "Vasant Textiles",
    stage: "enquiry", pipeline: "scoping", status: "awaiting dimensions",
    origin: "Chennai", destination: "Singapore", cargo_description: "cotton textile bales",
    container_type: "LCL", volume_cbm: 8, sailing_offset: 4,
    notes: "Needs piece dimensions before anyone can quote.",
  },
  {
    ref: "ARX-ENQ-9003", phone: "919999020003", customer_name: "Farid Ahmed", company: "Crescent Exports",
    stage: "enquiry", pipeline: "sourcing", status: "rates requested",
    origin: "Chennai", destination: "Jebel Ali, Dubai", cargo_description: "industrial pumps, 4 crates",
    container_type: "20GP", volume_cbm: 14, sailing_offset: 9,
    notes: "RFQ out to three partners.",
  },
  {
    ref: "ARX-ENQ-9004", phone: "919999020004", customer_name: "Deepa Menon", company: "Nirmal Agro",
    stage: "enquiry", pipeline: "collecting", status: "rates coming in",
    origin: "Chennai", destination: "Colombo", cargo_description: "dried spices, 180 sacks",
    container_type: "20GP", volume_cbm: 18, sailing_offset: 3,
    notes: "Two partners quoted, one still to reply.",
  },
  {
    ref: "ARX-ENQ-9005", phone: "919999020005", customer_name: "Rajesh Pillai", company: "Southgate Machinery",
    stage: "enquiry", pipeline: "awaiting_approval", status: "quote held for approval",
    origin: "Chennai", destination: "Singapore", cargo_description: "CNC lathe, one crate, over-height",
    container_type: "40HC", volume_cbm: 26, quoted_amount_inr: 148_000, sailing_offset: 12,
    notes: "Margin outside the band — held for the desk.",
  },
  {
    ref: "ARX-ENQ-9006", phone: "919999020006", customer_name: "Anita Desai", company: "Blue Harbour Foods",
    stage: "processing", pipeline: "quoted", status: "quotation sent",
    origin: "Chennai", destination: "Jebel Ali, Dubai", cargo_description: "frozen seafood, reefer",
    container_type: "20RF", volume_cbm: 20, quoted_amount_inr: 212_000, sailing_offset: 9,
    notes: "Quote with the customer, awaiting their answer.",
  },
  {
    ref: "ARX-ENQ-9007", phone: "919999020007", customer_name: "Vikram Seth", company: "Meridian Auto Parts",
    stage: "processing", pipeline: "accepted", status: "booking confirmed",
    origin: "Nhava Sheva", destination: "Rotterdam", cargo_description: "automotive components, 12 pallets",
    container_type: "40HC", volume_cbm: 48, quoted_amount_inr: 385_000, agreed_amount_inr: 378_000,
    bl_number: "MSCU7291044", sailing_offset: 15,
    notes: "Accepted at a small discount. Documents outstanding.",
  },
  {
    ref: "ARX-ENQ-9008", phone: "919999020008", customer_name: "Hari Prasad", company: "Konark Ceramics",
    stage: "processing", pipeline: "accepted", status: "in transit",
    origin: "Mundra", destination: "Hamburg", cargo_description: "ceramic tiles, 20 pallets",
    container_type: "40HC", volume_cbm: 52, quoted_amount_inr: 410_000, agreed_amount_inr: 410_000,
    bl_number: "OOLU9013345", sailing_offset: -4,
    notes: "Sailed. Arrival notice due shortly.",
  },
  {
    ref: "ARX-ENQ-9009", phone: "919999020009", customer_name: "Nasreen Sheikh", company: "Orient Handicrafts",
    stage: "enquiry", pipeline: "declined", status: "customer went elsewhere",
    origin: "Chennai", destination: "Port Klang", cargo_description: "handicraft goods, 6 cartons",
    container_type: "LCL", volume_cbm: 3, quoted_amount_inr: 46_000, sailing_offset: 11,
    notes: "Lost on price.",
  },
  {
    ref: "ARX-ENQ-9010", phone: "919999020010", customer_name: "Joseph Fernandes", company: "Coastal Marine Supply",
    stage: "processed", pipeline: "accepted", status: "delivered",
    origin: "Chennai", destination: "Colombo", cargo_description: "marine rope and fittings",
    container_type: "20GP", volume_cbm: 16, quoted_amount_inr: 94_000, agreed_amount_inr: 94_000,
    bl_number: "CMAU4410982", sailing_offset: -18,
    notes: "Closed. Rebate claim may be due on this lane.",
  },
];

// ---------------------------------------------------------------- run

function phoneKey(p) {
  return p.replace(/\D/g, "").slice(-10);
}

async function main() {
  console.log(`\nSeeding ${URL_BASE.replace(/https:\/\/([^.]+).*/, "$1")}`);

  const existing = {
    real_records: (await rest("real_records?select=ref")).length,
    call_logs: (await rest("call_logs?select=call_id&limit=1000")).length,
    partners: (await rest("partners?select=id")).length,
    space_slots: (await rest("space_slots?select=id")).length,
  };
  console.log("  currently:", JSON.stringify(existing));

  console.log(`\n  would add: ${PARTNERS.length} partners, ${SAILINGS.length} sailings, ${ENQUIRIES.length} enquiries`);
  if (replace) {
    console.log(`  would DELETE: ${existing.real_records} real_records, ${existing.call_logs} call_logs, ${existing.space_slots} sailings`);
    console.log("               these are real captured calls — make sure you have a backup");
  } else {
    console.log("  would delete: nothing (pass --replace to clear existing rows first)");
  }

  if (!apply) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
    return;
  }

  if (replace) {
    // Order matters: children before parents, or the foreign keys refuse.
    for (const t of ["enquiry_events", "quote_lines", "partner_quotes", "space_placements"]) {
      await rest(`${t}?id=not.is.null`, { method: "DELETE" }).catch(() => {});
    }
    await rest("real_records?ref=not.is.null", { method: "DELETE" });
    await rest("call_logs?call_id=not.is.null", { method: "DELETE" });
    await rest("space_slots?id=not.is.null", { method: "DELETE" });
    console.log("\n  cleared existing rows");
  }

  await rest("partners?on_conflict=organisation", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(PARTNERS.map((p) => ({ ...p, active: true }))),
  });
  console.log(`  partners      +${PARTNERS.length}`);

  await rest("space_slots?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(SAILINGS.map((s) => ({
      id: s.id, route: s.route, carrier: s.carrier,
      sailing_date: day(s.sail), cutoff_date: day(s.cut),
      container_code: s.container_code, mode: s.mode,
      // A cut-off inside two days is what the sentinel should be shouting about.
      status: s.cut <= 2 ? "closing_soon" : "open",
    }))),
  });
  console.log(`  space_slots   +${SAILINGS.length}`);

  await rest("real_records?on_conflict=ref", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    // PostgREST refuses a bulk insert whose objects have different key sets — "All object
    // keys must match". The rows here legitimately differ (not every enquiry has a BL
    // number or an agreed amount), so every row is widened to the same shape with nulls
    // rather than the list being split into one request per distinct shape.
    body: JSON.stringify(ENQUIRIES.map((e) => ({
      ref: e.ref,
      phone: e.phone,
      phone_key: phoneKey(e.phone),
      customer_name: e.customer_name ?? null,
      company: e.company ?? null,
      bl_number: e.bl_number ?? null,
      stage: e.stage,
      status: e.status,
      pipeline: e.pipeline,
      origin: e.origin ?? null,
      destination: e.destination ?? null,
      cargo_description: e.cargo_description ?? null,
      container_type: e.container_type ?? null,
      volume_cbm: e.volume_cbm ?? null,
      quoted_amount_inr: e.quoted_amount_inr ?? null,
      agreed_amount_inr: e.agreed_amount_inr ?? null,
      target_margin_pct: e.target_margin_pct ?? null,
      sailing_date: day(e.sailing_offset),
      notes: e.notes ?? null,
      source_call_id: null,
      source_language: "en",
      request_details: { piece_count: 1, volume_cbm: e.volume_cbm ?? null, seeded: true },
    }))),
  });
  console.log(`  real_records  +${ENQUIRIES.length}`);

  console.log("\n  done. Every row above is invented — no real customer data remains");
  console.log("  unless you skipped --replace, in which case the originals are still there.\n");
}

main().catch((e) => {
  console.error("\n" + e.message + "\n");
  process.exit(1);
});
