/**
 * One-off: pushes the seeded sailing slots and their load plans into Postgres.
 *
 * Space used to live in process memory, which meant a restart wiped every booking back to
 * the seed. Once this has run, Postgres is the source of truth and the seed data in code
 * is only a starting point, not something re-applied on each boot.
 *
 *   npx tsx scripts/seed-space.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listSlots, placementsFor } from "../server/store";

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const line of readFileSync(join(__dirname, "..", "snapserve-setup", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const URL_BASE = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  const slots = listSlots();

  const slotRows = slots.map((s) => ({
    id: s.id,
    route: s.route,
    carrier: s.carrier,
    sailing_date: s.sailingDate,
    cutoff_date: s.cutoffDate,
    container_code: s.containerCode,
    mode: s.mode,
    status: s.status,
  }));

  await rest("space_slots", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(slotRows),
  });
  console.log(`seeded ${slotRows.length} slots`);

  const placementRows = slots.flatMap((s) =>
    placementsFor(s.id).map((p) => ({
      id: p.id,
      slot_id: p.slotId,
      client_name: p.clientName,
      reference: p.reference,
      x_m: p.xM,
      length_m: p.lengthM,
      pieces_across: p.piecesAcross,
      pieces_high: p.piecesHigh,
      rows_count: p.rows,
      quantity: p.quantity,
      piece_length_m: p.pieceLengthM,
      piece_width_m: p.pieceWidthM,
      piece_height_m: p.pieceHeightM,
      weight_kg: p.weightKg,
      color_index: p.colorIndex,
      source: p.source,
    }))
  );

  if (placementRows.length) {
    await rest("space_placements", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(placementRows),
    });
  }
  console.log(`seeded ${placementRows.length} placements`);

  const check = (await rest("space_slots?select=id")) as unknown[];
  const checkP = (await rest("space_placements?select=id")) as unknown[];
  console.log(`verified in Postgres: ${check.length} slots, ${checkP.length} placements`);
})();
