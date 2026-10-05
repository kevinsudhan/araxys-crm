/**
 * The stuffing report for a console (125): every box, its seal, and each
 * house stuffed in it, with the tally — packages declared against packages
 * received — and the condition they came in.
 *
 * ---------------------------------------------------------------------------
 * What went into which box is the jobs' container lines (shipment_containers):
 * a house split across two boxes is in both, with its packages in each. A
 * house with no container line yet is listed as not in a box, because a
 * report that leaves it off says it was not on the console at all.
 * ---------------------------------------------------------------------------
 */

export interface StuffedHouse {
  shipmentId: string;
  ref: string;
  hblNo: string;
  shipper: string;
  marks: string;
  packages: number;
  packageType: string;
  kg: number;
  cbm: number;
  /** The tally: what the job declared, and what the CFS received. */
  declaredPkgs: number | null;
  receivedPkgs: number | null;
  condition: string;
}

export interface StuffedBox {
  containerNo: string;
  sizeType: string;
  sealNo: string;
  houses: StuffedHouse[];
  packages: number;
  kg: number;
  cbm: number;
}

export interface JobBoxRow {
  shipment_id: string;
  container_no: string | null;
  size_type: string | null;
  seal_no: string | null;
  package_count: number | string | null;
  weight_kg: number | string | null;
  volume_cbm: number | string | null;
}

export interface HouseFacts {
  shipmentId: string;
  ref: string;
  hblNo: string;
  shipper: string;
  marks: string;
  packageType: string;
  /** The job's own figures, for a house not in a box yet. */
  packages: number;
  kg: number;
  cbm: number;
  declaredPkgs: number | null;
  receivedPkgs: number | null;
  condition: string;
}

const key = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function stuffedBoxes(lines: JobBoxRow[], houses: HouseFacts[]): StuffedBox[] {
  const facts = new Map(houses.map((h) => [h.shipmentId, h]));
  const boxes = new Map<string, StuffedBox>();
  const placed = new Set<string>();
  for (const l of lines) {
    const k = key(l.container_no);
    const h = facts.get(l.shipment_id);
    if (!k || !h) continue;
    const b = boxes.get(k) ?? { containerNo: k, sizeType: "", sealNo: "", houses: [], packages: 0, kg: 0, cbm: 0 };
    b.sizeType ||= (l.size_type ?? "").trim().toUpperCase();
    b.sealNo ||= (l.seal_no ?? "").trim().toUpperCase();
    const was = b.houses.find((x) => x.shipmentId === h.shipmentId);
    const add = { packages: n(l.package_count), kg: n(l.weight_kg), cbm: n(l.volume_cbm) };
    if (was) {
      was.packages += add.packages;
      was.kg += add.kg;
      was.cbm = round3(was.cbm + add.cbm);
    } else {
      b.houses.push({ shipmentId: h.shipmentId, ref: h.ref, hblNo: h.hblNo, shipper: h.shipper, marks: h.marks, packageType: h.packageType, declaredPkgs: h.declaredPkgs, receivedPkgs: h.receivedPkgs, condition: h.condition, ...add });
    }
    b.packages += add.packages;
    b.kg += add.kg;
    b.cbm = round3(b.cbm + add.cbm);
    boxes.set(k, b);
    placed.add(h.shipmentId);
  }
  const out = [...boxes.values()];
  const loose = houses.filter((h) => !placed.has(h.shipmentId));
  if (loose.length) {
    out.push({
      containerNo: "",
      sizeType: "",
      sealNo: "",
      houses: loose.map((h) => ({ ...h })),
      packages: loose.reduce((s, h) => s + h.packages, 0),
      kg: loose.reduce((s, h) => s + h.kg, 0),
      cbm: round3(loose.reduce((s, h) => s + h.cbm, 0)),
    });
  }
  return out;
}

