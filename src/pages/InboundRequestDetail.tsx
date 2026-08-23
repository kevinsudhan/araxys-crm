import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import ChannelBadge from "../components/ChannelBadge";
import StowPanel from "../components/StowPanel";
import { inboundRequests } from "../data/mockData";

/**
 * An inbound enquiry as its own page.
 *
 * These used to open a call drawer, which suited listening back to the call and nothing
 * else — there was no room for the quote, the negotiation band, or where the cargo would
 * actually go. A request is the start of a shipment, so it gets the same treatment as
 * one: a full page, and the container it is destined for.
 */
export default function InboundRequestDetail() {
  const { id } = useParams();
  const request = inboundRequests.find((r) => r.id === id);

  if (!request) return <EmptyState label="Request not found." />;

  const fmt = (n?: number) => (n !== undefined ? `₹${n.toLocaleString("en-IN")}` : "—");

  return (
    <div>
      <Link
        to="/inbound"
        className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary mb-4"
      >
        <ChevronLeft size={14} /> Back to inbound requests
      </Link>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium text-text-primary">
            {request.company || request.customerName}
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {request.origin} → {request.destination} · {request.cargoDescription}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ChannelBadge channel={request.channel} />
          <StatusPill tone={request.status === "accepted" ? "success" : "accent"}>
            {request.status}
          </StatusPill>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Contact" value={request.customerName} />
        <Field label="Phone" value={request.phone} />
        <Field label="Email" value={request.email} />
        <Field label="Requested" value={request.requestedAt} />
        <Field label="Volume" value={`${request.volumeCbm} CBM`} />
        <Field label="Quote" value={fmt(request.quoteAmount)} />
        <Field label="Past shipments" value={String(request.pastShipmentsCount)} />
        <Field
          label="Routed to"
          value={request.routedTo === "human_review" ? "Human review" : "Intake / quote agent"}
        />
      </div>

      {(request.negotiationFloor || request.negotiationCeiling) && (
        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
            Negotiation band
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Floor" value={fmt(request.negotiationFloor)} />
            <Field label="Ceiling" value={fmt(request.negotiationCeiling)} />
            <Field label="Quoted" value={fmt(request.quoteAmount)} />
          </div>
          {request.negotiationNote && (
            <p className="mt-2 text-[13px] text-text-secondary">{request.negotiationNote}</p>
          )}
        </section>
      )}

      <StowPanel
        query={{
          company: request.company,
          origin: request.origin,
          destination: request.destination,
        }}
        title="Container it would travel in"
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface-1 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-0.5 text-[13px] text-text-primary">{value || "—"}</div>
    </div>
  );
}
