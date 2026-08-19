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
