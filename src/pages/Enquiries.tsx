import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, Inbox, Loader2, Plus, RefreshCw, Search, Truck } from "lucide-react";
import PageHeader from "../components/PageHeader";
import NewEnquiry from "../components/NewEnquiry";
import { useAuth } from "../lib/auth";
import {
  listEnquiries,
  listShipments,
  promoteToShipment,
  unfiledMail,
  STATUS_LABEL,
  INBOUND_STATUSES,
  type Customer,
  type Enquiry,
  type EnquiryStatus,
  type Shipment,
} from "../services/enquiries";
import { mailIsLive, type MailMessage } from "../services/backend";

type Row = Enquiry & { customer: Customer | null };

const STATUS_TONE: Record<EnquiryStatus, string> = {
  new: "bg-bg-accent text-text-accent",
  qualifying: "bg-bg-accent text-text-accent",
  quoted: "bg-bg-warning text-text-warning",
  accepted: "bg-bg-success text-text-success",
  declined: "bg-surface-2 text-text-secondary",
  lost: "bg-surface-2 text-text-muted",
};

/**
 * The inbound pipeline.
 *
 * Everything here is real: an enquiry exists because somebody opened one from
 * an email or entered it by hand. There are no sample rows, so an empty desk
 * looks empty -- which is the honest thing for it to look like.
 */
export default function Enquiries() {
  const { session } = useAuth();
  const mailbox = session?.email ?? "";

  const [rows, setRows] = useState<Row[]>([]);
  const [unfiled, setUnfiled] = useState<MailMessage[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EnquiryStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | { from?: MailMessage }>(null);
  /** Which enquiries already have a shipment, so the row shows the right thing. */
  const [shipped, setShipped] = useState<Map<string, Shipment>>(new Map());
  const [pushing, setPushing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, ships] = await Promise.all([listEnquiries(), listShipments()]);
      setRows(list);
      setShipped(new Map(ships.map((s) => [s.enquiry_ref, s])));
      // Triage only makes sense once a mailbox is connected.
      setUnfiled(mailIsLive() ? await unfiledMail(mailbox) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load enquiries.");
    } finally {
      setLoading(false);
    }
  }, [mailbox]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((r) => filter === "all" || r.status === filter)
      .filter((r) =>
        !needle
          ? true
          : [r.ref, r.origin, r.destination, r.cargo, r.customer?.name, r.customer?.company]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [rows, query, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of INBOUND_STATUSES) c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  /**
   * Pushing from the list rather than the case file.
   *
   * The guard is unchanged -- the database refuses without an accepted quote --
   * but somebody working through a morning's enquiries should not have to open
   * each one to move it on.
   */
  async function push(ref: string) {
    setPushing(ref);
    setError(null);
    try {
      await promoteToShipment(ref);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the shipment.");
    } finally {
      setPushing(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Inbound enquiries"
        subtitle="Every enquiry from first contact to the customer's acceptance, under a reference of ours."
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setCreating({})}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
        >
          <Plus size={13} />
          New enquiry
        </button>

        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reference, customer, route, cargo…"
            className="w-full pl-8 h-8"
          />
        </div>

        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="opacity-60">{counts.all}</span>
        </Chip>
        {INBOUND_STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]} <span className="opacity-60">{counts[s] ?? 0}</span>
          </Chip>
        ))}
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
        /**
         * An empty desk looks empty. Seeding sample enquiries would make the
         * pipeline appear busy and teach nobody whether any of it works.
         */
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Inbox size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No enquiries yet</p>
          <p className="mt-1 text-[13px] text-text-secondary max-w-md mx-auto">
            Open one from an email in the triage list below, or create one by hand after a phone
            call. Nothing here is sample data.
          </p>
          <button
            onClick={() => setCreating({})}
            className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium"
          >
            <Plus size={13} />
            New enquiry
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <Link
              key={r.ref}
              to={`/enquiries/${r.ref}`}
              className="block rounded-card border border-border bg-surface-1 p-4 hover:border-border-strong transition-colors"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-mono text-[12px] text-text-accent">{r.ref}</p>
                  <p className="mt-0.5 text-[14px] font-medium text-text-primary">
                    {r.customer?.company || r.customer?.name || "—"}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {[r.origin, r.destination].filter(Boolean).join(" → ") || "Route not captured"}
                    {r.cargo ? ` · ${r.cargo}` : ""}
                    {r.volume_cbm ? ` · ${r.volume_cbm} CBM` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                  <p className="mt-1 text-[11px] text-text-muted capitalize">via {r.source}</p>
                </div>
              </div>

              {/*
                Only on an accepted enquiry, and only when it is not already a
                shipment. A row that offers a button which then errors is worse
                than one that explains why it is not offering it.
              */}
              {r.status === "accepted" && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  {shipped.has(r.ref) ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-text-success">
                      <Truck size={13} />
                      In process as{" "}
                      <span className="font-mono">{shipped.get(r.ref)!.id}</span>
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        // The row is a link; pushing is not navigation.
                        e.preventDefault();
                        e.stopPropagation();
                        void push(r.ref);
                      }}
                      disabled={pushing !== null}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                    >
                      {pushing === r.ref ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Check size={12} />
                      )}
                      Push to in-process shipments
                    </button>
                  )}
                </div>
              )}
            </Link>
          ))}
          {!visible.length && (
            <p className="text-[13px] text-text-muted py-6">Nothing matches that.</p>
          )}
        </div>
      )}

      {/* ---- triage ---- */}
      <section className="mt-8">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
          <AlertCircle size={12} className="text-text-warning" />
          Inbox, not yet on an enquiry
          {unfiled.length > 0 && <span className="text-text-muted">{unfiled.length}</span>}
        </h2>

        {!mailIsLive() ? (
          <p className="text-[12px] text-text-muted">
            Connect Outlook on the Mail page to triage incoming enquiries here.
          </p>
        ) : !unfiled.length ? (
          <p className="text-[12px] text-text-muted">
            Nothing waiting — every message in {mailbox} is either filed or not shipment mail.
          </p>
        ) : (
          <div className="space-y-2">
            {unfiled.map((m) => (
              <div
                key={m.id}
                className="rounded-card border border-border bg-surface-1 p-3 flex items-start gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <span className="text-text-primary">
                      {m.from.emailAddress.name || m.from.emailAddress.address}
                    </span>
                    <span className="truncate">{m.from.emailAddress.address}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-text-primary">{m.subject}</p>
                  <p className="text-[12px] text-text-secondary line-clamp-1">{m.bodyPreview}</p>
                </div>
                <button
                  onClick={() => setCreating({ from: m })}
                  className="shrink-0 h-7 px-2.5 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2"
                >
                  Open enquiry
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {creating && (
        <NewEnquiry
          fromMessage={creating.from}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            void load();
          }}
        />
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
