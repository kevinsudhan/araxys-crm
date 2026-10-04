import { jsPDF } from "jspdf";
import { BRAND, CONTENT_W, FOOTER_Y, INK, MARGIN, MUTED, PAGE_W, RULE, TINT, docDate, drawLetterhead } from "./letterhead";
import type { HblData } from "../hbl";
import type { MasterConsole, SiTerms } from "../masterBill";

/**
 * The shipping instruction for a console's master B/L, as the line receives
 * it (119): on the letterhead, the booking and the voyage, the three parties,
 * every box with its seal and cargo, the cargo as the bill should describe
 * it, the freight, and the desk's remarks. The house list — the console's
 * cargo manifest — goes with it as its own attachment, which is what "as per
 * attached list" points at.
 */
export function renderMasterSiPdf(c: MasterConsole, si: HblData, terms: SiTerms, printedOn: Date = new Date()): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const set = (k: [number, number, number]) => doc.setTextColor(k[0], k[1], k[2]);
  const stroke = () => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.3);
  };
  const right = MARGIN + CONTENT_W;

  let y = drawLetterhead(doc, MARGIN);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  set(INK);
  doc.text(c.coload ? "SHIPPING INSTRUCTIONS — CO-LOAD" : "SHIPPING INSTRUCTIONS — MASTER B/L", PAGE_W / 2, y + 3, { align: "center" });
  y += 9;

  // ---- the booking and the voyage ----
  const facts: Array<[string, string]> = [
    c.coload ? ["Co-loader", (c.coloader ?? "").toUpperCase()] : ["Carrier", c.carrier.toUpperCase()],
    ["Booking no", si.booking_ref],
    ["Our console", c.console_no ?? ""],
    ["Date", docDate(printedOn.toISOString())],
    ["Vessel / voyage", [si.vessel, si.voyage].filter(Boolean).join(" / ")],
    ["Port of loading", si.port_of_loading],
    ["Port of discharge", si.port_of_discharge],
    ["Place of delivery", si.place_of_delivery],
    ["ETD", docDate(c.etd)],
    ["Cut-off", docDate(c.cutoff_date)],
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

  // ---- the parties ----
  const party = (label: string, name: string, address: string) => {
    const body = (doc.splitTextToSize([name, address].filter(Boolean).join("\n") || "—", CONTENT_W - 36) as string[]).slice(0, 5);
    const h = Math.max(10, body.length * 3.9 + 4);
    stroke();
    doc.rect(MARGIN, y, CONTENT_W, h);
    doc.setFillColor(TINT[0], TINT[1], TINT[2]);
    doc.rect(MARGIN, y, 32, h, "F");
    doc.rect(MARGIN, y, 32, h);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    set(BRAND);
    doc.text(label, MARGIN + 2, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    set(INK);
    doc.text(body, MARGIN + 35, y + 5);
    y += h;
  };
  party("SHIPPER", si.shipper_name, si.shipper_address);
  party("CONSIGNEE", si.consignee_name, si.consignee_address);
  party("NOTIFY PARTY", si.notify_name, si.notify_address);
  y += 5;

  // ---- the boxes ----
  const head: Array<[string, number, "left" | "right"]> = [
    ["Container", 40, "left"],
    ["Size / type", 24, "left"],
    ["Seal", 36, "left"],
    ["Packages", 24, "right"],
    ["Gross kg", 30, "right"],
    ["CBM", CONTENT_W - 154, "right"],
  ];
  const row = (cells: string[], bold = false, fillRow = false) => {
    let x = MARGIN;
    if (fillRow) {
      doc.setFillColor(TINT[0], TINT[1], TINT[2]);
      doc.rect(MARGIN, y, CONTENT_W, 7, "F");
    }
    head.forEach(([, w, align], i) => {
      stroke();
      doc.rect(x, y, w, 7);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(7.8);
      set(INK);
      doc.text(cells[i] ?? "", align === "right" ? x + w - 1.8 : x + 1.8, y + 4.8, { align });
      x += w;
    });
    y += 7;
  };
  // On a co-load the box is theirs: the cargo below is all there is to state.
  if (!c.coload) {
    row(head.map(([h]) => h), true, true);
    if (!si.containers.length) row(["No container numbers yet", "", "", "", "", ""]);
    for (const b of si.containers) row([b.container_no, b.size_type, b.seal_no || "—", b.packages, b.gross_kg, b.cbm]);
    row(["TOTAL", "", "", si.packages, si.gross_weight_kg, si.measurement_cbm], true, true);
    y += 5;
  }

  // ---- the cargo, as the bill should say it ----
  const cargo = [
    `MARKS & NUMBERS: ${si.marks_numbers || "—"}`,
    `SAID TO CONTAIN ${si.packages || "—"} ${si.package_type} ${si.description}`.replace(/\s+/g, " ").trim(),
    `GROSS WEIGHT ${si.gross_weight_kg || "—"} KGS · MEASUREMENT ${si.measurement_cbm || "—"} CBM`,
    si.shippers_load ? "SHIPPER'S LOAD, STOW, COUNT AND SEAL" : `SERVICE ${si.service_type}`,
    `FREIGHT ${si.freight_terms.toUpperCase()}${si.freight_payable_at ? ` · PAYABLE AT ${si.freight_payable_at}` : ""}`,
  ];
  const wrapped = cargo.flatMap((l) => doc.splitTextToSize(l, CONTENT_W - 6) as string[]);
  const ch = wrapped.length * 4.1 + 5;
  stroke();
  doc.rect(MARGIN, y, CONTENT_W, ch);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  set(INK);
  doc.text(wrapped, MARGIN + 3, y + 5);
  y += ch + 5;

  if (terms.remarks.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    set(BRAND);
    doc.text("Remarks", MARGIN, y);
    doc.setFont("helvetica", "normal");
    set(INK);
    const r = doc.splitTextToSize(terms.remarks.trim(), CONTENT_W) as string[];
    doc.text(r, MARGIN, y + 4.5);
    y += r.length * 4 + 7;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  set(MUTED);
  doc.text(`The house list is attached. Kindly send the draft ${c.coload ? "B/L" : "master B/L"} for our approval before issuing.`, MARGIN, Math.min(y + 2, FOOTER_Y - 8));

  doc.setFontSize(6.8);
  doc.text(`${c.console_no ?? ""} · Shipping instructions`, MARGIN, FOOTER_Y);
  doc.text("Aashish Logistics Global Pvt Ltd", right, FOOTER_Y, { align: "right" });
  return doc;
}

export const masterSiFileName = (c: Pick<MasterConsole, "console_no" | "carrier_booking_no">) =>
  `SI-${(c.carrier_booking_no || c.console_no || "console").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

export const masterSiPdfBytes = (c: MasterConsole, si: HblData, terms: SiTerms) =>
  new Uint8Array(renderMasterSiPdf(c, si, terms).output("arraybuffer") as ArrayBuffer);
