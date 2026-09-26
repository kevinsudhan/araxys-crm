/**
 * Live rates (101): the Sunday mail asking a partner for the coming week's
 * rates on a service the desk names, and when it goes.
 *
 * ---------------------------------------------------------------------------
 * WHEN
 *
 * Every Sunday at 10:30 pm IST (17:00 GMT, pg_cron's clock), so the rates are
 * in the mailbox when the desk opens on Monday. The week asked about is the
 * one starting the next morning. A mail sent by hand on any other day asks
 * from that day to the coming Sunday instead, so it never asks about days
 * already gone.
 *
 * WHAT
 *
 * One mail per partner, addressed to them by name: no partner sees who else
 * was asked (as the enquiry's rate requests, services/rfq.ts). The subject
 * starts "Rate request", which is how Team oversight files it (lib/mailLog.ts).
 *
 * The live-rates function sends this same mail: it keeps a copy of this file,
 * and a test keeps the two identical. So nothing here may import anything.
 * ---------------------------------------------------------------------------
 */

export const SEND_WEEKDAY = 0; // Sunday
export const SEND_HOUR_IST = 22;
export const SEND_MINUTE_IST = 30;
export const SCHEDULE_LABEL = "Every Sunday, 10:30 pm IST";

const IST_MS = 5.5 * 3600 * 1000;
const DAY_MS = 86400000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The calendar date in India at an instant, yyyy-mm-dd. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** The next Sunday 10:30 pm IST strictly after `now`. */
export function nextSendAt(now: Date): Date {
  const ist = new Date(now.getTime() + IST_MS);
  const ahead = (SEND_WEEKDAY - ist.getUTCDay() + 7) % 7;
  const at = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + ahead, SEND_HOUR_IST, SEND_MINUTE_IST) - IST_MS;
  return new Date(at > now.getTime() ? at : at + 7 * DAY_MS);
}

/**
 * The days a mail sent at `at` asks about, as yyyy-mm-dd: on a Sunday, the
 * Monday after to the Sunday after; on any other day, that day to the coming
 * Sunday.
 */
export function weekAsked(at: Date): { from: string; to: string } {
  const [y, m, d] = istDate(at).split("-").map(Number);
  const today = Date.UTC(y, m - 1, d);
  const dow = new Date(today).getUTCDay();
  const from = dow === SEND_WEEKDAY ? today + DAY_MS : today;
  const to = dow === SEND_WEEKDAY ? today + 7 * DAY_MS : today + ((7 - dow) % 7) * DAY_MS;
  return { from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10) };
}

/** "2026-09-29" → "Mon 29 Sep", with the year when asked. */
export function dayLabel(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

export interface RateRequestLike {
  service: string;
  details: string;
}

export interface RecipientLike {
  /** The contact person. */
  name: string;
  organisation: string;
}

export interface Letterhead {
  legalName: string;
  address: string[];
  phone: string;
  website: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Dear Omar," or "Dear Gulf Freight Partners team," — never a blank name. */
export function greetingFor(p: RecipientLike): string {
  const name = p.name.trim();
  if (name) return name;
  const org = p.organisation.trim();
  return org ? `${org} team` : "Sir / Madam";
}

export function rateRequestSubject(req: RateRequestLike, at: Date): string {
  const { from } = weekAsked(at);
  return `Rate request · ${req.service.trim()} · week of ${dayLabel(from).slice(4)}`;
}

/** The mail itself: Outlook-safe HTML, every style inline. */
export function rateRequestMail(
  req: RateRequestLike,
  partner: RecipientLike,
  company: Letterhead,
  at: Date
): { subject: string; html: string } {
  const { from, to } = weekAsked(at);
  const details = req.details.trim();
  const detailsHtml = details
    .split(/\r?\n/)
    .map((l) => esc(l.trim()))
    .filter(Boolean)
    .join("<br/>");
  const p = (inner: string, gap = 12) => `<p style="margin:0 0 ${gap}px">${inner}</p>`;
  const html = [
    `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45;color:#1f2937">`,
    p(`Dear ${esc(greetingFor(partner))},`),
    p(`Greetings from ${esc(company.legalName)}.`),
    p(`Please share your best rates for <b>${dayLabel(from)} to ${dayLabel(to, true)}</b> for:`, 8),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 14px"><tr>`,
    `<td style="border-left:4px solid #0f6e56;background:#eef6f2;padding:10px 16px">`,
    `<div style="font-size:13pt;font-weight:bold;color:#0f213a">${esc(req.service.trim())}</div>`,
    detailsHtml ? `<div style="margin-top:6px;color:#374151">${detailsHtml}</div>` : "",
    `</td></tr></table>`,
    p("Kindly mention the validity, free time and any surcharges. A reply to this mail is all we need."),
    `<p style="margin:0">Thanks &amp; regards,<br/><b>Pricing desk</b><br/>${esc(company.legalName)}<br/>${company.address.map(esc).join("<br/>")}<br/>Tel: ${esc(company.phone)} · ${esc(company.website)}</p>`,
    `</div>`,
  ].join("");
  return { subject: rateRequestSubject(req, at), html };
}
