import { supabase } from "../lib/supabase";

/**
 * The questions the accounts desk asks, as queries.
 *
 * ---------------------------------------------------------------------------
 * WHY AGEING IS COMPUTED HERE AND NOT IN A VIEW
 *
 * Because the buckets are relative to today, and a view that hard-codes "now"
 * is a view that is wrong for anybody reconstructing a position as at a past
 * date. The rows carry a due date; the bucketing is a function of that and a
 * reference date, so it can be asked about any day.
 *
 * WHY 0/30/60/90
 *
 * Not because it is clever — because it is what every statement of account a
 * customer has ever received uses, and a report they cannot reconcile against
 * their own ledger is a report that starts an argument.
 * ---------------------------------------------------------------------------
 */

export type Bucket = "current" | "d30" | "d60" | "d90" | "d90plus";

export const BUCKET_LABEL: Record<Bucket, string> = {
  current: "Not yet due",
  d30: "1–30 days",
  d60: "31–60 days",
  d90: "61–90 days",
  d90plus: "Over 90 days",
};

export const BUCKETS: Bucket[] = ["current", "d30", "d60", "d90", "d90plus"];

/** Which bucket a due date falls in, as at `asAt`. */
export function bucketOf(dueDate: string | null, asAt = new Date()): Bucket {
  // No due date means nobody agreed terms, so it is not overdue — it is
  // current until somebody says otherwise. Calling it 90+ would put a number
  // in the worst column on the strength of a blank field.
  if (!dueDate) return "current";
  const days = Math.floor(
    (asAt.getTime() - new Date(dueDate + "T00:00:00").getTime()) / 86_400_000
  );
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "d90plus";
}

export interface AgedRow {
  party_id: string;
  label: string;
  buckets: Record<Bucket, number>;
  total: number;
  oldestDays: number;
}

interface OpenDoc {
  party_id: string;
  label: string;
  due_date: string | null;
  outstanding: number;
}

function age(docs: OpenDoc[], asAt = new Date()): AgedRow[] {
  const by = new Map<string, AgedRow>();

  for (const d of docs) {
    if (Math.abs(d.outstanding) < 0.005) continue;
    let row = by.get(d.party_id);
    if (!row) {
      row = {
        party_id: d.party_id,
        label: d.label,
        buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 },
        total: 0,
        oldestDays: 0,
      };
      by.set(d.party_id, row);
    }
    row.buckets[bucketOf(d.due_date, asAt)] += d.outstanding;
    row.total += d.outstanding;
    if (d.due_date) {
      const days = Math.floor(
        (asAt.getTime() - new Date(d.due_date + "T00:00:00").getTime()) / 86_400_000
      );
      if (days > row.oldestDays) row.oldestDays = days;
    }
  }

  return [...by.values()].sort((a, b) => b.total - a.total);
}

/** What customers owe us, aged. */
export async function receivablesAgeing(): Promise<{ rows: AgedRow[]; docs: OpenDoc[] }> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, customer_id, bill_to_name, due_date, total_inr, status, number, invoice_date, shipment_id, customers(name, company)")
    .in("status", ["issued", "part_paid"])
    .is("partner_id", null);
  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  const settled = new Map<string, number>();
  if (ids.length) {
    const { data: s } = await supabase
      .from("invoice_settlement")
      .select("invoice_id, outstanding")
      .in("invoice_id", ids);
    for (const r of s ?? [])
      settled.set((r as { invoice_id: string }).invoice_id, Number((r as { outstanding: number }).outstanding));
  }

  const docs: OpenDoc[] = (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      customer_id: string;
      bill_to_name: string;
      due_date: string | null;
      total_inr: number;
      customers?: { name?: string; company?: string } | null;
    };
    return {
      party_id: row.customer_id,
      label: row.customers?.company || row.customers?.name || row.bill_to_name,
      due_date: row.due_date,
      outstanding: settled.get(row.id) ?? Number(row.total_inr || 0),
    };
  });

  return { rows: age(docs), docs };
}

/** What we owe vendors and agents, aged. */
export async function payablesAgeing(): Promise<{ rows: AgedRow[] }> {
  const { data, error } = await supabase
    .from("bills")
    .select("id, partner_id, due_date, total_inr, status, kind, partners(name, organisation)")
    .in("status", ["received", "part_paid"]);
  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  const paid = new Map<string, number>();
  if (ids.length) {
    const { data: a } = await supabase
      .from("payment_allocations")
      .select("bill_id, amount, tds_amount, payments!inner(status)")
      .in("bill_id", ids)
      .eq("payments.status", "confirmed");
    for (const r of a ?? []) {
      const row = r as unknown as { bill_id: string; amount: number; tds_amount: number };
      paid.set(row.bill_id, (paid.get(row.bill_id) ?? 0) + Number(row.amount) + Number(row.tds_amount));
    }
  }

  const docs: OpenDoc[] = (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      partner_id: string;
      due_date: string | null;
      total_inr: number;
      kind: string;
      partners?: { name?: string; organisation?: string } | null;
    };
    const gross = (row.kind === "agent_credit_note" ? -1 : 1) * Number(row.total_inr || 0);
    return {
      party_id: row.partner_id,
      label: row.partners?.organisation || row.partners?.name || "—",
      due_date: row.due_date,
      outstanding: gross - (paid.get(row.id) ?? 0),
    };
  });

  return { rows: age(docs) };
}

