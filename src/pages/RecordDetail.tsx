import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, Check, Clock, X, PhoneIncoming } from "lucide-react";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import StowPanel from "../components/StowPanel";
import DocumentsPanel from "../components/DocumentsPanel";
import RequestDetailsGrid from "../components/RequestDetailsGrid";
import CallHistoryPanel from "../components/CallHistoryPanel";
import StageAction from "../components/StageAction";
import { documentDataFromRecord } from "../lib/documents";
import { getRealRecords, type RealRecord } from "../services/backend";

/**
 * A real customer's shipment, in full.
 *
 * The seeded shipments have had a page like this for a while; the customers captured from
 * actual calls only ever had a row that expanded. That was backwards — the real ones are
 * the ones somebody has to act on, and everything needed to act was spread across a list
 * row, a drawer and a different page.
 *
 * Same shape as the seeded shipment page on purpose: container and timeline at the top,
 * then what was extracted, then documents, then the calls themselves. Someone moving
 * between a demo shipment and a real one should not have to relearn where anything is.
 */
export default function RecordDetail() {
  const { ref } = useParams();
  const [record, setRecord] = useState<RealRecord | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  async function load() {
    try {
      const { records } = await getRealRecords();
      const hit = records.find((r) => r.ref === ref);
      setRecord(hit ?? null);
      setState(hit ? "ready" : "missing");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  if (state === "loading") return <p className="text-sm text-text-muted py-10">Loading…</p>;
  if (state === "error") return <EmptyState label="Backend not reachable." />;
  if (!record) return <EmptyState label="Record not found." />;

  const backTo =
    record.stage === "enquiry"
      ? "/inbound"
      : record.stage === "processed"
        ? "/shipments/completed"
        : "/shipments/in-process";

  return (
    <div>
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary mb-4"
      >
        <ChevronLeft size={14} /> Back
      </Link>

      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-medium text-text-primary font-mono">
            {record.blNumber ?? record.ref}
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            <PhoneIncoming size={12} className="inline mr-1 -mt-0.5 text-text-accent" />
            {record.company ?? record.customerName ?? "Unnamed caller"} · {record.phone}
            {record.origin && record.destination ? ` · ${record.origin} → ${record.destination}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!record.blNumber && <StatusPill tone="warning">No BL yet</StatusPill>}
          <StatusPill tone={record.stage === "processed" ? "success" : "accent"}>
            {record.stage}
          </StatusPill>
        </div>
      </div>

      <StageAction record={record} onChanged={load} />

      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <StowPanel
          query={{
            blNumber: record.blNumber,
            reference: record.ref,
            company: record.company,
            origin: record.origin,
            destination: record.destination,
          }}
        />
        <div className="rounded-card bg-surface-1 border border-border p-4">
          <p className="text-sm font-medium text-text-primary mb-3">Timeline</p>
          <Timeline record={record} />
        </div>
      </div>

      <section className="mb-6">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
          Captured from calls
        </h2>
        <RequestDetailsGrid details={record.requestDetails} sourceLanguage={record.sourceLanguage} />
      </section>

      <section className="mb-6">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
          Documents
        </h2>
        <DocumentsPanel data={documentDataFromRecord(record)} defaultOpen />
      </section>

      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
          Calls and transcripts
        </h2>
        <CallHistoryPanel phone={record.phone} />
      </section>
    </div>
  );
}

/**
 * Built from what the record actually has, not from a fixed script.
 *
 * A seeded shipment carries a hand-written timeline. A real one has only the facts the
 * calls and the desk produced, so each step is shown as done, current or pending based on
 * whether the thing behind it exists.
 */
function Timeline({ record }: { record: RealRecord }) {
  const steps: Array<{ label: string; date: string; state: "done" | "current" | "pending" }> = [
    { label: "Enquiry received", date: record.createdAt.slice(0, 10), state: "done" },
    {
      label: "Quote given",
      date: record.quotedAmountInr ? `₹${record.quotedAmountInr.toLocaleString("en-IN")}` : "pending",
      state: record.quotedAmountInr ? "done" : "pending",
    },
    {
      label: "Rate agreed",
      date: record.agreedAmountInr ? `₹${record.agreedAmountInr.toLocaleString("en-IN")}` : "pending",
      state: record.agreedAmountInr ? "done" : "pending",
    },
    {
      label: "Sailing date confirmed",
      date: record.sailingDate ?? "pending",
      state: record.sailingDate ? "done" : record.stage === "enquiry" ? "current" : "pending",
    },
    {
      label: "Booking started",
      date: record.processingStartedAt?.slice(0, 10) ?? "pending",
      state:
        record.stage === "processing" || record.stage === "processed"
          ? "done"
          : record.sailingDate
            ? "current"
            : "pending",
    },
    {
      label: "Bill of lading issued",
      date: record.blNumber ?? "pending",
      state: record.blNumber ? "done" : record.stage === "processing" ? "current" : "pending",
    },
    {
      label: "Delivered",
      date: record.stage === "processed" ? record.updatedAt.slice(0, 10) : "pending",
      state: record.stage === "processed" ? "done" : "pending",
    },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      {steps.map((t, i) => (
        <div key={i} className="flex items-center gap-2 text-[13px]">
          {t.state === "done" && <Check size={15} className="text-text-success shrink-0" />}
          {t.state === "current" && <Clock size={15} className="text-text-warning shrink-0" />}
          {t.state === "pending" && <X size={15} className="text-text-muted shrink-0" />}
          <span className={t.state === "pending" ? "text-text-muted" : "text-text-primary"}>
            {t.label}
          </span>
          <span className="text-xs text-text-muted ml-auto">{t.date}</span>
        </div>
      ))}
    </div>
  );
}
