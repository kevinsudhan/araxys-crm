import { useState } from "react";
import { AlertCircle, IndianRupee, Loader2, MailCheck } from "lucide-react";
import ComposeMail from "./ComposeMail";
import { subjectToken } from "../services/caseFile";
import { mailIsLive } from "../services/backend";
import {
  linkCustomerEmail,
  logEvent,
  markQuoteSent,
  type Customer,
  type Enquiry,
  type Quote,
} from "../services/enquiries";

/** Which letter is being written. They differ in wording, not in machinery. */
type Kind = "quotation" | "confirmation";

/**
 * The two letters that turn a phone call into a paper trail.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * A call ends with a rate named and a customer saying yes, and then nothing
 * written down on their side. They have no reference, no record of the figure,
 * and nothing to reply to -- so when they write next week it arrives as an
 * unfiled message from a stranger. Both letters here carry our reference in the
 * subject, which is what makes their reply file itself against this case.
 *
 * QUOTATION comes first: the rate in writing, before anybody has agreed.
 * Sending it moves the quote from draft to sent, so the pipeline reflects what
 * the customer has actually been shown rather than what was said on a call.
 *
 * CONFIRMATION comes after they accept: the same details, worded as agreed
 * rather than offered, sent before the booking is made.
 *
 * WHY THEY ARE DRAFTS AND NOT SENDS
 *
 * Both open the composer pre-filled rather than sending on click. They go out
 * under a real person's name, quoting a price to a customer, and whoever is
 * named on them should read them first. Everything in them comes from the
 * enquiry -- nothing is invented to fill a gap, and a field we do not hold is
 * simply not a line in the letter.
 *
 * WHY THERE IS AN ADDRESS FIELD
 *
 * Often there is no address on file, because the agent took the call and never
 * asked. Rather than refusing, the panel asks for one and writes it to the
 * customer through link_email_to_customer -- so the first letter out is also
 * what connects this customer's phone number to their mailbox.
 * ---------------------------------------------------------------------------
 */
