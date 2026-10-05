import type { Customer, Enquiry, Quote } from "../services/enquiries";
import type { QuoteLine } from "../services/quoteLines";
import type { QuoteTerm } from "../services/quoteApproval";
import { shareOf, type ChargesLayout } from "./pastedQuote";
import { roeText, rupees, type AirTable } from "./airQuote";
import { isRevised, quotationNumber, quotationTitle, revisionOf } from "./quoteRevision";
import { formatDate } from "./dates";
import {
  ACCENT,
  INK,
  LINE,
  MODE_WORD,
  MUTED,
  NAVY,
  caption,
  esc,
  letter,
  longDate,
  message as messageSection,
  money,
  num,
  packagesAndWeight,
  preparedFor,
  section,
  shipmentBox,
  signOff,
} from "./brandedMail";

/**
 * The quotation, as a mail a customer opens.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MAIL CARRIES THE FIGURES AND NOT JUST THE ATTACHMENT
 *
 * Half the people who receive this read it on a phone, where opening a PDF is a
 * decision rather than a glance. A mail saying "please find attached" makes the
 * customer work before they can see a number, and the ones who do not bother
 * are the ones who go quiet. The PDF still goes, because that is what gets
 * forwarded to their accounts department and printed.
 *
 * THE LETTERHEAD
 *
 * The card, the logo header, the shipment box, the sign-off and the footer
 * are the shared letterhead in lib/brandedMail.ts, so the booking
 * confirmation looks like the same company wrote it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not invent a figure. Where a charge has no rate, the line prints what
 * is recorded rather than a total that looks complete, because a quotation that
 * silently omits a charge is one this desk has to honour.
 * ---------------------------------------------------------------------------
 */

export interface QuotationMailInput {
  enquiry: Enquiry;
  customer: Customer | null;
  quote: Quote;
  lines: QuoteLine[];
  terms: QuoteTerm[];
  /** What the sender wants to say above the figures. Their words, not ours. */
  message?: string;
  /** How it is signed off. */
  fromName?: string;
  company?: string;
  /**
   * Where the customer can accept it, if a link has been issued.
   *
   * Absent means no button is drawn — better than a button that goes nowhere.
   */
  acceptUrl?: string | null;
  /**
   * The logo's address (MAIL_LOGO_PATH on this app's origin).
   *
   * An http address so the compose window can show it; the send swaps it for
   * an inline attachment (lib/inlineBrand.ts). Absent, the header sets the
   * name in type instead.
   */
  logoSrc?: string | null;
  /**
   * A pasted quotation's charges (lib/pastedQuote `chargesLayout`). Given, the
   * letter carries them in the desk's own style (`chargesHtml`) where it would
   * otherwise draw the charges table. Everything around them is the same
   * letter. The PDF keeps its tables.
   */
  charges?: ChargesLayout | null;
  /**
   * A pasted air quotation's charges (lib/airQuote `airTable`): the desk's
   * rate table (`airTableHtml`) where the letter would draw its own. Wins over
   * `charges`.
   */
  airCharges?: AirTable | null;
  /** When it is sent; now when not given. Said under the buttons and at the foot (see `sentLine`). */
  sentAt?: Date;
}

/**
 * "1 Oct 2026, 3:05 pm" — when this send left, in India time.
 *
 * Said in words under the Accept and Revise buttons and on the last line of
 * the footer. Gmail folds whatever a mail in a thread repeats from an earlier
 * one behind "•••", and a quotation revised or sent again in the customer's
 * thread repeated its buttons, terms and footer word for word — so the Accept
 * button went behind the dots (1 Oct). Hidden differences do not count with
 * Gmail; this one is visible and true, and no two sends share it.
 */
/**
 * This send's time as a run of zero-width characters (space, non-joiner,
 * joiner): nothing to see, and no two sends a second apart alike. Put at the
 * end of a button's label so the label is not, as Gmail compares it, the
 * label of the quotation sent before.
 */
export function sendSignature(at: Date): string {
  const marks = ["&#8203;", "&#8204;", "&#8205;"];
  let n = Math.floor(at.getTime() / 1000);
  let out = "";
  while (n > 0) {
    out += marks[n % 3];
    n = Math.floor(n / 3);
  }
  return out;
}

