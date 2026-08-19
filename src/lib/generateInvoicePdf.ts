import { jsPDF } from "jspdf";
import type { Shipment } from "../types";

const PAGE_W = 210;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

function fmtInr(n: number | undefined) {
  return n !== undefined ? `Rs. ${n.toLocaleString("en-IN")}` : "TBD";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generates a real Commercial Invoice & Packing List PDF under the Araxys Logistics
 * letterhead, populated from whatever the shipment record actually has. Missing fields
 * render as "TBD" rather than being invented — this is meant to be usable the moment
 * documentation is genuinely complete, and honest about it when it isn't.
 */
export function generateInvoicePdf(shipment: Shipment): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const dg = shipment.docGenDetails;
  let y = MARGIN;

  // Letterhead
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(15, 110, 86); // brand teal
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

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("COMMERCIAL INVOICE & PACKING LIST", MARGIN, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(`Invoice no: ARX-${shipment.blNumber}`, MARGIN, y);
  doc.text(`Date issued: ${todayIso()}`, PAGE_W - MARGIN, y, { align: "right" });
  y += 5;
  doc.text(`Bill of lading: ${shipment.blNumber}`, MARGIN, y);
  if (dg?.documentationStatus) {
    doc.text(`Documentation status: ${dg.documentationStatus.replace(/_/g, " ")}`, PAGE_W - MARGIN, y, { align: "right" });
  }
  y += 10;

  // Parties: two columns
  const colW = CONTENT_W / 2 - 4;
  const partyTop = y;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Shipper / Exporter", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  let yl = y + 5;
  const shipperLines = [dg?.shipperName ?? shipment.company, dg?.shipperGstinIec ? `GSTIN/IEC: ${dg.shipperGstinIec}` : "GSTIN/IEC: TBD"];
  for (const line of shipperLines) {
    doc.text(line, MARGIN, yl);
    yl += 5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Consignee / Importer", MARGIN + colW + 8, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  let yr = y + 5;
  const consigneeLines = [
    dg?.consigneeName ?? "TBD",
    dg?.consigneeAddress ?? "TBD",
    dg?.consigneeCountry ?? shipment.destination,
  ];
  for (const line of consigneeLines) {
    doc.text(line, MARGIN + colW + 8, yr);
    yr += 5;
  }

  y = Math.max(yl, yr) + 6;
  doc.setDrawColor(230, 230, 230);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // Shipment details table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Shipment details", MARGIN, y);
  y += 6;

  const shipmentRows: [string, string][] = [
    ["Origin", shipment.origin],
    ["Destination", shipment.destination],
    ["Carrier", shipment.carrier],
    ["Container", shipment.containerId ?? "TBD"],
    ["Sailing / ETA date", shipment.etaDate],
    ["Cargo description", shipment.callExtraction?.cargoDescription ?? "TBD"],
    ["HS code", dg?.hsCode ?? "TBD"],
    ["Packages", dg?.packageCount !== undefined ? `${dg.packageCount} x ${dg.packageType ?? "units"}` : "TBD"],
    ["Net weight", dg?.netWeightKg !== undefined ? `${dg.netWeightKg.toLocaleString("en-IN")} kg` : "TBD"],
    ["Gross weight", dg?.grossWeightKg !== undefined ? `${dg.grossWeightKg.toLocaleString("en-IN")} kg` : "TBD"],
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const labelW = 45;
  for (const [label, value] of shipmentRows) {
    doc.setTextColor(100, 100, 100);
    doc.text(label, MARGIN, y);
    doc.setTextColor(0, 0, 0);
    doc.text(String(value), MARGIN + labelW, y);
    y += 6;
  }

  y += 4;
  doc.setDrawColor(230, 230, 230);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // Value / rate block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Value & freight", MARGIN, y);
  y += 6;

  const valueRows: [string, string][] = [
    ["Declared invoice value", fmtInr(dg?.invoiceValueInr ?? (shipment.quoteAmount || undefined))],
    ["Freight rate (fixed)", fmtInr(shipment.quoteAmount || undefined)],
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  for (const [label, value] of valueRows) {
    doc.setTextColor(100, 100, 100);
    doc.text(label, MARGIN, y);
    doc.setTextColor(0, 0, 0);
    doc.text(value, MARGIN + labelW, y);
    y += 6;
  }

  if (dg?.missingFields) {
    y += 4;
    doc.setTextColor(160, 60, 40);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text(`Note: still pending from customer -- ${dg.missingFields}`, MARGIN, y, { maxWidth: CONTENT_W });
    doc.setTextColor(0, 0, 0);
    y += 8;
  }

  // Footer
  const footerY = 275;
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("Generated by Araxys Logistics -- this document is system-generated from confirmed call and shipment data.", MARGIN, footerY + 5);
  doc.text(`Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`, MARGIN, footerY + 9);
  doc.text("Authorized signatory: ____________________", PAGE_W - MARGIN, footerY + 9, { align: "right" });

  doc.save(`ARX-${shipment.blNumber}-commercial-invoice.pdf`);
}
