/**
 * Mailboxes for the in-CRM Outlook client.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SHAPE LOOKS LIKE MICROSOFT GRAPH
 *
 * Real Outlook means Microsoft Graph: /me/mailFolders, /me/messages,
 * /me/sendMail, behind OAuth against the tenant. That needs a server -- the
 * client secret and the refresh tokens cannot live in a browser bundle -- and
 * v2 deliberately has no server.
 *
 * So the messages below carry Graph's field names and nesting exactly:
 * `from.emailAddress.address`, `toRecipients[]`, `receivedDateTime`,
 * `bodyPreview`, `body.contentType`, `isRead`, `conversationId`. Nothing here
 * is a convenient invention.
 *
 * The point is that wiring up the real thing becomes a transport change rather
 * than a rewrite: swap the four functions at the bottom of this file for Graph
 * calls and the entire UI keeps working, because it is already reading the
 * shape Graph returns. Getting this wrong -- inventing `sender`, `date`,
 * `read` -- is what turns a mail mock into a week of refactoring later.
 * ---------------------------------------------------------------------------
 */

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

export type FolderId = "inbox" | "sent" | "drafts" | "archive";

export interface Recipient {
  emailAddress: { name: string; address: string };
}

export interface MailMessage {
  id: string;
  conversationId: string;
  /** Which mailbox this sits in — Graph scopes by the signed-in user; we scope explicitly. */
  mailbox: string;
  folder: FolderId;
  subject: string;
  from: Recipient;
  toRecipients: Recipient[];
  ccRecipients: Recipient[];
  receivedDateTime: string;
  bodyPreview: string;
  body: { contentType: "text" | "html"; content: string };
  isRead: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  attachments: Array<{ name: string; size: number; contentType: string }>;
  importance: "low" | "normal" | "high";
}

const r = (name: string, address: string): Recipient => ({ emailAddress: { name, address } });

const DESK = {
  aashish: r("Aashish", "aashish@aashishlogistics.com"),
  parasu: r("Parasu", "parasu@aashishlogistics.com"),
  aarathy: r("Aarathy", "aarathy@aashishlogistics.com"),
  info: r("Info Desk", "info@aashishlogistics.com"),
  imports: r("Imports Desk", "imports@aashishlogistics.com"),
};

let seq = 0;
function msg(m: Partial<MailMessage> & Pick<MailMessage, "mailbox" | "subject" | "from" | "body">): MailMessage {
  seq += 1;
  const content = m.body.content;
  return {
    id: `msg-${seq}`,
    conversationId: m.conversationId ?? `conv-${seq}`,
    folder: "inbox",
    toRecipients: [r("", m.mailbox)],
    ccRecipients: [],
    receivedDateTime: ago(seq * 47),
    bodyPreview: content.replace(/\s+/g, " ").trim().slice(0, 140),
    isRead: false,
    isDraft: false,
    hasAttachments: false,
    attachments: [],
    importance: "normal",
    ...m,
  } as MailMessage;
}

/**
 * Each desk sees a different mailbox, which is the point of scoping by login:
 * imports@ lives in arrival notices and customs, aarathy@ in documentation,
 * parasu@ in carrier operations. If every account showed the same inbox the
 * per-user sign-in would be decoration.
 */
