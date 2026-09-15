import { supabase } from "../lib/supabase";
import type { Invoice } from "./billing";

// The arithmetic lives in lib/ so a test can load it without Vite.
export { spreadOldestFirst, remainderAfter } from "../lib/allocate";
export type { Owed } from "../lib/allocate";

/**
 * Money in and money out, and what it settles.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS THIS HAS TO GET RIGHT
 *
 * One receipt settles many invoices. A customer pays one amount against
 * whatever they feel like clearing, and it is routinely a round number covering
 * two invoices from two different bookings.
 *
 * TDS is not a shortfall. An Indian customer settling 17,000 pays 16,830 and
 * remits 170 to the government against our PAN. Recorded as a short payment,
 * that invoice never reaches paid and sits in the ageing report for ever.
 *
 * An advance is an unallocated receipt. Money arrives before the invoice does,
 * and what is left unapplied IS the advance — not a separate kind of record
 * with its own drawdown rules.
 * ---------------------------------------------------------------------------
 */

export type Direction = "in" | "out";
export type PaymentStatus = "draft" | "confirmed" | "cancelled";
export type PaymentMode =
  | "bank_transfer"
  | "cheque"
  | "cash"
  | "upi"
  | "from_advance"
  | "adjustment"
  | "other";

export const MODE_LABEL: Record<PaymentMode, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
  upi: "UPI",
  from_advance: "From advance",
  adjustment: "Adjustment",
  other: "Other",
};

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

/** Modes that have a cheque or reference number and a bank behind them. */
export const MODES_WITH_INSTRUMENT: PaymentMode[] = ["cheque", "bank_transfer", "upi"];

export interface PaymentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string;
  amount: number;
  tds_amount: number;
  created_at: string;

  /** Joined by the loaders, not columns. */
  invoice?: Pick<Invoice, "number" | "total_amount" | "invoice_date" | "shipment_id" | "bl_number">;
}

export interface Payment {
  id: string;
  number: string | null;
  series: string;
  fy: string | null;
  direction: Direction;
  status: PaymentStatus;

  payment_date: string;
  customer_id: string | null;
  partner_id: string | null;
  paid_by: string;

  amount: number;
  currency: string;
  exchange_rate: number;

  mode: PaymentMode;
  instrument_no: string;
  drawn_on: string;
  instrument_date: string | null;

  remarks: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;

  allocations?: PaymentAllocation[];
  party_label?: string | null;
}

const SELECT =
  "*, allocations:payment_allocations(*, invoice:invoices(number, total_amount, invoice_date, shipment_id, bl_number))";

/** Cash applied, which is not the same as what the receipt settled. */
export const allocatedCash = (p: Payment) =>
  (p.allocations ?? []).reduce((t, a) => t + Number(a.amount || 0), 0);

/** Cash plus withheld tax — what the invoices were actually reduced by. */
export const settledTotal = (p: Payment) =>
  (p.allocations ?? []).reduce((t, a) => t + Number(a.amount || 0) + Number(a.tds_amount || 0), 0);

/**
 * What is left sitting on the customer's account.
 *
 * This is the advance. It is not an error state and it is not lost — it shows
 * on their balance and is applied later by adding an allocation.
 */
export const onAccount = (p: Payment) => Number(p.amount || 0) - allocatedCash(p);

export async function listPayments(opts?: {
  direction?: Direction;
  customerId?: string;
  limit?: number;
}): Promise<Payment[]> {
  let q = supabase
    .from("payments")
    .select(`${SELECT}, customers(name, company), partners(name, organisation)`)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (opts?.direction) q = q.eq("direction", opts.direction);
  if (opts?.customerId) q = q.eq("customer_id", opts.customerId);
  q = q.limit(opts?.limit ?? 200);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const { customers, partners, ...rest } = row as Record<string, unknown> & {
      customers?: { name?: string; company?: string } | null;
      partners?: { name?: string; organisation?: string } | null;
    };
    return {
      ...(rest as unknown as Payment),
      party_label:
        customers?.company ||
        customers?.name ||
        partners?.organisation ||
        partners?.name ||
        null,
    };
  });
}

