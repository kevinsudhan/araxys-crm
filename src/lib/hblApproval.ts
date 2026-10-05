import { ACCENT, INK, LINE, MUTED, NAVY, caption, esc, letter, message, section, signOff } from "./brandedMail";
import { normaliseHbl, type HblData, type ReleaseMode } from "./hbl";
import { sendSignature, sentLine } from "./quotationMail";

/**
 * The shipper's approval of our house B/L draft (123).
 *
 * ---------------------------------------------------------------------------
 * AN APPROVAL IS OF THE DRAFT AS SENT
 *
 * The page shows the shipper the draft as it was mailed, and their "approve"
 * is kept against that copy. A B/L changed afterwards — a seal corrected, a
 * consignee's address added — is no longer the one they approved, so it is
 * shown as changed since and wants sending again. Issuing without an approval
 * is the desk's call, asked on screen with the reason in words.
 * ---------------------------------------------------------------------------
 */

export type HblApproval = "none" | "sent" | "approved" | "changes";

export interface DraftSnapshot {
  data: unknown;
  hbl_no: string | null;
  release_mode: ReleaseMode;
  originals: number;
  amendment?: number;
}

export interface ApprovalRow {
  hbl_no: string | null;
  release_mode: ReleaseMode;
  originals: number;
  data: HblData;
  approval: HblApproval;
  draft_sent: DraftSnapshot | null;
  draft_sent_at: string | null;
  draft_sent_to: string;
  approval_at: string | null;
  approval_by: string;
  approval_note: string;
}

/** JSON with every object's keys in order, so two copies of one B/L compare equal however they were stored. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Whether the B/L as it stands is the one the shipper was sent. */
export function changedSinceSent(r: Pick<ApprovalRow, "hbl_no" | "release_mode" | "originals" | "data" | "draft_sent">): boolean {
  const s = r.draft_sent;
  if (!s) return false;
  const now = { data: normaliseHbl(r.data), hbl_no: r.hbl_no, release_mode: r.release_mode, originals: r.originals };
  const then = { data: normaliseHbl(s.data as Partial<HblData>), hbl_no: s.hbl_no, release_mode: s.release_mode, originals: s.originals };
  return stableJson(now) !== stableJson(then);
}

/**
 * Where the approval stands, in words for the desk: one line, and how it
 * should look. "Changed since" outranks what the shipper said, because what
 * they said was about a different B/L.
 */
export function approvalLine(r: ApprovalRow): { tone: "muted" | "waiting" | "good" | "warn"; text: string } {
  const changed = changedSinceSent(r);
  if (r.approval === "none") return { tone: "muted", text: "Not sent to the shipper for approval" };
  if (changed) return { tone: "warn", text: "Changed since it was sent to the shipper: send the draft again" };
  if (r.approval === "approved") return { tone: "good", text: `Approved${r.approval_by ? ` by ${r.approval_by}` : " by the shipper"}` };
  if (r.approval === "changes") return { tone: "warn", text: "The shipper asks for corrections" };
  return { tone: "waiting", text: `Sent to the shipper${r.draft_sent_to ? ` (${r.draft_sent_to})` : ""}: waiting for their approval` };
}

/** What to ask before issuing, or null when the shipper approved this very draft. */
export function issueWarning(r: ApprovalRow): string | null {
  if (r.approval === "approved" && !changedSinceSent(r)) return null;
  if (r.approval === "none") return "The shipper has not been sent this draft to approve";
  if (changedSinceSent(r)) return "The B/L has changed since the shipper was sent it";
  if (r.approval === "changes") return `The shipper asked for corrections: "${r.approval_note.slice(0, 200)}"`;
  return "The shipper has not approved the draft yet";
}

// ---------------------------------------------------------------------------
// The mail to the shipper
// ---------------------------------------------------------------------------

export function hblDraftSubject(i: { hblNo: string | null; ref: string; amendment: number }): string {
  return [`[${i.ref}] DRAFT HOUSE B/L ${i.hblNo ?? ""}`.trim(), i.amendment ? `AMENDMENT ${i.amendment}` : null, "FOR YOUR APPROVAL"].filter(Boolean).join(" — ");
}

/**
 * The draft to the shipper: what it says in brief, the PDF attached, and the
 * two buttons — approve, or say what to correct — which open the page that
 * records it. Following a link records nothing: mail scanners open every link.
 */
