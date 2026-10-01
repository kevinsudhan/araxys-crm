import type { Customer, Enquiry, Quote } from "../services/enquiries";
import { subjectToken } from "../services/caseFile";
import { MODE_WORD, esc, letter, longDate, message as messageSection, num, preparedFor, shipmentBox, signOff } from "./brandedMail";

/**
 * The booking confirmation: the booking is confirmed, and what it is for.
 *
 * ---------------------------------------------------------------------------
 * The same letterhead as the quotation (lib/brandedMail.ts), so the customer
 * reads one company from the first rate to the booking. It says the booking
 * is confirmed and sets out the shipment — nothing more (1 Oct): no rate or
 * total, and no request to reply, which the customer has already done by
 * accepting.
 *
 * Every line is conditional. An enquiry with no ready date produces a letter
 * with no ready-date line, rather than one saying "Ready: not specified" — the
 * customer is being asked to check this, and a placeholder invites them to
 * confirm something nobody established.
 * ---------------------------------------------------------------------------
 */

export interface ConfirmationMailInput {
  enquiry: Enquiry;
  customer: Customer | null;
  /** The accepted quotation, when there is one. */
  quote: Quote | null;
  fromName?: string;
  company?: string;
  /** The logo on this app (MAIL_LOGO_PATH); carried inside the message at send. */
  logoSrc?: string | null;
  /** Today, for the letter's date; passed in so the letter is the same when tested. */
  date?: Date;
}

const route = (e: Enquiry) => [e.origin, e.destination].filter(Boolean).join(" to ");

/** The reference goes in brackets at the front, where a reply-all cannot lose it. */
export function confirmationSubject(e: Enquiry): string {
  return `${subjectToken(e.ref)} Booking confirmation${route(e) ? ` — ${route(e)}` : ""}`;
}

/** The covering note, for the sender to edit rather than to send as is. */
export function confirmationMessage(i: Pick<ConfirmationMailInput, "customer">): string {
  const greeting = i.customer?.name ? `Dear ${i.customer.name},` : "Dear Sir or Madam,";
  return `${greeting}\n\nYour booking has been confirmed.`;
}

export function confirmationHtml(i: ConfirmationMailInput): string {
  const { enquiry: e, customer, quote } = i;

  // Totals, not one piece's size: a consignment of several sizes has no single one to print.
  const pieces = e.piece_count
    ? e.piece_length_cm && e.piece_width_cm && e.piece_height_cm
      ? `${num(e.piece_count)} at ${num(e.piece_length_cm)} × ${num(e.piece_width_cm)} × ${num(e.piece_height_cm)} cm`
      : `${num(e.piece_count)}`
    : e.package_count
      ? `${num(e.package_count)} ${esc(e.package_type || "packages")}`
      : "";

  const facts: Array<[string, string]> = [
    ["Mode", e.transport_mode ? MODE_WORD[e.transport_mode] ?? "" : ""],
    ["Incoterm", e.incoterm ? esc(e.incoterm.toUpperCase()) : ""],
    ["Cargo", esc(e.cargo ?? "")],
    ["Cargo ready", e.ready_date ? longDate(e.ready_date) : ""],
    ["Pieces", pieces],
    ["Gross weight", e.gross_weight_kg ? `${num(e.gross_weight_kg)} kg` : ""],
    ["Volume", e.volume_cbm ? `${num(e.volume_cbm)} CBM` : ""],
    ["Sailing", quote?.sailing_date ? longDate(quote.sailing_date) : ""],
    ["Collection from", e.pickup_required ? esc(e.pickup_location ?? "") : ""],
    ["Delivery to", e.delivery_required ? esc(e.delivery_location ?? "") : ""],
    ["Consignee", esc([e.consignee_name, e.consignee_country].filter(Boolean).join(", "))],
    ["Special handling", esc(e.special_handling ?? "")],
  ];

  return letter({
    logoSrc: i.logoSrc,
    title: "BOOKING CONFIRMATION",
    meta: [
      ["Reference", esc(e.ref)],
      ["Date", longDate((i.date ?? new Date()).toISOString())],
      ...(e.customer_reference ? ([["Your ref", esc(e.customer_reference)]] as Array<[string, string]>) : []),
    ],
    sections: [
      preparedFor(customer),
      messageSection(confirmationMessage(i)),
      shipmentBox(e, facts),
      signOff(i.fromName, i.company),
    ],
  });
}
