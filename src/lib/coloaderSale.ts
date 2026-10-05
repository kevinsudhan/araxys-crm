import { wmOf } from "./coload";
import { sameName } from "./receivedHbl";

/**
 * Space on our console sold to another forwarder (124).
 *
 * ---------------------------------------------------------------------------
 * A CO-LOADER IS A CUSTOMER WHO IS A FORWARDER
 *
 * They come the way every customer does — an enquiry, a quotation per W/M, a
 * booking, a job put on the console — so the price, the invoice and the
 * money are the job's. Three things differ, and they are here:
 *
 *   our house B/L names the forwarder as shipper, and their agent at
 *     destination as consignee: they issue their own house B/L to their
 *     shipper under ours;
 *   they need our delivery instructions: the CFS the box is stuffed at, the
 *     cut-off, the sailing, and what to send for our B/L;
 *   the console says how much of the box went to co-loaders, and to whom.
 * ---------------------------------------------------------------------------
 */

export interface ColoaderHouse {
  shipmentId: string;
  ref: string;
  forwarder: { id: string; name: string; email: string; address: string };
  /** Our house B/L to them, and whether it is out. */
  hblNo: string | null;
  hblIssued: boolean;
  /** The shipper our B/L names: the forwarder, or somebody else by mistake. */
  hblShipper: string;
  grossKg: number;
  cbm: number;
  /** The accepted quotation's figure in rupees, as quoted. */
  quotedInr: number | null;
  instructionsSentAt: string | null;
  instructionsSentTo: string;
}

export interface ColoaderConsole {
  console_no: string | null;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  place_of_delivery: string;
  etd: string | null;
  cutoff_date: string | null;
  cfs_name: string;
}

/** How much of the box went to co-loaders: W/M theirs of all, and what it was quoted at. */
export function coloaderShare(houses: ColoaderHouse[], console: { cbm: number; grossKg: number }): { houses: number; wm: number; ofAll: number | null; quotedInr: number } {
  const wm = Math.round(houses.reduce((n, h) => n + wmOf(h.cbm, h.grossKg), 0) * 1000) / 1000;
  const all = wmOf(console.cbm, console.grossKg);
  return {
    houses: houses.length,
    wm,
    ofAll: all > 0 ? Math.round((wm / all) * 1000) / 10 : null,
    quotedInr: Math.round(houses.reduce((n, h) => n + (h.quotedInr ?? 0), 0) * 100) / 100,
  };
}

/** What is not right with one co-loader's house yet, in words. */
export function coloaderIssues(h: ColoaderHouse): string[] {
  const out: string[] = [];
  if (!h.forwarder.email) out.push("No email for them");
  if (!h.instructionsSentAt) out.push("Delivery instructions not sent");
  if (!h.hblNo) out.push("No house B/L to them yet");
  else if (h.hblShipper && !sameName(h.hblShipper, h.forwarder.name)) out.push(`Our B/L names ${h.hblShipper} as shipper, not ${h.forwarder.name}`);
  if (h.quotedInr === null) out.push("No accepted quotation");
  return out;
}

/** What the instructions need before they are worth sending. Said beside the button; they can still go. */
export function instructionIssues(c: ColoaderConsole): string[] {
  const out: string[] = [];
  if (!c.cfs_name.trim()) out.push("Name the stuffing CFS");
  if (!c.cutoff_date) out.push("No cut-off date on the console");
  if (!c.etd) out.push("No ETD on the console");
  return out;
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function instructionsSubject(c: ColoaderConsole, h: Pick<ColoaderHouse, "ref">): string {
  return [
    `[${h.ref}] DELIVERY INSTRUCTIONS`,
    c.console_no,
    [up(c.pol), up(c.place_of_delivery || c.pod)].filter(Boolean).join("-") || null,
    c.cutoff_date ? `CUT-OFF ${up(day(c.cutoff_date))}` : null,
  ]
    .filter(Boolean)
    .join(" — ");
}

/**
 * The instructions to the co-loader: their cargo is booked on our box; where
 * and by when to deliver it; and the shipping instructions we need for our
 * house B/L to them.
 */
export function instructionsHtml(c: ColoaderConsole, h: Pick<ColoaderHouse, "ref" | "forwarder" | "grossKg" | "cbm">): string {
  const cell = "padding:4px 10px 4px 0;vertical-align:top;border-bottom:1px solid #e5e7eb";
  const facts: Array<[string, string]> = [
    ["Our reference", up(h.ref)],
    ["Console", up(c.console_no)],
    ["Vessel / voyage", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" / ")],
    ["Port of loading", up(c.pol)],
    ["Port of discharge", up(c.pod)],
    ["Place of delivery", up(c.place_of_delivery)],
    ["ETD", day(c.etd)],
    ["Cargo cut-off at the CFS", day(c.cutoff_date)],
    ["Deliver the cargo to", up(c.cfs_name)],
    ["Booked", [h.grossKg ? `${h.grossKg.toLocaleString("en-IN")} KGS` : "", h.cbm ? `${h.cbm.toLocaleString("en-IN")} CBM` : ""].filter(Boolean).join(" / ")],
  ];
  const needs = [
    "Shipper: yourselves, with your full address",
    "Consignee and notify party: your agent at destination, with address and contact",
    "Marks and numbers, number and kind of packages",
    "Description of goods and HS code",
    "Gross weight and measurement",
    "Freight prepaid or collect",
    "The shipping bill number for the cargo, once filed",
  ];
  return (
    `<p>Dear ${esc(h.forwarder.name || "Sir / Madam")} team,</p>` +
    `<p>Thank you for your booking. Your cargo is booked on our console as below. Kindly deliver it to the CFS before the cut-off, quoting our reference <strong>${esc(up(h.ref))}</strong> on the delivery.</p>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px">` +
    facts.filter(([, v]) => v).map(([k, v]) => `<tr><td style="${cell};color:#555;width:190px">${k}</td><td style="${cell}">${esc(v)}</td></tr>`).join("") +
    `</table>` +
    `<p>Please send your shipping instructions for our house B/L by the cut-off:</p>` +
    `<ul style="margin:4px 0 12px;padding-left:20px;font-size:13px;line-height:1.6">${needs.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` +
    `<p>We will send you the draft B/L to approve before it is issued.</p>`
  );
}
