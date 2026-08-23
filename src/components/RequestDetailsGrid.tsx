import { Languages, Check } from "lucide-react";
import {
  REQUEST_FIELDS,
  GROUP_LABELS,
  completeness,
  type FieldDef,
  type FieldGroup,
  type RequestDetails,
  type SourceLanguage,
} from "../data/requestFields";

/**
 * Every field the desk needs off a call, one labelled box each.
 *
 * The design decision that matters: fields with no value are still rendered, dimmed, as
 * "not stated". A grid that hides its empty fields looks complete when it is not, and the
 * whole point of this view is to show at a glance what still has to be asked before the
 * booking can move. Missing data is the operational signal, so it is shown, not hidden.
 */

const LANG_LABEL: Record<SourceLanguage, string> = {
  en: "English",
  ta: "Tamil",
  mixed: "Tamil and English",
  unknown: "not detected",
};

function formatValue(f: FieldDef, raw: string | number | boolean): string {
  if (f.kind === "boolean") return raw ? "Yes" : "No";

  if (f.kind === "number") {
    const n = Number(raw);
    if (f.unit === "INR") return `₹${n.toLocaleString("en-IN")}`;
    return f.unit ? `${n.toLocaleString("en-IN")} ${f.unit}` : n.toLocaleString("en-IN");
  }

  // Enums are stored as the machine value the schema constrains to; the underscores are
  // for the extractor, not for whoever is reading the screen.
  if (f.kind === "enum") return String(raw).replace(/_/g, " ");

  return String(raw);
}

function FieldBox({ field, value }: { field: FieldDef; value: string | number | boolean | null | undefined }) {
  const stated = value !== null && value !== undefined && value !== "";

  return (
    <div
      className={`rounded px-2.5 py-1.5 border ${
        stated ? "border-border bg-surface-1" : "border-dashed border-border bg-transparent"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-text-muted truncate" title={field.label}>
        {field.label}
      </div>
      <div className={`mt-0.5 text-[13px] ${stated ? "text-text-primary" : "italic text-text-muted"}`}>
        {stated ? formatValue(field, value as string | number | boolean) : "not stated"}
      </div>
    </div>
  );
}

function Group({ group, details }: { group: FieldGroup; details: RequestDetails }) {
  const fields = REQUEST_FIELDS.filter((f) => f.group === group);
  const filled = fields.filter((f) => details[f.key] !== null && details[f.key] !== undefined).length;

  // Cargo handling only applies to hazardous and reefer cargo. Six permanently empty
  // boxes on every general-dry enquiry would make the grid read as incomplete when it is
  // not — so the group appears only once something in it has actually been established.
  if (group === "handling" && filled === 0) return null;

  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          {GROUP_LABELS[group]}
        </h4>
        <span className="text-[11px] text-text-muted">
          {filled} of {fields.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 lg:grid-cols-4">
        {fields.map((f) => (
          <FieldBox key={f.key} field={f} value={details[f.key]} />
        ))}
      </div>

    </div>
  );
}

export default function RequestDetailsGrid({
  details,
  sourceLanguage,
}: {
  details?: RequestDetails;
  sourceLanguage?: SourceLanguage;
}) {
  const d = details ?? {};
  const { filled, total } = completeness(d);

  if (filled === 0) {
    return (
      <p className="text-[13px] italic text-text-muted py-3">
        No fields extracted from this caller's calls yet.
      </p>
    );
  }

  const pct = Math.round((filled / total) * 100);
  const translated = sourceLanguage === "ta" || sourceLanguage === "mixed";

  return (
    <div className="py-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-text-secondary">
            {filled} of {total} fields captured
          </span>
        </div>

        {sourceLanguage && (
          <span className="inline-flex items-center gap-1 rounded-full bg-bg-accent px-2 py-0.5 text-[11px] text-text-accent">
            {translated ? <Languages size={11} /> : <Check size={11} />}
            {translated ? `Translated from ${LANG_LABEL[sourceLanguage]}` : `Spoken in ${LANG_LABEL[sourceLanguage]}`}
          </span>
        )}
      </div>

      <Group group="booking" details={d} />
      <Group group="documentation" details={d} />
      <Group group="handling" details={d} />

      <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
        Extracted from call transcripts. A field reads "not stated" when the call did not
        establish it — nothing here is inferred or carried over from a similar shipment.
      </p>
    </div>
  );
}