export async function getPayment(id: string): Promise<Payment | null> {
  const { data, error } = await supabase.from("payments").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Payment) ?? null;
}

/**
 * Open one.
 *
 * Passing an invoice is the common case — you are looking at something unpaid
 * and pressing "record a receipt". The customer, the amount still outstanding
 * and the allocation line all come across, so an ordinary receipt is a confirm
 * rather than a screen of typing.
 */
export async function startPayment(input: {
  direction: Direction;
  customerId?: string | null;
  partnerId?: string | null;
  invoiceId?: string | null;
}): Promise<Payment> {
  const { data, error } = await supabase.rpc("start_payment", {
    p_direction: input.direction,
    p_customer: input.customerId ?? null,
    p_partner: input.partnerId ?? null,
    p_invoice: input.invoiceId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Payment;
}

export async function updatePayment(id: string, patch: Partial<Payment>): Promise<Payment> {
  const { data, error } = await supabase
    .from("payments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Payment;
}

export async function addAllocation(
  paymentId: string,
  invoiceId: string,
  amount = 0,
  tds = 0
): Promise<void> {
  const { error } = await supabase
    .from("payment_allocations")
    .insert({ payment_id: paymentId, invoice_id: invoiceId, amount, tds_amount: tds });
  if (error) throw new Error(error.message);
}

export async function updateAllocation(
  id: string,
  patch: { amount?: number; tds_amount?: number }
): Promise<void> {
  const { error } = await supabase.from("payment_allocations").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeAllocation(id: string): Promise<void> {
  const { error } = await supabase.from("payment_allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function confirmPayment(id: string): Promise<Payment> {
  const { data, error } = await supabase.rpc("confirm_payment", { p_id: id });
  if (error) throw new Error(error.message);
  return data as Payment;
}

export async function cancelPayment(id: string, reason = ""): Promise<Payment> {
  const { data, error } = await supabase.rpc("cancel_payment", { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as Payment;
}

export interface OpenInvoice {
  invoice_id: string;
  number: string | null;
  invoice_date: string;
  shipment_id: string | null;
  bl_number: string | null;
  total_amount: number;
  cash_received: number;
  tds_withheld: number;
  outstanding: number;
}

/**
 * What a customer still owes, oldest first.
 *
 * Oldest first because that is the order money is applied in unless somebody
 * says otherwise — and because it is the order that keeps an ageing report
 * meaningful.
 */
export async function openInvoicesFor(customerId: string): Promise<OpenInvoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, number, invoice_date, shipment_id, bl_number, total_amount, status")
    .eq("customer_id", customerId)
    .in("status", ["issued", "part_paid"])
    .order("invoice_date", { ascending: true });
  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return [];

  const { data: settle, error: e2 } = await supabase
    .from("invoice_settlement")
    .select("invoice_id, cash_received, tds_withheld, outstanding")
    .in("invoice_id", ids);
  if (e2) throw new Error(e2.message);

  const byId = new Map(
    (settle ?? []).map((s) => [(s as { invoice_id: string }).invoice_id, s as OpenInvoice])
  );

  return (data ?? []).map((r) => {
    const row = r as unknown as OpenInvoice & { id: string };
    const s = byId.get(row.id);
    return {
      invoice_id: row.id,
      number: row.number,
      invoice_date: row.invoice_date,
      shipment_id: row.shipment_id,
      bl_number: row.bl_number,
      total_amount: Number(row.total_amount || 0),
      cash_received: Number(s?.cash_received ?? 0),
      tds_withheld: Number(s?.tds_withheld ?? 0),
      outstanding: Number(s?.outstanding ?? row.total_amount ?? 0),
    };
  });
}

export interface CustomerBalance {
  customer_id: string;
  label: string;
  billed: number;
  cash_received: number;
  tds_withheld: number;
  outstanding: number;
  on_account: number;
  open_invoices: number;
}

export async function customerBalances(): Promise<CustomerBalance[]> {
  const { data, error } = await supabase
    .from("customer_balances")
    .select("*")
    .order("outstanding", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerBalance[];
}
