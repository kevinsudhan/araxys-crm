/**
 * Accepting dangerous goods into a console (131).
 *
 * ---------------------------------------------------------------------------
 * A DG house goes into the box only when:
 *
 *   its class is one a consolidation takes — never explosives (1), infectious
 *   substances (6.2) or radioactive material (7); many lines and co-loaders
 *   refuse toxic gases, classes 4 and 5 and toxic substances in LCL too, and
 *   their approval below decides;
 *   its UN number, packing group and (for a flammable liquid) flash point are
 *   given and agree with the class;
 *   the safety data sheet is in hand and under five years old;
 *   the shipper's signed DG declaration is in hand;
 *   the line has approved it — on space bought, the co-loader has accepted it;
 *   it may share the container with every other DG house in it.
 *
 * SHARING A CONTAINER
 *
 * The IMDG Code's segregation table (7.2.4), by primary class:
 *
 *   X  no general requirement (the DG List's entry may still have one);
 *   1  "away from": in the same container only with the competent
 *      authority's approval (7.3.4.1);
 *   2  "separated from", 3 and 4: never in the same container.
 *
 * A subsidiary hazard and the DG List's own segregation entries can ask for
 * more than the primary class does; this system does not hold them, and the
 * line's DG desk has the last word. The database (131) refuses an acceptance
 * without the papers; the segregation is checked here.
 * ---------------------------------------------------------------------------
 */