const messages: MailMessage[] = [
  // ---------------------------------------------------------------- info@
  msg({
    mailbox: "info@aashishlogistics.com",
    subject: "Enquiry — 96 cartons Chennai to Jebel Ali",
    from: r("Meera Raghavan", "meera@kavithatextiles.in"),
    importance: "high",
    body: {
      contentType: "text",
      content:
        "Dear Sir/Madam,\n\nFollowing my call with Priya yesterday, please confirm the booking for 96 cartons of cotton bed linen from Chennai to Jebel Ali against reference ARX-ENQ-0001.\n\nAgreed rate ₹1,85,000 all-in. Sailing on the 1st, cut-off on the 30th as discussed.\n\nPlease send the booking confirmation and shipping instructions at your earliest.\n\nRegards,\nMeera Raghavan\nKavitha Textiles Pvt Ltd",
    },
  }),
  msg({
    mailbox: "info@aashishlogistics.com",
    subject: "Rate request — Chennai to Colombo, 70 cartons",
    from: r("Kevin", "kevin@sudhantrading.in"),
    body: {
      contentType: "text",
      content:
        "Hi,\n\nCan you quote for 70 cartons of packaged food products, Chennai to Colombo? Each carton is roughly 50x40x30 cm, 22 kg.\n\nI spoke to your agent on the phone and was quoted around ₹68,000 — please confirm in writing along with the next available sailing.\n\nThanks,\nKevin\nSudhan Trading",
    },
  }),
  msg({
    mailbox: "info@aashishlogistics.com",
    subject: "Re: Quotation for spice consignment to Jeddah",
    from: r("Suresh Babu", "suresh@meenakshispices.com"),
    body: {
      contentType: "text",
      content:
        "Sir,\n\nWe have not yet received the quotation for the ground spices consignment to Jeddah (ref ARX-ENQ-0005). Could you please expedite?\n\nWe need to confirm with our buyer by end of week.\n\nRegards,\nSuresh Babu",
    },
  }),
  msg({
    mailbox: "info@aashishlogistics.com",
    subject: "New supplier registration — Coral Exports",
    from: r("Coral Exports", "accounts@coralexports.in"),
    isRead: true,
    body: {
      contentType: "text",
      content:
        "Please find attached our company registration, GST certificate and IEC for onboarding as a shipper.\n\nWe expect regular movements Tuticorin to Colombo from next month.",
    },
    hasAttachments: true,
    attachments: [
      { name: "Coral-Exports-GST.pdf", size: 184_320, contentType: "application/pdf" },
      { name: "IEC-Certificate.pdf", size: 96_100, contentType: "application/pdf" },
    ],
  }),

  // ------------------------------------------------------------- imports@
  msg({
    mailbox: "imports@aashishlogistics.com",
    subject: "Arrival Notice — MSCU7291044 ETA 02 Sep",
    from: r("MSC Chennai", "notices@msc-agency.in"),
    importance: "high",
    body: {
      contentType: "text",
      content:
        "ARRIVAL NOTICE\n\nVessel: MSC ARIANE / Voyage 534W\nContainer: MSCU7291044\nETA Chennai: 02 September\n\nPlease arrange delivery order and settle terminal charges prior to arrival to avoid demurrage. Free period expires 5 days after discharge.\n\nMSC Agency (India) Pvt Ltd",
    },
    hasAttachments: true,
    attachments: [{ name: "Arrival-Notice-MSCU7291044.pdf", size: 142_000, contentType: "application/pdf" }],
  }),
  msg({
    mailbox: "imports@aashishlogistics.com",
    subject: "Customs query — HS code clarification MSCU5510221",
    from: r("Ravi Shankar", "r.shankar@cha-chennai.in"),
    importance: "high",
    body: {
      contentType: "text",
      content:
        "Sir,\n\nCustoms has raised a query on the HS code declared for container MSCU5510221. Declared 6302.31 but the examination officer believes it should be 6302.39 based on the material composition.\n\nPlease confirm with the shipper and revert urgently — cargo is on hold and detention will start accruing from tomorrow.\n\nRavi Shankar\nCustoms House Agent",
    },
  }),
  msg({
    mailbox: "imports@aashishlogistics.com",
    subject: "Delivery order request — TCLU2201983",
    from: r("Al Noor Trading", "logistics@alnoortrading.ae"),
    body: {
      contentType: "text",
      content:
        "Good afternoon,\n\nKindly issue the delivery order for container TCLU2201983 against our reference. Original bill of lading has been surrendered at origin.\n\nOur transporter will collect on Tuesday morning.\n\nBest regards,\nAl Noor Trading LLC",
    },
  }),
  msg({
    mailbox: "imports@aashishlogistics.com",
    subject: "Terminal handling charges — invoice for settlement",
    from: r("Chennai Container Terminal", "billing@chennaiterminal.in"),
    isRead: true,
    body: {
      contentType: "text",
      content:
        "Please find attached the THC invoice for the current month's movements. Payment due within 15 days.",
    },
    hasAttachments: true,
    attachments: [{ name: "THC-Invoice-Aug.pdf", size: 88_400, contentType: "application/pdf" }],
  }),

  // -------------------------------------------------------------- parasu@
  msg({
    mailbox: "parasu@aashishlogistics.com",
    subject: "Space confirmation — ONE Singapore service, 04 Sep sailing",
    from: r("ONE Line Bookings", "bookings@one-line.in"),
    body: {
      contentType: "text",
      content:
        "Dear Parasu,\n\nConfirming allocation of 1 x 40HC on our 04 September Singapore sailing. Cut-off for documentation is 02 September 1700 hrs.\n\nPlease submit shipping instructions and VGM before cut-off.\n\nRegards,\nONE Line Bookings",
    },
  }),
  msg({
    mailbox: "parasu@aashishlogistics.com",
    subject: "URGENT: Vessel delay — CMA CGM Colombo service",
    from: r("CMA CGM Operations", "ops@cma-cgm-chennai.in"),
    importance: "high",
    body: {
      contentType: "text",
      content:
        "Please be advised that the CMA CGM Colombo service scheduled for 31 August is delayed by approximately 9 hours due to berth congestion at Chennai.\n\nRevised ETD 31 August 2300 hrs. Cut-off timings remain unchanged.\n\nKindly inform your customers accordingly.",
    },
  }),
  msg({
    mailbox: "parasu@aashishlogistics.com",
    subject: "Empty container pickup — 40HC availability",
    from: r("Maersk Equipment", "equipment@maersk-chennai.in"),
    isRead: true,
    body: {
      contentType: "text",
      content:
        "40HC units are available for pickup at our Manali depot from tomorrow 0900. Please quote the booking reference at the gate.",
    },
  }),

  // ------------------------------------------------------------- aarathy@
  msg({
    mailbox: "aarathy@aashishlogistics.com",
    subject: "Draft B/L for approval — ARX-ENQ-0001",
    from: r("Meera Raghavan", "meera@kavithatextiles.in"),
    importance: "high",
    body: {
      contentType: "text",
      content:
        "Dear Aarathy,\n\nPlease find our comments on the draft bill of lading for ARX-ENQ-0001:\n\n1. Consignee address should read 'Warehouse 12, Jebel Ali Free Zone, Dubai' — currently shows Warehouse 21.\n2. Gross weight should be 1,728 kg not 1,278 kg.\n3. Marks and numbers to include our PO reference KT/2026/0841.\n\nEverything else is in order. Please send the corrected draft for final approval.\n\nRegards,\nMeera",
    },
  }),
  msg({
    mailbox: "aarathy@aashishlogistics.com",
    subject: "Certificate of origin — missing for MSCU7291044",
    from: r("Ravi Shankar", "r.shankar@cha-chennai.in"),
    body: {
      contentType: "text",
      content:
        "Aarathy,\n\nThe certificate of origin has not been received for MSCU7291044. Without it we cannot claim preferential duty at destination.\n\nPlease chase the shipper today — the consignment is already at the port.\n\nRavi",
    },
  }),
  msg({
    mailbox: "aarathy@aashishlogistics.com",
    subject: "Consignee details for Singapore shipment",
    from: r("Rajesh Kumar", "rajesh@rajeshexports.in"),
    body: {
      contentType: "text",
      content:
        "Hi Aarathy,\n\nApologies for the delay — here are the consignee details Arun asked for on the call:\n\nMerlion Industrial Supplies Pte Ltd\n18 Tuas Avenue 10, Singapore 639145\nUEN: 201534892K\nContact: Wei Ming, +65 6789 4432\n\nLet me know if you need anything else for the invoice.\n\nRajesh",
    },
  }),

  // ------------------------------------------------------------- aashish@
  msg({
    mailbox: "aashish@aashishlogistics.com",
    subject: "Monthly performance summary — August",
    from: r("Araxys Reporting", "reports@araxys.io"),
    body: {
      contentType: "text",
      content:
        "August summary for Aashish Logistics Global:\n\n- 117 calls handled by the voice desk\n- 38% quote-to-booking conversion\n- 6 active shipments through delivery\n- ₹1,84,000 demurrage avoided through proactive arrival notices\n\nFull breakdown available in the Analytics page.",
    },
  }),
  msg({
    mailbox: "aashish@aashishlogistics.com",
    subject: "Escalation — rate dispute with Surya Auto Components",
    from: DESK.parasu,
    importance: "high",
    body: {
      contentType: "text",
      content:
        "Aashish,\n\nSurya Auto are disputing the freight invoice on ARX-ENQ-0004. They say they were quoted ₹1,95,000 but were invoiced ₹2,05,000.\n\nThe call recording confirms ₹2,05,000 was agreed after they added two extra pieces, but they are insisting otherwise. Needs your call on whether we hold or credit the difference.\n\nParasu",
    },
  }),
  msg({
    mailbox: "aashish@aashishlogistics.com",
    subject: "Renewal notice — Vobiz hotline number",
    from: r("Vobiz Billing", "billing@vobiz.io"),
    isRead: true,
    body: {
      contentType: "text",
      content:
        "Your hotline number +91 79658 54267 renews on 17 September. No action needed if your wallet balance is sufficient.",
    },
  }),

  // A couple of already-sent items so the Sent folder is not empty on arrival.
  msg({
    mailbox: "info@aashishlogistics.com",
    folder: "sent",
    subject: "Re: Rate request — Chennai to Colombo, 70 cartons",
    from: DESK.info,
    toRecipients: [r("Kevin", "kevin@sudhantrading.in")],
    isRead: true,
    body: {
      contentType: "text",
      content:
        "Dear Kevin,\n\nThank you for your enquiry. Confirming our quotation of ₹68,000 all-in for 70 cartons Chennai to Colombo, valid for 7 days.\n\nNext available sailing is 31 August with the cut-off on 30 August. Please confirm and we will proceed with the booking.\n\nRegards,\nAashish Logistics Global",
    },
  }),
  msg({
    mailbox: "imports@aashishlogistics.com",
    folder: "sent",
    subject: "Delivery order issued — TCLU2201983",
    from: DESK.imports,
    toRecipients: [r("Al Noor Trading", "logistics@alnoortrading.ae")],
    isRead: true,
    body: {
      contentType: "text",
      content:
        "Good afternoon,\n\nDelivery order for TCLU2201983 is attached. Please present it at the terminal gate on collection.\n\nRegards,\nImports Desk",
    },
    hasAttachments: true,
    attachments: [{ name: "DO-TCLU2201983.pdf", size: 74_200, contentType: "application/pdf" }],
  }),
];

