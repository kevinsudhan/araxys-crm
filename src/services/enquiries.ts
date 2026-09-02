import { supabase } from "../lib/supabase";
import { refFromSubject, type PartyRole } from "./caseFile";
import { getMailMessages, mailIsLive, type MailMessage } from "./backend";

/**
 * Enquiries, against v2's own Supabase project.
 *
 * ---------------------------------------------------------------------------
 * REAL DATA, NOT FIXTURES
 *
 * Nothing in here is seeded. An enquiry exists because somebody created one
 * from a real email or entered one by hand, and every screen shows an empty
 * state until that happens. Sample rows would make the pipeline look busy and
 * teach nobody anything about whether it works.
 *
 * This is v2's project, not v1's. The production CRM and the live voice agents
 * are untouched by anything done here.
 * ---------------------------------------------------------------------------
 */

export type EnquiryStatus =
  | "new"
  | "qualifying"
  | "quoted"
  | "accepted"
  | "declined"
  | "lost";

export type EnquirySource = "email" | "call" | "whatsapp" | "web" | "manual";

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  qualifying: "Qualifying",
  quoted: "Quoted",
  accepted: "Accepted",
  declined: "Declined",
  lost: "Lost",
};

/** The inbound pipeline, in the order an enquiry moves through it. */
export const INBOUND_STATUSES: EnquiryStatus[] = ["new", "qualifying", "quoted", "accepted"];

export interface Customer {
  id: string;
  name: string;
  company: string;
  phones: string[];
  emails: string[];
}

export interface Enquiry {
  ref: string;
  customer_id: string;
  seq: number;
  status: EnquiryStatus;
  source: EnquirySource;

  origin: string | null;
  destination: string | null;
  cargo: string | null;
  cargo_type: string | null;
  incoterm: string | null;
  ready_date: string | null;
  pickup_location: string | null;

  piece_count: number | null;
  piece_length_cm: number | null;
  piece_width_cm: number | null;
  piece_height_cm: number | null;
  weight_per_piece_kg: number | null;
  gross_weight_kg: number | null;
  volume_cbm: number | null;
  stackable: boolean | null;
  upright_only: boolean | null;
  special_handling: string | null;

  consignee_name: string | null;
  consignee_country: string | null;

  notes: string | null;
  opened_at: string;
  updated_at: string;
}

export interface Party {
  id: string;
  enquiry_ref: string;
  role: PartyRole;
  name: string;
  organisation: string;
  emails: string[];
}

export interface Quote {
  id: string;
  enquiry_ref: string;
  version: number;
  amount_inr: number;
  basis: string;
  valid_until: string | null;
  sailing_date: string | null;
  status: "draft" | "sent" | "accepted" | "declined" | "expired" | "superseded";
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface EnquiryEvent {
  id: string;
  enquiry_ref: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
  at: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listEnquiries(): Promise<Array<Enquiry & { customer: Customer | null }>> {
  const { data, error } = await supabase
    .from("enquiries")
    .select("*, customer:customers(*)")
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Array<Enquiry & { customer: Customer | null }>;
}

export async function getEnquiry(
  ref: string
): Promise<(Enquiry & { customer: Customer | null }) | null> {
  const { data, error } = await supabase
    .from("enquiries")
    .select("*, customer:customers(*)")
    .eq("ref", ref.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as (Enquiry & { customer: Customer | null }) | null) ?? null;
}

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from("customers").select("*").order("company");
  if (error) throw error;
  return (data ?? []) as Customer[];
}

export async function partiesFor(ref: string): Promise<Party[]> {
  const { data, error } = await supabase
    .from("enquiry_parties")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase());
  if (error) throw error;
  return (data ?? []) as Party[];
}

export async function quotesFor(ref: string): Promise<Quote[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase())
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Quote[];
}

export async function eventsFor(ref: string): Promise<EnquiryEvent[]> {
  const { data, error } = await supabase
    .from("enquiry_events")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase())
    .order("at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EnquiryEvent[];
}

