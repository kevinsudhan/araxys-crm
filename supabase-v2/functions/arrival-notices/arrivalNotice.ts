/**
 * The arrival notice for one house on an import console (126): to its
 * consignee, that the cargo is on its way in, and what they need to take
 * delivery.
 *
 * ---------------------------------------------------------------------------
 * ONE COPY, TWO SENDERS
 *
 * The desk sends it from its own Outlook, one house at a time; the scheduler
 * (supabase-v2/functions/arrival-notices) sends it on its own, a set number
 * of days before the ETA, for a console it has been switched on for. Both
 * write the same mail, so this file is copied into the function verbatim and
 * a test keeps the two identical. That is also why it imports nothing: the
 * company comes in as an argument.
 * ---------------------------------------------------------------------------
 */

export interface ArrivalHouse {
  ref: string;
  hblNo: string;
  mblNo: string;
  consignee: string;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  /** YYYY-MM-DD */
  eta: string | null;
  igmNo: string;
  igmDate: string | null;
  /** "PCIU1234567 40HC" */
  containers: string[];
  packages: string;
  grossKg: string;
  cbm: string;
  description: string;
  /** Where it is destuffed and delivered from. */
  cfs: string;
  /** How their B/L is released: an original to surrender, a telex release, or a sea waybill. */
  release: "original" | "telex" | "express" | null;
  freightCollect: boolean;
}

