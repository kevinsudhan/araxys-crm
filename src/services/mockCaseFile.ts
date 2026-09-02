import {
  fileMessage,
  roleOf,
  type Customer,
  type Enquiry,
  type EnquiryThread,
  type Party,
  type PartyRole,
} from "./caseFile";
import { allMessages, type MailMessage } from "./mockMail";

/**
 * Case-file data for the v2 workspace.
 *
 * Deliberately built on top of the mail and call fixtures that already exist
 * rather than beside them: the correspondents here are the same people who
 * appear in the mailboxes, so the case file joins real threads to real
 * enquiries instead of demonstrating itself against a parallel set of data
 * that happens to line up.
 */

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const customers: Customer[] = [
  {
    id: "C0042",
    name: "Meera Raghavan",
    company: "Kavitha Textiles",
    phones: ["+919840112233"],
    emails: ["meera@kavithatextiles.in"],
  },
  {
    id: "C0043",
    name: "Rajesh Kumar",
    company: "Rajesh Exports",
    phones: ["+919176554321"],
    emails: ["rajesh@rajeshexports.in"],
  },
  {
    id: "C0044",
    name: "Kevin",
    company: "Sudhan Trading",
    phones: ["+918939153390"],
    emails: ["kevin@sudhantrading.in"],
  },
  {
    id: "C0045",
    name: "Suresh Babu",
    company: "Meenakshi Spices",
    phones: ["+919094887766"],
    emails: ["suresh@meenakshispices.com"],
  },
];

// ---------------------------------------------------------------------------
// Enquiries
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const day = (d: number) => iso(d).slice(0, 10);

const enquiries: Enquiry[] = [
  {
    ref: "ARX-C0042-E01",
    customerId: "C0042",
    recordRef: "ARX-ENQ-0001",
    subject: "96 cartons cotton bed linen — Chennai to Jebel Ali",
    origin: "Chennai",
    destination: "Jebel Ali",
    cargo: "Cotton bed linen sets",
    volumeCbm: 8.06,
    containerCode: "40HC",
    containerNumber: "MSCU7291044",
    blNumber: "MSCU7845120",
    sailingDate: day(4),
    stage: "booked",
    openedAt: iso(-9),
  },
  {
    ref: "ARX-C0043-E01",
    customerId: "C0043",
    recordRef: "ARX-ENQ-0002",
    subject: "Machined steel fittings — Chennai to Singapore",
    origin: "Chennai",
    destination: "Singapore",
    cargo: "Machined steel fittings",
    volumeCbm: 10.56,
    containerCode: "40HC",
    sailingDate: day(7),
    stage: "booked",
    openedAt: iso(-6),
  },
  {
    ref: "ARX-C0044-E01",
    customerId: "C0044",
    recordRef: "ARX-ENQ-0003",
    subject: "70 cartons packaged food — Chennai to Colombo",
    origin: "Chennai",
    destination: "Colombo",
    cargo: "Packaged food products",
    volumeCbm: 4.2,
    stage: "quoted",
    openedAt: iso(-1),
  },
  {
    ref: "ARX-C0045-E01",
    customerId: "C0045",
    recordRef: "ARX-ENQ-0005",
    subject: "Ground spices — Chennai to Jeddah",
    origin: "Chennai",
    destination: "Jeddah",
    cargo: "Ground spices in sacks",
    stage: "enquiry",
    openedAt: iso(-1),
  },
];

// ---------------------------------------------------------------------------
// Parties
//
// Roles are recorded, never inferred. notices@msc-agency.in is a carrier
// because it is written here, not because the address contains "msc".
// ---------------------------------------------------------------------------

