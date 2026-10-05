/**
 * The load plan for a console's box (125): where every house's pieces go on
 * the floor, whether it all fits, and how much floor each house takes.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FLOOR, NOT THE VOLUME
 *
 * Volume alone misleads. 30 CBM "fits" a box of 33, but a crate 2.6 m high
 * fits no 20GP in any arrangement, and ten pallets that must not be stacked
 * take the floor of a box they fill a third of. A consolidator sells space by
 * the floor it takes as much as by the cubic metre, so the plan is drawn on
 * the floor, from above.
 *
 * HOW IT IS LAID OUT
 *
 * Each piece passes the door or it does not go: its height under the door's,
 * its narrower side under the door's width. Pieces that may be stacked are
 * stacked to the box's height; the rest stand alone. Each stack is turned the
 * way that takes the least floor, and set in rows across the width. Houses go
 * in from the nose, heaviest first, each house's cargo together — the way a
 * CFS stuffs a box so each house comes out in one piece — and a short row of
 * one house shares its strip with the next house's where it fits beside it.
 *
 * A house with no piece sizes is drawn from its CBM, stood 2 m high across
 * the full width, and marked as an estimate.
 *
 * The boxes are the standard internal sizes; a particular line's box differs
 * by a few centimetres, which is why the plan is a plan and the CFS the word.
 * ---------------------------------------------------------------------------
 */

export type BoxType = "20GP" | "40GP" | "40HC";

export const BOX_TYPES: BoxType[] = ["20GP", "40GP", "40HC"];

/** Internal sizes in centimetres, the door opening, and what the box may carry, in kilos. */
export const BOX: Record<BoxType, { lengthCm: number; widthCm: number; heightCm: number; doorHeightCm: number; doorWidthCm: number; payloadKg: number }> = {
  "20GP": { lengthCm: 589, widthCm: 235, heightCm: 239, doorHeightCm: 228, doorWidthCm: 234, payloadKg: 28000 },
  "40GP": { lengthCm: 1203, widthCm: 235, heightCm: 239, doorHeightCm: 228, doorWidthCm: 234, payloadKg: 26700 },
  "40HC": { lengthCm: 1203, widthCm: 235, heightCm: 269, doorHeightCm: 258, doorWidthCm: 234, payloadKg: 26500 },
};

/** How high cargo with no sizes is assumed to stand. */
const ESTIMATE_HEIGHT_CM = 200;

export interface PieceGroup {
  count: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  kgEach: number;
  stackable: boolean;
}

export interface HouseCargo {
  houseId: string;
  house: string;
  /** Its pieces with sizes; empty when it has none. */
  groups: PieceGroup[];
  /** The house's CBM and weight: what an estimate is drawn from, and the weight counted. */
  cbm: number;
  kg: number;
}

export interface Placement {
  houseId: string;
  house: string;
  /** From the nose along the length, and across the width, in centimetres. */
  x: number;
  y: number;
  length: number;
  width: number;
  /** Pieces in this stack. */
  pieces: number;
  estimated: boolean;
}

export interface LoadPlan {
  box: BoxType;
  placements: Placement[];
  floorLengthCm: number;
  fits: boolean;
  floorPct: number;
  volumePct: number;
  weightKg: number;
  payloadPct: number;
  houses: Array<{ houseId: string; house: string; floorM: number; cbm: number; kg: number; estimated: boolean }>;
  problems: string[];
}

