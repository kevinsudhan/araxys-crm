/**
 * Registers the live space-availability tool on Priya (agent 717).
 *
 * Requires a PUBLIC base URL — SnapServe's servers call this endpoint mid-conversation,
 * so localhost:8787 will not work. Run a tunnel first (see snapserve-setup/README.md),
 * then pass the public origin:
 *
 *   node register-space-tool.cjs https://your-tunnel-host
 *
 * Verified: the webhook tool schema below is accepted and persisted by the SnapServe API
 * (tested against agent 758 before being applied here).
 */
const fs = require("fs");
const path = require("path");

const publicBase = process.argv[2];
if (!publicBase || !/^https?:\/\//.test(publicBase)) {
  console.error("Usage: node register-space-tool.cjs https://your-public-host");
  console.error("The URL must be reachable from the internet — SnapServe calls it during the call.");
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const AGENT_ID = 717;
const tools = [
  { type: "end_call", name: "end_call", description: "End the call when the conversation is complete." },
  {
    type: "webhook",
    name: "check_container_space",
    description:
      "Check whether the customer's cargo physically fits on a sailing, and how much space is left. " +
      "Call this whenever a customer asks about availability, space, or shipping on a particular date. " +
      "Always ask for the dimensions of one piece, how many pieces, and the weight per piece before calling. " +
      "Never estimate fit yourself from CBM — this tool checks it in three dimensions against live bookings.",
    url: `${publicBase.replace(/\/$/, "")}/api/tools/check-space`,
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route in the customer's words, e.g. 'Chennai to Singapore'" },
        sailing_date: { type: "string", description: "Preferred sailing date, YYYY-MM-DD. Omit if the customer has no preference." },
        length_cm: { type: "number", description: "Length of ONE piece in centimetres" },
        width_cm: { type: "number", description: "Width of ONE piece in centimetres" },
        height_cm: { type: "number", description: "Height of ONE piece in centimetres" },
        quantity: { type: "number", description: "How many pieces" },
        weight_kg_each: { type: "number", description: "Weight of one piece in kilograms" },
        stackable: { type: "boolean", description: "False if the pieces cannot be stacked on top of each other" },
        upright_only: { type: "boolean", description: "True if the cargo must stay upright and cannot be laid on its side" },
      },
      required: ["route", "length_cm", "width_cm", "height_cm", "quantity"],
    },
  },
  {
    type: "webhook",
    name: "lookup_shipment",
    description:
      "Look up the confirmed facts for an existing shipment — status, ETA, container number, " +
      "free days remaining, demurrage date, and which documents are received or still outstanding. " +
      "CRITICAL: if the caller says a BL number, you MUST pass it as bl_number. Do not call this tool " +
      "with empty arguments and do not answer from the CRM update block injected at the start of the " +
      "call — that block describes this caller's own most recent shipment, which is very often NOT the " +
      "shipment they are asking about. A caller can ask about any BL number, including one that belongs " +
      "to a different route entirely. Only use the phone argument when the caller has no BL number at " +
      "all. If this returns found=false, say exactly what it tells you and never substitute a " +
      "similar-looking shipment.",
    url: `${publicBase.replace(/\/$/, "")}/api/tools/lookup-shipment`,
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        bl_number: {
          type: "string",
          description:
            "The BL number the caller said, e.g. MSCU7291044 or OOLU9013345. Letters and digits, no spaces or dashes. " +
            "Transcribe exactly what they said, including when they spell it out letter by letter " +
            "('O-O-L-U nine zero one three three four five' becomes OOLU9013345). " +
            "This is REQUIRED. If the caller genuinely has no BL number to hand, pass the exact string NONE " +
            "and the lookup will fall back to their phone number.",
        },
        phone: {
          type: "string",
          description: "The caller's phone number. Only used when bl_number is NONE.",
        },
      },
      required: ["bl_number"],
    },
  },
  {
    type: "webhook",
    name: "save_customer_enquiry",
    description:
      "Save this caller's details so we have a record of them. Call this near the END of any call " +
      "with a customer who is enquiring about a new shipment, as soon as you know their name, " +
      "company and what they want to ship — even if they have not booked anything and have no BL " +
      "number. The phone number is required; everything else is optional, so send whatever you " +
      "actually learned and leave the rest out. Calling this is what lets us recognise them the " +
      "next time they ring, so do not skip it just because the enquiry is unfinished.",
    // Permanent Supabase Edge Function URL, not the tunnel. This endpoint must keep
    // working when no laptop is running — a dead URL here means the agent silently stops
    // recording callers mid-call and nobody finds out until the records are missing.
    url: env.SUPABASE_URL
      ? `${env.SUPABASE_URL}/functions/v1/save-customer`
      : `${publicBase.replace(/\/$/, "")}/api/tools/save-customer`,
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string", description: "The caller's phone number. Required." },
        customer_name: { type: "string", description: "Contact person's name" },
        company: { type: "string", description: "Their company name" },
        origin: { type: "string", description: "Origin port or city" },
        destination: { type: "string", description: "Destination port or city" },
        cargo_description: { type: "string", description: "What they are shipping, in their words" },
        volume_cbm: { type: "number", description: "Volume in CBM if mentioned" },
        container_type: { type: "string", description: "LCL, 20GP, 40GP, 40HC, 20RF or 40RF" },
        quoted_amount_inr: { type: "number", description: "Amount you quoted them, in rupees" },
        agreed_amount_inr: { type: "number", description: "Final agreed rate if they accepted" },
        sailing_date: { type: "string", description: "Sailing date discussed, YYYY-MM-DD" },
        status: { type: "string", description: "Short status, e.g. 'quoted, awaiting confirmation'" },
        notes: { type: "string", description: "Anything else worth recording for the next call" },
      },
      required: ["phone"],
    },
  },
];

(async () => {
  const r = await fetch(`${env.SNAPSERVE_BASE_URL}/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.SNAPSERVE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tools }),
  });
  const body = await r.json();
  if (!r.ok) {
    console.error(`Failed: HTTP ${r.status}`, body);
    process.exit(1);
  }
  console.log(`HTTP ${r.status} — Priya's tools are now: ${body.tools.map((t) => t.name).join(", ")}`);
  console.log(`check_container_space -> ${tools[1].url}`);
})();
