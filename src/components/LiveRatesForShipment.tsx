import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, Loader2, Package, Search, Send } from "lucide-react";
import RateRequestForm from "./RateRequestForm";
import StatusPill from "./StatusPill";
import { ListSkeleton } from "./Loading";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { useLiveVersion } from "../lib/liveVersions";
import { MODE_WORD } from "../lib/rateRequest";
import { openJobs, type OpenJob } from "../services/liveRates";
import { QUOTE_STATUS_LABEL, recentRateRequests, type PartnerQuote, type QuoteStatus } from "../services/rfq";
import { STATUS_LABEL, SHIPMENT_STAGE_LABEL, type ShipmentStage } from "../services/enquiries";

/**
 * Live rates, by hand, for one job (107): choose a shipment, the partners,
 * and what each should price; each gets their own mail from the sender's
 * Outlook, filed on the job as a thread. The Sunday requests carry on as they
 * were, on the other tab.
 */
export default function LiveRatesForShipment() {
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<OpenJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setJobs(await openJobs());
    } catch (e) {
      setError(failureText(e, "Could not load the jobs.").message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The job in the address, so a link (or a reload) lands on it.
  const ref = (params.get("job") ?? "").toUpperCase();
  const job = jobs.find((j) => j.enquiry.ref.toUpperCase() === ref) ?? null;
  const choose = (r: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (r) n.set("job", r);
        else n.delete("job");
        return n;
      },
      { replace: true }
    );

  const matches = useMemo(() => {
    const n = query.trim().toLowerCase();
    return jobs.filter(({ enquiry: e, shipmentId }) =>
      !n
        ? true
        : [e.ref, shipmentId, e.customer?.company, e.customer?.name, e.origin, e.destination, e.cargo]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(n))
    );
  }, [jobs, query]);
  const listed = showAll || query ? matches : matches.slice(0, 8);

  const [sentVersion, setSentVersion] = useState(0);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
          <Send size={14} /> Ask partners about a shipment
        </h2>
        <p className="mt-0.5 max-w-prose text-[12px] text-text-secondary">
          Choose the job, the partners, and what each of them should price. Each gets their own mail from your Outlook, and the request
          and their reply are filed on the job, under Partner quotes.
        </p>

        {/* ---- the job ---- */}
        <div className="mt-4">
          <p className="mb-2 text-[12px] font-medium text-text-secondary">The shipment</p>
          {error && (
            <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
          {loading ? (
            <ListSkeleton rows={3} />
          ) : job ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-brand/30 bg-bg-success px-3 py-2.5">
              <JobLine job={job} />
              <div className="ml-auto flex items-center gap-3">
                <Link to={`/enquiries/${encodeURIComponent(job.enquiry.ref)}?section=quote`} className="text-[12px] text-text-accent hover:underline">
                  Open the job
                </Link>
                <button type="button" onClick={() => choose(null)} className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary hover:text-text-primary">
                  Change
                </button>
              </div>
            </div>
          ) : (
            <>
              {ref && <p className="mb-2 text-[12px] text-text-warning">{ref} is not an open job. Choose one below.</p>}
              <div className="relative mb-2 max-w-md">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Reference, customer, port, cargo…"
                  className="h-9 w-full pl-7 text-[12.5px]"
                  aria-label="Find the shipment"
                />
              </div>
              {!jobs.length ? (
                <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-text-secondary">No open enquiries or shipments.</p>
              ) : !matches.length ? (
                <p className="px-1 py-2 text-[12px] text-text-muted">Nothing matches that.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {listed.map((j) => (
                    <li key={j.enquiry.ref}>
                      <button
                        type="button"
                        onClick={() => choose(j.enquiry.ref)}
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-surface-2"
                      >
                        <JobLine job={j} />
                        <ArrowRight size={13} className="ml-auto text-text-muted" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!query && matches.length > listed.length && (
                <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-[12px] text-text-accent hover:underline">
                  Show all {matches.length}
                </button>
              )}
            </>
          )}
        </div>

        {/* ---- the request ---- */}
        {job && (
          <div className="mt-5 border-t border-border pt-4">
            <RateRequestForm key={job.enquiry.ref} enquiry={job.enquiry} source="live_rates" layout="page" onSent={() => setSentVersion((v) => v + 1)} />
          </div>
        )}
      </div>

      <SentFromHere bump={sentVersion} />
    </div>
  );
}

function JobLine({ job: { enquiry: e, shipmentId, stage } }: { job: OpenJob }) {
  const lane = [e.origin, e.destination].filter(Boolean).join(" → ");
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] font-medium text-text-primary">{e.ref}</span>
        {shipmentId && <span className="font-mono text-[11.5px] text-text-secondary">{shipmentId}</span>}
        <StatusPill tone={shipmentId ? "accent" : "neutral"}>
          {shipmentId && stage ? SHIPMENT_STAGE_LABEL[stage as ShipmentStage] ?? stage : STATUS_LABEL[e.status]}
        </StatusPill>
        <span className="truncate text-[12.5px] text-text-primary">{e.customer?.company || e.customer?.name || "—"}</span>
      </span>
      <span className="mt-0.5 block truncate text-[11.5px] text-text-muted">
        {[lane || "Route not known yet", e.transport_mode ? MODE_WORD[e.transport_mode] : "", e.cargo].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

const TONE: Record<QuoteStatus, "neutral" | "accent" | "success" | "warning"> = {
  asked: "neutral",
  replied: "accent",
  quoted: "success",
  declined: "warning",
  no_reply: "neutral",
};

/** What Live rates has sent, and where each stands: the replies are read on the job. */
function SentFromHere({ bump }: { bump: number }) {
  const [rows, setRows] = useState<PartnerQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useLiveVersion("partner_quotes");

  useEffect(() => {
    recentRateRequests()
      .then(setRows)
      .catch((e) => setError(failureText(e, "Could not load what was sent.").message));
  }, [live, bump]);

  return (
    <div className="card p-4">
      <h2 className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
        <Package size={13} /> Sent from Live rates
      </h2>
      <p className="mt-0.5 text-[11.5px] text-text-muted">The latest requests sent from this page. Replies are found when the job is opened.</p>
      {error ? (
        <p className="mt-2 text-[12px] text-text-danger">{error}</p>
      ) : rows === null ? (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </p>
      ) : !rows.length ? (
        <p className="mt-2 text-[12px] text-text-muted">Nothing sent from here yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <Link to={`/enquiries/${encodeURIComponent(q.enquiry_ref)}?section=quote`} className="font-mono font-medium text-text-accent hover:underline">
                    {q.enquiry_ref}
                  </Link>
                  <span className="font-medium text-text-primary">{q.partner_label || q.partner_email}</span>
                  <StatusPill tone={TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</StatusPill>
                  {q.amount != null && (
                    <span className="tabular-nums text-text-primary">
                      {q.currency ? `${q.currency} ` : ""}
                      {Number(q.amount).toLocaleString("en-IN")}
                    </span>
                  )}
                </p>
                {q.services.length > 0 && <p className="mt-0.5 text-[11.5px] text-text-secondary">{q.services.join(" · ")}</p>}
              </div>
              <p className="text-[11px] text-text-muted">
                {formatDate(q.sent_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                {q.sent_from ? ` · ${q.sent_from}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
