import type { CellValue, Column, Sheet } from "./xlsx";
import { ACCENT, INK, LINE, MUTED, NAVY, SOFT, caption, esc, letter, longDate, message, section, signOff } from "./brandedMail";

/**
 * The customer's DSR — daily status report (108): every live shipment of
 * theirs on one sheet, in the columns the desk has always sent it in.
 *
 * ---------------------------------------------------------------------------
 * READ FROM THE JOB, NOT TYPED AGAIN
 *
 * References, terms, ports, packages, vessel, cut-off, ETD and ETA are the
 * shipment's own; the booking and pickup dates are its milestones. Only the
 * REASON (what is happening) and the STATUS (what is awaited) are written for
 * the report (`shipment_dsr_notes`), and a STATUS nobody has written reads
 * from the milestones instead of going out blank.
 *
 * THE CUSTOMER'S COPY HAS NO AGENT
 *
 * The desk's own sheet hid the agent column before sending. A hidden column is
 * one click from visible, so the customer's copy — the attachment and the
 * mail — leaves it out altogether. The desk's download keeps it.
 * ---------------------------------------------------------------------------
 */

export interface DsrMilestone {
  code: string;
  label: string;
  position: number;
  reached_on: string | null;
  hidden?: boolean | null;
}

/** What one shipment's line is made from. */
export interface DsrSource {
  shipment: {
    id: string;
    enquiry_ref: string;
    stage: string | null;
    transport_mode: string | null;
    trade_direction: string | null;
    incoterm: string | null;
    booking_number: string | null;
    bl_number: string | null;
    forwarders_bl_no: string | null;
    vessel: string | null;
    voyage: string | null;
    flight_number: string | null;
    etd: string | null;
    eta: string | null;
    cargo_cutoff: string | null;
    origin: string | null;
    destination: string | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    package_count: number | null;
    package_type: string | null;
    piece_count: number | null;
    gross_weight_kg: number | string | null;
    volume_cbm: number | string | null;
    created_at: string;
  };
  customerName: string;
  /** The house bill or house airway bill number, when one is issued. */
  houseBill: string | null;
  agent: string | null;
  /** When the booking came in: the quotation accepted, else the job opened. */
  bookingReceived: string | null;
  milestones: DsrMilestone[];
  /** A pickup planned but not yet done. */
  pickupPlanned: string | null;
  note: { remark: string; status: string } | null;
}

export interface DsrRow {
  shipmentId: string;
  enquiryRef: string;
  bookingNo: string;
  blNo: string;
  customer: string;
  term: string;
  mode: string;
  port: string;
  agent: string;
  bookingReceived: string | null;
  bookingConfirmed: string | null;
  pickup: string | null;
  /** The pickup is planned, not done. */
  pickupPlanned: boolean;
  pkg: string;
  weight: string;
  cbm: number | null;
  vessel: string;
  cutoff: string | null;
  etd: string | null;
  eta: string | null;
  reason: string;
  status: string;
  /** No STATUS written: it reads from the milestones. */
  statusFromMilestones: boolean;
  delivered: boolean;
}

const MODE: Record<string, string> = { sea_lcl: "SEA LCL", sea_fcl: "SEA FCL", air: "AIR", road: "ROAD", other: "" };

const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const plain = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const day = (v: string | null | undefined): string | null => (v ? String(v).slice(0, 10) : null);

/** The port that matters to the customer: the far end of the job. */
function farPort(s: DsrSource["shipment"]): string {
  const pol = s.port_of_loading?.trim() || s.origin?.trim() || "";
  const pod = s.port_of_discharge?.trim() || s.destination?.trim() || "";
  return (s.trade_direction === "export" ? pod || pol : pol || pod).toUpperCase();
}

/**
 * The STATUS when the desk has written none: the last milestone reached and
 * the next one to come — "Booking confirmed on 24 Sep 2026 · next: cargo
 * picked up".
 */
export function statusFromMilestones(milestones: DsrMilestone[]): string {
  const shown = milestones.filter((m) => !m.hidden).sort((a, b) => a.position - b.position);
  const reached = shown.filter((m) => m.reached_on);
  const last = reached[reached.length - 1];
  const next = shown.find((m) => !m.reached_on && (!last || m.position > last.position));
  // "Received at the CFS" reads "received at the CFS" mid-sentence, not "cfs".
  const lower = (l: string) => l.charAt(0).toLowerCase() + l.slice(1);
  if (!last) return next ? `Awaiting ${lower(next.label)}` : "";
  const done = `${last.label} on ${longDate(last.reached_on!)}`;
  return next ? `${done} · next: ${lower(next.label)}` : done;
}

