/**
 * The public surface: pick a document, give it a record, get a PDF.
 */
import type { Shipment } from "../../types";
import type { RealRecord } from "../../services/backend";
import { DOCUMENTS, documentSpec } from "./registry";
import { documentDataFromRecord, documentDataFromShipment, readiness } from "./data";
import { renderDocument } from "./render";
import type { DocSpec, DocumentData } from "./types";

export { DOCUMENTS, documentSpec, readiness, documentDataFromRecord, documentDataFromShipment };
export type { DocSpec, DocumentData };
export type { DataKey } from "./types";

const filename = (spec: DocSpec, data: DocumentData) =>
  `ARX-${spec.numberPrefix}-${data.documentNumber}-${spec.id}.pdf`;

export function generateDocument(spec: DocSpec, data: DocumentData): void {
  renderDocument(spec, data).save(filename(spec, data));
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
