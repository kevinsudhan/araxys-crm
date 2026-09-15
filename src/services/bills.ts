import { supabase } from "../lib/supabase";

/**
 * What the carrier, the overseas agent and everybody else bill us.
 *
 * ---------------------------------------------------------------------------
 * WHY A BILL IS NOT AN INVOICE POINTED THE OTHER WAY
 *
 * Our invoice number is ours, allocated from a locked series, gapless because
 * the law requires it. A bill carries THEIR number, typed as it appears on
 * their document.
 *
 * Our invoice is immutable once issued because somebody has it. A bill is a
 * claim against us that we can dispute, part-pay or reject.
 *
 * The tax runs the other way. Output tax on our invoice is what we owe; input
 * tax on a bill is what we reclaim — and on a service bought from an overseas
 * agent there is none on the document at all, because we pay it ourselves under
 * reverse charge.
 * ---------------------------------------------------------------------------
 */

export type BillKind =
  | "carrier_invoice"
  | "agent_debit_note"
  | "agent_credit_note"
  | "vendor_invoice";

export type BillStatus =
  | "draft"
  | "received"
  | "part_paid"
  | "paid"
  | "disputed"
  | "cancelled";

export const KIND_LABEL: Record<BillKind, string> = {
  carrier_invoice: "Carrier invoice",
  agent_debit_note: "Agent debit note",
  agent_credit_note: "Agent credit note",
  vendor_invoice: "Vendor invoice",
};

export const KIND_HINT: Record<BillKind, string> = {
  carrier_invoice: "The line's own charges — freight, THC",
  agent_debit_note: "The overseas agent billing us their half of the job",
  agent_credit_note: "The agent crediting something back, so it reduces what we owe",
  vendor_invoice: "Transport, CFS, the CHA, anybody else",
};