/** What the report still lacks, in words. Said beside the buttons; it can still go. */
export function stuffingIssues(boxes: StuffedBox[], stuffedOn: string | null): string[] {
  const out: string[] = [];
  const real = boxes.filter((b) => b.containerNo);
  if (!real.length) out.push("No container number on any job yet");
  const noSeal = real.filter((b) => !b.sealNo).map((b) => b.containerNo);
  if (noSeal.length) out.push(`No seal on ${noSeal.join(", ")}`);
  const loose = boxes.find((b) => !b.containerNo);
  if (loose) out.push(`${loose.houses.length} house${loose.houses.length === 1 ? " is" : "s are"} not in a box: ${loose.houses.map((h) => h.ref).join(", ")}`);
  const short = boxes.flatMap((b) => b.houses).filter((h) => h.receivedPkgs !== null && h.declaredPkgs !== null && h.receivedPkgs !== h.declaredPkgs);
  // A house split across two boxes is said once.
  if (short.length) out.push(`Packages received differ from declared on ${[...new Set(short.map((h) => h.ref))].join(", ")}`);
  if (!stuffedOn) out.push("No stuffing date");
  return out;
}

export interface StuffingConsole {
  console_no: string | null;
  carrier: string;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  etd: string | null;
  cfs_name: string;
  mbl_number: string | null;
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function stuffingSubject(c: StuffingConsole, stuffedOn: string | null): string {
  return [
    `[${c.console_no ?? "CONSOLE"}] STUFFING REPORT`,
    [up(c.vessel), up(c.voyage)].filter(Boolean).join(" ") || null,
    [up(c.pol), up(c.pod)].filter(Boolean).join("-") || null,
    stuffedOn ? `STUFFED ${stuffedOn}` : null,
  ]
    .filter(Boolean)
    .join(" — ");
}

/** The report as a mail: the console, then each box with its houses and the tally; the PDF goes with it. */
export function stuffingHtml(c: StuffingConsole, boxes: StuffedBox[], stuffedOn: string | null, to: string, attached: boolean): string {
  const cell = "padding:4px 8px 4px 0;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:12.5px";
  const head = "padding:4px 8px 4px 0;text-align:left;color:#555;font-weight:600;border-bottom:1px solid #cbd5e1;font-size:12px";
  const facts = [
    ["Console", up(c.console_no)],
    ["Vessel / voyage", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" / ")],
    ["Route", [up(c.pol), up(c.pod)].filter(Boolean).join(" → ")],
    ["Master B/L", up(c.mbl_number)],
    ["CFS", up(c.cfs_name)],
    ["Stuffed on", stuffedOn ?? ""],
  ].filter(([, v]) => v);
  const tally = (h: StuffedHouse) =>
    h.receivedPkgs === null ? "not received" : h.declaredPkgs !== null && h.receivedPkgs !== h.declaredPkgs ? `${h.receivedPkgs} of ${h.declaredPkgs} declared` : `${h.receivedPkgs} as declared`;
  const box = (b: StuffedBox) =>
    `<p style="margin:14px 0 4px;font-size:13px;font-weight:700">${b.containerNo ? `${esc(b.containerNo)} ${esc(b.sizeType)}${b.sealNo ? ` · seal ${esc(b.sealNo)}` : " · no seal"}` : "Not in a box yet"}</p>` +
    `<table style="border-collapse:collapse;margin:0 0 6px"><tr>${["House B/L", "Shipper", "Marks", "Packages", "Kg", "CBM", "Received", "Condition"].map((x) => `<th style="${head}">${x}</th>`).join("")}</tr>` +
    b.houses
      .map(
        (h) =>
          `<tr>${[h.hblNo || h.ref, up(h.shipper), up(h.marks), `${h.packages} ${up(h.packageType)}`.trim(), h.kg ? h.kg.toLocaleString("en-IN") : "", h.cbm ? String(h.cbm) : "", tally(h), h.condition]
            .map((v) => `<td style="${cell}">${esc(String(v || "—"))}</td>`)
            .join("")}</tr>`
      )
      .join("") +
    `<tr><td style="${cell};font-weight:700" colspan="3">Total</td><td style="${cell};font-weight:700">${b.packages}</td><td style="${cell};font-weight:700">${b.kg.toLocaleString("en-IN")}</td><td style="${cell};font-weight:700">${b.cbm}</td><td style="${cell}" colspan="2"></td></tr></table>`;
  return (
    `<p>Dear ${esc(to || "Sir / Madam")},</p>` +
    `<p>Please find below the stuffing report for our console ${esc(up(c.console_no))}${attached ? ", also attached as PDF" : ""}.</p>` +
    `<table style="border-collapse:collapse;margin:6px 0 4px">${facts.map(([k, v]) => `<tr><td style="${cell};color:#555;width:130px">${k}</td><td style="${cell}">${esc(v)}</td></tr>`).join("")}</table>` +
    boxes.map(box).join("")
  );
}
