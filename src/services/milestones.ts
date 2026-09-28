import { supabase } from "../lib/supabase";
import type { MilestoneLike } from "../lib/milestones";

/**
 * The customer's milestones on a job (102).
 *
 * Read like any table; written only through the functions in 102, which
 * refuse a signed-off or cancelled job, a date in the future, and a standing
 * milestone being deleted — and which move the job's stage when the milestone
 * marks one. What they refuse comes back in the desk's words.
 */

export interface ShipmentMilestone extends MilestoneLike {
  id: string;
  shipment_id: string;
  code: string;
  location: string;
  note: string;
  hidden: boolean;
  added: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export interface MilestoneEntry {
  /** YYYY-MM-DD, or null for "not reached". */
  on: string | null;
  /** HH:MM, or null when only the day is known. */
  time: string | null;
  location: string;
  note: string;
  hidden: boolean;
}

export async function milestonesFor(shipmentId: string): Promise<ShipmentMilestone[]> {
  const { data, error } = await supabase.from("shipment_milestones").select("*").eq("shipment_id", shipmentId).order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as ShipmentMilestone[];
}

/** `label`: new wording for an update the desk added; ignored for the standing ones. */
export async function saveMilestone(id: string, e: MilestoneEntry, label?: string): Promise<ShipmentMilestone> {
  const { data, error } = await supabase.rpc("save_shipment_milestone", {
    p_id: id,
    p_on: e.on,
    p_time: e.on ? e.time || null : null,
    p_location: e.location,
    p_note: e.note,
    p_hidden: e.hidden,
    p_label: label ?? null,
  });
  if (error) throw new Error(error.message);
  return data as ShipmentMilestone;
}

/** An update of the desk's own: "Transhipped at Colombo". */
export async function addUpdate(shipmentId: string, label: string, e: Omit<MilestoneEntry, "hidden"> & { on: string }): Promise<ShipmentMilestone> {
  const { data, error } = await supabase.rpc("add_shipment_update", {
    p_shipment_id: shipmentId,
    p_label: label,
    p_on: e.on,
    p_time: e.time || null,
    p_location: e.location,
    p_note: e.note,
  });
  if (error) throw new Error(error.message);
  return data as ShipmentMilestone;
}

export async function deleteUpdate(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_shipment_update", { p_id: id });
  if (error) throw new Error(error.message);
}

/** "Not reached after all" for the milestone that marks a stage — the case file's "back to in process". */
export async function clearStage(shipmentId: string, stage: string): Promise<void> {
  const m = (await milestonesFor(shipmentId)).find((x) => x.stage === stage);
  if (!m?.reached_on) return;
  await saveMilestone(m.id, { on: null, time: null, location: m.location, note: m.note, hidden: m.hidden });
}
