import { wmOf } from "./coload";
import { compare, type Difference, type Totals } from "./warehouse";

/**
 * Each house on the console, declared against what the CFS received and
 * measured (125).
 *
 * ---------------------------------------------------------------------------
 * The quotation was priced on what the shipper said. The CFS counts, weighs
 * and measures what turns up (the warehouse receipts on the job, 068), and a
 * house that measures bigger is W/M the invoice has to follow or the margin
 * pays for. So each house says: declared, received, the revised W/M, and what
 * the difference comes to at the rate it was quoted per W/M.
 *
 * Pieces are compared exactly, weight and volume with the warehouse's own
 * tolerances (lib/warehouse.ts). A house with no receipt yet is "not
 * received", not a difference.
 * ---------------------------------------------------------------------------
 */

export interface HouseMeasureInput {
  shipmentId: string;
  ref: string;
  customer: string;
  declared: Totals;
  /** The receipts' totals, or null when nothing has been received. */
  received: Totals | null;
  /** Any receipt not in good order: damaged, short, wet. */
  conditions: string[];
  /** The accepted quotation's charges per W/M (or per CBM): the W/M quoted and their rupee rate per W/M. */
  quotedWm: number | null;
  perWmInr: number | null;
}

export interface HouseMeasure extends HouseMeasureInput {
  pieces: Difference;
  weight: Difference;
  volume: Difference;
  declaredWm: number | null;
  measuredWm: number | null;
  /** Measured W/M less what it was quoted on (or declared, where the quotation does not say). */
  wmChange: number | null;
  /** What the change comes to at the quoted rate per W/M. */
  inrChange: number | null;
  state: "not_received" | "agrees" | "differs";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function measureHouse(h: HouseMeasureInput): HouseMeasure {
  const r = h.received;
  const pieces = compare(h.declared.pieces, r?.pieces ?? null, "pieces");
  const weight = compare(h.declared.grossKg, r?.grossKg ?? null, "weight");
  const volume = compare(h.declared.volumeCbm, r?.volumeCbm ?? null, "volume");
  const declaredWm = h.declared.volumeCbm !== null || h.declared.grossKg !== null ? wmOf(h.declared.volumeCbm ?? 0, h.declared.grossKg ?? 0) : null;
  const measuredWm = r && r.volumeCbm !== null && r.grossKg !== null ? wmOf(r.volumeCbm, r.grossKg) : null;
  const basis = h.quotedWm ?? declaredWm;
  const wmChange = measuredWm !== null && basis !== null ? round3(measuredWm - basis) : null;
  // Within the volume tolerance, the W/M has not changed for the invoice.
  const moved = wmChange !== null && Math.abs(wmChange) > Math.max(0.01, (basis ?? 0) * 0.02);
  const inrChange = moved && h.perWmInr !== null ? round2(wmChange! * h.perWmInr) : null;
  const differs = [pieces, weight, volume].some((d) => d.verdict === "short" || d.verdict === "over") || h.conditions.length > 0;
  return {
    ...h,
    pieces,
    weight,
    volume,
    declaredWm,
    measuredWm,
    wmChange: moved ? wmChange : wmChange === null ? null : 0,
    inrChange,
    state: !r ? "not_received" : differs ? "differs" : "agrees",
  };
}

/** The accepted quotation's W/M basis: the lines charged per W/M or per CBM, their quantity and their rupee rate together. */
export function quotedPerWm(lines: Array<{ unit: string | null; quantity: number | string | null; rate: number | string | null; fx_rate: number | string | null; currency?: string | null }>): { quotedWm: number | null; perWmInr: number | null } {
  const per = lines.filter((l) => l.unit === "W/M" || l.unit === "CBM");
  if (!per.length) return { quotedWm: null, perWmInr: null };
  const quotedWm = Math.max(...per.map((l) => Number(l.quantity) || 0)) || null;
  const perWmInr = round2(per.reduce((n, l) => n + (Number(l.rate) || 0) * ((l.currency ?? "INR") === "INR" ? 1 : Number(l.fx_rate) || 0), 0));
  return { quotedWm, perWmInr: perWmInr || null };
}

/** The console's houses in one line: how many are in, how many differ, and the W/M and rupees it moves. */
export function measureSummary(rows: HouseMeasure[]): { received: number; differ: number; wmChange: number; inrChange: number } {
  return {
    received: rows.filter((r) => r.state !== "not_received").length,
    differ: rows.filter((r) => r.state === "differs").length,
    wmChange: round3(rows.reduce((n, r) => n + (r.wmChange ?? 0), 0)),
    inrChange: round2(rows.reduce((n, r) => n + (r.inrChange ?? 0), 0)),
  };
}
