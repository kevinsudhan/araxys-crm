/**
 * One complete enquiry, every field filled, for demonstrating the case file.
 *
 *   node supabase-v2/seed-demo-enquiry.mjs
 *   node supabase-v2/seed-demo-enquiry.mjs --clear
 *
 * ---------------------------------------------------------------------------
 * WHY A SEED AND NOT A HAND-TYPED RECORD
 *
 * A demo enquiry has to be reproducible: wiped and rebuilt in one command
 * between run-throughs, and identical every time so the walkthrough never has
 * to adapt. Typing it into the UI once gets edited by accident and cannot be
 * restored.
 *
 * The numbers are internally consistent rather than plausible-looking. Volume
 * and gross weight are computed from the piece dimensions exactly as the CRM
 * computes them, and the quote is the real Chennai-Singapore rate card figure
 * multiplied by that volume. Nothing on this record contradicts anything else
 * on it, which is what makes it survive a judge doing the arithmetic.
 *
 * The customer is clearly fictional and the email is at .example, which cannot
 * resolve, so nothing here can accidentally reach a real inbox.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { id: PROJECT } = JSON.parse(readFileSync(join(root, "server-v2/.project.json"), "utf-8"));
const { service_role } = JSON.parse(readFileSync(join(root, "server-v2/.keys.json"), "utf-8"));

const BASE = `https://${PROJECT}.supabase.co/rest/v1`;
const H = {
  apikey: service_role,
  Authorization: `Bearer ${service_role}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const db = async (path, init = {}) => {
  const r = await fetch(`${BASE}/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} on ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

const CUSTOMER = "CDEMO";
const REF = "ARX-CDEMO-E01";
const CALL = "demo-call-1";

if (process.argv.includes("--clear")) {
  await db(`shipments?enquiry_ref=eq.${REF}`, { method: "DELETE" });
  await db(`partner_assignments?enquiry_ref=eq.${REF}`, { method: "DELETE" });
  await db(`enquiry_events?enquiry_ref=eq.${REF}`, { method: "DELETE" });
  await db(`enquiry_parties?enquiry_ref=eq.${REF}`, { method: "DELETE" });
  await db(`quotes?enquiry_ref=eq.${REF}`, { method: "DELETE" });
  await db(`calls?call_id=eq.${CALL}`, { method: "DELETE" });
  await db(`enquiries?ref=eq.${REF}`, { method: "DELETE" });
  await db(`customers?id=eq.${CUSTOMER}`, { method: "DELETE" });
  console.log(`\n  ${REF} removed\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The cargo. Everything downstream is derived from these five numbers.
// ---------------------------------------------------------------------------
const PIECES = 24;
const L = 120, W = 80, Hc = 90; // cm
const KG = 45;

const volume = Number(((L * W * Hc * PIECES) / 1_000_000).toFixed(2)); // 20.74 CBM
const gross = KG * PIECES; // 1080 kg
const RATE = 4200; // Chennai to Singapore, per CBM, from the rate card
const amount = Math.round(volume * RATE); // 87,108

await db("customers", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({
    id: CUSTOMER,
    name: "Rajesh Venkatesan",
    company: "Velmurugan Textiles Pvt Ltd",
    phones: ["919840556677"],
    emails: ["rajesh@velmurugantextiles.example"],
  }),
});

await db("enquiries", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({
    ref: REF,
    customer_id: CUSTOMER,
    seq: 1,
    status: "accepted",
    source: "call",
    origin: "Chennai",
    destination: "Singapore",
    cargo: "Cotton bed linen sets, cartons",
    cargo_type: "General",
    incoterm: "FOB",
    ready_date: "2026-09-06",
    pickup_location: "Tirupur, Tamil Nadu",
    piece_count: PIECES,
    piece_length_cm: L,
    piece_width_cm: W,
    piece_height_cm: Hc,
    weight_per_piece_kg: KG,
    gross_weight_kg: gross,
    volume_cbm: volume,
    stackable: true,
    upright_only: false,
    special_handling: "Keep dry. Cartons shrink-wrapped on pallets.",
    consignee_name: "Tan Wei Ming",
    consignee_country: "Singapore",
    notes: "Repeat shipper. Prefers the earlier sailing when both are open.",
  }),
});

// The call it came from, so the case file shows where the details originated.
await db("calls", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({
    call_id: CALL,
    enquiry_ref: REF,
    customer_id: CUSTOMER,
    agent_name: "Priya",
    from_number: "919840556677",
    duration_secs: 232,
    language: "Tamil / English",
    matched_by: "phone",
    started_at: "2026-09-04T09:12:00Z",
    ended_at: "2026-09-04T09:15:52Z",
    extracted_at: new Date().toISOString(),
    summary:
      "Rajesh from Velmurugan Textiles is sending 24 cartons of cotton bed linen from " +
      "Chennai to Singapore, 120 x 80 x 90 cm each at 45 kg. Cargo ready 6 September at " +
      "Tirupur. Quoted 4,200 per CBM on 20.74 CBM, total 87,108 plus THC and " +
      "documentation. Agreed the 8 September sailing and confirmed by email.",
    transcript:
      "Agent: Hi, this is Priya from the forwarder desk at Aashish Logistics Global. How can I help you today?\n" +
      "Caller: I need to send some cartons to Singapore.\n" +
      "Agent: Sure, I can help with that. Before we proceed, which language would you be comfortable speaking in?\n" +
      "Caller: Tamil is fine.\n" +
      "Agent: Sari. Enga irundhu anuppureenga?\n" +
      "Caller: Chennai la irundhu Singapore.\n" +
      "Agent: Documentation-kaga unga perai therinjukkalama?\n" +
      "Caller: Rajesh Venkatesan.\n" +
      "Agent: Endha company Rajesh?\n" +
      "Caller: Velmurugan Textiles.\n" +
      "Agent: Enna cargo anuppureenga?\n" +
      "Caller: Cotton bed linen sets, cartons la.\n" +
      "Agent: Oru carton oda size enna? Length, width, height.\n" +
      "Caller: 120 by 80 by 90 centimetre.\n" +
      "Agent: Moththam eththanai cartons?\n" +
      "Caller: Twenty four.\n" +
      "Agent: Oru carton oda weight?\n" +
      "Caller: Forty five kilo.\n" +
      "Agent: Cargo eppo ready aagum, truck collect panna?\n" +
      "Caller: Aaram thedhi, Tirupur la irundhu.\n" +
      "Agent: Chennai la irundhu Singapore-ku oru CBM-ku 4,200 rupees. Unga volume 20.74 CBM, " +
      "so total 87,108 rupees. THC rendu pakkamum, documentation fee extra varum. " +
      "Singapore-ku ettaam thedhi oru sailing irukku, booking cut-off aaram thedhi. Adhula proceed pannalama?\n" +
      "Caller: Ama, ettaam thedhi okay.\n" +
      "Agent: Quotation anuppa unga email address sollunga.\n" +
      "Caller: rajesh at velmurugantextiles dot example.\n" +
      "Agent: rajesh at velmurugantextiles dot example, correct-a? Ippo Arun kitta transfer " +
      "panren, avaru documentation details vaanguvaaru.\n",
  }),
});

const [quote] = await db("quotes", {
  method: "POST",
  body: JSON.stringify({
    enquiry_ref: REF,
    version: 1,
    amount_inr: amount,
    basis: "per CBM plus THC both ends and documentation fee — quoted on call",
    sailing_date: "2026-09-08",
    valid_until: "2026-09-06",
    status: "accepted",
    sent_at: "2026-09-04T09:40:00Z",
    responded_at: "2026-09-04T11:05:00Z",
    verbal_accept_at: "2026-09-04T09:15:00Z",
    accepted_via: "email",
    accepted_message_id: "DEMO-MSG-0001",
    acceptance_note: "Confirmed by email from rajesh@velmurugantextiles.example",
  }),
});

// A partner on the shipment, so the case file shows the network in use.
const [agent] = await db("partners?role=eq.overseas_agent&active=eq.true&select=id&limit=1");
if (agent) {
  await db("rpc/assign_partner", {
    method: "POST",
    body: JSON.stringify({ p_ref: REF, p_partner_id: agent.id, p_role: "overseas_agent", p_note: "" }),
  });
}

// A timeline somebody can read top to bottom.
await db("enquiry_events", {
  method: "POST",
  body: JSON.stringify([
    { enquiry_ref: REF, kind: "created", summary: "Enquiry opened from call", detail: { call_id: CALL } },
    { enquiry_ref: REF, kind: "field_updated", summary: "Cargo details captured from the call", detail: { fields: 11 } },
    { enquiry_ref: REF, kind: "quote_sent", summary: `Quoted ₹${amount.toLocaleString("en-IN")} per CBM plus surcharges`, detail: { quote_id: quote.id } },
    { enquiry_ref: REF, kind: "verbal_accept", summary: "Caller agreed on the call — still to be confirmed in writing", detail: { quote_id: quote.id } },
    { enquiry_ref: REF, kind: "accepted", summary: `Customer confirmed in writing — ₹${amount.toLocaleString("en-IN")}`, detail: { quote_id: quote.id, via: "email" } },
  ]),
});

console.log(`
  ${REF} created

  customer   ${CUSTOMER}  Rajesh Venkatesan / Velmurugan Textiles Pvt Ltd
  route      Chennai to Singapore, FOB, ready 2026-09-06 from Tirupur
  cargo      ${PIECES} cartons of cotton bed linen, ${L} x ${W} x ${Hc} cm, ${KG} kg each
  derived    ${volume} CBM, ${gross} kg gross
  quote      v1 ₹${amount.toLocaleString("en-IN")} at ₹${RATE}/CBM, accepted in writing
  sailing    2026-09-08 to Singapore, cut-off 2026-09-06
  consignee  Tan Wei Ming, Singapore
  partner    ${agent ? "overseas agent assigned" : "none — seed partners first"}

  Open it at /enquiries/${REF}
`);
