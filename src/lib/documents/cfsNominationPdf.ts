import { jsPDF } from "jspdf";
import { BRAND, CONTENT_W, FOOTER_Y, INK, MARGIN, MUTED, RULE, TINT, docDate, drawLetterhead } from "./letterhead";
import type { ConsoleBox } from "../masterBill";
import type { ImportConsole } from "../importMaster";

/**
 * The letter nominating a CFS to the line for an import console's box (120):
 * on the letterhead, to the line, the master B/L, the vessel, the IGM, every
 * box with its seal, the CFS, and the ask: move the box there on discharge
 * and issue the delivery order in its favour. Signed for the company as the
 * master's consignee.
 */
export function renderCfsNominationPdf(c: ImportConsole, boxes: ConsoleBox[], cfs: string, ourName: string, printedOn: Date = new Date()): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const set = (k: [number, number, number]) => doc.setTextColor(k[0], k[1], k[2]);
  const stroke = () => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.3);
  };
  const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
  const right = MARGIN + CONTENT_W;
  const plural = boxes.length === 1 ? "" : "S";

  let y = drawLetterhead(doc, MARGIN);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  set(INK);
  doc.text(`Date: ${docDate(printedOn.toISOString())}`, right, y, { align: "right" });
  doc.text(["To,", `${up(c.carrier) || "THE SHIPPING LINE"}`, "Import Documentation"], MARGIN, y);
  y += 17;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Sub: Nomination of CFS for import container${plural.toLowerCase()} under master B/L ${up(c.mbl_number) || "—"}`, MARGIN, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const opening = doc.splitTextToSize(
    `Dear Sir / Madam, we, ${ourName}, consignee of the master B/L below, hereby nominate ${up(cfs) || "—"} for the movement and destuffing of the following container${plural.toLowerCase()}.`,
    CONTENT_W
  ) as string[];
  doc.text(opening, MARGIN, y);
  y += opening.length * 4.4 + 4;

  // ---- the bill and the voyage ----
  const facts: Array<[string, string]> = [
    ["Master B/L no", up(c.mbl_number)],
    ["MBL date", docDate(c.mbl_date)],
    ["Vessel / voyage", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" / ")],
    ["ETA", docDate(c.eta)],
    ["IGM no", up(c.igm_no)],
    ["IGM date", docDate(c.igm_date)],
    ["Port of loading", up(c.pol)],
    ["Port of discharge", up(c.pod)],
  ];
  const cols = 4;
  const fw = CONTENT_W / cols;
  const fh = 10;
  facts.forEach(([k, v], i) => {
    const x = MARGIN + (i % cols) * fw;
    const yy = y + Math.floor(i / cols) * fh;
    stroke();
    doc.rect(x, yy, fw, fh);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    set(MUTED);
    doc.text(k, x + 1.6, yy + 3.4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    set(INK);
    doc.text((doc.splitTextToSize(v || "—", fw - 3) as string[]).slice(0, 2), x + 1.6, yy + 7.3);
  });
  y += Math.ceil(facts.length / cols) * fh + 5;

  // ---- the nominated CFS ----
  stroke();
  doc.setFillColor(TINT[0], TINT[1], TINT[2]);
  doc.rect(MARGIN, y, CONTENT_W, 11, "F");
  doc.rect(MARGIN, y, CONTENT_W, 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  set(BRAND);
  doc.text("NOMINATED CFS", MARGIN + 2, y + 4.4);
  doc.setFontSize(10);
  set(INK);
  doc.text(up(cfs) || "—", MARGIN + 2, y + 9);
  y += 16;

  // ---- the boxes ----
  const head: Array<[string, number]> = [
    ["#", 10],
    ["Container", 60],
    ["Size / type", 40],
    ["Seal", CONTENT_W - 110],
  ];
  const row = (cells: string[], bold = false, fillRow = false) => {
    let x = MARGIN;
    if (fillRow) {
      doc.setFillColor(TINT[0], TINT[1], TINT[2]);
      doc.rect(MARGIN, y, CONTENT_W, 7, "F");
    }
    head.forEach(([, w], i) => {
      stroke();
      doc.rect(x, y, w, 7);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(8);
      set(INK);
      doc.text(cells[i] ?? "", x + 1.8, y + 4.8);
      x += w;
    });
    y += 7;
  };
  row(head.map(([h]) => h), true, true);
  if (!boxes.length) row(["", "No container numbers yet", "", ""]);
  boxes.forEach((b, i) => row([String(i + 1), b.container_no, b.size_type || "—", b.seal_no || "—"]));
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const ask = doc.splitTextToSize(
    `Kindly arrange to move the above container${plural.toLowerCase()} to the nominated CFS on discharge and issue the delivery order in its favour. All charges at the CFS are to our account.`,
    CONTENT_W
  ) as string[];
  doc.text(ask, MARGIN, y);
  y += ask.length * 4.4 + 12;

  doc.text("Thanking you,", MARGIN, y);
  doc.setFont("helvetica", "bold");
  doc.text(`For ${ourName}`, MARGIN, y + 6);
  doc.setFont("helvetica", "normal");
  doc.text("Authorised Signatory", MARGIN, y + 24);

  doc.setFontSize(6.8);
  set(MUTED);
  doc.text(`${c.console_no ?? ""} · CFS nomination`, MARGIN, FOOTER_Y);
  doc.text(ourName, right, FOOTER_Y, { align: "right" });
  return doc;
}

export const cfsNominationFileName = (c: Pick<ImportConsole, "console_no" | "mbl_number">) =>
  `CFS-Nomination-${(c.mbl_number || c.console_no || "console").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

export const cfsNominationPdfBytes = (c: ImportConsole, boxes: ConsoleBox[], cfs: string, ourName: string) =>
  new Uint8Array(renderCfsNominationPdf(c, boxes, cfs, ourName).output("arraybuffer") as ArrayBuffer);
