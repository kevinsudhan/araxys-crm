import { supabase } from "../lib/supabase";
import { measureHouse, quotedPerWm, type HouseMeasure } from "../lib/cfsMeasure";
import { CM_PER, KG_PER, type DimensionUnit } from "../lib/dimensions";
import type { BoxType, HouseCargo } from "../lib/loadPlan";
import type { HouseFacts, JobBoxRow, StuffingConsole } from "../lib/stuffingReport";
import { receivedTotals } from "../lib/warehouse";
import { manifestFor } from "./consoleManifest";
import { shipmentsOn, updateConsole, type Console } from "./consoles";
import { logEvent, updateShipment } from "./enquiries";
import { listPartners } from "./partners";

/**
 * The console at the CFS (125): each house declared against what was
 * received, the cargo for the load plan, and the stuffing report's boxes.
 * The rules are lib/cfsMeasure.ts, lib/loadPlan.ts and lib/stuffingReport.ts.
 */

export interface CfsData {
  measures: HouseMeasure[];
  cargo: HouseCargo[];
  houses: HouseFacts[];
  lines: JobBoxRow[];
  agent: { name: string; email: string } | null;
}

type Rec = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export const stuffingConsole = (c: Console): StuffingConsole => ({
  console_no: c.console_no,
  carrier: c.carrier,
  vessel: c.vessel,
  voyage: c.voyage,
  pol: c.pol,
  pod: c.pod,
  etd: c.etd,
  cfs_name: c.cfs_name ?? "",
  mbl_number: c.mbl_number,
});

async function rowsIn(table: string, select: string, column: string, values: string[]): Promise<Rec[]> {
  if (!values.length) return [];
  const { data, error } = await supabase.from(table).select(select).in(column, values);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Rec[];
}

