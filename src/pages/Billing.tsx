import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Download, Loader2, PackageSearch, Receipt } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { invoiceSheets } from "../lib/exports";
import { downloadWorkbook, stamped } from "../lib/xlsx";
import {
  KIND_LABEL,
  STATUS_LABEL,
  daysOverdue,
  listInvoices,
  money,
  unbilledShipments,
  type Invoice,
  type InvoiceStatus,
} from "../services/billing";

/**
 * The invoice register.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE EXISTS SEPARATELY FROM THE JOB
 *
 * Raising an invoice happens on the shipment, because an invoice is about a
 * job and asking somebody to retype the job's own reference on a separate
 * screen is the defect this product is being built against.
 *
 * But three questions cannot be answered from inside one job, because the
 * answer *is* the set of them: what is outstanding, what is overdue, and which
 * shipments were never billed at all. The last one is the expensive one — a job
 * that sailed, arrived and was delivered with no invoice against it is invisible
 * from its own page, where everything looks finished.
 *
 * So: work on the job, questions here, and every row is a link back to the job.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  issued: "accent",
  part_paid: "warning",
  paid: "success",
  cancelled: "danger",
};

type Filter = "open" | "draft" | "overdue" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Outstanding" },
  { key: "overdue", label: "Overdue" },
  { key: "draft", label: "Drafts" },
  { key: "all", label: "Everything" },
];

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card min-w-0 flex-1 p-4">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">{value}</p>
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

export default function Billing() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [unbilled, setUnbilled] = useState<
    { id: string; customer: string | null; stage: string; agreed_inr: number | null }[]
  >([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [inv, un] = await Promise.all([listInvoices(), unbilledShipments()]);
      setInvoices(inv);
      setUnbilled(un);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the register.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useMemo(
    () => invoices.filter((i) => i.status === "issued" || i.status === "part_paid"),
    [invoices]
  );
  const overdue = useMemo(() => open.filter((i) => (daysOverdue(i) ?? -1) > 0), [open]);
  const drafts = useMemo(() => invoices.filter((i) => i.status === "draft"), [invoices]);

  const shown = useMemo(() => {
    switch (filter) {
      case "open":
        return open;
      case "overdue":
        return overdue;
      case "draft":
        return drafts;
      default:
        return invoices;
    }
  }, [filter, invoices, open, overdue, drafts]);

  const sum = (rows: Invoice[]) => rows.reduce((t, i) => t + Number(i.total_inr || 0), 0);

  if (loading) return <p className="py-10 text-[13px] text-text-muted">Loading…</p>;

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Everything billed across the desk. Raising one happens on the shipment — this is where you see what is owed."
        action={
          <button
            onClick={() => {
              setExporting(true);
              setError(null);
              // Re-fetched with the charge lines, which the screen does not
              // need and a pivot table does.
              listInvoices({ withLines: true })
                .then((all) => downloadWorkbook(stamped("invoices"), invoiceSheets(all)))
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : "Could not build the spreadsheet.")
                )
                .finally(() => setExporting(false));
            }}
            disabled={exporting || invoices.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={14} />}
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
          label="Outstanding"
          value={money(sum(open))}
          hint={`${open.length} invoice${open.length === 1 ? "" : "s"} unpaid`}
        />
        <Tile
          label="Overdue"
          value={money(sum(overdue))}
          hint={overdue.length ? `${overdue.length} past its due date` : "Nothing past due"}
        />
        <Tile
          label="In draft"
          value={money(sum(drafts))}
          hint={drafts.length ? `${drafts.length} not yet issued` : "No drafts open"}
        />
        <Tile
          label="Never billed"
          value={String(unbilled.length)}
          hint={unbilled.length ? "shipments with nothing raised" : "every shipment has an invoice"}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`h-8 rounded-lg px-3 text-[12px] transition-colors ${
              filter === f.key
                ? "bg-brand font-medium text-white"
                : "border border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={
            filter === "all" ? "No invoices yet" : `Nothing ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}`
          }
          hint={
            filter === "all"
              ? "Open a shipment and raise one. The customer, the B/L, the tonnage and the agreed amount come across from the booking."
              : "Try another filter."
          }
        />
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {shown.map((inv) => {
            const over = daysOverdue(inv);
            return (
              <Link
                key={inv.id}
                to={`/shipments/${inv.shipment_id}/invoices`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="font-mono text-[12px] font-medium text-text-primary">
                  {inv.number ?? "Draft"}
                </span>
                <StatusPill tone={TONE[inv.status]}>{STATUS_LABEL[inv.status]}</StatusPill>
                {inv.kind !== "tax_invoice" && (
                  <StatusPill tone="neutral">{KIND_LABEL[inv.kind]}</StatusPill>
                )}
                {over !== null && over > 0 && (
                  <StatusPill tone="danger">{over} days overdue</StatusPill>
                )}

                <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                  {inv.customer_label ?? inv.bill_to_name ?? "—"}
                </span>

                <span className="font-mono text-[11px] text-text-muted">{inv.shipment_id}</span>
                <span className="text-[12px] text-text-muted">
                  {new Date(inv.invoice_date + "T00:00:00").toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="w-28 text-right text-[13px] font-medium tabular-nums text-text-primary">
                  {money(inv.total_amount, inv.currency)}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* ---- the expensive question ---- */}
      {unbilled.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Shipments with nothing billed
          </h2>
          <div className="card divide-y divide-border overflow-hidden">
            {unbilled.map((s) => (
              <Link
                key={s.id}
                to={`/shipments/${s.id}/invoices`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
              >
                <PackageSearch size={14} className="shrink-0 text-text-muted" />
                <span className="font-mono text-[12px] text-text-accent">{s.id}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                  {s.customer ?? "—"}
                </span>
                <span className="text-[12px] text-text-secondary">
                  {s.stage.replace(/_/g, " ")}
                </span>
                <span className="w-28 text-right text-[12px] tabular-nums text-text-muted">
                  {s.agreed_inr === null ? "no agreed amount" : money(s.agreed_inr)}
                </span>
                <ArrowRight size={13} className="shrink-0 text-text-muted" />
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            Each of these has an agreed amount and no invoice against it. The figure shown is what
            was quoted, not what is owed — nothing is owed until an invoice is issued.
          </p>
        </section>
      )}
    </div>
  );
}