export function hblDraftHtml(i: {
  hblNo: string | null;
  data: HblData;
  url: string | null;
  amendment: number;
  fromName?: string;
  logoSrc?: string | null;
  sentAt?: Date;
}): string {
  const d = i.data;
  const at = i.sentAt ?? new Date();
  const sig = sendSignature(at);
  const no = i.hblNo ?? "";
  const facts: Array<[string, string]> = [
    ["Shipper", d.shipper_name],
    ["Consignee", d.consignee_mode === "to_order" ? `TO ORDER${d.consignee_name ? ` OF ${d.consignee_name}` : ""}` : d.consignee_name],
    ["Notify party", d.notify_name],
    ["Vessel / voyage", [d.vessel, d.voyage].filter(Boolean).join(" / ")],
    ["From / to", [d.port_of_loading, d.place_of_delivery || d.port_of_discharge].filter(Boolean).join(" → ")],
    ["Containers", d.containers.map((c) => [c.container_no, c.seal_no && `seal ${c.seal_no}`].filter(Boolean).join(" ")).filter(Boolean).join(", ")],
    ["Packages", [d.packages, d.package_type].filter(Boolean).join(" ")],
    ["Description", d.description],
    ["Gross weight", d.gross_weight_kg ? `${d.gross_weight_kg} KGS` : ""],
    ["Measurement", d.measurement_cbm ? `${d.measurement_cbm} CBM` : ""],
    ["Freight", [d.freight_terms.toUpperCase(), d.freight_payable_at && `payable at ${d.freight_payable_at}`].filter(Boolean).join(", ")],
  ];
  const factsHtml = section(
    `${caption("The draft in brief", NAVY)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px;">
      ${facts
        .filter(([, v]) => v && v.trim())
        .map(
          ([k, v]) => `<tr>
        <td valign="top" style="padding:7px 10px 7px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:12px;width:120px;">${k}</td>
        <td valign="top" style="padding:7px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:13px;line-height:1.45;word-break:break-word;">${esc(v)}</td>
      </tr>`
        )
        .join("")}
    </table>`,
    20
  );
  const withParam = (url: string, param: string) => `${url}${url.includes("?") ? "&" : "?"}${param}`;
  const buttons = i.url
    ? section(
        `<table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td bgcolor="${ACCENT}" style="background:${ACCENT};border:1px solid ${ACCENT};border-radius:6px;">
              <a href="${esc(withParam(i.url, "approve=1"))}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:.02em;">Approve the draft &rarr;${sig}</a>
            </td>
            <td style="width:10px;font-size:0;line-height:0;">&nbsp;</td>
            <td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${ACCENT};border-radius:6px;">
              <a href="${esc(withParam(i.url, "correct=1"))}" style="display:inline-block;padding:12px 22px;color:${ACCENT};font-size:14px;font-weight:700;text-decoration:none;letter-spacing:.02em;">Ask for a correction${sig}</a>
            </td>
          </tr>
          <tr>
            <td colspan="3" style="padding:8px 0 0;">
              <p style="margin:0;font-size:11.5px;color:${MUTED};line-height:1.5;">Sent ${esc(sentLine(at))}. The originals are issued once you approve. Replying to this email works just as well.</p>
            </td>
          </tr>
        </table>`,
        24
      )
    : "";
  return letter({
    logoSrc: i.logoSrc,
    stamp: `Draft house B/L ${no} · sent ${sentLine(at)}`,
    title: i.amendment ? "DRAFT B/L — AMENDED" : "DRAFT HOUSE B/L",
    meta: [
      ["B/L no", esc(no)],
      ...(i.amendment ? ([["Amendment", String(i.amendment)]] as Array<[string, string]>) : []),
      ["Vessel", esc([d.vessel, d.voyage].filter(Boolean).join(" ") || "—")],
    ],
    sections: [
      message(
        i.amendment
          ? `Please find attached the corrected draft of our house bill of lading ${no}. Kindly check it against your documents and approve it, or tell us what to correct, before we issue the new originals.`
          : `Please find attached the draft of our house bill of lading ${no} for your shipment. Kindly check every detail against your invoice, packing list and letter of credit, then approve it or tell us what to correct, before we issue the originals.`
      ),
      factsHtml,
      buttons,
      signOff(i.fromName, undefined),
    ],
  });
}
