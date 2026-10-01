import { supabase } from "../lib/supabase";

/**
 * The quotation as a customer sees it, without an account.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER CALLS TWO FUNCTIONS AND TOUCHES NO TABLE
 *
 * A customer is `anon` here. Rather than giving `anon` a row policy on quotes —
 * which is a thing somebody widens later without remembering why it was narrow —
 * the two calls below are security-definer functions that return a fixed shape.
 * The cost column is not in that shape, so it cannot leak however the caller
 * asks.
 *
 * WHY READING AND ACCEPTING ARE SEPARATE
 *
 * Because corporate mail is scanned. Outlook Safe Links, Proofpoint and every
 * antivirus gateway fetch the URLs in a message before the recipient sees it.
 * If following the link accepted the quotation, a machine would accept it
 * minutes after sending. So the link only reads; accepting takes a press.
 * ---------------------------------------------------------------------------
 */

export type QuoteLinkState =
  | "open"
  | "accepted"
  | "expired"
  | "revoked"
  | "declined"
  | "unknown";

/** The shipper as the customer gave it on the page, after accepting (114). */
export interface ShipperGiven {
  name: string;
  address: string;
  contact: string | null;
  email: string | null;
}

export interface PublicQuote {
  state: QuoteLinkState;
  accepted_at: string | null;
  accepted_name: string | null;
  /** Their latest "revise this quote" (114). */
  revision_requested_at?: string | null;
  revision_note?: string | null;
  shipper?: ShipperGiven | null;
  reference: string;
  version: number;
  issued_on: string;
  valid_until: string | null;
  amount_inr: number;
  terms: Array<{ scope: string; text: string }>;
  customer: string | null;
  origin: string | null;
  destination: string | null;
  cargo: string | null;
  ready_date: string | null;
  lines: Array<{
    description: string;
    unit: string;
    quantity: number;
    rate: number;
    currency: string;
    amount_inr: number;
  }>;
}

export async function quoteByToken(token: string): Promise<PublicQuote> {
  const { data, error } = await supabase.rpc("quote_by_token", { p_token: token });
  if (error) throw new Error(error.message);
  return data as PublicQuote;
}

/**
 * Say yes.
 *
 * Returns what happened rather than throwing on a refusal: "this link has
 * expired" is something to show a customer plainly, not an error to dress up.
 */
export async function acceptByToken(
  token: string,
  name: string,
  note: string
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("accept_quote_by_token", {
    p_token: token,
    p_name: name || null,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; reason: string };
}

/**
 * "Revise this quote" (114): what they want changed. Also on a quotation that
 * has expired — asking for a fresh one is the same request.
 */
export async function requestRevisionByToken(token: string, note: string, name: string): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("request_revision_by_token", {
    p_token: token,
    p_note: note,
    p_name: name || null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; reason: string };
}

/** The shipper, after the booking is confirmed (114). */
export async function shipperByToken(token: string, s: ShipperGiven): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("shipper_by_token", {
    p_token: token,
    p_name: s.name,
    p_address: s.address,
    p_contact: s.contact || null,
    p_email: s.email || null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; reason: string };
}

/** Mint (or re-read) the link for a quotation. Approved quotations only. */
export async function issueLink(quoteId: string): Promise<{ token: string; expires_at: string }> {
  const { data, error } = await supabase.rpc("issue_quote_link", { p_quote_id: quoteId });
  if (error) throw new Error(error.message);
  return data as { token: string; expires_at: string };
}

/**
 * Where the customer lands.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS CONFIGURED AND NOT TAKEN FROM THE BROWSER
 *
 * It used to be `window.location.origin`, which is correct exactly when the
 * person sending the quotation is on the production site. Sent from a laptop
 * running the dev server, it builds `http://localhost:5174/q/...` — and that
 * URL, opened on the customer's phone, means THEIR machine. They get a
 * connection error and the desk hears nothing, because a mail that fails on
 * the recipient's device fails silently here.
 *
 * `VITE_PUBLIC_APP_URL` is the address the customer can reach. The browser
 * origin stays as the fallback, which is right for a deployed build and
 * obviously wrong for a local one — hence `isReachable` below, so the panel can
 * say so before the mail goes rather than after.
 * ---------------------------------------------------------------------------
 */
export function acceptUrl(token: string): string {
  const base = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, "");
  return `${base}/q/${encodeURIComponent(token)}`;
}

/**
 * Whether a link built here can be opened by somebody else.
 *
 * Loopback and private addresses resolve on the sender's own network and
 * nowhere else. This is the difference between a quotation that can be accepted
 * and one that produces an error page on the customer's phone.
 */
export function isReachable(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (host.endsWith(".local")) return false;
    // RFC1918: 10/8, 172.16–31/12, 192.168/16.
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** What the customer did, as the link recorded it. */
export interface AcceptanceEvidence {
  accepted_at: string;
  /** What they typed as their name. Optional on the page, so often null. */
  accepted_name: string | null;
  /** Anything they added — "please proceed", "can we bring it forward". */
  accepted_note: string | null;
  /** The shipper they gave after accepting (114), and when. */
  shipper: ShipperGiven | null;
  shipper_at: string | null;
}

export interface RevisionRequest {
  quote_id: string;
  version: number;
  at: string;
  note: string;
  name: string | null;
}

/**
 * The customer's latest "revise this quote" on this enquiry (114), while no
 * quotation has been sent since it — once a new version has gone, it is
 * answered.
 */
export async function openRevisionRequest(ref: string): Promise<RevisionRequest | null> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, version, sent_at, quote_links(revision_requested_at, revision_note, revision_name)")
    .eq("enquiry_ref", ref.toUpperCase());
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    version: number;
    sent_at: string | null;
    quote_links: Array<{ revision_requested_at: string | null; revision_note: string | null; revision_name: string | null }>;
  }>;
  let best: RevisionRequest | null = null;
  for (const q of rows)
    for (const l of q.quote_links ?? [])
      if (l.revision_requested_at && l.revision_note && (!best || l.revision_requested_at > best.at))
        best = { quote_id: q.id, version: q.version, at: l.revision_requested_at, note: l.revision_note, name: l.revision_name };
  if (!best) return null;
  const answered = rows.some((q) => q.sent_at && q.sent_at > best!.at);
  return answered ? null : best;
}

/**
 * How a quotation came to be accepted, where it was accepted from the link.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS READ SEPARATELY FROM THE QUOTE
 *
 * The quote carries that it was accepted and roughly how. The link carries the
 * evidence: the moment the button was pressed, the name the person typed, and
 * anything they said while doing it.
 *
 * That distinction matters exactly once, and badly — when a customer says they
 * never agreed. "Accepted" on a row is an assertion by this system; a
 * timestamp against a token that was only ever in their mailbox is something
 * to show them.
 *
 * Returns null for a quotation accepted any other way, which is not a failure:
 * the desk recording an acceptance off a reply is an ordinary path and has its
 * own evidence in the mail.
 * ---------------------------------------------------------------------------
 */
export async function acceptanceEvidence(quoteId: string): Promise<AcceptanceEvidence | null> {
  const { data, error } = await supabase
    .from("quote_links")
    .select("accepted_at, accepted_name, accepted_note, shipper, shipper_at")
    .eq("quote_id", quoteId)
    .not("accepted_at", "is", null)
    .order("accepted_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as AcceptanceEvidence) ?? null;
}
