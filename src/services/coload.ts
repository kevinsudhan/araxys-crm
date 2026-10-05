import { supabase } from "../lib/supabase";
import type { CsnListHouse } from "../lib/coload";
import type { ManifestLine } from "../lib/consoleManifest";
import { manifestFor } from "./consoleManifest";
import { updateConsole, type Console } from "./consoles";

/**
 * A co-load console's CSN when the co-loader files it (122): our houses as
 * they need them, and the record that the list went. The rules are
 * lib/coload.ts.
 */

export const setCsnBy = (c: Console, by: "us" | "coloader") => updateConsole(c.id, { csn_by: by });

export const markCsnListSent = (c: Console, to: string) => updateConsole(c.id, { csn_list_sent_at: new Date().toISOString(), csn_list_sent_to: to });

/** The houses with what the co-loader's CSN asks of each: on an export, each exporter's shipping bill too. */
export async function csnListFor(c: Console): Promise<{ houses: CsnListHouse[]; lines: ManifestLine[]; provisional: boolean }> {
  const m = await manifestFor(c);
  const exporting = c.direction !== "import";
  const ids = m.lines.map((l) => l.shipmentId);
  const sb = new Map<string, { sb_number: string | null; sb_date: string | null }>();
  if (exporting && ids.length) {
    const { data, error } = await supabase.from("shipment_customs").select("shipment_id, sb_number, sb_date").eq("side", "export").in("shipment_id", ids);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ shipment_id: string; sb_number: string | null; sb_date: string | null }>) sb.set(r.shipment_id, r);
  }
  const houses = m.lines.map((l) => ({
    hblNo: l.hblNo,
    shipper: l.shipper,
    consignee: l.consignee,
    packages: l.packages,
    packageType: l.packageType,
    grossKg: l.grossKg,
    cbm: l.cbm,
    description: l.description,
    sbNo: sb.get(l.shipmentId)?.sb_number ?? null,
    sbDate: sb.get(l.shipmentId)?.sb_date ?? null,
  }));
  return { houses, lines: m.lines, provisional: m.provisional };
}
