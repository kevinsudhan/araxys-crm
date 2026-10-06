import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowLeftRight, Download, RefreshCw, Search } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import EnquiryLink from "../../components/EnquiryLink";
import { PageSkeleton } from "../../components/Loading";
import { inr } from "../../components/PnlChart";
import { CREDIT, DEBIT, MonthColumns, PairedBars } from "../../components/DebitCreditCharts";
import { formatDate } from "../../lib/dates";
import { todayIST } from "../../lib/progress";
import { useCachedState } from "../../lib/useCachedState";
import { useTablesChanges } from "../../lib/useTableChanges";
import { downloadWorkbook, stamped } from "../../lib/xlsx";
import {
  byJob,
  byMonth,
  byParty,
  DOC_LABEL,
  monthLabel,
  PERIOD_LABEL,
  periodDays,
  standing,
  totals,
  within,
  type DcDoc,
  type Group,
  type PeriodKey,
  type Totals,
} from "../../lib/debitCredit";
import { loadDebitCredit, type DcData } from "../../services/debitCredit";

/**
 * Debit and credit, per shipment and per party (7 Oct).
 *
 * ---------------------------------------------------------------------------
 * What each shipment and each party is worth both ways, in plain words:
 *
 *   Debit    what we billed them — they owe us
 *   Credit   what they billed us — we owe them
 *
 * with what is still to collect and still to pay. The rules are the final
 * bill's (lib/debitCredit.ts): issued invoices and notes, every bill not
 * cancelled, rupees with GST.
 *
 * The page: the period's totals, debit and credit month by month, the biggest
 * shipments and parties as bars, and every one in a table. A shipment opens
 * to the parties on it and its documents; a party opens to its shipments and
 * documents (`?job=` / `?party=` in the address, so Back works and a link
 * opens on them). The period and the search narrow everything.
 * ---------------------------------------------------------------------------
 */

const PERIODS: PeriodKey[] = ["month", "3m", "fy", "all"];
const day = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });

