/**
 * Demo partners -- two of every kind.
 *
 *   node supabase-v2/seed-partners.mjs           # add them
 *   node supabase-v2/seed-partners.mjs --clear   # take them away again
 *
 * ---------------------------------------------------------------------------
 * WHY THE ADDRESSES END IN .example
 *
 * This CRM sends real email. A demo partner carrying a plausible-looking
 * address at a real domain is one mis-click away from a live message reaching a
 * company that has never heard of us -- quoting a shipment, from a freight
 * forwarder, out of nowhere.
 *
 * ".example" is reserved by RFC 2606 and can never resolve, so nothing
 * addressed to these partners can leave the building. Same reasoning for the
 * phone numbers, which use the 555 range.
 *
 * WHY THESE TAGS
 *
 * They are chosen to match the lanes the desk actually demos -- Chennai to
 * Singapore, Chennai to Jebel Ali, textiles and garments -- so opening an
 * enquiry shows real suggestions with real reasons rather than an empty panel.
 * Every partner is tagged the way the desk would tag them: a place, a cargo, a
 * service.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { id } = JSON.parse(readFileSync(join(root, "server-v2/.project.json"), "utf-8"));
const { service_role } = JSON.parse(readFileSync(join(root, "server-v2/.keys.json"), "utf-8"));

const base = `https://${id}.supabase.co/rest/v1`;
const H = {
  apikey: service_role,
  Authorization: `Bearer ${service_role}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const PARTNERS = [
  // ---- overseas agents: the far end of the lane ----
  {
    organisation: "Pacific Consolidators Pte",
    name: "Wei Ling Tan",
    role: "overseas_agent",
    emails: ["ops@pacificconsol.example"],
    phones: ["+65 5550 1201"],
    tags: ["Singapore", "textiles", "garments", "LCL"],
    notes: "Quick on documentation. Slow on hazmat — check before committing.",
  },
  {
    organisation: "Gulf Line Freight LLC",
    name: "Rashid Al Mansoori",
    role: "overseas_agent",
    emails: ["chennai.desk@gulflinefreight.example"],
    phones: ["+971 4 5550 118"],
    tags: ["Jebel Ali", "Dubai", "UAE", "textiles", "FCL"],
    notes: "Handles our Jebel Ali deliveries. Free days negotiable at 14.",
  },

  // ---- consol partners: whose box the cargo travels in ----
  {
    organisation: "Seabridge Groupage",
    name: "Anand Krishnan",
    role: "consol_partner",
    emails: ["bookings@seabridge.example"],
    phones: ["+91 44 5550 2210"],
    tags: ["Chennai", "Singapore", "LCL", "groupage"],
    notes: "Weekly Chennai–Singapore box. Cut-off is two days before sailing.",
  },
  {
    organisation: "Indus Consol Services",
    name: "Farida Sheikh",
    role: "consol_partner",
    emails: ["ops@indusconsol.example"],
    phones: ["+91 22 5550 3344"],
    tags: ["Nhava Sheva", "Jebel Ali", "LCL", "groupage"],
    notes: "Better rates westbound. Nothing under 2 CBM.",
  },

  // ---- carriers ----
  {
    organisation: "Meridian Lines",
    name: "S Ramanathan",
    role: "carrier",
    emails: ["chennai@meridianlines.example"],
    phones: ["+91 44 5550 4102"],
    tags: ["Chennai", "Singapore", "Colombo", "FCL"],
    notes: "Two sailings a week. Reliable on transit time.",
  },
  {
    organisation: "Orient Star Shipping",
    name: "Lim Chee Hong",
    role: "carrier",
    emails: ["bookings@orientstar.example"],
    phones: ["+65 5550 6677"],
    tags: ["Singapore", "Port Klang", "Jebel Ali", "reefer", "FCL"],
    notes: "The one to use for reefer. Premium rate, but they hold the temperature.",
  },

  // ---- CHA / customs ----
  {
    organisation: "Coastline Clearing Agents",
    name: "R Kumar",
    role: "cha_customs",
    emails: ["docs@coastlineclearing.example"],
    phones: ["+91 44 5550 7781"],
    tags: ["Chennai", "customs", "export clearance", "textiles"],
    notes: "Same-day filing if papers are in before noon.",
  },
  {
    organisation: "Trident Customs House",
    name: "Nithya Balan",
    role: "cha_customs",
    emails: ["clearance@tridentcha.example"],
    phones: ["+91 44 5550 8823"],
    tags: ["Chennai", "Ennore", "customs", "hazmat", "drawback"],
    notes: "Use them for anything hazardous or a drawback claim.",
  },

  // ---- CFS / transport ----
  {
    organisation: "Metro Haulage",
    name: "S Devi",
    role: "cfs_transport",
    emails: ["dispatch@metrohaulage.example"],
    phones: ["+91 44 5550 9012"],
    tags: ["Chennai", "Sriperumbudur", "trailer", "container movement"],
    notes: "Trailers at short notice. Confirm the day before for a 20ft.",
  },
  {
    organisation: "Redhills CFS & Logistics",
    name: "Vignesh Kumar",
    role: "cfs_transport",
    emails: ["yard@redhillscfs.example"],
    phones: ["+91 44 5550 9455"],
    tags: ["Chennai", "CFS", "stuffing", "warehousing"],
    notes: "Stuffing yard near the port. Free storage for the first three days.",
  },

  // ---- other ----
  {
    organisation: "Southern Marine Surveyors",
    name: "P Jayaraman",
    role: "other",
    emails: ["survey@southernmarine.example"],
    phones: ["+91 44 5550 6120"],
    tags: ["Chennai", "survey", "inspection", "cargo damage"],
    notes: "Called in when a container is opened short or damaged.",
  },
  {
    organisation: "Anchor Marine Insurance",
    name: "Divya Raghavan",
    role: "other",
    emails: ["cover@anchormarine.example"],
    phones: ["+91 44 5550 6355"],
    tags: ["marine insurance", "all risks", "textiles", "Jebel Ali"],
    notes: "All-risks cover. Needs the invoice value before they will quote.",
  },
];

/** Every seeded address is at .example, which is how they are found again. */
const isSeeded = (p) => (p.emails ?? []).some((e) => e.endsWith(".example"));

