import { useParams, Link } from "react-router-dom";
import { ChevronLeft, Check, X, Clock, RefreshCw, PhoneIncoming, FileDown } from "lucide-react";
import StatusPill, { toneForShipmentStatus } from "../components/StatusPill";
import { shipments } from "../data/mockData";
import EmptyState from "../components/EmptyState";
import { generateInvoicePdf } from "../lib/generateInvoicePdf";
import StowPanel from "../components/StowPanel";

const docStatusTone = { complete: "success", partial_callback_needed: "warning", escalated: "danger" } as const;

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

const cargoTypeLabels: Record<string, string> = {
  general_dry: "General dry cargo",
  textiles_garments: "Textiles & garments",
  perishable_food: "Perishable & food",
  hazardous_dg: "Hazardous / DG",
  electronics: "Electronics",
  agri_grain: "Agricultural bulk & grain",
};

const outcomeLabels: Record<string, string> = {
  quote_provided: "Quote provided",
  negotiating: "Negotiating",
  booked: "Booked",
  status_check: "Status check",
  docs_missing: "Docs missing",
  escalated: "Escalated",
  complaint: "Complaint",
};

export default function ShipmentDetail() {
  const { id } = useParams();
  const shipment = shipments.find((s) => s.id === id);

  if (!shipment) return <EmptyState label="Shipment not found." />;

  const ce = shipment.callExtraction;
  const dg = shipment.docGenDetails;

  return (
    <div>
      <Link to={shipment.stage === "completed" ? "/shipments/completed" : "/shipments/in-process"} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary mb-4">
        <ChevronLeft size={14} /> Back
      </Link>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium text-text-primary font-mono">{shipment.blNumber}</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {shipment.company} · {shipment.origin} → {shipment.destination} · {shipment.carrier}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => generateInvoicePdf(shipment)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 text-text-primary"
          >
            <FileDown size={13} /> Generate documents
          </button>
          <StatusPill tone={toneForShipmentStatus(shipment.status)}>{shipment.status.replace(/_/g, " ")}</StatusPill>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="rounded-card bg-surface-1 border border-border p-4">
          <p className="text-sm font-medium text-text-primary mb-3">Timeline</p>
          <div className="flex flex-col gap-2.5">
            {shipment.timeline.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                {t.state === "done" && <Check size={15} className="text-text-success shrink-0" />}
                {t.state === "current" && <Clock size={15} className="text-text-warning shrink-0" />}
                {t.state === "pending" && <X size={15} className="text-text-muted shrink-0" />}
                <span className={t.state === "pending" ? "text-text-muted" : "text-text-primary"}>{t.label}</span>
                <span className="text-xs text-text-muted ml-auto">{t.date}</span>
              </div>
            ))}
          </div>

          {(shipment.pickup || shipment.delivery) && (
            <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-3">
              {shipment.pickup && (
                <div>
                  <p className="text-xs text-text-secondary">Pickup</p>
                  <p className="text-[13px] text-text-primary">{shipment.pickup.date} · {shipment.pickup.window}</p>
                  <StatusPill tone={shipment.pickup.confirmed ? "success" : "warning"}>
                    {shipment.pickup.confirmed ? "Confirmed" : "Pending"}
                  </StatusPill>
                </div>
              )}
              {shipment.delivery && (
                <div>
                  <p className="text-xs text-text-secondary">Delivery</p>
                  <p className="text-[13px] text-text-primary">{shipment.delivery.date} · {shipment.delivery.window}</p>
                  <StatusPill tone={shipment.delivery.confirmed ? "success" : "warning"}>
                    {shipment.delivery.confirmed ? "Confirmed" : "Pending"}
                  </StatusPill>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-card bg-surface-1 border border-border p-4">
            <p className="text-sm font-medium text-text-primary mb-3 flex items-center gap-1.5">
              Synced to SnapServe <RefreshCw size={13} className="text-text-success" />
            </p>
            <div className="text-xs font-mono text-text-secondary flex flex-col gap-1.5">
              <span>order_status: {shipment.status}</span>
              {shipment.demurrageStartDate && <span>demurrage_start: {shipment.demurrageStartDate}</span>}
              {shipment.freeDaysRemaining !== undefined && <span>free_days_left: {shipment.freeDaysRemaining}</span>}
            </div>
            <p className="text-[11px] text-text-muted mt-2.5">
              Last synced {shipment.lastSyncedToSnapserve} · caller memory + campaign lead fields
            </p>
          </div>

          <div className="rounded-card bg-surface-1 border border-border p-4">
            <p className="text-sm font-medium text-text-primary mb-3">Documents</p>
            <div className="flex flex-col gap-2">
              {shipment.documents.map((d, i) => (
                <div key={i} className="flex items-center justify-between text-[13px]">
                  <span className="text-text-primary">{d.name}</span>
                  <StatusPill tone={d.status === "received" ? "success" : d.status === "missing" ? "danger" : "accent"}>
                    {d.status}
                  </StatusPill>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {ce && (
        <div className="rounded-card bg-surface-1 border border-border p-4 mb-5">
          <p className="text-sm font-medium text-text-primary mb-3 flex items-center gap-1.5">
            <PhoneIncoming size={14} className="text-text-accent" /> Extracted from call
          </p>
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {ce.cargoType && (
              <div>
                <p className="text-xs text-text-secondary">Cargo type</p>
                <p className="text-[13px] text-text-primary">{cargoTypeLabels[ce.cargoType] ?? ce.cargoType}</p>
              </div>
            )}
            {ce.cargoDescription && (
              <div>
                <p className="text-xs text-text-secondary">Cargo description</p>
                <p className="text-[13px] text-text-primary">{ce.cargoDescription}</p>
              </div>
            )}
            {ce.volumeCbm !== undefined && (
              <div>
                <p className="text-xs text-text-secondary">Volume</p>
                <p className="text-[13px] text-text-primary">{ce.volumeCbm} CBM</p>
              </div>
            )}
            {ce.containerTypeRequested && (
              <div>
                <p className="text-xs text-text-secondary">Container requested</p>
                <p className="text-[13px] text-text-primary font-mono">{ce.containerTypeRequested}</p>
              </div>
            )}
            {ce.priceAskedInr !== undefined && (
              <div>
                <p className="text-xs text-text-secondary">Price asked</p>
                <p className="text-[13px] text-text-primary">{fmtInr(ce.priceAskedInr)}</p>
              </div>
            )}
            {ce.priceNegotiatedInr !== undefined && (
              <div>
                <p className="text-xs text-text-secondary">Price negotiated</p>
                <p className="text-[13px] text-text-success">{fmtInr(ce.priceNegotiatedInr)}</p>
              </div>
            )}
            {ce.callOutcome && (
              <div>
                <p className="text-xs text-text-secondary">Call outcome</p>
                <StatusPill tone="accent">{outcomeLabels[ce.callOutcome] ?? ce.callOutcome}</StatusPill>
              </div>
            )}
            {ce.nextStep && (
              <div className="col-span-2">
                <p className="text-xs text-text-secondary">Next step</p>
                <p className="text-[13px] text-text-primary">{ce.nextStep}</p>
              </div>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-3">
            SnapServe call {ce.snapserveCallId} · {ce.callDate} · via disposition schema
          </p>
        </div>
      )}

      {dg && (
        <div className="rounded-card bg-surface-1 border border-border p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-text-primary flex items-center gap-1.5">
              <FileDown size={14} className="text-text-accent" /> Documentation (from Arun)
            </p>
            <StatusPill tone={docStatusTone[dg.documentationStatus]}>{dg.documentationStatus.replace(/_/g, " ")}</StatusPill>
          </div>
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {dg.shipperName && (
              <div>
                <p className="text-xs text-text-secondary">Shipper</p>
                <p className="text-[13px] text-text-primary">{dg.shipperName}</p>
              </div>
            )}
            {dg.shipperGstinIec && (
              <div>
                <p className="text-xs text-text-secondary">GSTIN / IEC</p>
                <p className="text-[13px] text-text-primary font-mono">{dg.shipperGstinIec}</p>
              </div>
            )}
            {dg.consigneeName && (
              <div>
                <p className="text-xs text-text-secondary">Consignee</p>
                <p className="text-[13px] text-text-primary">{dg.consigneeName}</p>
              </div>
            )}
            {dg.consigneeCountry && (
              <div>
                <p className="text-xs text-text-secondary">Consignee country</p>
                <p className="text-[13px] text-text-primary">{dg.consigneeCountry}</p>
              </div>
            )}
            {dg.hsCode && (
              <div>
                <p className="text-xs text-text-secondary">HS code</p>
                <p className="text-[13px] text-text-primary font-mono">{dg.hsCode}</p>
              </div>
            )}
            {dg.invoiceValueInr !== undefined && (
              <div>
                <p className="text-xs text-text-secondary">Invoice value</p>
                <p className="text-[13px] text-text-primary">{fmtInr(dg.invoiceValueInr)}</p>
              </div>
            )}
            {dg.packageCount !== undefined && (
              <div>
                <p className="text-xs text-text-secondary">Packages</p>
                <p className="text-[13px] text-text-primary">{dg.packageCount} x {dg.packageType ?? "units"}</p>
              </div>
            )}
            {dg.grossWeightKg !== undefined && (
              <div>
                <p className="text-xs text-text-secondary">Gross weight</p>
                <p className="text-[13px] text-text-primary">{dg.grossWeightKg.toLocaleString("en-IN")} kg</p>
              </div>
            )}
          </div>
          {dg.missingFields && <p className="text-xs text-text-danger mt-3">Still pending from customer: {dg.missingFields}</p>}
          <p className="text-[11px] text-text-muted mt-3">SnapServe call {dg.snapserveCallId} · {dg.callDate}</p>
        </div>
      )}

      {ce && ce.transcript.length > 0 && (
        <div className="rounded-card bg-surface-1 border border-border p-4 mb-5">
          <p className="text-sm font-medium text-text-primary mb-3">Conversation</p>
          <div className="flex flex-col gap-2.5">
            {ce.transcript.map((t, i) => (
              <div key={i} className={`flex ${t.speaker === "agent" ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[75%] rounded-card px-3 py-2 text-[13px] ${
                    t.speaker === "agent" ? "bg-surface-2 text-text-primary" : "bg-bg-accent text-text-accent"
                  }`}
                >
                  <p className="text-[11px] text-text-muted mb-0.5">{t.speaker === "agent" ? "Priya" : shipment.customerName}</p>
                  {t.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <StowPanel
        query={{
          blNumber: shipment.blNumber,
          company: shipment.company,
          origin: shipment.origin,
          destination: shipment.destination,
        }}
      />

      <div className="rounded-card bg-surface-1 border border-border p-4 mt-6">
        <p className="text-sm font-medium text-text-primary mb-3">Call history</p>
        <div className="flex flex-col gap-2">
          {shipment.callHistory.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-[13px]">
              <span className="text-text-primary">{c.date} · {c.agent}</span>
              <span className="text-text-secondary">{c.disposition}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
