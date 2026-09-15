import type { Invoice } from "../services/billing";
import type { CustomerBalance, Payment } from "../services/receipts";
import { allocatedCash, onAccount, settledTotal } from "../services/receipts";
import type { Sheet } from "./xlsx";

/**
 * Turning what is on a screen into sheets somebody can work in.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EXPORT IS NOT THE SCREEN
 *
 * A screen answers one question and hides the rest so it can. A spreadsheet is
 * opened precisely because somebody has a question nobody anticipated, so it
 * carries the columns the screen suppressed — the tax split, the place of
 * supply, the exchange rate, the SAC on every line.
 *
 * WHY THE LINES ARE THEIR OWN SHEET
 *
 * Because that is the sheet a pivot table is built on. "What did we earn on
 * documentation fees this quarter" is the reference system's P/L Chargewise
 * report; here it is a pivot over the Charges sheet, which means the desk can
 * ask the next question too without anybody writing a report for it.
 *
 * WHY MONEY IS A NUMBER AND NOT "₹1,234"
 *
 * Because the first thing anybody does to an exported ledger is select a column
 * and look at the sum. A currency symbol in the cell makes it text, and text
 * does not sum.
 * ---------------------------------------------------------------------------
 */

/** ISO, so a text date still sorts correctly if a reader mangles the format. */
const asDate = (s: string | null | undefined) => (s ? new Date(s + "T00:00:00") : null);

const TREATMENT: Record<string, string> = {
  cgst_sgst: "CGST + SGST",
  igst: "IGST",
  export_lut: "Export — zero rated (LUT)",
  export_igst: "Export — IGST paid",
  exempt: "Exempt / non-GST",
};

export function invoiceSheets(invoices: Invoice[]): Sheet[] {
  const headers: Sheet = {
    name: "Invoices",
    columns: [
      { header: "Number", width: 22 },
      { header: "Date", width: 12 },
      { header: "Due", width: 12 },
      { header: "Customer", width: 30 },
      { header: "Kind", width: 14 },
      { header: "Status", width: 12 },
      { header: "Shipment", width: 16 },
      { header: "B/L", width: 20 },
      { header: "Vessel / voyage", width: 22 },
      { header: "Currency", width: 9 },
      { header: "Rate", width: 9 },
      { header: "Taxable", width: 14 },
      { header: "CGST", width: 12 },
      { header: "SGST", width: 12 },
      { header: "IGST", width: 12 },
      { header: "Total", width: 14 },
      { header: "Total (INR)", width: 14 },
      { header: "Tax treatment", width: 24 },
      { header: "Place of supply", width: 18 },
      { header: "GSTIN", width: 18 },
    ],
    rows: invoices.map((i) => [
      i.number ?? "(draft)",
      asDate(i.invoice_date),
      asDate(i.due_date),
      i.customer_label ?? i.bill_to_name,
      i.kind.replace(/_/g, " "),
      i.status.replace(/_/g, " "),
      i.shipment_id,
      i.bl_number,
      i.vessel_voyage,
      i.currency,
      Number(i.exchange_rate),
      Number(i.taxable_value),
      Number(i.cgst_amount),
      Number(i.sgst_amount),
      Number(i.igst_amount),
      Number(i.total_amount),
      Number(i.total_inr),
      TREATMENT[i.tax_treatment] ?? i.tax_treatment,
      i.place_of_supply,
      i.bill_to_gstin,
    ]),
  };

  // One row per charge, flattened across every invoice. This is the sheet the
  // charge-wise questions get answered from.
  const lines: Sheet = {
    name: "Charges",
    columns: [
      { header: "Invoice", width: 22 },
      { header: "Date", width: 12 },
      { header: "Customer", width: 30 },
      { header: "Charge", width: 34 },
      { header: "SAC", width: 10 },
      { header: "Qty", width: 8 },
      { header: "Unit", width: 12 },
      { header: "Rate", width: 12 },
      { header: "Amount", width: 14 },
      { header: "Tax %", width: 8 },
      { header: "Reimbursement", width: 14 },
    ],
    rows: invoices.flatMap((i) =>
      (i.lines ?? []).map((l) => [
        i.number ?? "(draft)",
        asDate(i.invoice_date),
        i.customer_label ?? i.bill_to_name,
        l.description,
        l.sac_code,
        Number(l.quantity),
        l.unit,
        Number(l.rate),
        Number(l.amount),
        Number(l.tax_rate),
        l.is_reimbursement,
      ])
    ),
  };

  return lines.rows.length > 0 ? [headers, lines] : [headers];
}

export function receiptSheets(
  payments: Payment[],
  balances: CustomerBalance[],
  direction: "in" | "out"
): Sheet[] {
  const label = direction === "in" ? "Receipts" : "Payments";

  const head: Sheet = {
    name: label,
    columns: [
      { header: "Number", width: 22 },
      { header: "Date", width: 12 },
      { header: "Party", width: 30 },
      { header: "Paid by", width: 24 },
      { header: "Mode", width: 16 },
      { header: "Instrument", width: 18 },
      { header: "Drawn on", width: 20 },
      { header: "Status", width: 12 },
      { header: "Amount", width: 14 },
      { header: "Cash applied", width: 14 },
      { header: "TDS withheld", width: 14 },
      { header: "Invoices reduced by", width: 18 },
      { header: "On account", width: 14 },
      { header: "Remarks", width: 30 },
    ],
    rows: payments.map((p) => {
      const cash = allocatedCash(p);
      const settled = settledTotal(p);
      return [
        p.number ?? "(draft)",
        asDate(p.payment_date),
        p.party_label,
        p.paid_by,
        p.mode.replace(/_/g, " "),
        p.instrument_no,
        p.drawn_on,
        p.status,
        Number(p.amount),
        cash,
        settled - cash,
        settled,
        Math.max(onAccount(p), 0),
        p.remarks,
      ];
    }),
  };

  const alloc: Sheet = {
    name: "Applied to",
    columns: [
      { header: label.slice(0, -1), width: 22 },
      { header: "Date", width: 12 },
      { header: "Party", width: 30 },
      { header: "Invoice", width: 22 },
      { header: "Invoice total", width: 14 },
      { header: "Cash applied", width: 14 },
      { header: "TDS", width: 12 },
      { header: "Settled", width: 14 },
      { header: "Shipment", width: 16 },
    ],
    rows: payments.flatMap((p) =>
      (p.allocations ?? []).map((a) => [
        p.number ?? "(draft)",
        asDate(p.payment_date),
        p.party_label,
        a.invoice?.number ?? "(draft)",
        Number(a.invoice?.total_amount ?? 0),
        Number(a.amount),
        Number(a.tds_amount),
        Number(a.amount) + Number(a.tds_amount),
        a.invoice?.shipment_id,
      ])
    ),
  };

  const owing: Sheet = {
    name: "Balances",
    columns: [
      { header: "Customer", width: 34 },
      { header: "Billed", width: 14 },
      { header: "Cash received", width: 14 },
      { header: "TDS withheld", width: 14 },
      { header: "Outstanding", width: 14 },
      { header: "On account", width: 14 },
      { header: "Open invoices", width: 13 },
    ],
    rows: balances.map((b) => [
      b.label,
      Number(b.billed),
      Number(b.cash_received),
      Number(b.tds_withheld),
      Number(b.outstanding),
      Number(b.on_account),
      Number(b.open_invoices),
    ]),
  };

  const out: Sheet[] = [head];
  if (alloc.rows.length > 0) out.push(alloc);
  if (owing.rows.length > 0) out.push(owing);
  return out;
}