const parties: Party[] = [
  // ARX-C0042-E01 — the fully populated one, showing every role at once.
  P("ARX-C0042-E01", "client", "Meera Raghavan", "Kavitha Textiles", ["meera@kavithatextiles.in"]),
  P("ARX-C0042-E01", "client", "Al Noor Trading", "Consignee, Jebel Ali", ["logistics@alnoortrading.ae"]),
  P("ARX-C0042-E01", "carrier", "MSC Chennai", "Mediterranean Shipping Co.", ["notices@msc-agency.in"]),
  P("ARX-C0042-E01", "cha_customs", "Ravi Shankar", "Customs House Agent", ["r.shankar@cha-chennai.in"]),
  P("ARX-C0042-E01", "cfs_transport", "Chennai Container Terminal", "CFS", ["billing@chennaiterminal.in"]),
  P("ARX-C0042-E01", "consol_partner", "Gulf Consol LLC", "Destination agent, Dubai", ["ops@gulfconsol.ae"]),

  // ARX-C0043-E01
  P("ARX-C0043-E01", "client", "Rajesh Kumar", "Rajesh Exports", ["rajesh@rajeshexports.in"]),
  P("ARX-C0043-E01", "carrier", "ONE Line Bookings", "Ocean Network Express", ["bookings@one-line.in"]),

  // ARX-C0044-E01
  P("ARX-C0044-E01", "client", "Kevin", "Sudhan Trading", ["kevin@sudhantrading.in"]),
  P("ARX-C0044-E01", "carrier", "CMA CGM Operations", "CMA CGM", ["ops@cma-cgm-chennai.in"]),

  // ARX-C0045-E01
  P("ARX-C0045-E01", "client", "Suresh Babu", "Meenakshi Spices", ["suresh@meenakshispices.com"]),
];

function P(
  enquiryRef: string,
  role: PartyRole,
  name: string,
  organisation: string,
  emails: string[]
): Party {
  return { enquiryRef, role, name, organisation, emails };
}

// ---------------------------------------------------------------------------
// Threads
//
// Seeded by conversationId so the fixtures file themselves the way real mail
// would, rather than each message carrying a hardcoded enquiry reference.
// ---------------------------------------------------------------------------

const threads: EnquiryThread[] = [];

/**
 * Binds every thread that has a known party at one end.
 *
 * Which end depends on direction: on a received message the counterparty is
 * the sender, on one we sent it is the recipient. Matching only on sender put
 * our own replies into triage, because the sender there is the desk mailbox --
 * so a customer's mail filed correctly while the answer to it did not.
 */
function seedThreads() {
  if (threads.length) return;
  for (const m of allMessages()) {
    const counterparties =
      m.folder === "sent"
        ? m.toRecipients.map((t) => t.emailAddress.address)
        : [m.from.emailAddress.address];

    const match = parties.find((p) =>
      p.emails.some((e) => counterparties.some((c) => c.toLowerCase() === e.toLowerCase()))
    );
    if (!match) continue;
    if (!threads.some((t) => t.conversationId === m.conversationId)) {
      threads.push({ enquiryRef: match.enquiryRef, conversationId: m.conversationId });
    }
  }
}

// Manual links, for messages a signal could not reach.
const manualLinks = new Map<string, string>();

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface CaseCall {
  callId: string;
  enquiryRef: string;
  agent: string;
  fromNumber: string;
  durationSecs: number;
  language: string;
  startedAt: string;
  summary: string;
}

