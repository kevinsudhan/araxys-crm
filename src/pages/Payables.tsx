import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Download, Receipt } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { money } from "../services/billing";
import {
  KIND_LABEL,
  STATUS_LABEL,
  listBills,
  partnerBalances,
  type Bill,
  type PartnerBalance,
} from "../services/bills";
import { downloadWorkbook, stamped, type Sheet } from "../lib/xlsx";

/**
 * What we owe, and to whom.
 *
 * ---------------------------------------------------------------------------
 * ONE PAGE, NOT THREE
 *
 * The reference system has Payables Report, Payment Details Report and Overseas
 * Agent SOA as three entries over the same rows. The questions are "what is
 * outstanding", "who is it with" and "what has it cost us" — one table read
 * three ways, so it is one page with the balances underneath it.
 *
 * DISPUTED IS NOT OVERDUE
 *
 * A bill we are refusing to pay is counted apart from bills we simply have not
 * paid. Treating a dispute as overdue tells the desk off for a decision it made
 * deliberately, and after a week of that nobody reads the number at all.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "warning" | "success" | "danger" | "accent"> = {
  draft: "neutral",
  received: "warning",
  part_paid: "accent",
  paid: "success",
  disputed: "danger",
  cancelled: "neutral",
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card min-w-0 flex-1 p-4">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">{value}</p>
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

const asDate = (s: string | null) => (s ? new Date(s + "T00:00:00") : null);

export default function Payables() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [balances, setBalances] = useState<PartnerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, p] = await Promise.all([listBills(), partnerBalances()]);
      setBills(b);
      setBalances(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the payables.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const owed = useMemo(
    () => bills.filter((b) => b.status === "received" || b.status === "part_paid"),
    [bills]
  );
  const disputed = useMemo(() => bills.filter((b) => b.status === "disputed"), [bills]);

  /** A credit note from an agent reduces what we owe, so it subtracts. */
  const sum = (rows: Bill[]) =>
    rows.reduce(
      (t, b) => t + (b.kind === "agent_credit_note" ? -1 : 1) * Number(b.total_inr || 0),
      0
    );

  const sheets = (): Sheet[] => [
    {
      name: "Bills",
      columns: [
        { header: "Their number", width: 20 },
        { header: "Date", width: 12 },
        { header: "Due", width: 12 },
        { header: "Vendor", width: 30 },
        { header: "Kind", width: 20 },
        { header: "Status", width: 12 },
        { header: "Shipment", width: 16 },
        { header: "Currency", width: 9 },
        { header: "Charges", width: 14 },
        { header: "Tax", width: 12 },
        { header: "Total", width: 14 },
        { header: "Total (INR)", width: 14 },
        { header: "Reverse charge", width: 13 },
        { header: "Vendor GSTIN", width: 18 },
      ],
      rows: bills.map((b) => [
        b.bill_no,
        asDate(b.bill_date),
        asDate(b.due_date),
        b.partner_label,
        KIND_LABEL[b.kind],
        STATUS_LABEL[b.status],
        b.shipment_id,
        b.currency,
        Number(b.taxable_value),
        Number(b.tax_amount),
        Number(b.total_amount),
        Number(b.total_inr),
        b.reverse_charge,
        b.vendor_gstin,
      ]),
    },
    {
      name: "Costs",
      columns: [
        { header: "Bill", width: 20 },
        { header: "Vendor", width: 30 },
        { header: "Charge", width: 32 },
        { header: "SAC", width: 10 },
        { header: "Qty", width: 8 },
        { header: "Rate", width: 12 },
        { header: "Amount", width: 14 },
        { header: "Tax %", width: 8 },
      ],
      rows: bills.flatMap((b) =>
        (b.lines ?? []).map((l) => [
          b.bill_no,
          b.partner_label,
          l.description,
          l.sac_code,
          Number(l.quantity),
          Number(l.rate),
          Number(l.amount),
          Number(l.tax_rate),
        ])
      ),
    },
    {
      name: "By vendor",
      columns: [
        { header: "Vendor", width: 34 },
        { header: "Billed to us", width: 14 },
        { header: "Settled", width: 14 },
        { header: "Outstanding", width: 14 },
        { header: "Open bills", width: 11 },
        { header: "Disputed", width: 10 },
      ],
      rows: balances.map((p) => [
        p.label,
        Number(p.billed_to_us),
        Number(p.settled),
        Number(p.billed_to_us) - Number(p.settled),
        Number(p.open_bills),
        Number(p.disputed_bills),
      ]),
    },
  ];

  if (loading) return <p className="py-10 text-[13px] text-text-muted">Loading…</p>;

  return (
    <div>
      <PageHeader
        title="Payables"
        subtitle="What the carrier, the overseas agent and everybody else have billed us."
        action={
          <button
            onClick={() => downloadWorkbook(stamped("payables"), sheets())}
            disabled={bills.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <Download size={14} />
            Excel
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-3">
        <Tile
          label="Owed"
          value={money(sum(owed))}
          hint={`${owed.length} bill${owed.length === 1 ? "" : "s"} unpaid`}
        />
        <Tile
          label="Disputed"
          value={money(sum(disputed))}
          hint={disputed.length ? "held, and not counted as overdue" : "nothing in dispute"}
        />
        <Tile
          label="Billed to us"
          value={money(balances.reduce((t, p) => t + Number(p.billed_to_us), 0))}
          hint="across every vendor"
        />
      </div>

      {bills.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills recorded"
          hint="Costs are recorded against the job they belong to — open a shipment and use its Costs section. Until they are, margin cannot be known."
        />
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {bills.map((b) => (
            <Link
              key={b.id}
              to={b.shipment_id ? `/shipments/${b.shipment_id}/costs` : "/payables"}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <span className="font-mono text-[12px] font-medium text-text-primary">
                {b.bill_no}
              </span>
              <StatusPill tone={TONE[b.status]}>{STATUS_LABEL[b.status]}</StatusPill>
              {b.reverse_charge && <StatusPill tone="accent">Reverse charge</StatusPill>}
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                {b.partner_label ?? "—"}
              </span>
              <span className="text-[12px] text-text-muted">{KIND_LABEL[b.kind]}</span>
              <span className="font-mono text-[11px] text-text-muted">{b.shipment_id}</span>
              <span className="w-28 text-right text-[13px] font-medium tabular-nums text-text-primary">
                {money(b.total_amount, b.currency)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {balances.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Where each vendor stands
          </h2>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                  <th className="px-4 py-2 font-medium">Vendor</th>
                  <th className="px-4 py-2 text-right font-medium">Billed to us</th>
                  <th className="px-4 py-2 text-right font-medium">Settled</th>
                  <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-2 text-right font-medium">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {balances.map((p) => {
                  const out = Number(p.billed_to_us) - Number(p.settled);
                  return (
                    <tr key={p.partner_id}>
                      <td className="px-4 py-2 text-text-primary">{p.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                        {money(Number(p.billed_to_us))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                        {money(Number(p.settled))}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          out > 0.005 ? "text-text-warning" : "text-text-muted"
                        }`}
                      >
                        {money(out)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                        {p.open_bills}
                        {p.disputed_bills > 0 && (
                          <span className="ml-1 text-text-danger">
                            +{p.disputed_bills} disputed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
