import type { MailMessage } from "./backend";

/**
 * Recognising and reading the website's quote form.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS NEEDS NO MODEL
 *
 * A form submission has a fixed shape. It comes from one sender, carries one
 * subject, and writes its fields under labels the form itself chose. Deciding
 * whether a message is one is a string comparison, and pulling the fields out
 * is a parse. Putting a language model in front of that would cost money per
 * message to be less reliable than a regular expression.
 *
 * The live form posts through Netlify:
 *
 *   From:    aashishlogisticsglobal.com <formresponses@netlify.com>
 *   To:      info@aashishlogistics.com
 *   Subject: Form submission from quote form:
 *
 *   Name:
 *   Kevin Sudhan
 *
 *   Phone:
 *   +918939153390
 *
 *   Email:
 *   kevinsudhan31@gmail.com
 *
 *   Message:
 *   Enquiry test
 *
 * THE ADDRESS IN THE HEADER IS NOT THE CUSTOMER
 *
 * That is the whole reason this file exists. The sender is Netlify's mailer, so
 * taking the customer from the From header would file every website enquiry
 * this business ever receives under one customer called netlify.com. The real
 * address is in the body, under a label, and has to be read out of it.
 *
 * WHAT IT DOES WHEN THE FORM CHANGES
 *
 * Degrades, rather than breaks. Every field is optional and unknown labels are
 * ignored, so adding a field to the website yields a row with one fewer field
 * filled in rather than a parse failure. Nothing here decides anything either:
 * the result lands in the intake queue, where a person confirms it before a
 * reference is allocated. A wrong parse is visible and correctable, which is
 * exactly what the queue is for.
 * ---------------------------------------------------------------------------
 */

/**
 * How a website submission is recognised.
 *
 * Two independent signals, because either can survive what the other does not.
 * The sender is exact but changes if the form is ever moved off Netlify; the
 * subject survives that move but is easier for an unrelated message to match.
 * Requiring only one keeps recognition working through either change, and the
 * cost of a false positive is a row in a queue somebody was going to read.
 *
 * Edit these when the form moves. They are the whole configuration.
 */
export const WEB_FORM_SENDERS = ["formresponses@netlify.com"];
export const WEB_FORM_SUBJECT = /^\s*form submission from\b/i;

/** True when this message is a submission from the website's form. */
export function looksLikeWebEnquiry(m: MailMessage): boolean {
  const from = m.from?.emailAddress?.address?.trim().toLowerCase() ?? "";
  if (WEB_FORM_SENDERS.includes(from)) return true;
  return WEB_FORM_SUBJECT.test(m.subject ?? "");
}

export interface ParsedWebEnquiry {
  contact_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  origin: string | null;
  destination: string | null;
  cargo: string | null;
  notes: string | null;
  /** Which labels were found, so the interface can say what it read. */
  found: string[];
}

/**
 * Labels the form might use, mapped onto the fields the queue holds.
 *
 * Several spellings each, because the wording on a website changes without
 * anybody telling the CRM. Matching is on the label text with punctuation and
 * case removed.
 */
const LABELS: Array<{ keys: string[]; field: keyof ParsedWebEnquiry }> = [
  { keys: ["name", "full name", "your name", "contact name", "contact person"], field: "contact_name" },
  { keys: ["company", "company name", "organisation", "organization", "business"], field: "company" },
  { keys: ["email", "e mail", "email address", "your email"], field: "email" },
  { keys: ["phone", "mobile", "phone number", "contact number", "telephone", "whatsapp"], field: "phone" },
  { keys: ["origin", "from", "pickup", "pick up", "port of loading", "loading port"], field: "origin" },
  { keys: ["destination", "to", "delivery", "port of discharge", "discharge port"], field: "destination" },
  { keys: ["cargo", "commodity", "goods", "shipment", "what are you shipping"], field: "cargo" },
  { keys: ["message", "details", "enquiry", "comments", "notes", "requirement"], field: "notes" },
];

const normaliseLabel = (s: string) =>
  s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** Turns an HTML body into the lines a person would see. */
function toLines(m: MailMessage): string[] {
  const raw = m.body?.content ?? m.bodyPreview ?? "";
  const text =
    m.body?.contentType === "html"
      ? raw
          // Block-level tags are line breaks; everything else goes.
          .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
      : raw;
  return text.split(/\r?\n/).map((l) => l.trim());
}

/** An address that is ours, and therefore never the customer's. */
const isOurs = (address: string) => /@aashishlogistics(global)?\.com$/i.test(address);

/**
 * Reads the form's fields out of the message.
 *
 * Handles both shapes a form can produce: the label and value on one line
 * ("Name: Kevin Sudhan") and the label on its own with the value beneath it,
 * which is what Netlify sends. A value runs until the next label or a blank
 * line, so a multi-line message survives intact.
 */
export function parseWebEnquiry(m: MailMessage): ParsedWebEnquiry {
  const out: ParsedWebEnquiry = {
    contact_name: null,
    company: null,
    email: null,
    phone: null,
    origin: null,
    destination: null,
    cargo: null,
    notes: null,
    found: [],
  };

  const lines = toLines(m);
  const fieldFor = (label: string) =>
    LABELS.find((l) => l.keys.includes(normaliseLabel(label)))?.field ?? null;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Za-z][A-Za-z ./_-]{0,28}?)\s*:\s*(.*)$/);
    if (!match) continue;

    const field = fieldFor(match[1]);
    if (!field || field === "found" || out[field]) continue;

    let value = match[2].trim();

    // Netlify puts the value on the following lines. Collect until the next
    // label or a blank line, so a message that runs to a paragraph survives.
    if (!value) {
      const parts: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line) {
          if (parts.length) break;
          continue;
        }
        const next = line.match(/^([A-Za-z][A-Za-z ./_-]{0,28}?)\s*:\s*(.*)$/);
        if (next && fieldFor(next[1])) break;
        parts.push(line);
      }
      value = parts.join("\n").trim();
    }

    if (!value) continue;

    // "From" and "To" are plausible route labels and plausible mail headers.
    // An address under either of them is the second thing, so it is discarded.
    if ((field === "origin" || field === "destination") && value.includes("@")) continue;

    out[field] = value;
    out.found.push(field);
  }

  // A form with no email label, or one the parse missed. The first address in
  // the body that is not one of ours is the best remaining answer.
  if (!out.email) {
    const candidates = lines
      .join(" ")
      .match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)
      ?.filter((a) => !isOurs(a) && !WEB_FORM_SENDERS.includes(a.toLowerCase()));
    if (candidates?.length) out.email = candidates[0];
  }

  if (out.email) out.email = out.email.toLowerCase();
  return out;
}