export const STATUS_LABEL: Record<BillStatus, string> = {
  draft: "Draft",
  received: "Owed",
  part_paid: "Part paid",
  paid: "Paid",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

/** What the desk buys, with the SAC each usually arrives under. */
export const COST_HEADS: { label: string; sac: string; unit: string }[] = [
  { label: "Ocean freight", sac: "996521", unit: "Container" },
  { label: "Terminal handling (origin)", sac: "996719", unit: "Container" },
  { label: "Terminal handling (destination)", sac: "996719", unit: "Container" },
  { label: "Destination handling / agent fee", sac: "996799", unit: "B/L" },
  { label: "Bill of lading fee", sac: "996799", unit: "B/L" },
  { label: "CFS / stuffing charges", sac: "996719", unit: "Container" },
  { label: "Inland haulage", sac: "996511", unit: "Trip" },
  { label: "Customs clearance", sac: "996799", unit: "Shipment" },
  { label: "Detention & demurrage", sac: "996719", unit: "Container" },
  { label: "Other charges", sac: "996799", unit: "Lumpsum" },
];

export interface BillLine {
  id: string;
  bill_id: string;
  position: number;
  description: string;
  sac_code: string | null;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  tax_rate: number;
  created_at: string;
}

export interface Bill {
  id: string;
  bill_no: string;
  bill_date: string;
  received_at: string;
  due_date: string | null;
  kind: BillKind;
  status: BillStatus;

  partner_id: string;
  shipment_id: string | null;
  console_id: string | null;

  currency: string;
  exchange_rate: number;

  taxable_value: number;
  tax_amount: number;
  total_amount: number;
  total_inr: number;

  reverse_charge: boolean;
  vendor_gstin: string | null;
  remarks: string;
  disputed_reason: string | null;

  created_at: string;
  updated_at: string;

  lines?: BillLine[];
  partner_label?: string | null;
}

const SELECT = "*, lines:bill_lines(*), partners(name, organisation)";

const shape = (row: unknown): Bill => {
  const { partners, ...rest } = row as Record<string, unknown> & {
    partners?: { name?: string; organisation?: string } | null;
  };
  const b = rest as unknown as Bill;
  return {
    ...b,
    partner_label: partners?.organisation || partners?.name || null,
    lines: [...(b.lines ?? [])].sort((a, c) => a.position - c.position),
  };
};

export async function listBills(opts?: {
  shipmentId?: string;
  consoleId?: string;
  partnerId?: string;
}): Promise<Bill[]> {
  let q = supabase
    .from("bills")
    .select(SELECT)
    .order("bill_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (opts?.shipmentId) q = q.eq("shipment_id", opts.shipmentId);
  if (opts?.consoleId) q = q.eq("console_id", opts.consoleId);
  if (opts?.partnerId) q = q.eq("partner_id", opts.partnerId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(shape);
}

export async function getBill(id: string): Promise<Bill | null> {
  const { data, error } = await supabase.from("bills").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? shape(data) : null;
}

/**
 * Record one.
 *
 * `bill_no` is theirs and there is nothing to allocate. The database refuses
 * the same number twice for the same vendor, which is the guard against the
 * classic accounts-payable error: paying a bill twice because it was entered
 * twice.
 */
export async function recordBill(input: {
  bill_no: string;
  partner_id: string;
  kind?: BillKind;
  shipment_id?: string | null;
  console_id?: string | null;
  currency?: string;
  reverse_charge?: boolean;
}): Promise<Bill> {
  const { data, error } = await supabase.from("bills").insert(input).select(SELECT).single();
  if (error) {
    // The unique index is the real message; the raw one names an index nobody
    // has heard of.
    if (error.code === "23505") {
      throw new Error(`A bill numbered ${input.bill_no} is already recorded for that vendor.`);
    }
    throw new Error(error.message);
  }
  return shape(data);
}

export async function updateBill(id: string, patch: Partial<Bill>): Promise<Bill> {
  const { data, error } = await supabase
    .from("bills")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return shape(data);
}

export async function addBillLine(
  billId: string,
  line: Partial<Omit<BillLine, "id" | "bill_id" | "amount" | "created_at">>
): Promise<void> {
  const { error } = await supabase.from("bill_lines").insert({ bill_id: billId, ...line });
  if (error) throw new Error(error.message);
}

export async function updateBillLine(
  id: string,
  patch: Partial<Omit<BillLine, "id" | "bill_id" | "amount" | "created_at">>
): Promise<void> {
  const { error } = await supabase.from("bill_lines").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeBillLine(id: string): Promise<void> {
  const { error } = await supabase.from("bill_lines").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface Margin {
  shipment_id: string;
  console_id: string | null;
  revenue_inr: number;
  cost_inr: number;
}

export async function shipmentMargin(shipmentId: string): Promise<Margin | null> {
  const { data, error } = await supabase
    .from("shipment_margin")
    .select("*")
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Margin) ?? null;
}

export interface PartnerBalance {
  partner_id: string;
  label: string;
  billed_to_us: number;
  settled: number;
  open_bills: number;
  disputed_bills: number;
}

export async function partnerBalances(): Promise<PartnerBalance[]> {
  const { data, error } = await supabase
    .from("partner_balances")
    .select("*")
    .order("billed_to_us", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PartnerBalance[]).filter(
    (p) => Number(p.billed_to_us) > 0 || Number(p.open_bills) > 0
  );
}

export interface ConsoleMargin {
  console_id: string;
  console_no: string | null;
  revenue_inr: number;
  cost_inr: number;
}

export async function consoleMargins(): Promise<ConsoleMargin[]> {
  const { data, error } = await supabase.from("console_margin").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as ConsoleMargin[];
}

/**
 * Margin as a percentage of revenue.
 *
 * Of revenue, not of cost. A consolidator quotes a sell rate and lives on what
 * is left of it, so "we kept 18% of what the shipper paid" is the sentence the
 * number is standing in for. Null when nothing has been billed — a percentage
 * of zero revenue is not 100%, it is not a number.
 */
export function marginPct(revenue: number, cost: number): number | null {
  if (!revenue) return null;
  return Math.round(((revenue - cost) / revenue) * 1000) / 10;
}
