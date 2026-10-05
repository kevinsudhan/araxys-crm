import { supabase } from "../lib/supabase";
import { normaliseHbl, type HblData } from "../lib/hbl";
import { checkHouseAgainstMaster, type HouseRow, type MasterFacts } from "../lib/houseMaster";
import { boxesFrom, type JobBoxLine } from "../lib/masterBill";
import { shipmentsOn, type Console } from "./consoles";
import { copyOf } from "./importMaster";

/**
 * The houses on a console against its master (123). The rules are
 * lib/houseMaster.ts.
 */

/** The master's boxes: the master copy's on an import once read, otherwise the boxes on the console's jobs. */
export async function masterFactsFor(c: Console, jobIds?: string[]): Promise<MasterFacts> {
  const copy = c.direction === "import" ? copyOf(c) : null;
  let boxes: MasterFacts["boxes"] = null;
  if (copy && copy.bill.containers.length) {
    boxes = copy.bill.containers.map((b) => ({ container_no: b.container_no, seal_no: b.seal_no }));
  } else {
    const ids = jobIds ?? (await shipmentsOn(c.id)).map((j) => j.id);
    if (ids.length) {
      const { data, error } = await supabase.from("shipment_containers").select("shipment_id, container_no, size_type, seal_no, package_count, weight_kg, volume_cbm").in("shipment_id", ids);
      if (error) throw new Error(error.message);
      const found = boxesFrom((data ?? []) as JobBoxLine[]);
      if (found.length) boxes = found.map((b) => ({ container_no: b.container_no, seal_no: b.seal_no }));
    }
  }
  return {
    console_no: c.console_no,
    mblNo: c.mbl_number || copy?.bl_no || null,
    vessel: c.vessel,
    voyage: c.voyage,
    pol: c.pol,
    pod: c.pod,
    boxes,
  };
}

export interface HouseOnConsole {
  shipmentId: string;
  ref: string;
  hblNo: string | null;
  /** Whose B/L it is: ours, or the agent's or co-loader's received one. */
  theirs: boolean;
  rows: HouseRow[];
}

/** Every house on the console, checked: ours where we issue it, the received one where somebody else does. */
export async function checkConsoleHouses(c: Console): Promise<{ facts: MasterFacts; houses: HouseOnConsole[] }> {
  const jobs = await shipmentsOn(c.id);
  const ids = jobs.map((j) => j.id);
  const [facts, ours, received] = await Promise.all([
    masterFactsFor(c, ids),
    ids.length ? supabase.from("house_bills").select("shipment_id, hbl_no, data").in("shipment_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("received_house_bills").select("shipment_id, hbl_no, data").in("shipment_id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  if (ours.error) throw new Error(ours.error.message);
  if (received.error) throw new Error(received.error.message);
  type Row = { shipment_id: string; hbl_no: string | null; data: unknown };
  const oursBy = new Map(((ours.data ?? []) as Row[]).map((r) => [r.shipment_id, r]));
  const theirsBy = new Map(((received.data ?? []) as Row[]).map((r) => [r.shipment_id, r]));
  const houses: HouseOnConsole[] = [];
  for (const j of jobs) {
    // Whose bill the cargo travels under (035): unset on an import means the origin agent's.
    const theirs = j.bl_type === "forwarder" || (!j.bl_type && c.direction === "import");
    const r = theirs ? theirsBy.get(j.id) : oursBy.get(j.id);
    if (!r) continue;
    const data: HblData = normaliseHbl(r.data as never);
    houses.push({ shipmentId: j.id, ref: j.enquiry_ref, hblNo: r.hbl_no || null, theirs, rows: checkHouseAgainstMaster(data, r.hbl_no, facts) });
  }
  return { facts, houses };
}