export default function DebitCredit() {
  const [params, setParams] = useSearchParams();
  const [data, setData, dataKnown] = useCachedState<DcData | null>("debitcredit:data", null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("fy");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"jobs" | "parties">("jobs");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadDebitCredit());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load debit and credit.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // An invoice issued or a bill entered by anybody shows as it happens (084).
  useTablesChanges(
    [
      ["invoices", null],
      ["bills", null],
    ],
    () => void load()
  );

  const range = useMemo(() => periodDays(period, todayIST()), [period]);
  const jobOf = useMemo(() => new Map((data?.jobs ?? []).map((j) => [j.id, j])), [data]);
  const consoleNo = useCallback((id: string) => data?.consoleNo[id] ?? null, [data]);

  // The period and the search, on the documents: every figure below follows them.
  const needle = query.trim().toLowerCase();
  const docs = useMemo(
    () =>
      (data?.docs ?? []).filter((d) => {
        if (!within(d, range)) return false;
        if (!needle) return true;
        const job = d.shipmentId ? jobOf.get(d.shipmentId) : undefined;
        return [d.partyName, d.number, job?.ref, job?.customer, d.consoleId ? consoleNo(d.consoleId) : null].some((v) => (v ?? "").toLowerCase().includes(needle));
      }),
    [data, range, needle, jobOf, consoleNo]
  );

  const sum = useMemo(() => totals(docs), [docs]);
  const jobs = useMemo(() => byJob(data?.jobs ?? [], docs, consoleNo), [data, docs, consoleNo]);
  const parties = useMemo(() => byParty(docs), [docs]);
  const months = useMemo(
    () => byMonth(docs, range.from, range.to).map((m) => ({ key: m.month, label: monthLabel(m.month), debit: m.debit, credit: m.credit })),
    [docs, range]
  );

  const pickedJob = params.get("job");
  const pickedParty = params.get("party");
  const open = (key: "job" | "party", value: string | null) =>
    setParams((p) => {
      p.delete("job");
      p.delete("party");
      if (value) p.set(key, value);
      return p;
    });
  useEffect(() => {
    if (pickedJob || pickedParty) window.scrollTo({ top: 0 });
  }, [pickedJob, pickedParty]);

  if (loading && !dataKnown) return <PageSkeleton />;

  const jobGroup = pickedJob ? (jobs.find((g) => g.key === pickedJob) ?? null) : null;
  const partyGroup = pickedParty ? (parties.find((g) => g.key === pickedParty) ?? null) : null;

  const exportBook = () =>
    downloadWorkbook(stamped("debit-credit"), [
      {
        name: "By shipment",
        columns: [
          { header: "Shipment", width: 18 },
          { header: "Customer · route", width: 40 },
          { header: "Debit (₹)", width: 14 },
          { header: "Credit (₹)", width: 14 },
          { header: "Difference (₹)", width: 14 },
          { header: "To collect (₹)", width: 14 },
          { header: "To pay (₹)", width: 14 },
        ],
        rows: jobs.map((g) => [g.label, g.sub, g.debit, g.credit, g.difference, g.toCollect, g.toPay]),
      },
      {
        name: "By party",
        columns: [
          { header: "Party", width: 34 },
          { header: "Type", width: 18 },
          { header: "Debit (₹)", width: 14 },
          { header: "Credit (₹)", width: 14 },
          { header: "To collect (₹)", width: 14 },
          { header: "To pay (₹)", width: 14 },
          { header: "Shipments", width: 10 },
        ],
        rows: parties.map((g) => [g.label, g.sub, g.debit, g.credit, g.toCollect, g.toPay, g.count]),
      },
      {
        name: "Documents",
        columns: [
          { header: "Date", width: 12 },
          { header: "Document", width: 18 },
          { header: "Number", width: 18 },
          { header: "Shipment", width: 16 },
          { header: "Party", width: 32 },
          { header: "Debit (₹)", width: 14 },
          { header: "Credit (₹)", width: 14 },
          { header: "Settled (₹)", width: 14 },
          { header: "Status", width: 12 },
        ],
        rows: docs.map((d) => [
          d.date,
          DOC_LABEL[d.kind] ?? d.kind,
          d.number ?? "",
          d.shipmentId ? (jobOf.get(d.shipmentId)?.ref ?? "") : d.consoleId ? `Console ${consoleNo(d.consoleId) ?? ""}` : "",
          d.partyName,
          d.side === "debit" ? d.amount : "",
          d.side === "credit" ? d.amount : "",
          d.settled,
          d.status,
        ]),
      },
    ]);

  return (
    <div>
      <PageHeader
        title="Debit & credit"
        subtitle="For every shipment and every party: what we billed them (debit), what they billed us (credit), and what is still to settle."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[13px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={exportBook}
              disabled={!docs.length}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <Download size={14} />
              Excel
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- one filter row for everything below ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <Chip key={p} active={period === p} onClick={() => setPeriod(p)}>
              {PERIOD_LABEL[p]}
            </Chip>
          ))}
        </div>
        <label className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Shipment, customer, party, document no.…" className="h-8 w-full pl-8" aria-label="Search" />
        </label>
      </div>

      {!(data?.docs.length ?? 0) ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No debit or credit yet"
          hint="Issued invoices, debit and credit notes, and the bills recorded against shipments and consoles show here, per shipment and per party."
        />
      ) : pickedJob ? (
        <JobView group={jobGroup} jobId={pickedJob} onBack={() => open("job", null)} onParty={(k) => open("party", k)} jobRef={(id) => jobOf.get(id)?.ref ?? null} />
      ) : pickedParty ? (
        <PartyView group={partyGroup} onBack={() => open("party", null)} onJob={(k) => open("job", k)} jobLabel={(d) => jobLabelOf(d, jobOf, consoleNo)} />
      ) : !docs.length ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={needle ? "Nothing matches the search" : `Nothing in ${PERIOD_LABEL[period].toLowerCase()}`}
          hint={needle ? "No document in this period names that shipment, party or number." : "Pick a longer period to see more."}
        />
      ) : (
        <div className="space-y-4">
          <Figures t={sum} />

          {months.length > 1 && (
            <section className="card p-4">
              <h2 className="mb-2 text-[13px] font-semibold text-text-primary">Month by month</h2>
              <MonthColumns rows={months} />
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="card p-4">
              <h2 className="text-[13px] font-semibold text-text-primary">Biggest shipments</h2>
              <p className="mb-2 text-[11.5px] text-text-muted">Press one to see who it is with.</p>
              <PairedBars rows={jobs.slice(0, 8)} onPick={(k) => open("job", k)} />
            </section>
            <section className="card p-4">
              <h2 className="text-[13px] font-semibold text-text-primary">Biggest parties</h2>
              <p className="mb-2 text-[11.5px] text-text-muted">Press one to see its shipments.</p>
              <PairedBars rows={parties.slice(0, 8).map((g) => ({ ...g, sub: `${g.sub} · ${g.count} shipment${g.count === 1 ? "" : "s"}` }))} onPick={(k) => open("party", k)} />
            </section>
          </div>

          {/* ---- every one, the chart's table twin ---- */}
          <section className="card overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold text-text-primary">
                {view === "jobs" ? `Every shipment · ${jobs.length}` : `Every party · ${parties.length}`}
              </h2>
              <div className="inline-flex rounded-lg border border-border bg-surface-1 p-0.5" role="group" aria-label="List">
                {(
                  [
                    ["jobs", "By shipment"],
                    ["parties", "By party"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`h-7 rounded-md px-2.5 text-[12px] transition-colors ${view === v ? "bg-brand text-white" : "text-text-secondary hover:text-text-primary"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <GroupTable
              groups={view === "jobs" ? jobs : parties}
              countLabel={view === "jobs" ? "parties" : "shipments"}
              onPick={(k) => open(view === "jobs" ? "job" : "party", k)}
              partyView={view === "parties"}
            />
          </section>
        </div>
      )}
    </div>
  );
}

const jobLabelOf = (d: DcDoc, jobOf: Map<string, { ref: string | null }>, consoleNo: (id: string) => string | null) =>
  d.shipmentId ? (jobOf.get(d.shipmentId)?.ref ?? "Shipment") : d.consoleId ? `Console ${consoleNo(d.consoleId) ?? ""}`.trim() : "—";

// ---------------------------------------------------------------------------

/** The five figures, in words a desk reads without a legend. */
function Figures({ t, owner }: { t: Totals; owner?: "party" }) {
  const s = standing(t);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      <Tile label="Debit · we billed" value={inr(t.debit)} swatch={DEBIT} />
      <Tile label="Credit · billed to us" value={inr(t.credit)} swatch={CREDIT} />
      {owner === "party" ? (
        <Tile
          label="Where they stand"
          value={s > 0 ? `They owe us ${inr(s)}` : s < 0 ? `We owe them ${inr(-s)}` : "Settled"}
          tone={s > 0 ? "good" : s < 0 ? "warning" : undefined}
        />
      ) : (
        <Tile label="Difference" value={inr(t.difference)} hint="Debit less credit" tone={t.difference < 0 ? "warning" : undefined} />
      )}
      <Tile label="Still to collect" value={inr(t.toCollect)} hint={`${inr(t.received)} received`} />
      <Tile label="Still to pay" value={inr(t.toPay)} hint={`${inr(t.paid)} paid`} />
    </div>
  );
}

function Tile({ label, value, hint, swatch, tone }: { label: string; value: string; hint?: string; swatch?: string; tone?: "good" | "warning" }) {
  return (
    <div className="card px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] text-text-secondary">
        {swatch && <span className="inline-block size-2 rounded-[2px]" style={{ background: swatch }} />}
        {label}
      </p>
      <p className={`mt-0.5 text-[18px] font-semibold leading-tight ${tone === "warning" ? "text-text-warning" : tone === "good" ? "text-text-success" : "text-text-primary"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

/** Every shipment or party: the figures in columns, a press to open one. */
function GroupTable({ groups, countLabel, onPick, partyView }: { groups: Group[]; countLabel: string; onPick: (key: string) => void; partyView?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, 25);
  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] gap-3 border-b border-border bg-surface-2/60 px-4 py-2 text-[11px] font-medium text-text-secondary md:grid">
        <span>{partyView ? "Party" : "Shipment"}</span>
        <span className="text-right">Debit</span>
        <span className="text-right">Credit</span>
        <span className="text-right">{partyView ? "Where they stand" : "Difference"}</span>
        <span className="text-right">To collect</span>
        <span className="text-right">To pay</span>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((g) => {
          const s = standing(g);
          return (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => onPick(g.key)}
                className="grid w-full grid-cols-3 gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 md:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] md:items-center"
              >
                <span className="col-span-3 min-w-0 md:col-span-1">
                  <span className="block truncate text-[13px] font-medium text-text-primary">{g.label}</span>
                  <span className="block truncate text-[11.5px] text-text-muted">
                    {g.sub}
                    {g.sub ? " · " : ""}
                    {g.count} {g.count === 1 ? countLabel.replace(/ies$/, "y").replace(/s$/, "") : countLabel}
                  </span>
                </span>
                <Num label="Debit" value={g.debit} />
                <Num label="Credit" value={g.credit} />
                {partyView ? (
                  <span className="text-right text-[12px]">
                    <span className="block text-[10.5px] text-text-muted md:hidden">Where they stand</span>
                    <span className={s > 0 ? "text-text-success" : s < 0 ? "text-text-warning" : "text-text-muted"}>
                      {s > 0 ? `Owe us ${inr(s)}` : s < 0 ? `We owe ${inr(-s)}` : "Settled"}
                    </span>
                  </span>
                ) : (
                  <Num label="Difference" value={g.difference} warn={g.difference < 0} />
                )}
                <Num label="To collect" value={g.toCollect} className="hidden md:block" />
                <Num label="To pay" value={g.toPay} className="hidden md:block" />
              </button>
            </li>
          );
        })}
      </ul>
      {groups.length > 25 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="w-full border-t border-border py-2 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary">
          {all ? "Show fewer" : `Show all ${groups.length}`}
        </button>
      )}
    </div>
  );
}

function Num({ label, value, warn, className = "" }: { label: string; value: number; warn?: boolean; className?: string }) {
  return (
    <span className={`text-right ${className}`}>
      <span className="block text-[10.5px] text-text-muted md:hidden">{label}</span>
      <span className={`text-[12.5px] tabular-nums ${warn ? "text-text-warning" : value ? "text-text-primary" : "text-text-muted"}`}>{value ? inr(value) : "—"}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// One shipment
// ---------------------------------------------------------------------------

function JobView({
  group,
  jobId,
  onBack,
  onParty,
  jobRef,
}: {
  group: Group | null;
  jobId: string;
  onBack: () => void;
  onParty: (key: string) => void;
  jobRef: (id: string) => string | null;
}) {
  const parties = useMemo(() => (group ? byParty(group.docs) : []), [group]);
  const isConsole = jobId.startsWith("console:");
  return (
    <div className="space-y-4">
      <Back onClick={onBack}>All shipments</Back>
      {!group ? (
        <EmptyState icon={ArrowLeftRight} title="Nothing on this shipment in this period" hint="Pick a longer period, or clear the search." />
      ) : (
        <>
          <section className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold text-text-primary">{group.label}</h2>
                <p className="text-[12px] text-text-muted">{group.sub}</p>
              </div>
              {!isConsole && (
                <span className="flex gap-3 text-[12px]">
                  <Link to={`/shipments/${jobId}`} className="text-text-accent hover:underline">
                    Open the shipment
                  </Link>
                  {jobRef(jobId) && (
                    <EnquiryLink to={`/enquiries/${jobRef(jobId)}`} className="text-text-accent hover:underline">
                      Case file
                    </EnquiryLink>
                  )}
                </span>
              )}
              {isConsole && (
                <Link to="/consoles" className="text-[12px] text-text-accent hover:underline">
                  Consoles
                </Link>
              )}
            </div>
          </section>

          <Figures t={group} />

          <section className="card p-4">
            <h3 className="text-[13px] font-semibold text-text-primary">With which party</h3>
            <p className="mb-2 text-[11.5px] text-text-muted">Who we billed on this shipment, and who billed us. Press one to see all their shipments.</p>
            <PairedBars rows={parties.map((p) => ({ ...p, sub: p.sub }))} onPick={onParty} />
          </section>

          <section className="card overflow-hidden p-0">
            <h3 className="border-b border-border px-4 py-3 text-[13px] font-semibold text-text-primary">Where each party stands</h3>
            <ul className="divide-y divide-border">
              {parties.map((p) => {
                const s = standing(p);
                return (
                  <li key={p.key}>
                    <button type="button" onClick={() => onParty(p.key)} className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-left hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text-primary">{p.label}</span>
                        <span className="block text-[11.5px] text-text-muted">{p.sub}</span>
                      </span>
                      <span className="text-[12px] tabular-nums text-text-secondary">
                        {p.debit ? <>billed {inr(p.debit)}</> : null}
                        {p.debit && p.credit ? " · " : null}
                        {p.credit ? <>billed us {inr(p.credit)}</> : null}
                      </span>
                      <span className={`w-full text-right text-[12.5px] font-medium sm:w-auto ${s > 0 ? "text-text-success" : s < 0 ? "text-text-warning" : "text-text-muted"}`}>
                        {s > 0 ? `Owes us ${inr(s)}` : s < 0 ? `We owe ${inr(-s)}` : "Settled"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <Documents docs={group.docs} showParty />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One party
// ---------------------------------------------------------------------------

function PartyView({ group, onBack, onJob, jobLabel }: { group: Group | null; onBack: () => void; onJob: (key: string) => void; jobLabel: (d: DcDoc) => string }) {
  const jobs = useMemo(() => {
    if (!group) return [];
    // Per shipment, labelled by the shipment's reference.
    const by = new Map<string, DcDoc[]>();
    for (const d of group.docs) {
      const key = d.shipmentId ?? (d.consoleId ? `console:${d.consoleId}` : "none");
      by.set(key, [...(by.get(key) ?? []), d]);
    }
    return [...by]
      .map(([key, list]) => ({ key, label: jobLabel(list[0]), sub: `${list.length} document${list.length === 1 ? "" : "s"}`, ...totals(list) }))
      .sort((a, b) => b.debit + b.credit - (a.debit + a.credit));
  }, [group, jobLabel]);

  return (
    <div className="space-y-4">
      <Back onClick={onBack}>All parties</Back>
      {!group ? (
        <EmptyState icon={ArrowLeftRight} title="Nothing with this party in this period" hint="Pick a longer period, or clear the search." />
      ) : (
        <>
          <section className="card p-4">
            <h2 className="text-[17px] font-semibold text-text-primary">{group.label}</h2>
            <p className="text-[12px] text-text-muted">
              {group.sub} · on {group.count} shipment{group.count === 1 ? "" : "s"}
            </p>
          </section>

          <Figures t={group} owner="party" />

          <section className="card p-4">
            <h3 className="text-[13px] font-semibold text-text-primary">By shipment</h3>
            <p className="mb-2 text-[11.5px] text-text-muted">What we billed them and what they billed us on each. Press one to open it.</p>
            <PairedBars rows={jobs} onPick={(k) => k !== "none" && onJob(k)} />
          </section>

          <Documents docs={group.docs} jobLabel={jobLabel} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The documents behind the figures, newest first: debit in one column, credit in the other. */
function Documents({ docs, showParty, jobLabel }: { docs: DcDoc[]; showParty?: boolean; jobLabel?: (d: DcDoc) => string }) {
  const sorted = [...docs].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="card overflow-hidden p-0">
      <h3 className="border-b border-border px-4 py-3 text-[13px] font-semibold text-text-primary">Documents · {docs.length}</h3>
      <div className="hidden grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1.2fr)_repeat(3,minmax(0,0.8fr))] gap-3 border-b border-border bg-surface-2/60 px-4 py-2 text-[11px] font-medium text-text-secondary md:grid">
        <span>Date</span>
        <span>Document</span>
        <span>{showParty ? "Party" : "Shipment"}</span>
        <span className="text-right">Debit</span>
        <span className="text-right">Credit</span>
        <span className="text-right">Settled</span>
      </div>
      <ul className="divide-y divide-border">
        {sorted.map((d) => (
          <li key={d.id} className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-4 py-2.5 text-[12.5px] md:grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1.2fr)_repeat(3,minmax(0,0.8fr))] md:items-center">
            <span className="text-[11.5px] tabular-nums text-text-muted">{day(d.date)}</span>
            <span className="min-w-0 text-right md:text-left">
              <span className="font-medium text-text-primary">{DOC_LABEL[d.kind] ?? d.kind}</span>
              {d.number && <span className="ml-1.5 font-mono text-[11.5px] text-text-secondary">{d.number}</span>}
              {d.status !== "issued" && d.status !== "paid" && <span className="ml-1.5 text-[11px] capitalize text-text-muted">· {d.status.replace(/_/g, " ")}</span>}
            </span>
            <span className="col-span-2 min-w-0 truncate text-text-secondary md:col-span-1">{showParty ? `${d.partyName} · ${d.partyType}` : (jobLabel?.(d) ?? "—")}</span>
            <span className="text-right tabular-nums">
              <span className="text-[10.5px] text-text-muted md:hidden">Debit </span>
              {d.side === "debit" ? inr(d.amount) : "—"}
            </span>
            <span className="text-right tabular-nums">
              <span className="text-[10.5px] text-text-muted md:hidden">Credit </span>
              {d.side === "credit" ? inr(d.amount) : "—"}
            </span>
            <span className="col-span-2 text-right tabular-nums text-text-secondary md:col-span-1">
              <span className="text-[10.5px] text-text-muted md:hidden">Settled </span>
              {d.amount > 0 ? (d.settled >= d.amount - 0.5 ? "In full" : d.settled > 0 ? inr(d.settled) : "Not yet") : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Back({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-[12.5px] text-text-secondary hover:text-text-primary">
      <ArrowLeft size={13} />
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        active ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