// ---------------------------------------------------------------------------
// Queries — the four operations the UI needs
// ---------------------------------------------------------------------------

export const FOLDERS: Array<{ id: FolderId; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "archive", label: "Archive" },
];

const forMailbox = (mailbox: string) => messages.filter((m) => m.mailbox === mailbox);

/**
 * Every message across every desk mailbox.
 *
 * The case file needs this: a shipment's correspondence is spread over info@,
 * imports@ and whoever else was involved, and filing by enquiry has to see all
 * of it rather than one person's inbox.
 */
export const allMessages = () => messages;

export function listFolders(mailbox: string) {
  return FOLDERS.map((f) => {
    const inFolder = forMailbox(mailbox).filter((m) => m.folder === f.id);
    return {
      id: f.id,
      label: f.label,
      total: inFolder.length,
      // Only unread in the inbox is worth badging; a Sent item being "unread" is meaningless.
      unread: f.id === "inbox" ? inFolder.filter((m) => !m.isRead).length : 0,
    };
  });
}

export function listMessages(mailbox: string, folder: FolderId, q?: string) {
  let list = forMailbox(mailbox).filter((m) => m.folder === folder);

  if (q?.trim()) {
    const needle = q.trim().toLowerCase();
    list = list.filter(
      (m) =>
        m.subject.toLowerCase().includes(needle) ||
        m.bodyPreview.toLowerCase().includes(needle) ||
        m.from.emailAddress.name.toLowerCase().includes(needle) ||
        m.from.emailAddress.address.toLowerCase().includes(needle)
    );
  }

  // Newest first, as every mail client does.
  return [...list].sort(
    (a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime)
  );
}

