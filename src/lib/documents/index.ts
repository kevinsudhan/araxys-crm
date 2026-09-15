/**
 * The public surface: pick a document, give it a record, get a PDF.
 */
import type { Shipment } from "../../types";
import type { RealRecord } from "../../services/backend";
import { DOCUMENTS, documentSpec } from "./registry";
import {
  documentDataFromBooking,
  documentDataFromEnquiry,
  documentDataFromRecord,
  documentDataFromShipment,
  readiness,
} from "./data";
import { renderDocument } from "./render";
import type { DocSpec, DocumentData } from "./types";

export {
  DOCUMENTS,
  documentSpec,
  readiness,
  documentDataFromRecord,
  documentDataFromShipment,
  documentDataFromBooking,
  documentDataFromEnquiry,
};
export type { DocSpec, DocumentData };
export type { DataKey } from "./types";

const filename = (spec: DocSpec, data: DocumentData) =>
  `ARX-${spec.numberPrefix}-${data.documentNumber}-${spec.id}.pdf`;

export function generateDocument(spec: DocSpec, data: DocumentData): void {
  renderDocument(spec, data).save(filename(spec, data));
}

/**
 * Opens the document to be read, rather than saving it to be filed.
 *
 * ---------------------------------------------------------------------------
 * READING AND KEEPING ARE DIFFERENT ACTS
 *
 * Downloading was the only thing on offer, so checking whether a B/L draft had
 * the right consignee meant putting a file in Downloads, opening it, reading
 * it, and then having a stale copy on the machine for ever. Most of the time
 * nobody wants the file at all — they want to look at it.
 *
 * The blob url is revoked on a timer rather than immediately: the new tab needs
 * it long enough to load, and there is no event here that fires when it has.
 * A minute is far longer than a PDF takes and short enough that a morning of
 * checking documents does not hold every one of them in memory.
 *
 * Returns false when the tab was blocked, so the caller can say so instead of
 * leaving somebody pressing a button that appears to do nothing.
 * ---------------------------------------------------------------------------
 */
export function viewDocument(spec: DocSpec, data: DocumentData): boolean {
  const url = renderDocument(spec, data).output("bloburl") as unknown as string;
  const tab = window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(tab);
}

export function viewDocumentForShipment(docId: string, shipment: Shipment): boolean {
  const spec = documentSpec(docId);
  if (!spec) throw new Error(`unknown document: ${docId}`);
  return viewDocument(spec, documentDataFromShipment(shipment));
}

export function generateDocumentForRecord(docId: string, record: RealRecord): void {
  const spec = documentSpec(docId);
  if (!spec) throw new Error(`unknown document: ${docId}`);
  generateDocument(spec, documentDataFromRecord(record));
}

export function generateDocumentForShipment(docId: string, shipment: Shipment): void {
  const spec = documentSpec(docId);
  if (!spec) throw new Error(`unknown document: ${docId}`);
  generateDocument(spec, documentDataFromShipment(shipment));
}

/** Readiness for every document against one record, for the UI list. */
export function documentStatuses(data: DocumentData) {
  return DOCUMENTS.map((spec) => ({ spec, ...readiness(data, spec.requires) }));
}