export function sentLine(at: Date): string {
  // formatDate, not toLocaleDateString: the locale writes September as "Sept".
  return formatDate(at, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

/** The subject line, carrying the reference so the reply files itself. */
export function quotationSubject(i: { enquiry: Enquiry; quote: Quote }): string {
  const lane = [i.enquiry.origin, i.enquiry.destination].filter(Boolean).join(" – ");
  const what = isRevised(i.quote.version) ? `Revised quotation ${i.enquiry.ref} (Rev ${revisionOf(i.quote.version)})` : `Quotation ${i.enquiry.ref}`;
  return `${what}${lane ? ` · ${lane}` : ""}`;
}

/** The default covering note, for the sender to edit rather than to send as is. */
export function quotationMessage(i: QuotationMailInput): string {
  const lane = [i.enquiry.origin, i.enquiry.destination].filter(Boolean).join(" to ");
  // A revision says so, and that it replaces what they were sent before.
  if (isRevised(i.quote.version)) {
    return (
      `Please find our revised quotation${lane ? ` for ${lane}` : ""} (revision ${revisionOf(i.quote.version)}), set out below and attached as a PDF. ` +
      `It replaces our earlier quotation.` +
      (i.quote.valid_until ? ` The rates are valid until ${longDate(i.quote.valid_until)}.` : "") +
      ` Please let us know if you would like us to proceed, or if anything needs adjusting.`
    );
  }
  return (
    `Thank you for your enquiry${lane ? ` for ${lane}` : ""}. ` +
    `Our quotation is set out below and attached as a PDF.` +
    (i.quote.valid_until ? ` The rates are valid until ${longDate(i.quote.valid_until)}.` : "") +
    ` Please let us know if you would like us to proceed, or if anything needs adjusting.`
  );
}

export function quotationHtml(i: QuotationMailInput): string {
  const { enquiry, customer, quote, lines, terms } = i;
  const text = i.message?.trim() || quotationMessage(i);
  // "ALG09014-26 Rev 1" on a revision: the header keeps to three facts, which is what a phone fits.
  const ref = quotationNumber(enquiry.ref, quote.version);
  const at = i.sentAt ?? new Date();
  const sent = sentLine(at);

  /*
    Two columns, for a single unit (5 Oct): every charge goes as its rate per
    kg, per CBM, per container — never multiplied out by the cargo. The unit
    sits under the charge name; a rate in another currency carries its rupee
    figure under it at the rate of exchange. A share of other charges ("3% on
    OF+EXW") has no figure for one unit and goes as its wording.
  */
  const unitCell = (l: QuoteLine) => {
    const share = shareOf(l.description);
    if (share) return `<span style="color:${INK};font-weight:600;">${esc(share.toUpperCase())}</span>`;
    const fx = (l.currency || "INR") !== "INR" && Number(l.fx_rate) > 0 ? Number(l.fx_rate) : null;
    return `<span style="color:${INK};font-weight:600;">${esc(l.currency || "INR")}&nbsp;${num(l.rate)}</span>${
      fx ? `<span style="display:block;margin-top:2px;color:${MUTED};font-size:11.5px;">${money(Number(l.rate) * fx)} at ${num(fx)}</span>` : ""
    }`;
  };
  const charges = lines.length
    ? lines
        .map(
          (l) => `
          <tr>
            <td style="padding:12px 8px;border-bottom:1px solid ${LINE};color:${INK};font-size:13.5px;line-height:1.4;word-break:break-word;">
              ${esc(shareOf(l.description) ? l.description.replace(/\s*\([^()]+\)\s*$/, "") : l.description)}
              ${l.unit && l.unit !== "Lumpsum" && !shareOf(l.description) ? `<span style="display:block;margin-top:2px;color:${MUTED};font-size:11.5px;">per ${esc(l.unit)}</span>` : ""}
            </td>
            <td align="right" style="padding:12px 8px;border-bottom:1px solid ${LINE};font-size:13.5px;white-space:nowrap;">${unitCell(l)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="2" style="padding:16px 10px;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px;font-style:italic;">Charges as discussed.</td></tr>`;

  const grouped = groupTerms(terms);
  const termsHtml = grouped.length
    ? section(
        `${caption("Terms & conditions", NAVY)}
        ${grouped
          .map(
            (g) => `
          ${g.label ? `<p style="margin:10px 0 4px;font-size:12px;font-weight:700;color:${INK};">${esc(g.label)}</p>` : ""}
          <ol style="margin:6px 0 0;padding-left:18px;list-style-type:decimal;color:${MUTED};font-size:12px;line-height:1.6;">
            ${g.items.map((t) => `<li style="margin:0 0 3px;">${esc(t)}</li>`).join("")}
          </ol>`
          )
          .join("")}`,
        26
      )
    : "";

  /*
    The accept button: a link, not a form. The page it opens is what accepts;
    following this URL only reads, because Outlook Safe Links and every mail
    gateway fetch the links in a message before the recipient sees it.

    A table cell with its own background rather than a styled <a> alone:
    Outlook ignores padding and background on inline elements.

    Two buttons side by side: accept, or ask for a revision (114). Both open
    the same page: the first thanks them and asks for the shipper (`?accept=1`;
    sending the details records the acceptance), the second opens it at the box
    for what they want changed (`?revise=1`).
  */
  const withParam = (url: string, param: string) => `${url}${url.includes("?") ? "&" : "?"}${param}`;
  const acceptHref = i.acceptUrl ? withParam(i.acceptUrl, "accept=1") : null;
  const reviseUrl = i.acceptUrl ? withParam(i.acceptUrl, "revise=1") : null;
  /*
    The buttons and the line under them are one table, and each label ends in
    this send's own run of zero-width characters (`sendSignature`): Gmail
    folds a block it has seen word for word earlier in the thread, and the
    button block was the one block a revised or resent quotation still
    repeated exactly — the send time under it sat outside it (1 Oct).
  */
  const sig = sendSignature(at);
  const accept = i.acceptUrl
    ? section(
        `<table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td bgcolor="${ACCENT}" style="background:${ACCENT};border:1px solid ${ACCENT};border-radius:6px;">
              <a href="${esc(acceptHref!)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:.02em;">Accept this quotation &rarr;${sig}</a>
            </td>
            <td style="width:10px;font-size:0;line-height:0;">&nbsp;</td>
            <td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${ACCENT};border-radius:6px;">
              <a href="${esc(reviseUrl!)}" style="display:inline-block;padding:12px 22px;color:${ACCENT};font-size:14px;font-weight:700;text-decoration:none;letter-spacing:.02em;">Revise this quote${sig}</a>
            </td>
          </tr>
          <tr>
            <td colspan="3" style="padding:8px 0 0;">
              <p style="margin:0;font-size:11.5px;color:${MUTED};line-height:1.5;">Sent ${esc(sent)}. Accepting ${esc(ref)} asks for the shipper's details to confirm the booking; revising asks what you would like changed. Replying to this email works just as well.</p>
            </td>
          </tr>
        </table>`,
        24
      )
    : "";

  const table = i.airCharges ? section(airTableHtml(i.airCharges), 24) : i.charges ? section(chargesHtml(i.charges), 24) : section(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th align="left" bgcolor="${NAVY}" style="background:${NAVY};padding:10px 8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;font-weight:700;">Charge</th>
              <th align="right" bgcolor="${NAVY}" style="background:${NAVY};padding:10px 8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;font-weight:700;">Rate per unit</th>
            </tr>
          </thead>
          <tbody>${charges}</tbody>
        </table>`,
    24
  );

  return letter({
    logoSrc: i.logoSrc,
    stamp: `Quotation ${ref} · sent ${sent}`,
    title: quotationTitle(quote.version),
    meta: [
      ["Reference", esc(ref)],
      ["Date", longDate(quote.created_at)],
      ...(quote.valid_until ? ([["Valid until", longDate(quote.valid_until)]] as Array<[string, string]>) : []),
    ],
    sections: [
      preparedFor(customer),
      messageSection(text),
      shipmentBox(enquiry, [
        ["Mode", enquiry.transport_mode ? MODE_WORD[enquiry.transport_mode] ?? "" : ""],
        ["Incoterm", enquiry.incoterm ? esc(enquiry.incoterm.toUpperCase()) : ""],
        ["Cargo", esc(enquiry.cargo ?? "")],
        ["Cargo ready", enquiry.ready_date ? longDate(enquiry.ready_date) : ""],
        ["Packages & weight", packagesAndWeight(enquiry)],
      ]),
      table,
      accept,
      termsHtml,
      signOff(i.fromName, i.company),
    ],
  });
}

/**
 * A pasted quotation's charges in the letter, in the desk's own style (1 Oct):
 * each group under a red, underlined heading on a yellow mark, the way the
 * desk has always set "FREIGHT CHARGES :" in its mails; a line per charge in
 * capitals, the colons and figures lined up; a condition in red. No totals,
 * under a group or for the whole (1 Oct): the quotation is its charges. The
 * rates of exchange stay, for the figures in other currencies. Lined up with
 * a borderless table, so it reads as text — there is no grid to see.
 */
const MARK = "#ffff00";
const RED = "#c00000";

export function chargesHtml(c: ChargesLayout): string {
  const cell = (inner: string, extra = "") =>
    `<td valign="top" style="padding:3px 0;font-size:13.5px;line-height:1.45;color:${INK};${extra}">${inner}</td>`;
  const row = (name: string, value: string, note: string | null, bold = false) =>
    `<tr>${cell(esc(name.toUpperCase()), `width:46%;padding-right:12px;${bold ? "font-weight:700;" : ""}`)}${cell(":", "width:10px;padding-right:8px;")}${cell(
      esc(value.toUpperCase()) + (note ? ` <span style="color:${RED};">(${esc(note.toUpperCase())})</span>` : ""),
      bold ? "font-weight:700;" : ""
    )}</tr>`;
  const groups = c.groups
    .map(
      (g) => `
    <p style="margin:0 0 8px;"><span style="background:${MARK};color:${RED};font-size:14px;font-weight:700;text-decoration:underline;letter-spacing:.02em;padding:1px 4px;">${esc(g.title.toUpperCase())} :</span></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;">
      ${g.rows.map((r) => row(r.name, r.value, r.note)).join("")}
    </table>`
    )
    .join("");
  return `${groups}${c.rates ? `
    <p style="margin:0;font-size:12.5px;color:${MUTED};">Rates of exchange: ${esc(c.rates)}</p>` : ""}`;
}

/**
 * A pasted air quotation's charges, as the desk's rate table (115): the line
 * of what it is for across the top, then CHARGES | CURRENCY/QUANTUM | RATES |
 * INR | GST | TOTAL VALUE IN INR, a row per group, and the rate of exchange
 * on the desk's yellow mark under it. No TOTAL row (1 Oct): the quotation is
 * its charges. Ruled like the desk's own
 * sheet, its figures right-aligned to the paisa so the columns line up.
 */
export function airTableHtml(t: AirTable): string {
  const GRID = "#94a3b8";
  const TINT = "#eef2f7";
  const cell = (inner: string, style = "", span = 1) =>
    `<td${span > 1 ? ` colspan="${span}"` : ""} style="border:1px solid ${GRID};padding:6px 7px;font-size:12px;line-height:1.35;color:${INK};${style}">${inner}</td>`;
  const fig = "text-align:right;white-space:nowrap;";
  const amount = (v: number | null) => (v === null ? "-" : rupees(v));
  // The charge name gets the room: it is the one column that should not wrap.
  const widths = [28, 15, 15, 14, 11, 17];
  const head = ["Charges", "Currency / Quantum", "Rates", "INR", "GST", "Total value in INR"]
    .map((h, k) => cell(esc(h.toUpperCase()), `width:${widths[k]}%;background:${TINT};font-size:10.5px;font-weight:700;letter-spacing:.03em;${k ? "text-align:center;" : ""}`))
    .join("");
  const body = t.groups
    .map(
      (g) =>
        `<tr>${cell(esc(g.title), `font-weight:700;color:${NAVY};background:#f8fafc;`, 6)}</tr>` +
        g.rows
          .map((r) => {
            const name = esc(r.name) + (r.note ? ` <span style="color:${RED};">(${esc(r.note)})</span>` : "");
            const figures = r.instead
              ? cell(esc(r.instead), "text-align:center;", 4)
              : cell(esc(r.rate), fig) + cell(amount(r.inr), fig) + cell(amount(r.gst), fig) + cell(amount(r.value), `${fig}font-weight:600;`);
            return `<tr>${cell(name)}${cell(esc(r.basis), "white-space:nowrap;")}${figures}</tr>`;
          })
          .join("")
    )
    .join("");
  const roe = t.roe.length
    ? `<p style="margin:10px 0 0;"><span style="background:${MARK};color:${INK};font-size:12.5px;font-weight:700;padding:3px 8px;">${esc(t.roe.map(roeText).join("   ·   "))}</span></p>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${t.title ? `<tr>${cell(esc(t.title), `background:${NAVY};color:#ffffff;font-weight:700;font-size:12.5px;text-align:center;letter-spacing:.02em;`, 6)}</tr>` : ""}
      <tr>${head}</tr>
      ${body}
    </table>${roe}`;
}

/**
 * Terms grouped by scope, general first.
 *
 * General terms apply to everything and a mode's terms are an addition to them,
 * so reading the mode's block first would have the customer agreeing to the
 * exception before the rule.
 */
export function groupTerms(terms: QuoteTerm[]): Array<{ label: string; items: string[] }> {
  const by = new Map<string, string[]>();
  for (const t of terms) {
    if (!t.text.trim()) continue;
    const list = by.get(t.scope) ?? [];
    list.push(t.text.trim());
    by.set(t.scope, list);
  }
  const order = ["general", "air", "sea_lcl", "sea_fcl", "road"];
  return [...by.entries()]
    .sort((a, b) => indexOrLast(order, a[0]) - indexOrLast(order, b[0]))
    .map(([scope, items]) => ({ label: scope === "general" ? "" : SCOPE_LABEL[scope] ?? scope, items }));
}

const SCOPE_LABEL: Record<string, string> = {
  air: "Air",
  sea_lcl: "Sea LCL",
  sea_fcl: "Sea FCL",
  road: "Road",
};

const indexOrLast = (list: string[], v: string) => {
  const i = list.indexOf(v);
  return i === -1 ? list.length : i;
};