export function dsrRow(src: DsrSource): DsrRow {
  const s = src.shipment;
  const at = (code: string) => src.milestones.find((m) => m.code === code && m.reached_on)?.reached_on ?? null;
  const picked = at("picked_up");
  const packages = n(s.package_count);
  const pieces = n(s.piece_count);
  const weight = n(s.gross_weight_kg);
  const air = s.transport_mode === "air";
  const written = src.note?.status?.trim() ?? "";
  return {
    shipmentId: s.id,
    enquiryRef: s.enquiry_ref,
    bookingNo: s.booking_number?.trim() || s.id,
    blNo: src.houseBill?.trim() || s.forwarders_bl_no?.trim() || s.bl_number?.trim() || "",
    customer: src.customerName.toUpperCase(),
    term: (s.incoterm ?? "").toUpperCase(),
    mode: MODE[s.transport_mode ?? ""] ?? "",
    port: farPort(s),
    agent: src.agent?.trim() ?? "",
    bookingReceived: day(src.bookingReceived),
    bookingConfirmed: day(at("booked")),
    pickup: day(picked ?? src.pickupPlanned),
    pickupPlanned: !picked && Boolean(src.pickupPlanned),
    pkg: packages ? `${plain(packages)} ${(s.package_type || "PKGS").toUpperCase()}` : pieces ? `${plain(pieces)} PKGS` : "",
    weight: weight ? `${plain(weight)} KGS` : "",
    cbm: n(s.volume_cbm),
    vessel: air ? (s.flight_number?.trim() ?? "").toUpperCase() : [s.vessel?.trim(), s.voyage?.trim()].filter(Boolean).join(" / ").toUpperCase(),
    cutoff: day(s.cargo_cutoff),
    etd: day(s.etd),
    eta: day(s.eta),
    reason: src.note?.remark?.trim() ?? "",
    status: written || statusFromMilestones(src.milestones),
    statusFromMilestones: !written,
    delivered: s.stage === "delivered",
  };
}

/** Oldest job first, as the desk numbers them. */
export const sortRows = (rows: DsrRow[]) => [...rows].sort((a, b) => a.enquiryRef.localeCompare(b.enquiryRef));

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

interface DsrColumn extends Column {
  value: (r: DsrRow, i: number) => CellValue;
  /** The desk's only: left out of the customer's copy. */
  internal?: boolean;
}

const asDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

/** The desk's columns, in the desk's order and words. */
export const DSR_COLUMNS: DsrColumn[] = [
  { header: "S.NO", width: 6, kind: "center", value: (_r, i) => i + 1 },
  { header: "ENQ.NO", width: 14, kind: "key", value: (r) => r.enquiryRef },
  { header: "BOOKING NO", width: 14, value: (r) => r.bookingNo },
  { header: "BL NO", width: 18, value: (r) => r.blNo },
  { header: "CUSTOMER NAME", width: 22, kind: "wrap", value: (r) => r.customer },
  { header: "TERM", width: 7, kind: "center", value: (r) => r.term },
  { header: "MODE", width: 9, kind: "center", value: (r) => r.mode },
  { header: "PORT", width: 14, value: (r) => r.port },
  { header: "AGENT NAME", width: 16, kind: "wrap", internal: true, value: (r) => r.agent },
  { header: "BOOKING RECEIVED", width: 13, kind: "date", value: (r) => asDate(r.bookingReceived) },
  { header: "BOOKING CNFR", width: 13, kind: "date", value: (r) => asDate(r.bookingConfirmed) },
  { header: "PICKUP DATE", width: 13, kind: "date", value: (r) => asDate(r.pickup) },
  { header: "PKG", width: 11, value: (r) => r.pkg },
  { header: "WEIGHT", width: 12, value: (r) => r.weight },
  { header: "CBM", width: 8, kind: "number", value: (r) => r.cbm },
  { header: "VESSEL NAME", width: 22, kind: "wrap", value: (r) => r.vessel },
  { header: "CUT-OFF", width: 12, kind: "date", value: (r) => asDate(r.cutoff) },
  { header: "ETD", width: 12, kind: "date", value: (r) => asDate(r.etd) },
  { header: "ETA", width: 12, kind: "date", value: (r) => asDate(r.eta) },
  { header: "REASON", width: 40, kind: "wrap", value: (r) => r.reason },
  { header: "STATUS", width: 34, kind: "wrap", value: (r) => r.status },
];

export function dsrColumns(forCustomer: boolean): DsrColumn[] {
  return DSR_COLUMNS.filter((c) => !(forCustomer && c.internal));
}

