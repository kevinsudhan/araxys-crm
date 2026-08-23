/**
 * Kept as the entry point the shipment pages already call.
 *
 * The commercial invoice is now one entry in the document registry rather than a
 * hand-written generator, so these are thin wrappers — the shipment detail page does not
 * need to know that changed.
 */
import type { Shipment } from "../types";
import type { RealRecord } from "../services/backend";
import { generateDocumentForRecord, generateDocumentForShipment } from "./documents";

export function generateInvoicePdf(shipment: Shipment): void {
  generateDocumentForShipment("commercial-invoice", shipment);
}

export function generateInvoicePdfFromRecord(record: RealRecord): void {
  generateDocumentForRecord("commercial-invoice", record);
}
