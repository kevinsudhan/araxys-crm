import { supabase } from "../lib/supabase";
import { istDay } from "../lib/enquiryRegister";
import type { DcDoc, DcJob } from "../lib/debitCredit";
import { PARTNER_ROLE_LABEL, type PartnerRole } from "./partners";
import { all, str, whereIn, type Row } from "./paging";

/**
 * Everything the debit and credit page is worked out from (7 Oct), in a handful
 * of reads for the whole book: the issued invoices and notes, the bills, what
 * has been received or paid against each, and the shipments, consoles,
 * customers and partners they name. The figures are lib/debitCredit.ts's.
 */

export interface DcData {
  jobs: DcJob[];
  docs: DcDoc[];
  consoleNo: Record<string, string | null>;
}

const INVOICE_COLS =
  "id, number, kind, status, shipment_id, console_id, customer_id, partner_id, bill_to_name, invoice_date, created_at, currency, exchange_rate, total_amount, total_inr";
const BILL_COLS = "id, bill_no, kind, status, shipment_id, console_id, partner_id, bill_date, created_at, currency, exchange_rate, total_amount, total_inr";

/** Rupees of a document: its own rupee total, else its amount at its rate. */
const rupees = (r: Row) => {
  const inr = Number(r.total_inr);
  if (Number.isFinite(inr) && r.total_inr !== null) return inr;
  return (Number(r.total_amount) || 0) * (Number(r.exchange_rate) || 1);
};

/** The share of a document settled, in its own currency, as rupees. */
const settledRupees = (r: Row, settledInCurrency: number) => {
  const total = Number(r.total_amount) || 0;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, settledInCurrency / total)) * rupees(r);
};

export async function loadDebitCredit(): Promise<DcData> {
  const [invoices, bills, invoiceSettled, billAllocations] = await Promise.all([
    all((a, b) =>
      supabase
        .from("invoices")
        .select(INVOICE_COLS)
        .in("kind", ["tax_invoice", "debit_note", "credit_note"])
        .in("status", ["issued", "part_paid", "paid"])
        .order("id")
        .range(a, b)
    ),
    all((a, b) => supabase.from("bills").select(BILL_COLS).neq("status", "cancelled").order("id").range(a, b)),
    all((a, b) => supabase.from("invoice_settlement").select("invoice_id, cash_received, tds_withheld").order("invoice_id").range(a, b)),
    all((a, b) =>
      supabase.from("payment_allocations").select("bill_id, amount, tds_amount, payment:payments(status)").not("bill_id", "is", null).order("id").range(a, b)
    ),
  ]);

  const shipmentIds = [...new Set([...invoices, ...bills].map((r) => str(r.shipment_id)).filter((x): x is string => !!x))];
  const consoleIds = [...new Set([...invoices, ...bills].map((r) => str(r.console_id)).filter((x): x is string => !!x))];
  const customerIds = invoices.map((r) => str(r.customer_id) ?? "");
  const partnerIds = [...invoices, ...bills].map((r) => str(r.partner_id) ?? "");

  const [shipments, consoles, customers, partners] = await Promise.all([
    whereIn("shipments", "id, enquiry_ref, transport_mode, origin, destination, console_id, customer:customers(name, company)", "id", shipmentIds),
    whereIn("consoles", "id, console_no", "id", consoleIds),
    whereIn("customers", "id, name, company, forwarder", "id", customerIds),
    whereIn("partners", "id, name, organisation, role", "id", partnerIds),
  ]);

  const consoleNo: Record<string, string | null> = Object.fromEntries(consoles.map((c) => [String(c.id), str(c.console_no)]));
  const customerOf = new Map(customers.map((c) => [String(c.id), c]));
  const partnerOf = new Map(partners.map((p) => [String(p.id), p]));
  const received = new Map(invoiceSettled.map((s) => [String(s.invoice_id), (Number(s.cash_received) || 0) + (Number(s.tds_withheld) || 0)]));
  const paid = new Map<string, number>();
  for (const a of billAllocations) {
    const p = a.payment as { status?: string } | null;
    if (p?.status !== "confirmed") continue;
    const id = String(a.bill_id);
    paid.set(id, (paid.get(id) ?? 0) + (Number(a.amount) || 0) + (Number(a.tds_amount) || 0));
  }

  const partnerParty = (id: string, fallback: string) => {
    const p = partnerOf.get(id);
    return {
      partyKey: `p:${id}`,
      partyName: String(p?.organisation || p?.name || fallback),
      partyType: PARTNER_ROLE_LABEL[(p?.role as PartnerRole) ?? "other"] ?? "Partner",
    };
  };

  const docs: DcDoc[] = [
    ...invoices.map((i): DcDoc => {
      const sign = i.kind === "credit_note" ? -1 : 1;
      const customer = i.customer_id ? customerOf.get(String(i.customer_id)) : undefined;
      const party = i.partner_id
        ? partnerParty(String(i.partner_id), String(i.bill_to_name ?? "Agent"))
        : customer
          ? {
              partyKey: `c:${customer.id}`,
              partyName: String(customer.company || customer.name || i.bill_to_name || "Customer"),
              partyType: customer.forwarder ? "Co-loader" : "Customer",
            }
          : { partyKey: `n:${String(i.bill_to_name ?? "").trim().toLowerCase()}`, partyName: String(i.bill_to_name || "Unnamed party"), partyType: "Customer" };
      return {
        id: String(i.id),
        side: "debit",
        kind: String(i.kind),
        number: str(i.number),
        date: istDay(String(i.invoice_date ?? i.created_at)),
        status: String(i.status),
        shipmentId: str(i.shipment_id),
        consoleId: str(i.console_id),
        ...party,
        amount: sign * rupees(i),
        settled: sign > 0 ? settledRupees(i, received.get(String(i.id)) ?? 0) : 0,
      };
    }),
    ...bills.map((b): DcDoc => {
      const sign = b.kind === "agent_credit_note" ? -1 : 1;
      const party = b.partner_id
        ? partnerParty(String(b.partner_id), "Vendor")
        : { partyKey: "n:unnamed vendor", partyName: "Unnamed vendor", partyType: "Vendor" };
      return {
        id: String(b.id),
        side: "credit",
        kind: String(b.kind),
        number: str(b.bill_no),
        date: istDay(String(b.bill_date ?? b.created_at)),
        status: String(b.status),
        shipmentId: str(b.shipment_id),
        consoleId: str(b.console_id),
        ...party,
        amount: sign * rupees(b),
        settled: sign > 0 ? settledRupees(b, paid.get(String(b.id)) ?? 0) : 0,
      };
    }),
  ];

  const jobs: DcJob[] = shipments.map((s) => {
    const c = s.customer as { name?: string | null; company?: string | null } | null;
    return {
      id: String(s.id),
      ref: str(s.enquiry_ref),
      customer: c?.company?.trim() || c?.name?.trim() || "—",
      route: [str(s.origin), str(s.destination)].filter(Boolean).join(" → "),
      mode: str(s.transport_mode),
      consoleId: str(s.console_id),
      consoleNo: s.console_id ? (consoleNo[String(s.console_id)] ?? null) : null,
    };
  });

  return { jobs, docs, consoleNo };
}
