import { useState } from "react";
import PageHeader from "../components/PageHeader";
import StatusPill from "../components/StatusPill";
import {
  containerSpecs,
  freightRates,
  cargoTypes,
  destinationRegulations,
  sailingSlots,
  knowledgeDocs,
} from "../data/knowledgeBase";
import type { KbCategory } from "../types/knowledgeBase";

const categoryLabels: Record<KbCategory, string> = {
  container_specs: "Container specs",
  pricing: "Pricing & negotiation",
  documents_by_cargo: "Documents by cargo type",
  destination_regulations: "Destination regulations",
  space_availability: "Space availability (dummy)",
};

const slotStatusTone = { open: "success", closing_soon: "warning", full: "danger" } as const;

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function KnowledgeBase() {
  const [category, setCategory] = useState<KbCategory>("container_specs");

  return (
    <div>
      <PageHeader
        title="Knowledge base"
        subtitle="The reference data the forwarder-rep agent draws on for container, pricing, documentation, and regulatory questions — ready to export to SnapServe's Knowledge Base."
      />

      <div className="flex gap-1.5 mb-5">
        {knowledgeDocs.map((doc) => (
          <button
            key={doc.id}
            onClick={() => setCategory(doc.category)}
            className={`px-3 py-1.5 rounded-lg text-xs border ${
              category === doc.category
                ? "bg-surface-2 border-border-strong text-text-primary font-medium"
                : "border-border text-text-secondary hover:bg-surface-2"
            }`}
          >
            {categoryLabels[doc.category]}
          </button>
        ))}
      </div>

      {category === "container_specs" && (
        <div className="rounded-card bg-surface-1 border border-border overflow-hidden">
          <table className="w-full text-[13px]" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-secondary">
                <th className="px-4 py-2.5 w-20">Code</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5 w-24">Capacity</th>
                <th className="px-4 py-2.5 w-28">Max payload</th>
                <th className="px-4 py-2.5">Use case</th>
              </tr>
            </thead>
            <tbody>
              {containerSpecs.map((c) => (
                <tr key={c.code} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-mono text-text-primary">{c.code}</td>
                  <td className="px-4 py-2.5 text-text-primary">{c.name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{c.capacityCbm ? `${c.capacityCbm} CBM` : "per unit"}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{c.maxPayloadKg ? `${c.maxPayloadKg.toLocaleString("en-IN")} kg` : "—"}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{c.useCase}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {category === "pricing" && (
        <div className="flex flex-col gap-3">
          {freightRates.map((r) => (
            <div key={r.id} className="rounded-card bg-surface-1 border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-medium text-text-primary">
                  {r.origin} → {r.destination} · <span className="font-mono">{r.containerCode}</span>
                </p>
                <span className="text-xs text-text-secondary">{r.transitDays} days transit</span>
              </div>
              <div className="flex items-center gap-4 text-[13px] text-text-secondary mb-2">
                <span>
                  Base: <span className="text-text-primary">{fmtInr(r.baseRateInr)}{r.unit === "per_cbm" ? " / CBM" : " / container"}</span>
                  {r.minChargeCbm && <span className="text-xs text-text-muted"> (min {r.minChargeCbm} CBM)</span>}
                </span>
                <StatusPill tone="neutral">
                  Band {r.negotiationFloorPct}% / +{r.negotiationCeilingPct}%
                </StatusPill>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.surcharges.map((s) => (
                  <span key={s.label} className="text-xs text-text-muted bg-surface-2 rounded px-2 py-1">
                    {s.label}: {s.basis === "flat" ? fmtInr(s.amountInr) : `${s.amountInr}%`}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {category === "documents_by_cargo" && (
        <div className="flex flex-col gap-3">
          {cargoTypes.map((c) => (
            <div key={c.code} className="rounded-card bg-surface-1 border border-border p-4">
              <p className="text-[13px] font-medium text-text-primary">{c.name}</p>
              <p className="text-xs text-text-secondary mb-2">{c.description}</p>
              <div className="flex flex-col gap-1.5 mb-2">
                {c.requiredDocuments.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-[13px]">
                    <StatusPill tone={d.mandatory ? "danger" : "neutral"}>{d.mandatory ? "Mandatory" : "Conditional"}</StatusPill>
                    <span className="text-text-primary">{d.name}</span>
                    {d.notes && <span className="text-xs text-text-muted">— {d.notes}</span>}
                  </div>
                ))}
              </div>
              {c.packagingRequirements && (
                <p className="text-xs text-text-secondary"><span className="text-text-muted">Packaging: </span>{c.packagingRequirements}</p>
              )}
              {c.specialHandling && (
                <p className="text-xs text-text-secondary"><span className="text-text-muted">Handling: </span>{c.specialHandling}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {category === "destination_regulations" && (
        <div className="flex flex-col gap-3">
          {destinationRegulations.map((d) => (
            <div key={d.port} className="rounded-card bg-surface-1 border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-medium text-text-primary">{d.port}, {d.country}</p>
                <span className="text-xs text-text-secondary">{d.freeDays} free days</span>
              </div>
              <div className="flex gap-4 text-xs text-text-secondary mb-2">
                <span>Detention: <span className="text-text-primary">{fmtInr(d.detentionRateInrPerDay)}/day</span></span>
                <span>Demurrage: <span className="text-text-primary">{fmtInr(d.demurrageRateInrPerDay)}/day</span></span>
              </div>
              <div className="flex flex-col gap-1 mb-1.5">
                {d.certificateRequirements.map((c) => (
                  <p key={c} className="text-[13px] text-text-primary">• {c}</p>
                ))}
              </div>
              {d.customsNotes.map((n) => (
                <p key={n} className="text-xs text-text-muted">{n}</p>
              ))}
              {d.restrictedGoodsNotes && <p className="text-xs text-text-danger mt-1">{d.restrictedGoodsNotes}</p>}
            </div>
          ))}
        </div>
      )}

      {category === "space_availability" && (
        <div>
          <p className="text-xs text-text-muted mb-3">
            Seed values only. Live remaining space is served by the backend and shown on{" "}
            <strong className="font-medium">Space &amp; containers</strong> — the agent checks fit in three dimensions
            through that service mid-call rather than reading these numbers as text.
          </p>
          <div className="rounded-card bg-surface-1 border border-border overflow-hidden">
            <table className="w-full text-[13px]" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-secondary">
                  <th className="px-4 py-2.5">Route</th>
                  <th className="px-4 py-2.5 w-24">Carrier</th>
                  <th className="px-4 py-2.5 w-28">Sailing</th>
                  <th className="px-4 py-2.5 w-24">Cutoff</th>
                  <th className="px-4 py-2.5 w-20">Box</th>
                  <th className="px-4 py-2.5 w-28">Floor used</th>
                  <th className="px-4 py-2.5 w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {sailingSlots.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-text-primary">{s.route}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{s.carrier}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{s.sailingDate}</td>
                    <td className="px-4 py-2.5 text-text-secondary">{s.cutoffDate}</td>
                    <td className="px-4 py-2.5 font-mono text-text-primary">
                      {s.containerCode}
                      <span className="text-text-muted"> {s.mode}</span>
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {s.usedLengthM}m · {s.usedWeightKg.toLocaleString("en-IN")}kg
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={slotStatusTone[s.status]}>{s.status.replace("_", " ")}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
