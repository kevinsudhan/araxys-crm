import { jsPDF } from "jspdf";
import { CONTENT_W, FOOTER_Y, INK, MARGIN, MUTED, PAGE_W, RULE, TINT, WARN, docDate, drawLetterhead } from "./letterhead";
import { OUTTURN_LABEL, outturnState, outturnSummary, type OutturnConsole, type OutturnHouse } from "../outturn";

/**
 * The outturn report on the letterhead (126): the console, the box and the
 * day it was opened, then every house, manifested against landed, with what
 * was wrong with it.
 */
export function renderOutturnReportPdf(c: OutturnConsole, houses: OutturnHouse[], printedOn: Date = new Date()): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const set = (k: [number, number, number]) => doc.setTextColor(k[0], k[1], k[2]);
  const stroke = () => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.3);
  };
  const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
  const right = MARGIN + CONTENT_W;

  let y = drawLetterhead(doc, MARGIN);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  set(INK);
  doc.text("OUTTURN REPORT", PAGE_W / 2, y + 3, { align: "center" });
  y += 9;

  const facts: Array<[string, string]> = [
    ["Console", up(c.console_no)],
    ["Master B/L", up(c.mbl_number)],
    ["Vessel / voyage", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" / ")],
    ["Destuffed on", docDate(c.destuffed_on)],
    ["Port of loading", up(c.pol)],
    ["Port of discharge", up(c.pod)],
    ["Container", c.containers.map(up).join(", ")],
    ["CFS", up(c.cfs_name)],
  ];
  const fw = CONTENT_W / 4;
  facts.forEach(([k, v], i) => {
    const x = MARGIN + (i % 4) * fw;
    const yy = y + Math.floor(i / 4) * 10;
    stroke();
    doc.rect(x, yy, fw, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    set(MUTED);
    doc.text(k, x + 1.6, yy + 3.4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    set(INK);
    doc.text((doc.splitTextToSize(v || "—", fw - 3) as string[]).slice(0, 2), x + 1.6, yy + 7.3);
  });
  y += 25;

  const s = outturnSummary(houses);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  set(s.clean ? INK : WARN);
  doc.text(s.clean ? "Clean outturn: every house landed as manifested." : s.exceptions ? `${s.exceptions} exception${s.exceptions === 1 ? "" : "s"}, marked below.` : "The tally is not complete.", MARGIN, y);
  y += 5;

  const head: Array<[string, number, "left" | "right"]> = [
    ["House B/L", 30, "left"],
    ["Consignee", 46, "left"],
    ["Manifested", 24, "right"],
    ["Landed", 16, "right"],
    ["Remarks", 36, "left"],
    ["Outturn", CONTENT_W - 152, "left"],
  ];
  const row = (cells: string[], bold = false, fill = false, warn = false) => {
    const wrapped = cells.map((v, i) => (doc.splitTextToSize(v || "", head[i][1] - 3) as string[]).slice(0, 3));
    const h = Math.max(6.5, Math.max(...wrapped.map((w) => w.length)) * 3.4 + 3);
    if (y + h > FOOTER_Y - 6) {
      doc.addPage();
      y = MARGIN;
    }
    if (fill) {
      doc.setFillColor(TINT[0], TINT[1], TINT[2]);
      doc.rect(MARGIN, y, CONTENT_W, h, "F");
    }
    let x = MARGIN;
    head.forEach(([, w, align], i) => {
      stroke();
      doc.rect(x, y, w, h);
      doc.setFont("helvetica", bold || (warn && i === 5) ? "bold" : "normal");
      doc.setFontSize(7.6);
      set(warn && i === 5 ? WARN : INK);
      doc.text(wrapped[i], align === "right" ? x + w - 1.6 : x + 1.6, y + 4.3, { align });
      x += w;
    });
    y += h;
  };
  row(head.map(([h]) => h), true, true);
  for (const h of houses) {
    const st = outturnState(h);
    const bad = h.conditions.filter((x) => x !== "good");
    row(
      [h.hblNo || h.ref, up(h.consignee), h.manifestedPkgs === null ? "—" : `${h.manifestedPkgs} ${up(h.packageType)}`.trim(), h.landedPkgs === null ? "—" : String(h.landedPkgs), h.remarks, `${OUTTURN_LABEL[st].toUpperCase()}${bad.length ? ` (${bad.join(", ").toUpperCase()})` : ""}`],
      false,
      false,
      st === "short" || st === "excess" || st === "damaged"
    );
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  set(MUTED);
  doc.text(`${c.console_no ?? ""} · Outturn report · ${docDate(printedOn.toISOString())}`, MARGIN, FOOTER_Y);
  doc.text("Aashish Logistics Global Pvt Ltd", right, FOOTER_Y, { align: "right" });
  return doc;
}

export const outturnFileName = (c: Pick<OutturnConsole, "console_no">) => `Outturn-${(c.console_no || "console").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

export const outturnPdfBytes = (c: OutturnConsole, houses: OutturnHouse[]) => new Uint8Array(renderOutturnReportPdf(c, houses).output("arraybuffer") as ArrayBuffer);
