import { getSpaceSlots, getSlotPlan, type SlotPlan, type SpaceSlot } from "../services/backend";

/**
 * Finds the container a shipment is actually loaded in, and which block inside it is theirs.
 *
 * There is no foreign key between a shipment and a placement — the space engine was built
 * around sailings and consignments, the CRM around customers and bills of lading, and the
 * two were never joined. Rather than invent a column and backfill it, this resolves the
 * link from what both sides already record.
 *
 * The matching is deliberately ordered strongest-first, and stops at the first confident
 * hit. Showing a customer the wrong block highlighted inside the right container is worse
 * than showing them the container with nothing highlighted, because the first looks
 * authoritative and the second obviously needs a human.
 */

export interface StowMatch {
  plan: SlotPlan;
  /** The consignment that belongs to this shipment, or null when only the sailing matched. */
  consignmentId: string | null;
  /** How the link was established, surfaced in the UI so nobody treats a guess as a fact. */
  basis: "reference" | "client" | "route" | "none";
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** "Chennai -> Jebel Ali, Dubai" and "Chennai"/"Jebel Ali, Dubai" describe the same lane. */
function routeMatches(slotRoute: string, origin?: string, destination?: string): boolean {
  const r = norm(slotRoute);
  const o = norm(origin);
  const d = norm(destination);
  if (!o || !d) return false;
  // Compare on the leading token of each end, so "Jebel Ali" matches "Jebel Ali, Dubai".
  const head = (x: string) => x.split(",")[0].trim();
  return r.includes(head(o)) && r.includes(head(d));
}

export interface StowQuery {
  blNumber?: string;
  reference?: string;
  company?: string;
  origin?: string;
  destination?: string;
}

export async function findStow(q: StowQuery): Promise<StowMatch | null> {
  const { slots } = await getSpaceSlots();
  if (!slots?.length) return null;

  // Sailings on this lane first — it is both the likeliest place to find them and a
  // cheap way to avoid pulling the plan for every container on the board.
  const onRoute = slots.filter((s: SpaceSlot) => routeMatches(s.route, q.origin, q.destination));
  const ordered = [...onRoute, ...slots.filter((s: SpaceSlot) => !onRoute.includes(s))];

  let routeFallback: SlotPlan | null = null;

  for (const slot of ordered) {
    let plan: SlotPlan;
    try {
      plan = await getSlotPlan(slot.id);
    } catch {
      continue;
    }

    for (const c of plan.consignments) {
      // A reference or BL number is issued, unique, and printed on the paperwork.
      if (q.blNumber && norm(c.reference) === norm(q.blNumber)) {
        return { plan, consignmentId: c.id, basis: "reference" };
      }
      if (q.reference && norm(c.reference) === norm(q.reference)) {
        return { plan, consignmentId: c.id, basis: "reference" };
      }
    }

    for (const c of plan.consignments) {
      // A company name is weaker: two enquiries from the same customer on the same lane
      // are indistinguishable here. Good enough to highlight, not to print on a document.
      if (q.company && norm(c.clientName) === norm(q.company)) {
        return { plan, consignmentId: c.id, basis: "client" };
      }
    }

    // Keep the first sailing on the right lane, in case nothing inside it matches.
    if (!routeFallback && onRoute.includes(slot)) routeFallback = plan;
  }

  if (routeFallback) return { plan: routeFallback, consignmentId: null, basis: "route" };
  return null;
}

export const BASIS_LABEL: Record<StowMatch["basis"], string> = {
  reference: "Matched on reference number",
  client: "Matched on customer name — confirm before relying on it",
  route: "No consignment matched; showing the sailing on this route",
  none: "Not matched to a container",
};