export const SEG_ORDER = ["1.1", "1.3", "1.4", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1", "6.2", "7", "8", "9"] as const;
export type SegKey = (typeof SEG_ORDER)[number];

/** Rows and columns in SEG_ORDER. "*": explosives among themselves (7.2.7). */
const TABLE: Record<SegKey, string> = {
  "1.1": "* * * 4 2 2 4 4 4 4 4 4 2 4 2 4 X",
  "1.3": "* * * 4 2 2 4 3 3 4 4 4 2 4 2 2 X",
  "1.4": "* * * 2 1 1 2 2 2 2 2 2 X 4 2 2 X",
  "2.1": "4 4 2 X X X 2 1 2 X 2 2 X 4 2 1 X",
  "2.2": "2 2 1 X X X 1 X 1 X X 1 X 2 1 X X",
  "2.3": "2 2 1 X X X 2 X 2 X X 2 X 2 1 X X",
  "3": "4 4 2 2 1 2 X X 2 1 2 2 X 3 2 X X",
  "4.1": "4 3 2 1 X X X X 1 X 1 2 X 3 2 1 X",
  "4.2": "4 3 2 2 1 2 2 1 X 1 2 2 1 3 2 1 X",
  "4.3": "4 4 2 X X X 1 X 1 X 2 2 X 2 2 1 X",
  "5.1": "4 4 2 2 X X 2 1 2 2 X 2 1 3 1 2 X",
  "5.2": "4 4 2 2 1 2 2 2 2 2 2 X 1 3 2 2 X",
  "6.1": "2 2 X X X X X X 1 X 1 1 X 1 X X X",
  "6.2": "4 4 4 4 2 2 3 3 3 2 3 3 1 X 3 3 X",
  "7": "2 2 2 2 1 1 2 2 2 2 1 2 X 3 X 2 X",
  "8": "4 2 2 1 X X X 1 1 1 2 2 X 3 2 X X",
  "9": "X X X X X X X X X X X X X X X X X",
};

export type SegCode = "X" | "1" | "2" | "3" | "4" | "*";

export const SEG_WORDS: Record<SegCode, string> = {
  X: "no segregation required",
  "1": "away from",
  "2": "separated from",
  "3": "separated by a complete compartment or hold from",
  "4": "separated longitudinally by a complete compartment or hold from",
  "*": "see the explosives' compatibility groups",
};

/** What the table asks between two classes. */
export function segregation(a: SegKey, b: SegKey): SegCode {
  return TABLE[a].split(" ")[SEG_ORDER.indexOf(b)] as SegCode;
}

export const CLASS_NAME: Record<string, string> = {
  "1": "explosives",
  "2.1": "flammable gas",
  "2.2": "non-flammable gas",
  "2.3": "toxic gas",
  "3": "flammable liquid",
  "4.1": "flammable solid",
  "4.2": "spontaneously combustible",
  "4.3": "dangerous when wet",
  "5.1": "oxidizing substance",
  "5.2": "organic peroxide",
  "6.1": "toxic substance",
  "6.2": "infectious substance",
  "7": "radioactive material",
  "8": "corrosive",
  "9": "miscellaneous",
};

/** The class as written ("Class 3", "3.0", "1.4S") read as the table's row, or what is wrong with it. */
export function classOf(raw: string | null | undefined): { cls: string | null; key: SegKey | null; problem: string | null } {
  const t = (raw ?? "")
    .trim()
    .replace(/^(class|cl\.?)\s*/i, "")
    .replace(/^(\d)\.0$/, "$1");
  if (!t) return { cls: null, key: null, problem: "No IMO class" };
  const ex = t.match(/^1(?:\.([1-6]))?\s*[A-S]?$/i);
  if (ex) {
    const div = ex[1];
    return { cls: div ? `1.${div}` : "1", key: div === "3" || div === "6" ? "1.3" : div === "4" ? "1.4" : "1.1", problem: null };
  }
  if ((SEG_ORDER as readonly string[]).includes(t)) return { cls: t, key: t as SegKey, problem: null };
  const divisions: Record<string, string> = { "2": "2.1, 2.2 or 2.3", "4": "4.1, 4.2 or 4.3", "5": "5.1 or 5.2", "6": "6.1 or 6.2" };
  if (divisions[t]) return { cls: t, key: null, problem: `Class ${t} needs its division: ${divisions[t]}` };
  return { cls: t, key: null, problem: `"${t}" is not an IMO class` };
}

const nameOf = (cls: string) => CLASS_NAME[cls] ?? CLASS_NAME[cls.split(".")[0]] ?? "";

/** "UN 1263", "un1263", "1263" → "UN1263"; null when it is not four digits. */
export function unOf(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().match(/^(?:UN)?\s*(\d{4})$/i);
  return m && m[1] !== "0000" ? `UN${m[1]}` : null;
}

export interface DgHouse {
  shipmentId: string;
  ref: string | null;
  customer: string;
  unNumber: string | null;
  imoClass: string | null;
  packingGroup: string | null;
  flashPointC: number | null;
  msdsProvided: boolean | null;
  /** YYYY-MM-DD */
  msdsDate: string | null;
  declarationAt: string | null;
  lineRef: string | null;
  acceptedAt: string | null;
  acceptNote: string | null;
}

export type CheckState = "ok" | "warn" | "stop";
export interface DgCheck {
  key: string;
  state: CheckState;
  text: string;
}

/** Never in a consolidation. */
const REFUSED = new Set(["1", "6.2", "7"]);
/** Often refused in LCL: the line's or co-loader's approval decides. */
const OFTEN_REFUSED = new Set(["2.3", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1"]);
/** A packing group is part of the entry. */
const PG_NEEDED = new Set(["3", "4.2", "4.3", "5.1", "6.1", "8"]);
/** Most entries carry one. */
const PG_USUAL = new Set(["4.1", "9"]);
/** No packing group in the class. */
const PG_NONE = new Set(["1", "2.1", "2.2", "2.3", "5.2", "6.2", "7"]);
/** Kept from foodstuffs in the same container (7.3.4.2). */
const FOOD = new Set(["2.3", "6.1", "8"]);

const yearsBefore = (today: string, years: number) => `${Number(today.slice(0, 4)) - years}${today.slice(4, 10)}`;

/**
 * Everything that decides whether this house may go in the box, in the order
 * the desk works through it. `others` are the other DG houses on the console.
 */
export function houseChecks(h: DgHouse, others: DgHouse[], opts: { coload: boolean; today: string }): DgCheck[] {
  const out: DgCheck[] = [];
  const c = classOf(h.imoClass);
  const top = c.cls ? (c.cls.startsWith("1") ? "1" : c.cls) : null;

  // ---- the class
  if (c.problem) out.push({ key: "class", state: "stop", text: c.problem });
  else if (top && REFUSED.has(top)) out.push({ key: "class", state: "stop", text: `Class ${c.cls} (${nameOf(c.cls!)}) is not taken in a consolidation` });
  else if (c.cls && OFTEN_REFUSED.has(c.cls))
    out.push({ key: "class", state: "warn", text: `Class ${c.cls} (${nameOf(c.cls)}): many lines and co-loaders refuse it in LCL — their approval below decides` });
  else if (c.cls) out.push({ key: "class", state: "ok", text: `Class ${c.cls} (${nameOf(c.cls)})` });

  // ---- the UN number
  const un = unOf(h.unNumber);
  if (!un) out.push({ key: "un", state: "stop", text: h.unNumber?.trim() ? `"${h.unNumber.trim()}" is not a UN number: four digits` : "No UN number" });
  else if (un < "UN1000" && top !== "1") out.push({ key: "un", state: "stop", text: `${un} is an explosive (UN0…), not class ${c.cls ?? "—"}: check the number and the class` });
  else out.push({ key: "un", state: "ok", text: un });

  // ---- packing group
  const pg = (h.packingGroup ?? "").trim().toUpperCase();
  if (c.cls) {
    if (!pg && PG_NEEDED.has(c.cls)) out.push({ key: "pg", state: "stop", text: `No packing group: class ${c.cls} has one (section 14 of the safety data sheet)` });
    else if (!pg && PG_USUAL.has(c.cls)) out.push({ key: "pg", state: "warn", text: `No packing group: most class ${c.cls} entries carry one — check section 14 of the safety data sheet` });
    else if (pg && (PG_NONE.has(c.cls) || c.cls.startsWith("1"))) out.push({ key: "pg", state: "warn", text: `Class ${c.cls} has no packing group, but PG ${pg} is given: check it` });
    else if (pg) out.push({ key: "pg", state: "ok", text: `Packing group ${pg}` });
  }

  // ---- flash point, for a flammable liquid
  if (c.cls === "3") {
    if (h.flashPointC === null || Number.isNaN(h.flashPointC)) out.push({ key: "fp", state: "stop", text: "No flash point: the line asks it of every flammable liquid" });
    else if (h.flashPointC > 60) out.push({ key: "fp", state: "warn", text: `Flash point ${h.flashPointC} °C: above 60 °C is not class 3 — check the safety data sheet` });
    else out.push({ key: "fp", state: "ok", text: `Flash point ${h.flashPointC} °C` });
  }

  // ---- the safety data sheet
  if (h.msdsProvided !== true) out.push({ key: "msds", state: "stop", text: "The safety data sheet (MSDS) is not in hand" });
  else if (!h.msdsDate) out.push({ key: "msds", state: "warn", text: "Safety data sheet in hand: give its date — most lines want it under five years old, in English" });
  else if (h.msdsDate < yearsBefore(opts.today, 5)) out.push({ key: "msds", state: "stop", text: `The safety data sheet is dated ${h.msdsDate}: more than five years old — ask for the current one` });
  else if (h.msdsDate > opts.today) out.push({ key: "msds", state: "warn", text: `The safety data sheet is dated ${h.msdsDate}, in the future: check the date` });
  else out.push({ key: "msds", state: "ok", text: `Safety data sheet dated ${h.msdsDate}` });

  // ---- the shipper's declaration
  out.push(
    h.declarationAt
      ? { key: "decl", state: "ok", text: "The shipper's signed DG declaration is in hand" }
      : { key: "decl", state: "stop", text: "The shipper's signed DG declaration (IMO multimodal form) is not in hand" }
  );

  // ---- the line's approval
  const who = opts.coload ? "co-loader" : "line";
  out.push(
    h.lineRef?.trim()
      ? { key: "line", state: "ok", text: `Approved by the ${who}: ${h.lineRef.trim()}` }
      : { key: "line", state: "stop", text: opts.coload ? "No DG acceptance from the co-loader yet" : "No DG approval from the line yet" }
  );

  // ---- the other DG houses in the box
  if (c.key) {
    for (const o of others) {
      if (o.shipmentId === h.shipmentId) continue;
      const oc = classOf(o.imoClass);
      if (!oc.key) continue;
      const code = segregation(c.key, oc.key);
      const with_ = `${o.ref ?? o.shipmentId} (class ${oc.cls})`;
      if (code === "1") out.push({ key: `seg:${o.shipmentId}`, state: "warn", text: `With ${with_}: "away from" — the same container only with the competent authority's approval` });
      else if (code !== "X") out.push({ key: `seg:${o.shipmentId}`, state: "stop", text: `Not in the same container as ${with_}: the IMDG table says "${SEG_WORDS[code]}"` });
    }
  }
  if (c.cls && FOOD.has(c.cls)) out.push({ key: "food", state: "warn", text: "Keep it from any foodstuff in the box (IMDG 7.3.4.2): check what else is going in" });

  return out;
}

export const canAccept = (checks: DgCheck[]) => !checks.some((x) => x.state === "stop");

/** Each pair of DG houses in the box, and what the table says between them. */
export function boxPairs(houses: DgHouse[]): Array<{ a: DgHouse; b: DgHouse; code: SegCode | null }> {
  const out: Array<{ a: DgHouse; b: DgHouse; code: SegCode | null }> = [];
  for (let i = 0; i < houses.length; i++) {
    for (let j = i + 1; j < houses.length; j++) {
      const a = classOf(houses[i].imoClass).key;
      const b = classOf(houses[j].imoClass).key;
      out.push({ a: houses[i], b: houses[j], code: a && b ? segregation(a, b) : null });
    }
  }
  return out;
}

/** The console's DG in a line: "2 DG houses: 1 accepted, 1 waiting". */
export function dgSummary(houses: DgHouse[]): string {
  if (!houses.length) return "No dangerous goods";
  const accepted = houses.filter((h) => h.acceptedAt).length;
  const waiting = houses.length - accepted;
  return `${houses.length} DG house${houses.length === 1 ? "" : "s"}: ${[accepted ? `${accepted} accepted` : "", waiting ? `${waiting} waiting` : ""].filter(Boolean).join(", ")}`;
}
