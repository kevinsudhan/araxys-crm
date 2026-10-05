import { jsPDF } from "jspdf";
import { BRAND, CONTENT_W, FOOTER_Y, INK, MARGIN, MUTED, PAGE_W, RULE, TINT, docDate, drawLetterhead } from "./letterhead";
import type { StuffedBox, StuffingConsole } from "../stuffingReport";

/**
 * The stuffing report on the letterhead (125): the console and the sailing,
 * then each box with its seal and every house in it — packages, weight,
 * measure, and the tally of received against declared with the condition.
 */
export function renderStuffingReportPdf(c: StuffingConsole, boxes: StuffedBox[], stuffedOn: string | null, printedOn: Date = new Date()): jsPDF {
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
  doc.text("STUFFING REPORT", PAGE_W / 2, y + 3, { align: "center" });
  y += 9;

  const facts: Array<[string, string]> = [
    ["Console", up(c.console_no)],
    ["Carrier", up(c.carrier)],
    ["Vessel / voyage", [up(c.vessel), up(c.voyage)].filter(Boolean).join(" / ")],
    ["Master B/L", up(c.mbl_number)],
    ["Port of loading", up(c.pol)],
    ["Port of discharge", up(c.pod)],
    ["ETD", docDate(c.etd)],
    ["Stuffed on", docDate(stuffedOn)],
  ];
  const cols = 4;
  const fw = CONTENT_W / cols;
  facts.forEach(([k, v], i) => {
    const x = MARGIN + (i % cols) * fw;
    const yy = y + Math.floor(i / cols) * 10;
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
  y += Math.ceil(facts.length / cols) * 10 + 3;
  if (c.cfs_name.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    set(MUTED);
    doc.text(`Stuffed at ${up(c.cfs_name)}`, MARGIN, y + 3);
    y += 6;
  }

  const head: Array<[string, number, "left" | "right"]> = [
    ["House B/L", 28, "left"],
    ["Shipper", 36, "left"],
    ["Marks", 20, "left"],
    ["Packages", 20, "right"],
    ["Kg", 16, "right"],
    ["CBM", 13, "right"],
    ["Received", 20, "right"],
    ["Condition", CONTENT_W - 153, "left"],
  ];
  const row = (cells: string[], bold = false, fillRow = false) => {
    const wrapped = cells.map((v, i) => (doc.splitTextToSize(v || "", head[i][1] - 3) as string[]).slice(0, 2));
    const h = Math.max(6.5, Math.max(...wrapped.map((w) => w.length)) * 3.4 + 3);
    if (y + h > FOOTER_Y - 6) {
      doc.addPage();
      y = MARGIN;
    }
    let x = MARGIN;
    if (fillRow) {
      doc.setFillColor(TINT[0], TINT[1], TINT[2]);
      doc.rect(MARGIN, y, CONTENT_W, h, "F");
    }
    head.forEach(([, w, align], i) => {
      stroke();
      doc.rect(x, y, w, h);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(7.4);
      set(INK);
      doc.text(wrapped[i], align === "right" ? x + w - 1.6 : x + 1.6, y + 4.3, { align });
      x += w;
    });
    y += h;
  };

  for (const b of boxes) {
    if (y + 24 > FOOTER_Y - 6) {
      doc.addPage();
      y = MARGIN;
    }
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    set(BRAND);
    doc.text(b.containerNo ? `${b.containerNo} ${b.sizeType}${b.sealNo ? `  ·  SEAL ${b.sealNo}` : "  ·  NO SEAL"}` : "NOT IN A BOX YET", MARGIN, y);
    y += 2.5;
    row(head.map(([h]) => h), true, true);
    for (const h of b.houses) {
      const received = h.receivedPkgs === null ? "—" : h.declaredPkgs !== null && h.receivedPkgs !== h.declaredPkgs ? `${h.receivedPkgs} / ${h.declaredPkgs}` : String(h.receivedPkgs);
      row([h.hblNo || h.ref, up(h.shipper), up(h.marks), `${h.packages} ${up(h.packageType)}`.trim(), h.kg ? h.kg.toLocaleString("en-IN") : "", h.cbm ? String(h.cbm) : "", received, up(h.condition)]);
    }
    row(["TOTAL", "", "", String(b.packages), b.kg.toLocaleString("en-IN"), String(b.cbm), "", ""], true, true);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  set(MUTED);
  doc.text("Received: packages counted at the CFS, against the packages declared where they differ.", MARGIN, Math.min(y + 6, FOOTER_Y - 6));
  doc.setFontSize(6.8);
  doc.text(`${c.console_no ?? ""} · Stuffing report · ${docDate(printedOn.toISOString())}`, MARGIN, FOOTER_Y);
  doc.text("Aashish Logistics Global Pvt Ltd", right, FOOTER_Y, { align: "right" });
  return doc;
}

export const stuffingReportFileName = (c: Pick<StuffingConsole, "console_no">) => `Stuffing-Report-${(c.console_no || "console").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

export const stuffingReportPdfBytes = (c: StuffingConsole, boxes: StuffedBox[], stuffedOn: string | null) =>
  new Uint8Array(renderStuffingReportPdf(c, boxes, stuffedOn).output("arraybuffer") as ArrayBuffer);