interface Item {
  across: number;
  along: number;
  pieces: number;
  estimated: boolean;
}
interface Row {
  houseId: string;
  house: string;
  depth: number;
  items: Item[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const m = (cm: number) => `${round2(cm / 100)} m`;

/** One group's rows: stacked as high as it may go, turned to take the least floor. */
function rowsFor(g: PieceGroup, b: (typeof BOX)[BoxType]): { rows: Array<{ depth: number; items: Item[] }>; problem: string | null } {
  if (g.heightCm > b.doorHeightCm) return { rows: [], problem: `pieces ${g.heightCm} cm high do not pass the ${b.doorHeightCm} cm door` };
  if (Math.min(g.lengthCm, g.widthCm) > Math.min(b.widthCm, b.doorWidthCm)) return { rows: [], problem: `pieces ${Math.min(g.lengthCm, g.widthCm)} cm wide do not pass the ${b.doorWidthCm} cm door` };
  const layers = g.stackable ? Math.max(1, Math.floor(b.heightCm / g.heightCm)) : 1;
  const stacks = Math.ceil(g.count / layers);
  const ways = [
    { across: g.widthCm, along: g.lengthCm },
    { across: g.lengthCm, along: g.widthCm },
  ]
    .filter((o) => o.across <= b.widthCm)
    .map((o) => {
      const perRow = Math.floor(b.widthCm / o.across);
      const rows = Math.ceil(stacks / perRow);
      return { ...o, perRow, rows, length: rows * o.along };
    })
    .sort((p, q) => p.length - q.length || p.rows - q.rows);
  const w = ways[0];
  const rows: Array<{ depth: number; items: Item[] }> = [];
  let left = g.count;
  for (let r = 0; r < w.rows; r++) {
    const items: Item[] = [];
    for (let k = 0; k < w.perRow && left > 0; k++) {
      const pieces = Math.min(layers, left);
      left -= pieces;
      items.push({ across: w.across, along: w.along, pieces, estimated: false });
    }
    rows.push({ depth: w.along, items });
  }
  return { rows, problem: null };
}

export function loadPlan(houses: HouseCargo[], box: BoxType): LoadPlan {
  const b = BOX[box];
  const problems: string[] = [];
  const estimated: string[] = [];
  // Heaviest in first, at the nose.
  const order = [...houses].sort((p, q) => q.kg - p.kg);
  const rows: Row[] = [];
  let volumeCm3 = 0;
  for (const h of order) {
    const sized = h.groups.filter((g) => g.count > 0 && g.lengthCm > 0 && g.widthCm > 0 && g.heightCm > 0);
    if (!sized.length) {
      if (h.cbm > 0) {
        estimated.push(h.house);
        const height = Math.min(ESTIMATE_HEIGHT_CM, b.heightCm);
        const depth = Math.ceil((h.cbm * 1e6) / height / b.widthCm);
        rows.push({ houseId: h.houseId, house: h.house, depth, items: [{ across: b.widthCm, along: depth, pieces: 0, estimated: true }] });
        volumeCm3 += h.cbm * 1e6;
      }
      continue;
    }
    const mine: Array<{ depth: number; items: Item[] }> = [];
    for (const g of sized) {
      const r = rowsFor(g, b);
      if (r.problem) problems.push(`${h.house}: ${r.problem}`);
      mine.push(...r.rows);
      if (!r.problem) volumeCm3 += g.count * g.lengthCm * g.widthCm * g.heightCm;
    }
    // Within the house, the deepest rows first, so the short ones can share a strip.
    mine.sort((p, q) => q.depth - p.depth);
    for (const r of mine) rows.push({ houseId: h.houseId, house: h.house, ...r });
  }

  // Strips across the width, from the nose: a row shares the last strip when it fits beside what is there.
  const placements: Placement[] = [];
  let shelf: { x: number; depth: number; used: number } | null = null;
  let length = 0;
  for (const r of rows) {
    const width = r.items.reduce((n, i) => n + i.across, 0);
    if (!shelf || shelf.used + width > b.widthCm || r.depth > shelf.depth) {
      shelf = { x: length, depth: r.depth, used: 0 };
      length += r.depth;
    }
    for (const i of r.items) {
      placements.push({ houseId: r.houseId, house: r.house, x: shelf.x, y: shelf.used, length: i.along, width: i.across, pieces: i.pieces, estimated: i.estimated });
      shelf.used += i.across;
    }
  }

  const weightKg = Math.round(houses.reduce((n, h) => n + (h.kg || 0), 0));
  if (length > b.lengthCm) problems.push(`Needs ${m(length)} of floor; the ${box} has ${m(b.lengthCm)}`);
  if (weightKg > b.payloadKg) problems.push(`${weightKg.toLocaleString("en-IN")} kg is over the ${box}'s ${b.payloadKg.toLocaleString("en-IN")} kg payload`);
  if (estimated.length) problems.push(`No piece sizes for ${estimated.join(", ")}: drawn from the CBM`);

  const floorBy = new Map<string, number>();
  for (const p of placements) floorBy.set(p.houseId, (floorBy.get(p.houseId) ?? 0) + p.length * p.width);
  return {
    box,
    placements,
    floorLengthCm: length,
    fits: length <= b.lengthCm && weightKg <= b.payloadKg && !problems.some((p) => p.includes("do not pass")),
    floorPct: round1((length / b.lengthCm) * 100),
    volumePct: round1((volumeCm3 / (b.lengthCm * b.widthCm * b.heightCm)) * 100),
    weightKg,
    payloadPct: round1((weightKg / b.payloadKg) * 100),
    houses: order.map((h) => ({
      houseId: h.houseId,
      house: h.house,
      floorM: round2((floorBy.get(h.houseId) ?? 0) / b.widthCm / 100),
      cbm: h.cbm,
      kg: h.kg,
      estimated: estimated.includes(h.house),
    })),
    problems,
  };
}

/** The smallest box the cargo fits, or null when it fits none. */
export function smallestBox(houses: HouseCargo[]): BoxType | null {
  return BOX_TYPES.find((t) => loadPlan(houses, t).fits) ?? null;
}