export interface ArrivalCompany {
  legalName: string;
  address: string[];
  phone: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dayOf = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const istToday = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Whether the scheduler should send it now: within `days` of the ETA, and not
 * more than a week after it — a notice for cargo that came in a fortnight ago
 * tells the consignee nothing and makes the desk look asleep.
 */
export function arrivalDue(eta: string | null, days: number, now: Date = new Date()): boolean {
  if (!eta) return false;
  const until = daysBetween(istToday(now), eta.slice(0, 10));
  return until <= days && until >= -7;
}

export function arrivalSubject(h: ArrivalHouse): string {
  return [`[${h.ref}] ARRIVAL NOTICE`, h.hblNo && `HBL ${up(h.hblNo)}`, [up(h.vessel), up(h.voyage)].filter(Boolean).join(" ") || null, h.eta ? `ETA ${up(dayOf(h.eta))}` : null]
    .filter(Boolean)
    .join(" — ");
}

/** What the consignee needs to take delivery, for the way their B/L is released. */
export function deliveryNeeds(h: Pick<ArrivalHouse, "release" | "freightCollect">): string[] {
  return [
    h.release === "telex"
      ? "The B/L is released by telex: no original is needed; we confirm the release once it is with us"
      : h.release === "express"
        ? "A sea waybill: no original is needed, delivery is to you as named consignee"
        : "One original house B/L, duly endorsed, surrendered to us",
    h.freightCollect ? "Payment of the freight (collect) and our delivery order charges" : "Payment of our delivery order charges",
    "Your KYC documents and an authorisation letter for your customs broker (CHA)",
    "Your CHA files the Bill of Entry once the IGM is filed",
  ];
}

export function arrivalHtml(h: ArrivalHouse, company: ArrivalCompany, fromName?: string): string {
  const cell = "padding:5px 10px 5px 0;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:13px";
  const facts: Array<[string, string]> = [
    ["Our reference", up(h.ref)],
    ["House B/L", up(h.hblNo)],
    ["Master B/L", up(h.mblNo)],
    ["Vessel / voyage", [up(h.vessel), up(h.voyage)].filter(Boolean).join(" / ")],
    ["Port of loading", up(h.pol)],
    ["Port of discharge", up(h.pod)],
    ["ETA", dayOf(h.eta)],
    ["IGM", [up(h.igmNo), h.igmDate ? `dated ${dayOf(h.igmDate)}` : ""].filter(Boolean).join(" ")],
    ["Container", h.containers.map(up).join(", ")],
    ["Packages", up(h.packages)],
    ["Gross weight", h.grossKg ? `${h.grossKg} KGS` : ""],
    ["Measurement", h.cbm ? `${h.cbm} CBM` : ""],
    ["Description", up(h.description)],
    ["Delivery from", up(h.cfs)],
  ];
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px">` +
    `<p style="font-size:14px">Dear ${esc(h.consignee.trim() || "Sir / Madam")},</p>` +
    `<p style="font-size:14px;line-height:1.6">We are pleased to advise the arrival of your cargo${h.eta ? `, expected at ${esc(up(h.pod) || "the port")} on <strong>${esc(dayOf(h.eta))}</strong>` : ""}. The particulars are below.</p>` +
    `<table style="border-collapse:collapse;margin:8px 0 14px">` +
    facts.filter(([, v]) => v).map(([k, v]) => `<tr><td style="${cell};color:#64748b;width:150px">${k}</td><td style="${cell}">${esc(v)}</td></tr>`).join("") +
    `</table>` +
    `<p style="font-size:14px;margin:0 0 4px"><strong>To take delivery</strong></p>` +
    `<ul style="margin:0 0 14px;padding-left:20px;font-size:13.5px;line-height:1.6">${deliveryNeeds(h).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` +
    `<p style="font-size:13.5px;line-height:1.6">Free time at the CFS runs from destuffing; storage beyond it is at the CFS's tariff. Please arrange clearance promptly, and reply to this mail with any questions.</p>` +
    `<p style="font-size:13.5px;line-height:1.6;margin-top:18px">Warm regards,<br>${fromName ? `<strong>${esc(fromName)}</strong><br>` : ""}Import desk, ${esc(company.legalName)}<br>` +
    `<span style="color:#64748b;font-size:12px">${company.address.map(esc).join(", ")} · Tel ${esc(company.phone)}</span></p>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// The notice from the records, the same way for the desk and the scheduler
// ---------------------------------------------------------------------------

type Num = number | string | null | undefined;

export interface ArrivalRows {
  job: {
    enquiry_ref: string;
    consignee_name: string | null;
    piece_count?: Num;
    package_count?: Num;
    package_type?: string | null;
    gross_weight_kg?: Num;
    volume_cbm?: Num;
    forwarders_bl_no?: string | null;
    bl_number?: string | null;
  };
  /** The house B/L as the origin agent issued it (088), when saved. */
  received: {
    hbl_no: string | null;
    release_mode: string | null;
    data: { description?: string; packages?: string; package_type?: string; freight_terms?: string; consignee_name?: string } | null;
  } | null;
  boxes: Array<{ container_no: string | null; size_type: string | null }>;
  console: { mbl_number: string | null; vessel: string; voyage: string; pol: string; pod: string; eta: string | null; igm_no: string | null; igm_date: string | null; cfs_name: string | null };
}

const figure = (v: Num) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));

export function arrivalHouseFrom(r: ArrivalRows): ArrivalHouse {
  const d = r.received?.data ?? {};
  const release = r.received?.release_mode;
  const seen = new Set<string>();
  const containers: string[] = [];
  for (const b of r.boxes) {
    const no = up(b.container_no).replace(/[^A-Z0-9]/g, "");
    if (!no || seen.has(no)) continue;
    seen.add(no);
    containers.push([no, up(b.size_type)].filter(Boolean).join(" "));
  }
  const pieces = figure(r.job.piece_count ?? r.job.package_count);
  return {
    ref: r.job.enquiry_ref,
    hblNo: (r.received?.hbl_no || r.job.forwarders_bl_no || r.job.bl_number || "").trim(),
    mblNo: (r.console.mbl_number ?? "").trim(),
    consignee: (r.job.consignee_name || d.consignee_name || "").trim(),
    vessel: r.console.vessel,
    voyage: r.console.voyage,
    pol: r.console.pol,
    pod: r.console.pod,
    eta: r.console.eta,
    igmNo: r.console.igm_no ?? "",
    igmDate: r.console.igm_date,
    containers,
    packages: d.packages ? `${d.packages} ${d.package_type ?? ""}`.trim() : pieces ? `${pieces} ${r.job.package_type ?? ""}`.trim() : "",
    grossKg: figure(r.job.gross_weight_kg),
    cbm: figure(r.job.volume_cbm),
    description: d.description ?? "",
    cfs: r.console.cfs_name ?? "",
    release: release === "original" || release === "telex" || release === "express" ? release : null,
    freightCollect: /collect/i.test(d.freight_terms ?? ""),
  };
}

/** Where the notice goes: the job's consignee, else the customer's own address. */
export function consigneeEmail(job: { consignee_email?: string | null }, customer: { emails?: string[] | null; billing_email?: string | null } | null): string {
  return (job.consignee_email || customer?.emails?.[0] || customer?.billing_email || "").trim();
}
