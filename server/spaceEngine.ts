/**
 * Container space-fit engine.
 *
 * This deliberately does NOT decide fit by comparing volumes. Volume math gets real
 * cases wrong: 30 CBM of cargo "fits" in a 33 CBM container by volume, but a single
 * 2.6m-tall crate does not fit a 2.39m-high 20GP at all, in any arrangement. So this
 * works in three dimensions, tries every axis-aligned orientation, and reasons about
 * how much container FLOOR LENGTH a consignment actually consumes -- which is how LCL
 * groupage space is really sold and how remaining space is really tracked.
 *
 * Model: a container is L x W x H internal. Existing bookings consume a run of floor
 * length from one end. Remaining space is therefore a cuboid of
 * (L - usedLength) x W x H, plus a remaining payload allowance in kg.
 */

export interface ContainerDims {
  code: string;
  internalLengthM: number;
  internalWidthM: number;
  internalHeightM: number;
  maxPayloadKg: number;
}

export interface CargoPiece {
  /** Dimensions of ONE piece, in centimetres (what a customer actually says on a call). */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  quantity: number;
  weightKgEach: number;
  /** False for fragile/non-stackable cargo -- then only one layer high is allowed. */
  stackable?: boolean;
  /**
   * True for "this way up" cargo -- machinery, drums, liquids, anything that cannot be
   * laid on its side. Restricts orientations to those that keep the stated height as
   * height; the piece may still be turned about the vertical axis.
   */
  uprightOnly?: boolean;
}

export interface SlotState {
  slotId: string;
  usedLengthM: number;
  usedWeightKg: number;
}

export type FitFailureReason =
  | "piece_too_large_for_container"
  | "not_enough_length_remaining"
  | "over_payload_limit"
  | "invalid_input";

export interface FitResult {
  fits: boolean;
  reason?: FitFailureReason;
  /** Human-readable explanation the voice agent can say out loud verbatim. */
  explanation: string;
  /** Orientation chosen, as the piece's footprint in metres (l x w x h as loaded). */
  orientation?: { lengthM: number; widthM: number; heightM: number };
  piecesAcrossWidth?: number;
  piecesStackedHigh?: number;
  piecesPerRow?: number;
  rowsNeeded?: number;
  /** Floor length this consignment would consume, in metres. */
  lengthConsumedM?: number;
  totalWeightKg?: number;
  /** How many pieces COULD fit in the remaining space (useful when the full qty doesn't). */
  maxPiecesThatFit?: number;
  remainingAfter?: { lengthM: number; payloadKg: number };
}

const EPS = 1e-9;

/**
 * Axis-aligned orientations as [alongLength, acrossWidth, vertical].
 * With uprightOnly, the vertical dimension is pinned to the piece's stated height and
 * only the two footprint rotations remain -- a drum can be turned, never laid down.
 */