const calls: CaseCall[] = [
  {
    callId: "12970",
    enquiryRef: "ARX-C0042-E01",
    agent: "Priya",
    fromNumber: "+919840112233",
    durationSecs: 214,
    language: "Tamil / English",
    startedAt: iso(-1),
    summary:
      "Booked 96 cartons of cotton bed linen, Chennai to Jebel Ali. Negotiated ₹195,000 to ₹185,000 and accepted. Handed to documentation.",
  },
  {
    callId: "12968",
    enquiryRef: "ARX-C0044-E01",
    agent: "Priya",
    fromNumber: "+918939153390",
    durationSecs: 138,
    language: "Tamil",
    startedAt: iso(-1),
    summary:
      "Enquired about 70 cartons of packaged food, Chennai to Colombo. Quoted ₹68,000. No sailing date agreed — callback needed.",
  },
  {
    callId: "12965",
    enquiryRef: "ARX-C0043-E01",
    agent: "Arun",
    fromNumber: "+919176554321",
    durationSecs: 96,
    language: "English",
    startedAt: iso(-2),
    summary:
      "Collected shipper legal name. Consignee details still outstanding; customer to call back.",
  },
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listCustomers = () => customers;
export const listEnquiries = () => enquiries;

export const getEnquiry = (ref: string) =>
  enquiries.find((e) => e.ref.toUpperCase() === ref.toUpperCase()) ?? null;

export const getCustomer = (id: string) => customers.find((c) => c.id === id) ?? null;

export const partiesFor = (ref: string) =>
  parties.filter((p) => p.enquiryRef.toUpperCase() === ref.toUpperCase());

export const callsFor = (ref: string) =>
  calls
    .filter((c) => c.enquiryRef.toUpperCase() === ref.toUpperCase())
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

export interface FiledMessage {
  message: MailMessage;
  role: PartyRole;
  /** How it was filed, surfaced so an inferred link never looks like a stated one. */
  via: "thread" | "subject" | "reference-in-body" | "manual";
  confidence: "certain" | "likely";
}

/** Every message filed against an enquiry, newest first, with its party role. */
export function correspondenceFor(ref: string): FiledMessage[] {
  seedThreads();
  const enquiryParties = partiesFor(ref);
  const out: FiledMessage[] = [];

  for (const m of allMessages()) {
    const manual = manualLinks.get(m.id);
    const signal = manual
      ? { ref: manual, via: "manual" as const, confidence: "certain" as const }
      : fileMessage(
          { subject: m.subject, conversationId: m.conversationId, body: m.body.content },
          threads,
          enquiries
        );

    if (!signal || signal.ref.toUpperCase() !== ref.toUpperCase()) continue;

    /**
     * Role comes from whichever end of the message is not us.
     *
     * On a sent message the counterparty is the recipient, not the sender --
     * filing our own reply under the sender's role would put every outbound
     * message in whatever bucket the desk mailbox happened to occupy.
     */
    const counterparty =
      m.folder === "sent"
        ? m.toRecipients[0]?.emailAddress.address ?? ""
        : m.from.emailAddress.address;

    out.push({
      message: m,
      role: roleOf(counterparty, enquiryParties) ?? "other",
      via: signal.via,
      confidence: signal.confidence,
    });
  }

  return out.sort(
    (a, b) => Date.parse(b.message.receivedDateTime) - Date.parse(a.message.receivedDateTime)
  );
}

/** Messages a signal could not place — triage rather than a guess. */
export function unfiledMessages(): MailMessage[] {
  seedThreads();
  return allMessages()
    .filter((m) => {
      if (manualLinks.has(m.id)) return false;
      return !fileMessage(
        { subject: m.subject, conversationId: m.conversationId, body: m.body.content },
        threads,
        enquiries
      );
    })
    .sort((a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime));
}

/** Binds a message to an enquiry by hand, and remembers its thread for next time. */
export function linkMessage(messageId: string, ref: string) {
  const message = allMessages().find((m) => m.id === messageId);
  if (!message) return null;
  manualLinks.set(messageId, ref.toUpperCase());

  // Bind the thread too, so the rest of this conversation files itself.
  if (!threads.some((t) => t.conversationId === message.conversationId)) {
    threads.push({ enquiryRef: ref.toUpperCase(), conversationId: message.conversationId });
  }
  return getEnquiry(ref);
}

/** Adds a correspondent to an enquiry, which is how the directory fills up. */
export function addParty(p: Party) {
  parties.push(p);
  return p;
}

export type TimelineEntry =
  | { kind: "mail"; at: string; filed: FiledMessage }
  | { kind: "call"; at: string; call: CaseCall };

/**
 * Everything that happened on this shipment, merged and newest first.
 *
 * The default view, because grouping by party is how you find a message and
 * chronology is how you understand what happened: a customs query at 11am and
 * the broker's reply at 2pm belong next to each other, not in separate buckets.
 */
export function timelineFor(ref: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...correspondenceFor(ref).map((filed) => ({
      kind: "mail" as const,
      at: filed.message.receivedDateTime,
      filed,
    })),
    ...callsFor(ref).map((call) => ({ kind: "call" as const, at: call.startedAt, call })),
  ];
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Free-text search across references, customers, routes, containers and BLs. */
export function searchEnquiries(q: string): Enquiry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return enquiries;
  return enquiries.filter((e) => {
    const c = getCustomer(e.customerId);
    return [
      e.ref,
      e.subject,
      e.origin,
      e.destination,
      e.cargo,
      e.containerNumber,
      e.blNumber,
      c?.name,
      c?.company,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });
}