export async function threadsFor(ref: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("enquiry_threads")
    .select("conversation_id")
    .eq("enquiry_ref", ref.toUpperCase());
  if (error) throw error;
  return (data ?? []).map((r) => r.conversation_id as string);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Finds an existing customer by address, or creates one. Server-side, to avoid a race. */
export async function findOrCreateCustomer(input: {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
}): Promise<Customer> {
  const { data, error } = await supabase.rpc("create_customer", {
    p_name: input.name,
    p_company: input.company ?? "",
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
  });
  if (error) throw error;
  return data as Customer;
}

/**
 * Opens an enquiry.
 *
 * The reference is allocated inside the database rather than here: two
 * operators taking an enquiry from the same customer at the same moment would
 * otherwise both read the same maximum and both try to write E03.
 */
export async function createEnquiry(input: {
  customerId: string;
  source: EnquirySource;
  origin?: string;
  destination?: string;
  cargo?: string;
}): Promise<Enquiry> {
  const { data, error } = await supabase.rpc("create_enquiry", {
    p_customer_id: input.customerId,
    p_source: input.source,
    p_origin: input.origin ?? null,
    p_destination: input.destination ?? null,
    p_cargo: input.cargo ?? null,
  });
  if (error) throw error;
  return data as Enquiry;
}

export async function updateEnquiry(
  ref: string,
  patch: Partial<Enquiry>,
  summary?: string
): Promise<Enquiry> {
  const { data, error } = await supabase
    .from("enquiries")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("ref", ref.toUpperCase())
    .select()
    .single();
  if (error) throw error;

  if (summary) await logEvent(ref, "field_updated", summary, patch as Record<string, unknown>);
  return data as Enquiry;
}

export async function addParty(p: {
  enquiryRef: string;
  role: PartyRole;
  name: string;
  organisation?: string;
  emails: string[];
}): Promise<Party> {
  const { data, error } = await supabase
    .from("enquiry_parties")
    .insert({
      enquiry_ref: p.enquiryRef.toUpperCase(),
      role: p.role,
      name: p.name,
      organisation: p.organisation ?? "",
      emails: p.emails,
    })
    .select()
    .single();
  if (error) throw error;
  await logEvent(p.enquiryRef, "party_added", `${p.name} added as ${p.role.replace("_", " ")}`);
  return data as Party;
}

/** Binds a mail thread, so the rest of the conversation files itself. */
export async function bindThread(ref: string, conversationId: string, messageId?: string) {
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase.from("enquiry_threads").upsert(
    {
      conversation_id: conversationId,
      enquiry_ref: ref.toUpperCase(),
      bound_by: user.user?.id ?? null,
    },
    { onConflict: "conversation_id" }
  );
  if (error) throw error;

  if (messageId) {
    await supabase
      .from("enquiry_messages")
      .upsert(
        { message_id: messageId, enquiry_ref: ref.toUpperCase(), via: "manual" },
        { onConflict: "message_id,enquiry_ref" }
      );
  }
  await logEvent(ref, "mail_linked", "Mail thread linked to this enquiry");
}

export async function logEvent(
  ref: string,
  kind: string,
  summary: string,
  detail: Record<string, unknown> = {}
) {
  const { data: user } = await supabase.auth.getUser();
  await supabase.from("enquiry_events").insert({
    enquiry_ref: ref.toUpperCase(),
    kind,
    summary,
    detail,
    actor: user.user?.id ?? null,
  });
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

/**
 * Records a quote, superseding whatever was outstanding.
 *
 * Previous versions are kept rather than overwritten: when a customer says
 * "you told me a different number last week", the earlier figure is the answer,
 * and an overwritten row cannot give it.
 */
export async function addQuote(input: {
  ref: string;
  amountInr: number;
  basis: string;
  validUntil?: string;
  sailingDate?: string;
}): Promise<Quote> {
  const ref = input.ref.toUpperCase();
  const existing = await quotesFor(ref);

  await supabase
    .from("quotes")
    .update({ status: "superseded" })
    .eq("enquiry_ref", ref)
    .in("status", ["draft", "sent"]);

  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("quotes")
    .insert({
      enquiry_ref: ref,
      version: (existing[0]?.version ?? 0) + 1,
      amount_inr: input.amountInr,
      basis: input.basis,
      valid_until: input.validUntil ?? null,
      sailing_date: input.sailingDate ?? null,
      status: "draft",
      created_by: user.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Quote;
}

export async function markQuoteSent(quoteId: string, ref: string, amount: number) {
  const { error } = await supabase
    .from("quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) throw error;

  await updateEnquiry(ref, { status: "quoted" });
  await logEvent(ref, "quote_sent", `Quoted ₹${amount.toLocaleString("en-IN")}`);
}

/**
 * The customer said yes.
 *
 * This is the end of the inbound half: the enquiry becomes a commitment, and
 * everything downstream -- booking, allocation, documents -- starts from here.
 * Recorded as an explicit act rather than inferred from a mail, because a
 * booking is a thing somebody at the desk should have to affirm.
 */
export async function acceptQuote(quoteId: string, ref: string, amount: number) {
  const { error } = await supabase
    .from("quotes")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) throw error;

  await updateEnquiry(ref, { status: "accepted" });
  await logEvent(ref, "accepted", `Customer accepted ₹${amount.toLocaleString("en-IN")}`);
}

export async function declineQuote(quoteId: string, ref: string, reason: string) {
  await supabase
    .from("quotes")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", quoteId);
  await updateEnquiry(ref, { status: "declined" });
  await logEvent(ref, "declined", reason || "Customer declined the quote");
}

// ---------------------------------------------------------------------------
// Mail filing
// ---------------------------------------------------------------------------

export interface FiledMessage {
  message: MailMessage;
  role: PartyRole;
  via: "thread" | "subject" | "reference-in-body" | "manual";
  confidence: "certain" | "likely";
}

/**
 * The correspondence on an enquiry, gathered from the signed-in user's mailbox.
 *
 * A caveat worth stating: this reads the mailbox of whoever is signed in, so
 * an enquiry's mail is only as complete as that person's access. Gathering
 * every desk mailbox needs application permissions and a server to hold them,
 * which v2 does not have. Today's answer is honest rather than complete.
 */
export async function correspondenceFor(
  ref: string,
  mailbox: string
): Promise<FiledMessage[]> {
  if (!mailIsLive() || !mailbox) return [];

  const [threads, parties, pinned] = await Promise.all([
    threadsFor(ref),
    partiesFor(ref),
    supabase.from("enquiry_messages").select("message_id, via").eq("enquiry_ref", ref.toUpperCase()),
  ]);

  const pinnedIds = new Map(
    (pinned.data ?? []).map((r) => [r.message_id as string, r.via as FiledMessage["via"]])
  );

  const folders = ["inbox", "sent", "archive"] as const;
  const seen = new Map<string, MailMessage>();
  for (const folder of folders) {
    try {
      const { messages } = await getMailMessages(mailbox, folder);
      for (const m of messages) seen.set(m.id, m);
    } catch {
      // A folder that will not load should not empty the whole case file.
    }
  }

  const out: FiledMessage[] = [];
  for (const m of seen.values()) {
    let via: FiledMessage["via"] | null = null;

    if (pinnedIds.has(m.id)) via = pinnedIds.get(m.id)!;
    else if (threads.includes(m.conversationId)) via = "thread";
    else if (refFromSubject(m.subject)?.toUpperCase() === ref.toUpperCase()) via = "subject";
    if (!via) continue;

    // The counterparty is whichever end is not us.
    const counterparty =
      m.folder === "sent"
        ? m.toRecipients[0]?.emailAddress.address ?? ""
        : m.from.emailAddress.address;
    const role =
      parties.find((p) =>
        p.emails.some((e) => e.toLowerCase() === counterparty.toLowerCase())
      )?.role ?? "other";

    out.push({ message: m, role, via, confidence: via === "reference-in-body" ? "likely" : "certain" });
  }

  return out.sort(
    (a, b) => Date.parse(b.message.receivedDateTime) - Date.parse(a.message.receivedDateTime)
  );
}

/** Inbox mail not yet filed against any enquiry — the triage queue. */
export async function unfiledMail(mailbox: string): Promise<MailMessage[]> {
  if (!mailIsLive() || !mailbox) return [];

  const [{ data: threadRows }, { data: msgRows }, { messages }] = await Promise.all([
    supabase.from("enquiry_threads").select("conversation_id"),
    supabase.from("enquiry_messages").select("message_id"),
    getMailMessages(mailbox, "inbox"),
  ]);

  const bound = new Set((threadRows ?? []).map((r) => r.conversation_id as string));
  const pinned = new Set((msgRows ?? []).map((r) => r.message_id as string));

  return messages.filter(
    (m) => !bound.has(m.conversationId) && !pinned.has(m.id) && !refFromSubject(m.subject)
  );
}

/** Volume from dimensions, so it is never a number somebody typed twice. */
export function computeVolumeCbm(e: Partial<Enquiry>): number | null {
  const { piece_length_cm: l, piece_width_cm: w, piece_height_cm: h, piece_count: n } = e;
  if (!l || !w || !h || !n) return null;
  return Number(((l * w * h * n) / 1_000_000).toFixed(2));
}

/** Gross weight from per-piece weight, same reasoning. */
export function computeGrossKg(e: Partial<Enquiry>): number | null {
  const { weight_per_piece_kg: kg, piece_count: n } = e;
  if (!kg || !n) return null;
  return Number((kg * n).toFixed(2));
}

/**
 * What is still missing before this enquiry can be quoted.
 *
 * Space cannot be checked in three dimensions without dimensions, and a rate
 * without a route is a guess -- so these are the fields a quote genuinely
 * depends on, not a wish list.
 */
export function missingForQuote(e: Enquiry): string[] {
  const need: Array<[keyof Enquiry, string]> = [
    ["origin", "Origin"],
    ["destination", "Destination"],
    ["cargo", "Cargo description"],
    ["piece_count", "Number of packages"],
    ["piece_length_cm", "Piece length"],
    ["piece_width_cm", "Piece width"],
    ["piece_height_cm", "Piece height"],
    ["weight_per_piece_kg", "Weight per piece"],
  ];
  return need.filter(([k]) => e[k] === null || e[k] === undefined || e[k] === "").map(([, l]) => l);
}
