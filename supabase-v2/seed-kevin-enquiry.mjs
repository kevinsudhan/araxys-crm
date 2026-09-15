/**
 * A second complete enquiry, under Kevin's name, every field filled.
 *
 *   node supabase-v2/seed-kevin-enquiry.mjs
 *   node supabase-v2/seed-kevin-enquiry.mjs --clear
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND ONE, AND WHY IT DIFFERS
 *
 * Two populated enquiries let a walkthrough show the list as well as the case
 * file, and this one is deliberately not a copy: the cargo is NOT stackable,
 * the pieces are square rather than oblong, and the cargo is not ready until
 * after the first sailing has closed — so it sits on the later one. Each of
 * those makes a visibly different container stow and a different reason for the
 * sailing that was chosen.
 *
 * As with the other seed, the figures are internally consistent: volume and
 * gross weight are computed from the piece dimensions the way the CRM computes
 * them, and the quote is the real Chennai-Singapore rate multiplied by that
 * volume. The customer is fictional and the address is at .example, which
 * cannot resolve.
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

const CUSTOMER = "CKEVIN";
const REF = "ARX-CKEVIN-E01";
const CALL = "demo-call-kevin";

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

// Everything below is derived from these five numbers.
const PIECES = 18;
const L = 100, W = 100, Hc = 80; // cm
const KG = 62;

const volume = Number(((L * W * Hc * PIECES) / 1_000_000).toFixed(2)); // 14.4 CBM
const gross = KG * PIECES; // 1116 kg
const RATE = 4200; // Chennai to Singapore, per CBM, from the rate card
const amount = Math.round(volume * RATE); // 60,480

await db("customers", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({
    id: CUSTOMER,
    name: "Kevin Sudhan",
    company: "Kevin Exports",
    phones: ["918939153390"],
    emails: ["kevin@kevinexports.example"],
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
    cargo: "Handloom cotton sarees, cartons",
    cargo_type: "General",
    incoterm: "FOB",
    ready_date: "2026-09-11",
    pickup_location: "Kanchipuram, Tamil Nadu",
    piece_count: PIECES,
    piece_length_cm: L,
    piece_width_cm: W,
    piece_height_cm: Hc,
    weight_per_piece_kg: KG,
    gross_weight_kg: gross,
    volume_cbm: volume,
    stackable: false,
    upright_only: true,
    special_handling: "Do not double-stack — sarees crush. Cartons on pallets, keep dry.",
    consignee_name: "Lim Hui Shan",
    consignee_country: "Singapore",
    notes: "First shipment with us. Wants the quotation by email before confirming.",
  }),
});

await db("calls", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({
    call_id: CALL,
    enquiry_ref: REF,
    customer_id: CUSTOMER,
    agent_name: "Priya",
    from_number: "918939153390",
    duration_secs: 214,
    language: "Tamil / English",
    matched_by: "phone",
    started_at: "2026-09-05T06:40:00Z",
    ended_at: "2026-09-05T06:43:34Z",
    extracted_at: new Date().toISOString(),
    summary:
      "Kevin from Kevin Exports is sending 18 cartons of handloom cotton sarees from " +
      "Chennai to Singapore, 100 x 100 x 80 cm each at 62 kg, not stackable. Cargo ready " +
      "11 September at Kanchipuram. Quoted 4,200 per CBM on 14.4 CBM, total 60,480 plus " +
      "THC and documentation. Took the 15 September sailing because the cargo is not " +
      "ready for the 8th, and confirmed by email.",
    transcript:
      "Agent: Hi, this is Priya from the forwarder desk at Aashish Logistics Global. How can I help you today?\n" +
      "Caller: I want to send some cartons to Singapore.\n" +
      "Agent: Sure, I can help with that. Before we proceed, which language would you be comfortable speaking in?\n" +
      "Caller: Tamil la pesalam.\n" +
      "Agent: Sari. Enga irundhu enga anuppanum?\n" +
      "Caller: Chennai la irundhu Singapore ku.\n" +
      "Agent: Documentation-kaga unga perai therinjukkalama?\n" +
      "Caller: Kevin Sudhan.\n" +
      "Agent: Kevin, endha company la irundhu anuppureenga?\n" +
      "Caller: Kevin Exports.\n" +
      "Agent: Enna porul anuppureenga?\n" +
      "Caller: Handloom cotton sarees, cartons la pack panni.\n" +
      "Agent: Oru carton oda size sollunga. Length, width, height.\n" +
      "Caller: Nooru by nooru by embathu centimetre.\n" +
      "Agent: Moththam eththanai cartons irukku?\n" +
      "Caller: Pathinettu.\n" +
      "Agent: Oru carton oda weight?\n" +
      "Caller: Arubathi rendu kilo.\n" +
      "Agent: Ivai stack panna mudiyuma, illa thaniya vaikkanuma?\n" +
      "Caller: Stack panna vendam, mela vachaa saree damage aagum.\n" +
      "Agent: Noted. Cargo eppo ready aagum, truck collect panna?\n" +
      "Caller: Pathinonnaam thedhi, Kanchipuram la irundhu.\n" +
      "Agent: Chennai la irundhu Singapore ku oru CBM-ku 4,200 rupees. Unga volume 14.4 CBM, " +
      "so total 60,480 rupees. THC rendu pakkamum, documentation fee extra varum. Cargo " +
      "pathinonnaam thedhi than ready, so ettaam thedhi sailing miss aagidum. " +
      "Pathinanjaam thedhi sailing irukku, cut-off pathimoonaam thedhi. Adhula proceed pannalama?\n" +
      "Caller: Ama, adhu okay. Aana quotation email la anuppunga, naan paathutu confirm panren.\n" +
      "Agent: Kandippa. Unga email address sollunga.\n" +
      "Caller: kevin at kevinexports dot example.\n" +
      "Agent: kevin at kevinexports dot example, correct-a? Ippo Arun kitta transfer panren, " +
      "avaru documentation details vaanguvaaru.\n",
  }),
});

const [quote] = await db("quotes", {
  method: "POST",
  body: JSON.stringify({
    enquiry_ref: REF,
    version: 1,
    amount_inr: amount,
    basis: "per CBM plus THC both ends and documentation fee — quoted on call",
    sailing_date: "2026-09-15",
    valid_until: "2026-09-13",
    status: "accepted",
    sent_at: "2026-09-05T07:05:00Z",
    responded_at: "2026-09-05T09:20:00Z",
    verbal_accept_at: "2026-09-05T06:43:00Z",
    accepted_via: "email",
    accepted_message_id: "DEMO-MSG-KEVIN-01",
    acceptance_note: "Confirmed by email from kevin@kevinexports.example",
  }),
});

// A consol partner rather than an overseas agent, so the two demo records do
// not show the same partner type.
const [partner] = await db(
  "partners?role=eq.consol_partner&active=eq.true&select=id,organisation&limit=1"
);
if (partner) {
  await db("rpc/assign_partner", {
    method: "POST",
    body: JSON.stringify({
      p_ref: REF,
      p_partner_id: partner.id,
      p_role: "consol_partner",
      p_note: "",
    }),
  });
}

await db("enquiry_events", {
  method: "POST",
  body: JSON.stringify([
    { enquiry_ref: REF, kind: "created", summary: "Enquiry opened from call", detail: { call_id: CALL } },
    { enquiry_ref: REF, kind: "field_updated", summary: "Cargo details captured from the call", detail: { fields: 12 } },
    { enquiry_ref: REF, kind: "quote_sent", summary: `Quoted ₹${amount.toLocaleString("en-IN")} at ₹${RATE}/CBM plus surcharges`, detail: { quote_id: quote.id } },
    { enquiry_ref: REF, kind: "verbal_accept", summary: "Caller agreed on the call — still to be confirmed in writing", detail: { quote_id: quote.id } },
    { enquiry_ref: REF, kind: "accepted", summary: `Customer confirmed in writing — ₹${amount.toLocaleString("en-IN")}`, detail: { quote_id: quote.id, via: "email" } },
  ]),
});

console.log(`
  ${REF} created

  customer   ${CUSTOMER}  Kevin Sudhan / Kevin Exports  (918939153390)
  route      Chennai to Singapore, FOB, ready 2026-09-11 from Kanchipuram
  cargo      ${PIECES} cartons of handloom sarees, ${L} x ${W} x ${Hc} cm, ${KG} kg each
  handling   NOT stackable, upright only
  derived    ${volume} CBM, ${gross} kg gross
  quote      v1 ₹${amount.toLocaleString("en-IN")} at ₹${RATE}/CBM, accepted in writing
  sailing    2026-09-15 to Singapore, cut-off 2026-09-13
  consignee  Lim Hui Shan, Singapore
  partner    ${partner ? partner.organisation : "none — seed partners first"}

  Open it at /enquiries/${REF}
`);