const existing = await fetch(`${base}/partners?select=id,organisation,emails`, {
  headers: H,
}).then((r) => r.json());

if (process.argv.includes("--clear")) {
  const mine = existing.filter(isSeeded);
  if (!mine.length) {
    console.log("\n  nothing seeded to remove\n");
    process.exit(0);
  }
  const ids = mine.map((p) => p.id).join(",");
  // Assignments first: the foreign key would refuse the other order, and an
  // assignment to a partner nobody can look up is worse than no assignment.
  await fetch(`${base}/partner_assignments?partner_id=in.(${ids})`, { method: "DELETE", headers: H });
  const gone = await fetch(`${base}/partners?id=in.(${ids})`, { method: "DELETE", headers: H }).then(
    (r) => r.json()
  );
  console.log(`\n  removed ${gone.length} demo partner(s)\n`);
  process.exit(0);
}

const already = new Set(existing.map((p) => p.organisation));
const toAdd = PARTNERS.filter((p) => !already.has(p.organisation));

if (!toAdd.length) {
  console.log("\n  already seeded — nothing to do\n");
} else {
  const r = await fetch(`${base}/partners`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(toAdd),
  });
  const rows = await r.json();
  if (!r.ok) {
    console.error(`\n  failed ${r.status}: ${JSON.stringify(rows).slice(0, 300)}\n`);
    process.exit(1);
  }
  console.log(`\n  added ${rows.length} partners:`);
  for (const p of rows) console.log(`    ${p.role.padEnd(15)} ${p.organisation}`);
}

// The agents should know the network before the next call, not in five minutes.
const sync = await fetch(`https://${id}.supabase.co/functions/v1/kb-sync`, {
  method: "POST",
  headers: { Authorization: `Bearer ${service_role}`, "Content-Type": "application/json" },
  body: JSON.stringify({ trigger: "seed-partners" }),
}).then((r) => r.json());
console.log(`\n  knowledge base: ${sync.partners} partners published\n`);
