import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, RefreshCw, Truck } from "lucide-react";
import PageHeader from "../components/PageHeader";
import {
  listShipments,
  SHIPMENT_STAGES,
  SHIPMENT_STAGE_LABEL,
  type Customer,
  type Shipment,
  type ShipmentStage,
} from "../services/enquiries";

/** Everything before delivery. Delivered shipments live on the completed page. */
const IN_PROCESS: ShipmentStage[] = SHIPMENT_STAGES.filter((s) => s !== "delivered");

export default function ShipmentsInProcess() {
  const [rows, setRows] = useState<Array<Shipment & { customer: Customer | null }>>([]);
  const [filter, setFilter] = useState<ShipmentStage | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listShipments(IN_PROCESS));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load shipments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of IN_PROCESS) c[s] = rows.filter((r) => r.stage === s).length;
    return c;
  }, [rows]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.stage === filter);

  return (
    <div>
      <PageHeader
        title="In-process shipments"
        subtitle="Bookings from acceptance through to delivery. Each one began as an enquiry the customer said yes to."
      />

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="opacity-60">{counts.all}</span>
        </Chip>
        {IN_PROCESS.filter((s) => counts[s] > 0).map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {SHIPMENT_STAGE_LABEL[s]} <span className="opacity-60">{counts[s]}</span>
          </Chip>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <p className="text-[13px] text-text-muted py-8">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Truck size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No shipments in process</p>
          <p className="mt-1 text-[13px] text-text-secondary max-w-md mx-auto">
            A shipment appears here when an accepted enquiry is pushed through from its case file.
          </p>
          <Link
            to="/enquiries"
            className="mt-4 inline-flex h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium items-center"
          >
            Go to enquiries
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((s) => (
            <Link
              key={s.id}
              to={`/enquiries/${s.enquiry_ref}`}
              className="block rounded-card border border-border bg-surface-1 p-4 hover:border-border-strong transition-colors"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-[12px] text-text-accent">{s.id}</p>
                    {s.bl_number && (
                      <span className="font-mono text-[11px] text-text-muted">{s.bl_number}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[14px] font-medium text-text-primary">
                    {s.customer?.company || s.customer?.name || "—"}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {[s.origin, s.destination].filter(Boolean).join(" → ")}
                    {s.cargo ? ` · ${s.cargo}` : ""}
                    {s.volume_cbm ? ` · ${s.volume_cbm} CBM` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] font-medium text-text-accent">
                    {SHIPMENT_STAGE_LABEL[s.stage]}
                  </span>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {s.sailing_date ? `Sailing ${s.sailing_date}` : "No sailing date"}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}