export const dsrTitle = (customer: string) => `DSR — ${customer}`;
export const dsrSubject = (customer: string, today: string) => `Daily Status Report · ${customer} · ${longDate(today)}`;
export const dsrFileName = (customer: string, today: string) =>
  `DSR ${customer.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)} ${today}.xlsx`;

/** The workbook's one sheet: the desk's copy, or the customer's (no agent). */
export function dsrSheet(rows: DsrRow[], input: { customer: string; today: string; forCustomer: boolean }): Sheet {
  const cols = dsrColumns(input.forCustomer);
  const sorted = sortRows(rows);
  return {
    name: "DSR",
    columns: cols.map(({ header, width, kind }) => ({ header, width, kind })),
    rows: sorted.map((r, i) => cols.map((c) => c.value(r, i))),
    report: {
      title: "DAILY STATUS REPORT",
      lines: [input.customer, `As on ${longDate(input.today)} · ${sorted.length} shipment${sorted.length === 1 ? "" : "s"}`],
      freezeColumns: 2,
      footer: `DSR · ${input.customer}`,
    },
  };
}

// ---------------------------------------------------------------------------
// The mail
// ---------------------------------------------------------------------------

const short = (iso: string | null) => (iso ? longDate(iso) : "—");

/**
 * The DSR as a mail: the company's letter, a short note, and one card per
 * shipment — readable on a phone, where a twenty-column table is not. The
 * full sheet goes with it as the attachment.
 */
export function dsrMailHtml(input: {
  customer: string;
  today: string;
  rows: DsrRow[];
  note: string;
  fromName?: string;
  logoSrc?: string | null;
}): string {
  const rows = sortRows(input.rows);
  const cell = (label: string, value: string) =>
    `<td valign="top" width="33%" style="padding:6px 8px 0 0;">
      <p style="margin:0;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${esc(label)}</p>
      <p style="margin:2px 0 0;font-size:13px;color:${INK};">${esc(value || "—")}</p>
    </td>`;
  const cards = rows
    .map((r) => {
      const head = [r.enquiryRef, r.blNo ? `BL ${r.blNo}` : "", r.mode, r.port].filter(Boolean).join(" · ");
      const cargo = [r.pkg, r.weight, r.cbm != null ? `${r.cbm} CBM` : ""].filter(Boolean).join(" · ");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${SOFT}" style="background:${SOFT};border:1px solid ${LINE};border-radius:8px;border-collapse:separate;margin:0 0 10px;">
        <tr><td style="padding:12px 14px;">
          <p style="margin:0;font-size:13.5px;font-weight:700;color:${NAVY};">${esc(head)}</p>
          ${cargo ? `<p style="margin:2px 0 0;font-size:12px;color:${MUTED};">${esc(cargo)}${r.vessel ? ` &middot; ${esc(r.vessel)}` : ""}</p>` : r.vessel ? `<p style="margin:2px 0 0;font-size:12px;color:${MUTED};">${esc(r.vessel)}</p>` : ""}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${cell("Cut-off", short(r.cutoff))}${cell("ETD", short(r.etd))}${cell("ETA", short(r.eta))}
          </tr></table>
          ${r.status ? `<p style="margin:10px 0 0;font-size:13px;font-weight:700;color:${r.delivered ? "#15803d" : ACCENT};">${esc(r.status)}</p>` : ""}
          ${r.reason ? `<p style="margin:3px 0 0;font-size:13px;line-height:1.5;color:${INK};">${esc(r.reason)}</p>` : ""}
        </td></tr>
      </table>`;
    })
    .join("");

  return letter({
    logoSrc: input.logoSrc,
    title: "DAILY STATUS REPORT",
    meta: [
      ["Date", longDate(input.today)],
      ["Shipments", String(rows.length)],
    ],
    sections: [
      section(`${caption("Prepared for")}<p style="margin:0;font-size:17px;font-weight:700;color:${NAVY};">${esc(input.customer)}</p>`, 26),
      message(input.note),
      section(rows.length ? cards : `<p style="margin:0;font-size:13px;color:${MUTED};">No shipments in progress.</p>`),
      signOff(input.fromName, undefined),
    ],
  });
}

/** The note above the shipments, for the sender to change. */
export const dsrNote = (count: number) =>
  count
    ? `Please find below the status of your ${count === 1 ? "shipment" : `${count} shipments`} with us as on today. The full report is attached as an Excel sheet. Do let us know if you need anything further.`
    : "There are no shipments in progress with us as on today.";