export interface SettlementLine {
  payment_number: string | null;
  payment_date: string;
  party: string | null;
  mode: string;
  instrument: string;
  document: string | null;
  document_date: string | null;
  shipment_id: string | null;
  cash: number;
  tds: number;
  settled: number;
}

/**
 * Every allocation, one row each — the detail behind a receipt or a payment.
 *
 * This is the reference system's "Receipt Details Report" and "Payment Details
 * Report", which are the same query pointed at two directions.
 */
export async function settlementDetail(direction: "in" | "out"): Promise<SettlementLine[]> {
  const { data, error } = await supabase
    .from("payment_allocations")
    .select(
      "amount, tds_amount, invoices(number, invoice_date, shipment_id), bills(bill_no, bill_date, shipment_id), payments!inner(number, payment_date, direction, status, mode, instrument_no, customers(name, company), partners(name, organisation))"
    )
    .eq("payments.direction", direction)
    .eq("payments.status", "confirmed");
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const row = r as unknown as {
      amount: number;
      tds_amount: number;
      invoices?: { number: string | null; invoice_date: string; shipment_id: string | null } | null;
      bills?: { bill_no: string; bill_date: string; shipment_id: string | null } | null;
      payments: {
        number: string | null;
        payment_date: string;
        mode: string;
        instrument_no: string;
        customers?: { name?: string; company?: string } | null;
        partners?: { name?: string; organisation?: string } | null;
      };
    };
    const p = row.payments;
    return {
      payment_number: p.number,
      payment_date: p.payment_date,
      party:
        p.customers?.company ||
        p.customers?.name ||
        p.partners?.organisation ||
        p.partners?.name ||
        null,
      mode: p.mode.replace(/_/g, " "),
      instrument: p.instrument_no,
      document: row.invoices?.number ?? row.bills?.bill_no ?? null,
      document_date: row.invoices?.invoice_date ?? row.bills?.bill_date ?? null,
      shipment_id: row.invoices?.shipment_id ?? row.bills?.shipment_id ?? null,
      cash: Number(row.amount),
      tds: Number(row.tds_amount),
      settled: Number(row.amount) + Number(row.tds_amount),
    };
  });
}

export interface FinalBillRow {
  shipment_id: string;
  enquiry_ref: string | null;
  customer_id: string;
  stage: string;
  billed_inr: number;
  collected_inr: number;
  cost_inr: number;
  paid_out_inr: number;
  open_drafts: number;
  unpaid_bills: number;
  disputed_bills: number;
  customer_label?: string | null;
}

/** Where every job stands: billed, collected, cost, paid, and what is left. */
export async function finalBills(): Promise<FinalBillRow[]> {
  const [{ data, error }, { data: custs }] = await Promise.all([
    supabase.from("job_final_bill").select("*"),
    supabase.from("customers").select("id, name, company"),
  ]);
  if (error) throw new Error(error.message);

  const names = new Map(
    (custs ?? []).map((c) => {
      const r = c as { id: string; name: string; company: string };
      return [r.id, r.company || r.name];
    })
  );

  return ((data ?? []) as FinalBillRow[]).map((r) => ({
    ...r,
    customer_label: names.get(r.customer_id) ?? null,
  }));
}

export interface AgentStatement {
  id: string;
  statement_no: string | null;
  partner_id: string;
  period_from: string;
  period_to: string;
  statement_date: string;
  remittance_date: string | null;
  status: string;
  currency: string;
  due_to_us: number;
  due_to_them: number;
  net_inr: number;
  remarks: string;
  partner_label?: string | null;
}

export async function listStatements(): Promise<AgentStatement[]> {
  const { data, error } = await supabase
    .from("agent_statements")
    .select("*, partners(name, organisation)")
    .order("period_to", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const { partners, ...rest } = r as Record<string, unknown> & {
      partners?: { name?: string; organisation?: string } | null;
    };
    return {
      ...(rest as unknown as AgentStatement),
      partner_label: partners?.organisation || partners?.name || null,
    };
  });
}

export async function buildStatement(
  partnerId: string,
  from: string,
  to: string
): Promise<AgentStatement> {
  const { data, error } = await supabase.rpc("build_agent_statement", {
    p_partner: partnerId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return data as AgentStatement;
}

export async function updateStatement(
  id: string,
  patch: Partial<AgentStatement>
): Promise<void> {
  const { error } = await supabase
    .from("agent_statements")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface StatementLine {
  id: string;
  invoice_id: string | null;
  bill_id: string | null;
  amount_inr: number;
  document?: string | null;
  document_date?: string | null;
}

export async function statementLines(statementId: string): Promise<StatementLine[]> {
  const { data, error } = await supabase
    .from("statement_lines")
    .select("*, invoices(number, invoice_date), bills(bill_no, bill_date)")
    .eq("statement_id", statementId);
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const row = r as unknown as StatementLine & {
      invoices?: { number: string | null; invoice_date: string } | null;
      bills?: { bill_no: string; bill_date: string } | null;
    };
    return {
      id: row.id,
      invoice_id: row.invoice_id,
      bill_id: row.bill_id,
      amount_inr: Number(row.amount_inr),
      document: row.invoices?.number ?? row.bills?.bill_no ?? null,
      document_date: row.invoices?.invoice_date ?? row.bills?.bill_date ?? null,
    };
  });
}
