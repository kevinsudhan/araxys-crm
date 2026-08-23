import { jsPDF } from "jspdf";
import type { DocSpec, DocumentData } from "./types";
import { readiness } from "./data";

/**
 * Draws any document in the registry.
 *
 * Written once, deliberately. The rules that matter are the ones about honesty, and they
 * only hold if there is a single place enforcing them:
 *
 *   - A field nobody established prints TBD, in grey, and is never inferred.
 *   - A document missing anything it requires is stamped DRAFT and lists what is
 *     outstanding, by name, on the document itself.
 *   - Nothing is presented as signed or issued by an authority that has not signed it.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 22;
const TBD = "TBD";

const today = () => new Date().toISOString().slice(0, 10);

export function renderDocument(spec: DocSpec, data: DocumentData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { ready, missingLabels } = readiness(data, spec.requires);
  let y = MARGIN;

  /** Starts a new page when the next block would run into the footer. */
  const ensure = (needed: number) => {
    if (y + needed < FOOTER_Y - 6) return;
    drawFooter(doc, data, spec);
    doc.addPage();
    y = MARGIN;
  };

  // ---------------------------------------------------------------- letterhead
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(15, 110, 86);
  doc.text("ARAXYS LOGISTICS", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Freight forwarding & customs documentation", MARGIN, y + 5);
  doc.setTextColor(0, 0, 0);
  y += 14;
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // -------------------------------------------------------------------- title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(spec.title, MARGIN, y, { maxWidth: CONTENT_W - 40 });
  if (!ready) {
    doc.setFontSize(10);
    doc.setTextColor(180, 80, 40);
    doc.text("DRAFT - INCOMPLETE", PAGE_W - MARGIN, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(`Document no: ARX-${spec.numberPrefix}-${data.documentNumber}`, MARGIN, y);
  doc.text(`Date issued: ${today()}`, PAGE_W - MARGIN, y, { align: "right" });
  y += 5;
  doc.text(`Reference: ${data.reference}`, MARGIN, y);
  doc.text(ready ? "Status: complete" : "Status: awaiting details", PAGE_W - MARGIN, y, {
    align: "right",
  });
  y += 10;

  // ------------------------------------------------------------------ parties
  if (spec.parties) {
    const colW = CONTENT_W / 2 - 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Shipper / Exporter", MARGIN, y);
    doc.text("Consignee / Importer", MARGIN + colW + 8, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);

    let yl = y + 5;
    for (const line of [data.shipperName ?? TBD, `GSTIN/IEC: ${data.shipperGstinIec ?? TBD}`]) {
      doc.text(line, MARGIN, yl, { maxWidth: colW });
      yl += 5;
    }

    let yr = y + 5;
    for (const line of [
      data.consigneeName ?? TBD,
      data.consigneeAddress ?? TBD,
      data.consigneeCountry ?? TBD,
    ]) {
      doc.text(line, MARGIN + colW + 8, yr, { maxWidth: colW });
      yr += 5;
    }

    y = Math.max(yl, yr) + 6;
    doc.setDrawColor(230, 230, 230);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 8;
  }

  // ----------------------------------------------------------------- sections
  const labelW = 48;
  for (const section of spec.sections) {
    // A section whose every row is empty is dropped rather than printed as a wall of
    // TBD — the outstanding list below already says what is missing, and repeating it
    // as ten blank rows buries the rows that do carry information.
    const rendered = section.rows.map((r) => [r.label, r.value(data)] as const);
    if (rendered.every(([, v]) => v === undefined)) continue;

    ensure(12 + rendered.length * 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(section.title, MARGIN, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    for (const [label, value] of rendered) {
      doc.setTextColor(100, 100, 100);
      doc.text(label, MARGIN, y);
      if (value === undefined) doc.setTextColor(150, 150, 150);
      else doc.setTextColor(0, 0, 0);
      doc.text(value ?? TBD, MARGIN + labelW, y, { maxWidth: CONTENT_W - labelW });
      doc.setTextColor(0, 0, 0);
      y += 6;
    }

    y += 4;
    doc.setDrawColor(230, 230, 230);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 8;
  }

  // ------------------------------------------------------------- outstanding
  if (missingLabels.length) {
    ensure(18);
    doc.setTextColor(160, 60, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `Still required before this document can be issued (${missingLabels.length}):`,
      MARGIN,
      y,
    );
    y += 5;
    doc.setFont("helvetica", "italic");
    doc.text(missingLabels.join(", "), MARGIN, y, { maxWidth: CONTENT_W });
    y += 5 + Math.ceil(missingLabels.join(", ").length / 110) * 4;
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
  }

  // ------------------------------------------------------------- declaration
  if (spec.declaration) {
    ensure(20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    doc.text(spec.declaration, MARGIN, y, { maxWidth: CONTENT_W });
    doc.setTextColor(0, 0, 0);
    y += 6 + Math.ceil(spec.declaration.length / 105) * 4;
  }

  drawFooter(doc, data, spec);
  return doc;
}

function drawFooter(doc: jsPDF, data: DocumentData, spec: DocSpec) {
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`System-generated by Araxys Logistics. ${data.sourceNote}`, MARGIN, FOOTER_Y + 5, {
    maxWidth: CONTENT_W,
  });
  doc.text(
    `Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
    MARGIN,
    FOOTER_Y + 9,
  );
  if (spec.issuer === "araxys") {
    doc.text("Authorized signatory: ____________________", PAGE_W - MARGIN, FOOTER_Y + 9, {
      align: "right",
    });
  }
  doc.setTextColor(0, 0, 0);
}
