/**
 * A quotation's revision, as the customer reads it.
 *
 * Version 1 is the quotation; version 2 is its first revision, version 3 its
 * second. The desk counts versions; a customer is sent "Revision 1" — and
 * every place the customer reads it says the same: the mail's title and its
 * reference line, the PDF's title, number and file name, and the page the
 * accept button opens.
 */

/** 0 for the quotation itself, 1 for its first revision. */
export const revisionOf = (version: number): number => Math.max(0, Math.floor(Number(version) || 1) - 1);

export const isRevised = (version: number): boolean => revisionOf(version) > 0;

/** "QUOTATION", or "REVISED QUOTATION". */
export const quotationTitle = (version: number): string => (isRevised(version) ? "REVISED QUOTATION" : "QUOTATION");

/** "ALG09014-26", or "ALG09014-26 Rev 1". */
export const quotationNumber = (ref: string, version: number): string => (isRevised(version) ? `${ref} Rev ${revisionOf(version)}` : ref);

/** "Quotation-ALG09014-26.pdf", or "Revised-Quotation-ALG09014-26-Rev1.pdf". */
export const quotationFileName = (ref: string, version: number): string =>
  isRevised(version) ? `Revised-Quotation-${ref}-Rev${revisionOf(version)}.pdf` : `Quotation-${ref}.pdf`;