function orientations(
  l: number,
  w: number,
  h: number,
  uprightOnly: boolean
): Array<[number, number, number]> {
  if (uprightOnly) {
    return [
      [l, w, h],
      [w, l, h],
    ];
  }
  return [
    [l, w, h],
    [l, h, w],
    [w, l, h],
    [w, h, l],
    [h, l, w],
    [h, w, l],
  ];
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Checks whether a consignment fits into the space remaining in one container slot.
 * Returns not just a yes/no but the actual loading arrangement and what's left after,
 * so the agent can explain a real answer instead of asserting a bare verdict.
 */
export function checkFit(
  container: ContainerDims,
  remaining: { lengthM: number; payloadKg: number },
  piece: CargoPiece
): FitResult {
  const qty = Math.floor(piece.quantity);
  if (
    !(piece.lengthCm > 0) ||
    !(piece.widthCm > 0) ||
    !(piece.heightCm > 0) ||
    !(qty > 0) ||
    piece.weightKgEach < 0
  ) {
    return {
      fits: false,
      reason: "invalid_input",
      explanation: "The cargo dimensions or quantity given aren't usable -- length, width, height and quantity all need to be positive numbers.",
    };
  }

  const pl = piece.lengthCm / 100;
  const pw = piece.widthCm / 100;
  const ph = piece.heightCm / 100;
  const stackable = piece.stackable !== false;

  const totalWeightKg = round2(qty * piece.weightKgEach);

  // Try every orientation; keep the one that consumes the least floor length.
  let best: {
    orientation: { lengthM: number; widthM: number; heightM: number };
    across: number;
    stacked: number;
    perRow: number;
    rows: number;
    lengthNeeded: number;
  } | null = null;

  let anyOrientationPhysicallyPossible = false;
  let bestCapacityInRemaining = 0;

  for (const [ol, ow, oh] of orientations(pl, pw, ph, piece.uprightOnly === true)) {
    // Must physically fit the container cross-section at all, ignoring current occupancy.
    if (ow > container.internalWidthM + EPS) continue;
    if (oh > container.internalHeightM + EPS) continue;
    if (ol > container.internalLengthM + EPS) continue;
    anyOrientationPhysicallyPossible = true;

    const across = Math.floor((container.internalWidthM + EPS) / ow);
    const stacked = stackable ? Math.floor((container.internalHeightM + EPS) / oh) : 1;
    const perRow = across * stacked;
    if (perRow <= 0) continue;

    // Capacity within the space that's actually left.
    const rowsThatFitInRemaining = Math.floor((remaining.lengthM + EPS) / ol);
    bestCapacityInRemaining = Math.max(bestCapacityInRemaining, rowsThatFitInRemaining * perRow);

    const rows = Math.ceil(qty / perRow);
    const lengthNeeded = round2(rows * ol);

    if (!best || lengthNeeded < best.lengthNeeded) {
      best = {
        orientation: { lengthM: round2(ol), widthM: round2(ow), heightM: round2(oh) },
        across,
        stacked,
        perRow,
        rows,
        lengthNeeded,
      };
    }
  }

  if (!anyOrientationPhysicallyPossible || !best) {
    const uprightNote = piece.uprightOnly
      ? ` Because this cargo has to stay upright, it can't be laid on its side to make it fit.`
      : "";
    return {
      fits: false,
      reason: "piece_too_large_for_container",
      explanation:
        `A single piece measuring ${piece.lengthCm} by ${piece.widthCm} by ${piece.heightCm} centimetres won't physically go into a ${container.code} in any allowed orientation -- ` +
        `that container's internal space is ${container.internalLengthM}m long, ${container.internalWidthM}m wide and ${container.internalHeightM}m high.${uprightNote} This needs a different container type.`,
      totalWeightKg,
    };
  }

  const overWeight = totalWeightKg > remaining.payloadKg + EPS;
  const overLength = best.lengthNeeded > remaining.lengthM + EPS;

  if (overWeight && !overLength) {
    return {
      fits: false,
      reason: "over_payload_limit",
      explanation:
        `The cargo physically fits, but the weight doesn't. ${qty} pieces at ${piece.weightKgEach}kg each is ${totalWeightKg}kg, ` +
        `and only ${round2(remaining.payloadKg)}kg of payload is left on this container.`,
      totalWeightKg,
      maxPiecesThatFit: bestCapacityInRemaining,
    };
  }

  if (overLength) {
    return {
      fits: false,
      reason: "not_enough_length_remaining",
      explanation:
        `This consignment needs about ${best.lengthNeeded}m of container floor, but only ${round2(remaining.lengthM)}m is left on this sailing. ` +
        (bestCapacityInRemaining > 0
          ? `About ${bestCapacityInRemaining} of the ${qty} pieces would fit in the space remaining.`
          : `There isn't enough room for even one piece.`),
      orientation: best.orientation,
      piecesAcrossWidth: best.across,
      piecesStackedHigh: best.stacked,
      piecesPerRow: best.perRow,
      rowsNeeded: best.rows,
      lengthConsumedM: best.lengthNeeded,
      totalWeightKg,
      maxPiecesThatFit: bestCapacityInRemaining,
    };
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return {
    fits: true,
    explanation:
      `Yes -- ${plural(qty, "piece loads", "pieces load")} as ${best.across} across by ${best.stacked} high, ` +
      `${best.perRow} per row, ${plural(best.rows, "row", "rows")} deep, ` +
      `taking about ${best.lengthNeeded}m of container floor and ${totalWeightKg}kg of payload.`,
    orientation: best.orientation,
    piecesAcrossWidth: best.across,
    piecesStackedHigh: best.stacked,
    piecesPerRow: best.perRow,
    rowsNeeded: best.rows,
    lengthConsumedM: best.lengthNeeded,
    totalWeightKg,
    maxPiecesThatFit: bestCapacityInRemaining,
    remainingAfter: {
      lengthM: round2(remaining.lengthM - best.lengthNeeded),
      payloadKg: round2(remaining.payloadKg - totalWeightKg),
    },
  };
}

/** Usable volume of the space left, for reporting only -- never used to decide fit. */
export function remainingCbm(container: ContainerDims, remainingLengthM: number) {
  return round2(remainingLengthM * container.internalWidthM * container.internalHeightM);
}
