import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, RefreshCw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import MetricCard from "../components/MetricCard";
import EmptyState from "../components/EmptyState";
import {
  arrivedAt,
  listEnquiries,
  listShipments,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
  type EnquiryStatus,
  type Shipment,
} from "../services/enquiries";

/**
 * What the desk did, counted.
 *
 * ---------------------------------------------------------------------------
 * NO FIGURE HERE WAS DECIDED IN ADVANCE
 *
 * An earlier version read four KPIs and a calls-per-week array out of a mock
 * module. All of them were null or empty, so it rendered four dashes and a bar
 * chart whose tallest bar was computed as `Math.max(...[])` — negative
 * infinity, which made every bar height NaN. The chart drew nothing and said
 * nothing about it.
 *
 * Every number below is derived from rows that were fetched. Conversion is
 * accepted over quoted, a ratio the desk can check by counting the enquiries
 * itself. Where a denominator is zero the figure is a dash rather than zero
 * percent, because no quotes sent is not the same as no quotes accepted.
 *
 * The call figures that used to sit here went with the voice desk. What
 * replaced them is the one measurement this desk now has that it did not
 * before: how long an enquiry waits on the shared board before somebody takes
 * it on.
 * ---------------------------------------------------------------------------
 */

type Row = Enquiry & { customer: Customer | null };

const SOURCE_LABEL: Record<string, string> = {
  call: "Voice",
  email: "Email",
  whatsapp: "WhatsApp",
  web: "Website form",
  manual: "Entered by hand",
};

/** The Monday of the week a date falls in, so rows bucket by week reliably. */
function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** Minutes, said the way a person would say them. */
function spell(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`;
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(hrs < 10 ? 1 : 0)} hr`;
  return `${Math.round(hrs / 24)} d`;
}

export default function Analytics() {
  const [enquiries, setEnquiries] = useState<Row[]>([]);
  const [shipments, setShipments] = useState<Array<Shipment & { customer: Customer | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s] = await Promise.all([listEnquiries(), listShipments()]);
      setEnquiries(e);
      setShipments(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load figures.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const quoted = enquiries.filter((e) => e.status === "quoted" || e.status === "accepted").length;
    const accepted = enquiries.filter((e) => e.status === "accepted").length;
    const unclaimed = enquiries.filter((e) => !e.assigned_to).length;

    // The median, not the mean. One enquiry that sat over a weekend drags an
    // average somewhere no actual enquiry has ever been.
    const waits = enquiries
      .filter((e) => e.assigned_at)
      .map((e) => (new Date(e.assigned_at!).getTime() - new Date(arrivedAt(e)).getTime()) / 60000)
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);

    return {
      enquiries: enquiries.length,
      conversion: quoted ? Math.round((accepted / quoted) * 100) : null,
      unclaimed,
      pickup: waits.length ? waits[Math.floor(waits.length / 2)] : null,
      booked: shipments.reduce((s, x) => s + (x.agreed_inr ?? 0), 0),
    };
  }, [enquiries, shipments]);

  /** Enquiries opened in each of the last eight weeks, oldest first. */
  const weeks = useMemo(() => {
    const buckets = new Map<string, number>();
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      buckets.set(weekStart(d.toISOString()), 0);
    }
    for (const e of enquiries) {
      // Bucketed by when it arrived, not when the row was made, so a backlog
      // cleared on one afternoon does not all land in that afternoon's column.
      const k = weekStart(arrivedAt(e));
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([start, count]) => ({ start, count }));
  }, [enquiries]);

  const maxWeek = Math.max(...weeks.map((w) => w.count), 1);

  const bySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enquiries) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [enquiries]);

  const byStatus = useMemo(() => {
    const counts = new Map<EnquiryStatus, number>();
    for (const e of enquiries) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [enquiries]);

  const nothing = !loading && !enquiries.length;

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Counted from the desk's own tables. A dash means nothing has been recorded, which is not the same as zero."
        action={
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Enquiries" value={stats.enquiries} hint="All time" />
        <MetricCard
          label="Quote → acceptance"
          value={stats.conversion === null ? null : `${stats.conversion}%`}
          hint="Accepted as a share of quoted"
        />
        <MetricCard
          label="Typical pick-up"
          value={stats.pickup === null ? null : spell(stats.pickup)}
          hint="Median wait before somebody takes one on"
        />
        <MetricCard
          label="Unclaimed now"
          value={stats.unclaimed}
          to="/enquiries"
          hint="Still on the shared board"
        />
      </div>

      {nothing ? (
        <EmptyState
          icon={BarChart3}
          title="Nothing to count yet"
          hint="Figures appear as soon as the desk opens its first enquiry. There are no illustrative numbers here."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="card p-4">
            <p className="text-[13px] font-medium text-text-primary mb-1">Enquiries per week</p>
            <p className="text-[11px] text-text-muted mb-4">Last eight weeks, by the day they arrived</p>
            <div className="flex items-end gap-1.5 sm:gap-3 h-32">
              {weeks.map((w) => (
                <div key={w.start} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <span className="text-[11px] text-text-secondary tabular-nums">
                    {w.count || ""}
                  </span>
                  <div
                    className="w-full rounded-t bg-brand/80 min-h-[2px] transition-[height] duration-300"
                    style={{ height: `${Math.max(2, (w.count / maxWeek) * 100)}%` }}
                    title={`Week of ${w.start}: ${w.count} enquir${w.count === 1 ? "y" : "ies"}`}
                  />
                  <span className="text-[10px] text-text-muted truncate w-full text-center">
                    {w.start.slice(8)}/{w.start.slice(5, 7)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-4">
            <p className="text-[13px] font-medium text-text-primary mb-4">
              Where enquiries came from
            </p>
            {!bySource.length ? (
              <p className="text-[12px] text-text-muted">No enquiries yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {bySource.map(([source, count]) => (
                  <div key={source} className="flex items-center gap-3">
                    <span className="text-[12px] text-text-secondary w-24 shrink-0 truncate">
                      {SOURCE_LABEL[source] ?? source}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className="h-full bg-brand transition-[width] duration-300"
                        style={{ width: `${(count / enquiries.length) * 100}%` }}
                      />
                    </div>
                    <span className="text-[12px] text-text-secondary w-6 text-right tabular-nums">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[13px] font-medium text-text-primary mt-6 mb-4">
              Where enquiries stand
            </p>
            {!byStatus.length ? (
              <p className="text-[12px] text-text-muted">No enquiries yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {byStatus.map(([status, count]) => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-[12px] text-text-secondary w-24 shrink-0 truncate">
                      {STATUS_LABEL[status]}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className="h-full bg-text-accent transition-[width] duration-300"
                        style={{ width: `${(count / enquiries.length) * 100}%` }}
                      />
                    </div>
                    <span className="text-[12px] text-text-secondary w-6 text-right tabular-nums">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