export async function cfsFor(c: Console): Promise<CfsData> {
  const jobs = await shipmentsOn(c.id);
  const ids = jobs.map((j) => j.id);
  const refs = jobs.map((j) => j.enquiry_ref);
  const [receipts, dims, enquiries, lines, quotes, manifest, partners] = await Promise.all([
    rowsIn("warehouse_receipts", "shipment_id, pieces, gross_weight_kg, volume_cbm, condition", "shipment_id", ids),
    rowsIn("enquiry_dimensions", "enquiry_ref, pieces, length, width, height, weight_per_piece, gross_weight", "enquiry_ref", refs),
    rowsIn("enquiries", "ref, stackable, dimension_unit", "ref", refs),
    rowsIn("shipment_containers", "shipment_id, container_no, size_type, seal_no, package_count, weight_kg, volume_cbm", "shipment_id", ids),
    rowsIn("quotes", "id, enquiry_ref, version, status", "enquiry_ref", refs),
    manifestFor(c),
    listPartners(true).catch(() => []),
  ]);

  // The latest accepted quotation of each enquiry, and its charges per W/M.
  const accepted = new Map<string, Rec>();
  for (const q of quotes) {
    if (q.status !== "accepted") continue;
    const was = accepted.get(String(q.enquiry_ref));
    if (!was || Number(q.version) > Number(was.version)) accepted.set(String(q.enquiry_ref), q);
  }
  const quoteLines = await rowsIn("quote_lines", "quote_id, unit, quantity, rate, fx_rate, currency", "quote_id", [...accepted.values()].map((q) => String(q.id)));

  const enquiryBy = new Map(enquiries.map((e) => [String(e.ref), e]));
  const manifestBy = new Map(manifest.lines.map((l) => [l.shipmentId, l]));

  const measures: HouseMeasure[] = [];
  const cargo: HouseCargo[] = [];
  const houses: HouseFacts[] = [];
  for (const j of jobs) {
    const customer = (j as unknown as { customers?: { name?: string; company?: string } | null }).customers;
    const name = customer?.company || customer?.name || j.enquiry_ref;
    const mine = receipts.filter((r) => r.shipment_id === j.id);
    const received = mine.length
      ? receivedTotals(mine.map((r) => ({ pieces: num(r.pieces), gross_weight_kg: num(r.gross_weight_kg), volume_cbm: num(r.volume_cbm) })))
      : null;
    const conditions = [...new Set(mine.map((r) => String(r.condition)).filter((x) => x && x !== "good"))];
    const q = accepted.get(j.enquiry_ref);
    const { quotedWm, perWmInr } = quotedPerWm(q ? quoteLines.filter((l) => l.quote_id === q.id) as never : []);
    const declared = { pieces: num(j.piece_count ?? j.package_count), grossKg: num(j.gross_weight_kg), volumeCbm: num(j.volume_cbm) };
    measures.push(measureHouse({ shipmentId: j.id, ref: j.enquiry_ref, customer: name, declared, received, conditions, quotedWm, perWmInr }));

    // The load plan's pieces, in centimetres and kilos.
    const e = enquiryBy.get(j.enquiry_ref);
    const unit = (e?.dimension_unit === "in_lb" ? "in_lb" : "cm_kg") as DimensionUnit;
    const groups = dims
      .filter((d) => d.enquiry_ref === j.enquiry_ref && num(d.pieces) && num(d.length) && num(d.width) && num(d.height))
      .map((d) => {
        const count = num(d.pieces)!;
        const each = num(d.weight_per_piece) ?? (num(d.gross_weight) !== null ? num(d.gross_weight)! / count : 0);
        return {
          count,
          lengthCm: Math.round(num(d.length)! * CM_PER[unit]),
          widthCm: Math.round(num(d.width)! * CM_PER[unit]),
          heightCm: Math.round(num(d.height)! * CM_PER[unit]),
          kgEach: each * KG_PER[unit],
          stackable: e?.stackable !== false,
        };
      });
    // Measured where the CFS has measured it, declared otherwise.
    cargo.push({ houseId: j.id, house: name, groups, cbm: received?.volumeCbm ?? declared.volumeCbm ?? 0, kg: received?.grossKg ?? declared.grossKg ?? 0 });

    const m = manifestBy.get(j.id);
    houses.push({
      shipmentId: j.id,
      ref: j.enquiry_ref,
      hblNo: m?.hblNo ?? j.bl_number ?? "",
      shipper: m?.shipper ?? name,
      marks: m?.marks ?? "",
      packageType: m?.packageType ?? j.package_type ?? "",
      packages: m?.packages ?? num(j.package_count) ?? 0,
      kg: m?.grossKg ?? num(j.gross_weight_kg) ?? 0,
      cbm: m?.cbm ?? num(j.volume_cbm) ?? 0,
      declaredPkgs: declared.pieces,
      receivedPkgs: received?.pieces ?? null,
      condition: conditions.length ? conditions.join(", ") : mine.length ? "good" : "",
    });
  }

  const agent = partners.find((p) => p.id === c.agent_id);
  return {
    measures,
    cargo,
    houses,
    lines: lines as unknown as JobBoxRow[],
    agent: agent ? { name: agent.organisation || agent.name, email: agent.emails[0] ?? "" } : null,
  };
}

/**
 * The CFS's figures become the job's: the manifest, the B/L, the console's
 * load and P&L follow the real cargo. What was declared is kept on the case
 * file's timeline, and on the quotation.
 */
export async function applyMeasured(m: HouseMeasure): Promise<void> {
  const r = m.received;
  if (!r) throw new Error("Nothing has been received for this house yet.");
  const patch: Record<string, unknown> = {};
  if (r.pieces !== null) patch.piece_count = r.pieces;
  if (r.grossKg !== null) patch.gross_weight_kg = r.grossKg;
  if (r.volumeCbm !== null) patch.volume_cbm = r.volumeCbm;
  if (!Object.keys(patch).length) throw new Error("The receipts give no figures to use.");
  await updateShipment(m.shipmentId, patch);
  const was = (a: number | null, b: number | null, unit: string) => (b === null ? null : `${a ?? "—"} → ${b} ${unit}`);
  const said = [was(m.declared.pieces, r.pieces, "pieces"), was(m.declared.grossKg, r.grossKg, "kg"), was(m.declared.volumeCbm, r.volumeCbm, "CBM")].filter(Boolean).join(", ");
  await logEvent(m.ref, "cfs_measured", `Figures measured at the CFS used on the job: ${said}`, { declared: m.declared, received: r });
}

export const saveBoxType = (c: Console, box: BoxType | null) => updateConsole(c.id, { box_type: box });
export const saveStuffedOn = (c: Console, on: string | null) => updateConsole(c.id, { stuffed_on: on });
export const markStuffingReportSent = (c: Console, to: string) => updateConsole(c.id, { stuffing_report_sent_at: new Date().toISOString(), stuffing_report_sent_to: to });
