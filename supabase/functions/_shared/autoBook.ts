/**
 * Allocates container space for a record the moment it becomes a booking.
 *
 * The agent does not do this. It has no tools and is never asked to reserve anything —
 * webhook tool results were verified not to reach the model on this stack, and a voice
 * agent that thinks it booked space when it did not is worse than one that never tries.
 * So the allocation happens here, server-side, immediately after a record is promoted:
 * the call establishes the facts, the CRM commits them.
 *
 * Everything this needs was already being captured. The dimensions, the piece count and
 * the weight come off the transcript; the route and the sailing date are what promoted
 * the record in the first place. No new question is asked of the customer.
 *
 * The refusals matter more than the successes here. Booking the wrong sailing, or
 * booking twice, or squeezing cargo into a container it does not fit, are all worse than
 * not booking — each one commits real floor space against a real vessel. So every branch
 * that cannot be certain returns a reason instead of a placement, and the reason is
 * carried back to the caller rather than logged and forgotten.
 */
import {
  listSlots,
  placementsFor,
  commitBooking,
  type CargoPiece,
  type SlotRow,
} from "./space.ts";

export type BookOutcome =
  | { booked: true; slotId: string; placementId: string; lengthM: number }
  | { booked: false; reason: string };

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** "Chennai" + "Jebel Ali, Dubai" against "Chennai -> Jebel Ali, Dubai". */
function routeMatches(slotRoute: string, origin?: string, destination?: string): boolean {
  if (!origin || !destination) return false;
  const r = slotRoute.toLowerCase();
  const head = (x: string) => x.split(",")[0].trim().toLowerCase();
  return r.includes(head(origin)) && r.includes(head(destination));
}

/**
 * The cargo, if the call established enough of it to load a container.
 *
 * All five are required and none is inferred. A missing weight cannot be assumed from
 * volume, and a missing dimension cannot be borrowed from another — the fit engine works
 * in three dimensions precisely because cargo that fits by volume can still be too tall
 * to stand up, and guessing any input would defeat the check entirely.
 */
export function pieceFromDetails(d: Record<string, unknown>): CargoPiece | null {
  const lengthCm = num(d.piece_length_cm);
  const widthCm = num(d.piece_width_cm);
  const heightCm = num(d.piece_height_cm);
  const quantity = num(d.piece_count);
  const weightKgEach = num(d.weight_per_piece_kg);

  if (!lengthCm || !widthCm || !heightCm || !quantity || !weightKgEach) return null;

  return {
    lengthCm,
    widthCm,
    heightCm,
    quantity,
    weightKgEach,
    // Unstated stackability is treated as not stackable: assuming cargo can be stacked
    // when nobody said so is how a container gets planned around a stack that cannot
    // legally exist. The conservative default costs floor, not safety.
    stackable: d.stackable === true,
    uprightOnly: d.upright_only === true,
  };
}

/** Already allocated? A re-extraction must not book the same consignment twice. */
async function alreadyPlaced(slots: SlotRow[], reference: string): Promise<string | null> {
  for (const slot of slots) {
    const placements = await placementsFor(slot.id);
    if (placements.some((p) => p.reference === reference)) return slot.id;
  }
  return null;
}

export async function autoBookSpace(args: {
  reference: string;
  clientName: string;
  origin?: string;
  destination?: string;
  sailingDate: string;
  details: Record<string, unknown>;
}): Promise<BookOutcome> {
  const piece = pieceFromDetails(args.details);
  if (!piece) {
    return { booked: false, reason: "cargo dimensions, piece count or weight not established on the call" };
  }

  const slots = await listSlots();
  if (!slots?.length) return { booked: false, reason: "no sailings on the board" };

  const existing = await alreadyPlaced(slots, args.reference);
  if (existing) return { booked: false, reason: `already allocated on ${existing}` };

  const onRoute = slots.filter((s) => routeMatches(s.route, args.origin, args.destination));
  if (!onRoute.length) {
    return { booked: false, reason: `no sailing on ${args.origin ?? "?"} to ${args.destination ?? "?"}` };
  }

  // The agreed date only. Silently moving a customer to the next sailing would commit
  // them to a date nobody read back to them on the call; that is the desk's decision to
  // make, and it can make it on the Space & containers page.
  const target = onRoute.find((s) => String(s.sailing_date).slice(0, 10) === args.sailingDate);
  if (!target) {
    return { booked: false, reason: `no sailing on ${args.sailingDate} for this route` };
  }

  const placed = await commitBooking({
    slotId: target.id,
    clientName: args.clientName,
    // The record's own reference, so the CRM can match this placement back to the
    // shipment by the strongest signal it has rather than by customer name.
    reference: args.reference,
    piece,
    source: "crm",
  });

  if (!placed) {
    return { booked: false, reason: `does not fit the space left on ${target.id}` };
  }

  return {
    booked: true,
    slotId: target.id,
    placementId: String(placed.id),
    lengthM: Number(placed.length_m),
  };
}
