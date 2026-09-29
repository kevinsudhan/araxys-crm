import { salutationName } from "./greeting";

/**
 * A rate request to a partner for one job (107): which services each partner
 * is asked to price, and the mail each of them gets.
 *
 * ---------------------------------------------------------------------------
 * ONE MESSAGE, PERSONALISED PER PARTNER
 *
 * The desk writes (or accepts) one message about the shipment. Each partner's
 * mail is that message under their own greeting and the list of services they
 * in particular are asked for: the overseas agent the destination end, the
 * line the freight, the CHA the clearance. Every figure in it is copied off
 * the enquiry (services/rfq.ts `draftRequest`); nothing here invents one.
 *
 * THE SUBJECT CARRIES THE REFERENCE
 *
 * "[ALG09009-26]" in the subject is what files the partner's reply against
 * the job in Mail, and "Rate request" is what files it as one in Team
 * oversight (lib/mailLog.ts). A subject edited without the reference gets it
 * back at sending (`withReference`).
 * ---------------------------------------------------------------------------
 */

export type Mode = "sea_lcl" | "sea_fcl" | "air" | "road" | "other" | null;
export type Role = "overseas_agent" | "consol_partner" | "carrier" | "cha_customs" | "cfs_transport" | "other";

/** What a rate request needs to know about the job. */
export interface RequestJob {
  ref: string;
  origin: string | null;
  destination: string | null;
  cargo: string | null;
  transport_mode: Mode;
  trade_direction?: "export" | "import" | "cross_trade" | null;
  pickup_location?: string | null;
  delivery_location?: string | null;
}

/** The leg that carries the cargo, in the job's own mode. */
export function mainCarriage(mode: Mode): string {
  if (mode === "sea_lcl" || mode === "sea_fcl") return "Ocean freight";
  if (mode === "air") return "Air freight";
  if (mode === "road") return "Road freight";
  return "Freight";
}

export const MODE_WORD: Record<Exclude<Mode, null>, string> = {
  sea_lcl: "Sea LCL",
  sea_fcl: "Sea FCL",
  air: "Air",
  road: "Road",
  other: "",
};

/**
 * The services a partner can be asked to price on this job, door to door.
 * A service not listed is typed in on the spot.
 */
export function serviceCatalogue(job: Pick<RequestJob, "transport_mode">): string[] {
  return [
    "Pickup and trucking",
    "Export customs clearance",
    "Origin charges",
    mainCarriage(job.transport_mode),
    "Destination charges",
    "Import customs clearance",
    "Delivery to consignee",
    "Warehousing",
    "Cargo insurance",
  ];
}

/**
 * What a partner of this kind is usually asked for — a starting point, ticked
 * off or added to on screen. An overseas agent quotes the far end of the job:
 * destination on an export, origin on an import.
 */
export function defaultServices(role: Role | null | undefined, job: Pick<RequestJob, "transport_mode" | "trade_direction">): string[] {
  const freight = mainCarriage(job.transport_mode);
  const importing = job.trade_direction === "import";
  switch (role) {
    case "overseas_agent":
      return importing ? ["Origin charges", freight] : ["Destination charges", "Import customs clearance", "Delivery to consignee"];
    case "consol_partner":
      return [freight, "Origin charges"];
    case "carrier":
      return [freight];
    case "cha_customs":
      return [importing ? "Import customs clearance" : "Export customs clearance"];
    case "cfs_transport":
      return [importing ? "Delivery to consignee" : "Pickup and trucking"];
    default:
      return [];
  }
}

/** Where a service applies on this job, when the enquiry says: "Chennai to Hamburg", "at Hamburg". */
export function serviceContext(service: string, job: RequestJob): string | null {
  const o = job.origin?.trim() || null;
  const d = job.destination?.trim() || null;
  switch (service) {
    case "Ocean freight":
    case "Air freight":
    case "Road freight":
    case "Freight":
      return o && d ? `${o} to ${d}` : null;
    // The addresses themselves are in the shipment details below the list.
    case "Pickup and trucking":
      return job.pickup_location?.trim() ? (o ? `pick-up address to ${o}` : "from the pick-up address") : o ? `at ${o}` : null;
    case "Export customs clearance":
    case "Origin charges":
      return o ? `at ${o}` : null;
    case "Destination charges":
    case "Import customs clearance":
      return d ? `at ${d}` : null;
    case "Delivery to consignee":
      return job.delivery_location?.trim() ? (d ? `${d} to the delivery address` : "to the delivery address") : d ? `at ${d}` : null;
    default:
      return null;
  }
}

/** Services as they will be sent: trimmed, blanks and repeats (in any case) dropped, order kept. */
export function cleanServices(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

export const subjectTokenFor = (ref: string) => `[${ref.toUpperCase()}]`;

/** "Rate request · Chennai → Hamburg · Sea LCL · Textile machinery [ALG09009-26]" */
export function requestSubject(job: RequestJob): string {
  const lane = [job.origin, job.destination].map((s) => s?.trim()).filter(Boolean).join(" → ");
  const mode = job.transport_mode ? MODE_WORD[job.transport_mode] : "";
  const cargo = job.cargo?.trim() ? (job.cargo.trim().length > 60 ? `${job.cargo.trim().slice(0, 57)}…` : job.cargo.trim()) : "";
  return ["Rate request", lane, mode, cargo].filter(Boolean).join(" · ") + ` ${subjectTokenFor(job.ref)}`;
}

/** The subject with the job's reference in it, whatever was done to it on screen. */
export function withReference(subject: string, ref: string): string {
  const s = subject.replace(/\s+/g, " ").trim();
  const token = subjectTokenFor(ref);
  if (s.toUpperCase().includes(token)) return s;
  return `${s || "Rate request"} ${token}`;
}

/** "Dear Omar," — the contact's first name, else their company's team, never blank. */
export function greetingName(p: { name: string | null; organisation: string | null }): string {
  const org = (p.organisation ?? "").trim();
  return salutationName(p.name) ?? (org ? `${org} team` : "Sir / Madam");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A greeting the message may open with, which the partner's own greeting replaces. */
const LEADING_GREETING = /^\s*(?:<div>\s*)?<p[^>]*>\s*(?:dear|hi|hello|greetings)\b[^<]{0,80}<\/p>\s*(?:<\/div>)?/i;

/**
 * One partner's mail: their greeting, the services they are asked to price
 * (with where each applies), then the desk's message about the shipment.
 */
export function personalise(
  message: string,
  partner: { name: string | null; organisation: string | null },
  services: string[],
  job: RequestJob
): string {
  const items = cleanServices(services)
    .map((s) => {
      const where = serviceContext(s, job);
      return `<li><strong>${esc(s)}</strong>${where ? ` — ${esc(where)}` : ""}</li>`;
    })
    .join("");
  return (
    `<p>Dear ${esc(greetingName(partner))},</p>` +
    `<p>Please share your best rates for:</p>` +
    `<ul>${items}</ul>` +
    message.replace(LEADING_GREETING, "")
  );
}