export default function ConfirmPanel({
  enquiry,
  customer,
  quotes,
  mailbox,
  fromName,
  signature,
  onChanged,
}: {
  enquiry: Enquiry;
  customer: Customer | null;
  quotes: Quote[];
  mailbox: string;
  fromName: string;
  signature: string;
  onChanged: () => void;
}) {
  const known = customer?.emails ?? [];
  const [address, setAddress] = useState(known[0] ?? "");
  const [composing, setComposing] = useState<Kind | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The figure this letter is about: what they accepted, else the latest one
   * put to them, else the latest one there is. A superseded quote is not it.
   */
  const last = <T,>(xs: T[]): T | null => (xs.length ? xs[xs.length - 1] : null);
  const quote =
    quotes.find((q) => q.status === "accepted") ??
    last(quotes.filter((q) => q.status === "sent")) ??
    last(quotes);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim());
  const isNew = valid && !known.some((e) => e.toLowerCase() === address.trim().toLowerCase());
  const accepted = enquiry.status === "accepted";

  /**
   * Recorded only once the message has actually gone.
   *
   * Marking a quote sent, or writing an address to the customer, before the
   * send would leave the record claiming something that never happened -- and
   * the address is what all future mail from this customer is matched on.
   */
  async function sent(kind: Kind) {
    setComposing(null);
    setSaving(true);
    setError(null);
    try {
      // Only when it actually went. A demo send records nothing, because the
      // address would then be on the customer with no message to explain it.
      if (mailIsLive() && isNew && customer) await linkCustomerEmail(customer.id, address.trim());

      if (kind === "quotation" && quote && quote.status === "draft") {
        await markQuoteSent(quote.id, enquiry.ref, quote.amount_inr);
      } else {
        await logEvent(
          enquiry.ref,
          kind === "quotation" ? "quotation_emailed" : "confirmation_sent",
          `${kind === "quotation" ? "Quotation" : "Confirmation"} emailed to ${address.trim()}`,
          { to: address.trim(), quote_id: quote?.id ?? null }
        );
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sent, but the record could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 card p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
        <MailCheck size={12} /> Write to the customer
      </h2>

      <p className="text-[12px] text-text-secondary mb-3">
        {known.length
          ? "Both letters carry our reference in the subject, so the customer's reply files itself against this case."
          : "We have no email address for this customer — the call never captured one. Adding it here sends the letter and links their mailbox to this record, so their replies find this enquiry."}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[240px]">
          <span className="block text-[11px] text-text-secondary mb-1">
            Send to
            {known.length > 1 && <span className="text-text-muted"> · {known.length} on file</span>}
          </span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="name@company.com"
            className="w-full h-8"
            autoComplete="off"
            list={known.length > 1 ? `emails-${enquiry.ref}` : undefined}
          />
          {known.length > 1 && (
            <datalist id={`emails-${enquiry.ref}`}>
              {known.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          )}
        </label>

        {/*
          The quotation is offered whenever there is a figure to quote, whether
          or not it has been accepted -- a customer who agreed on the phone will
          still ask for it in writing, and re-sending it is a normal thing to do.
        */}
        <button
          onClick={() => setComposing("quotation")}
          disabled={!valid || !quote || saving}
          className={`flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-medium disabled:opacity-60 ${
            accepted
              ? "border border-border-strong bg-surface-1 text-text-primary hover:bg-surface-2"
              : "bg-brand hover:bg-brand-dark text-white"
          }`}
          title={
            !quote
              ? "No rate has been recorded yet — add a quote first"
              : valid
              ? undefined
              : "Enter an email address first"
          }
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <IndianRupee size={13} />}
          Draft quotation
        </button>

        <button
          onClick={() => setComposing("confirmation")}
          disabled={!valid || saving}
          className={`flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-medium disabled:opacity-60 ${
            accepted
              ? "bg-brand hover:bg-brand-dark text-white"
              : "border border-border-strong bg-surface-1 text-text-primary hover:bg-surface-2"
          }`}
          title={valid ? undefined : "Enter an email address first"}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <MailCheck size={13} />}
          {accepted ? "Send confirmation" : "Draft process-start email"}
        </button>
      </div>

      {!quote && (
        <p className="mt-2 text-[11px] text-text-muted">
          No rate recorded yet, so there is nothing to quote — add one above and the quotation
          letter fills itself in.
        </p>
      )}

      {quote?.status === "draft" && (
        <p className="mt-2 text-[11px] text-text-muted">
          Sending the quotation marks it as sent, so the pipeline shows what the customer has
          actually been shown.
        </p>
      )}

      {!mailIsLive() && (
        <p className="mt-2 text-[11px] text-text-warning">
          Outlook is not connected on this session, so this will be drafted and filed rather than
          delivered. Connect it on the Mail page to send for real.
        </p>
      )}

      {isNew && (
        <p className="mt-2 text-[11px] text-text-muted">
          New address — it will be added to {customer?.company || customer?.name || "this customer"}{" "}
          once the message is sent, so future mail from it lands on this case.
        </p>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {composing && (
        <ComposeMail
          mailbox={mailbox}
          fromName={fromName}
          signature={signature}
          initial={{
            to: address.trim(),
            subject: subjectFor(composing, enquiry),
            body: draft(composing, enquiry, customer, quote),
          }}
          onClose={() => setComposing(null)}
          onSent={() => void sent(composing)}
        />
      )}
    </section>
  );
}

const route = (e: Enquiry) => [e.origin, e.destination].filter(Boolean).join(" to ");

const money = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

/**
 * The reference goes in brackets at the front, where a reply-all cannot lose it.
 * Everything after it is for the human reading their inbox.
 */
function subjectFor(kind: Kind, e: Enquiry): string {
  const what =
    kind === "quotation"
      ? "Quotation"
      : e.status === "accepted"
      ? "Booking confirmation"
      : "Your shipment enquiry";
  return `${subjectToken(e.ref)} ${what}${route(e) ? ` — ${route(e)}` : ""}`;
}

/**
 * Builds the letter out of what the enquiry actually holds.
 *
 * Every line is conditional. An enquiry with no ready date produces a letter
 * with no ready-date line, rather than one saying "Ready: not specified" -- the
 * customer is being asked to check this, and a placeholder invites them to
 * confirm something nobody established.
 */
function draft(kind: Kind, e: Enquiry, customer: Customer | null, quote: Quote | null): string {
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim() !== "")
      rows.push([label, String(value)]);
  };

  add("Our reference", e.ref);
  add("Route", route(e));
  add("Cargo", e.cargo);
  add("Incoterm", e.incoterm);
  add(
    "Pieces",
    e.piece_count
      ? e.piece_length_cm && e.piece_width_cm && e.piece_height_cm
        ? `${e.piece_count} at ${e.piece_length_cm} × ${e.piece_width_cm} × ${e.piece_height_cm} cm`
        : String(e.piece_count)
      : null
  );
  add("Weight per piece", e.weight_per_piece_kg ? `${e.weight_per_piece_kg} kg` : null);
  add("Volume", e.volume_cbm ? `${e.volume_cbm} CBM` : null);
  add("Cargo ready", e.ready_date);
  add("Collection from", e.pickup_location);
  add("Consignee", [e.consignee_name, e.consignee_country].filter(Boolean).join(", "));
  add("Special handling", e.special_handling);
  if (quote) {
    add(
      kind === "quotation" ? "Our rate" : "Rate quoted",
      quote.basis ? `${money(quote.amount_inr)} — ${quote.basis}` : money(quote.amount_inr)
    );
    add("Sailing", quote.sailing_date);
    add("Valid until", quote.valid_until);
  }

  const greeting = customer?.name ? `Dear ${escapeHtml(customer.name)},` : "Dear Sir or Madam,";

  const opening =
    kind === "quotation"
      ? "Thank you for your enquiry. Our quotation is below, against the details we hold — please check them and tell us if anything is wrong, as the rate follows from them."
      : e.status === "accepted"
      ? "Thank you for your call. Confirming below what we agreed, so you have it in writing before we book."
      : "Thank you for your enquiry. Below is what we have recorded — please check it and let us know if anything needs correcting.";

  const closing =
    kind === "quotation"
      ? "To go ahead, reply to this message and we will confirm the booking. If any of the cargo details above are not right, tell us and we will requote."
      : e.status === "accepted"
      ? "If everything above is correct, please reply to confirm and we will proceed with the booking. Any corrections, just reply to this message."
      : "Reply to this message with any corrections or the details still outstanding, and we will come back to you with the booking.";

  const list = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#555;white-space:nowrap;vertical-align:top">${escapeHtml(
          k
        )}</td><td style="padding:3px 0;color:#111">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  // Plain paragraphs and one borderless block, so it reads the same in Outlook,
  // Gmail and on a phone. This is a business letter, not a layout.
  return (
    `<p>${greeting}</p>` +
    `<p>${opening}</p>` +
    `<table style="border-collapse:collapse;font-size:14px">${list}</table>` +
    `<p>${closing}</p>` +
    `<p style="color:#555;font-size:13px">Please keep <strong>${escapeHtml(
      e.ref
    )}</strong> in the subject line when you reply — it is how we keep every message about this shipment together.</p>`
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