export function getMessage(mailbox: string, id: string) {
  return forMailbox(mailbox).find((m) => m.id === id) ?? null;
}

export function setRead(mailbox: string, id: string, isRead: boolean) {
  const m = getMessage(mailbox, id);
  if (!m) return null;
  m.isRead = isRead;
  return m;
}

export function moveMessage(mailbox: string, id: string, folder: FolderId) {
  const m = getMessage(mailbox, id);
  if (!m) return null;
  m.folder = folder;
  return m;
}

export function sendMessage(input: {
  mailbox: string;
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  content: string;
  /** Set when replying, so the sent copy threads with the original. */
  conversationId?: string;
}) {
  seq += 1;
  const sent: MailMessage = {
    id: `msg-${seq}`,
    conversationId: input.conversationId ?? `conv-${seq}`,
    mailbox: input.mailbox,
    folder: "sent",
    subject: input.subject,
    from: r(input.fromName, input.mailbox),
    toRecipients: input.to.map((a) => r("", a)),
    ccRecipients: (input.cc ?? []).map((a) => r("", a)),
    receivedDateTime: new Date().toISOString(),
    bodyPreview: input.content.replace(/\s+/g, " ").trim().slice(0, 140),
    body: { contentType: "text", content: input.content },
    isRead: true,
    isDraft: false,
    hasAttachments: false,
    attachments: [],
    importance: "normal",
  };
  messages.push(sent);
  return sent;
}
