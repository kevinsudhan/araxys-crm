import type { HblData } from "./hbl";
import { sameName, samePlace } from "./receivedHbl";

/**
 * A house B/L against the master it sits under (123).
 *
 * ---------------------------------------------------------------------------
 * WHAT HAS TO AGREE
 *
 * A house B/L travels under the master: the same ship, the same voyage, the
 * same ports, in one of the master's boxes behind that box's seal. Customs
 * matches the two on the IGM and the CSN, the destination agent matches them
 * at delivery, and a house saved before a seal was corrected on the job, or
 * typed with last week's voyage, is the one that stops at the port. Since
 * ICEGATE 2.0 (31 Aug 2026) a house may not carry the master's own number.
 *
 * The master is the console: its vessel, voyage and ports, its master B/L
 * number, and its boxes — the master copy's on an import once it is read,
 * otherwise the boxes on the console's jobs. A fact the console does not
 * have yet is not checked; it is not a difference.
 * ---------------------------------------------------------------------------
 */

export interface MasterFacts {
  console_no: string | null;
  mblNo: string | null;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  /** The master's boxes, or null when none is known to check against. */
  boxes: Array<{ container_no: string; seal_no: string }> | null;
}

export interface HouseRow {
  key: string;
  label: string;
  house: string;
  master: string;
  ok: boolean;
}

const key = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Only what both sides state is compared; one side blank is not a difference. */
export function checkHouseAgainstMaster(house: HblData, houseNo: string | null, m: MasterFacts): HouseRow[] {
  const rows: HouseRow[] = [];
  const add = (k: string, label: string, h: string, ms: string, same: (a: string, b: string) => boolean) => {
    if (!h.trim() || !ms.trim()) return;
    rows.push({ key: k, label, house: h.trim(), master: ms.trim(), ok: same(h, ms) });
  };
  const ident = (a: string, b: string) => key(a) === key(b);

  if (houseNo && m.mblNo && key(houseNo) === key(m.mblNo)) {
    rows.push({ key: "number", label: "B/L number", house: houseNo, master: m.mblNo, ok: false });
  }
  add("vessel", "Vessel", house.vessel, m.vessel, sameName);
  add("voyage", "Voyage", house.voyage, m.voyage, ident);
  add("pol", "Port of loading", house.port_of_loading, m.pol, samePlace);
  add("pod", "Port of discharge", house.port_of_discharge, m.pod, samePlace);

  if (m.boxes && m.boxes.length) {
    const master = new Map(m.boxes.map((b) => [key(b.container_no), b]));
    for (const c of house.containers) {
      const k = key(c.container_no);
      if (!k) continue;
      const b = master.get(k);
      if (!b) {
        rows.push({ key: `box:${k}`, label: `Container ${k}`, house: k, master: "not on the master", ok: false });
        continue;
      }
      add(`seal:${k}`, `Seal on ${k}`, c.seal_no, b.seal_no, ident);
    }
  }
  return rows;
}

export const houseProblems = (rows: HouseRow[]) => rows.filter((r) => !r.ok);

/** One line per difference, the way the desk says it: "Voyage: 127W on the house, 0127W on the master". */
export const problemText = (r: HouseRow) =>
  r.key === "number"
    ? `The house B/L carries the master's number ${r.master}: Customs refuses that`
    : r.key.startsWith("box:")
      ? `${r.label} is not one of the master's boxes`
      : `${r.label}: ${r.house} on the house, ${r.master} on the master`;
