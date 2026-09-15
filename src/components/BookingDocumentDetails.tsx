import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import Select from "./Select";
import { CONTAINER_TYPES } from "../services/containers";
import {
  setBookingDocumentDetails,
  type BookingDocumentDetails as Details,
  type Shipment,
} from "../services/enquiries";

/**
 * The particulars a shipping document is made of.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCREEN HAD TO EXIST
 *
 * The registry can issue twelve documents. Against a real booking only three
 * came out as finals, and the reason was not that nobody had typed the details
 * in — it was that there was nowhere to type them. 028 added the columns; this
 * is the form, and without it those columns could only be filled by SQL.
 *
 * WHAT IT COVERS NOW
 *
 * The particulars and the commercial terms. Shipper, consignee and notify party
 * were here too until the shipment grew a Parties & B/L section that holds the
 * whole box a bill of lading prints — city, state, the country codes, GSTIN,
 * PAN and IEC. Five fields in a dialog were never going to be that, and two
 * forms writing the same five columns is one place too many.
 *
 * EVERY FIELD IS OPTIONAL
 *
 * A booking is entered before its consignee is confirmed, and the draft a
 * document prints while a field is missing is the thing the desk sends to chase
 * it. Blank is a legitimate state, and blanking a field that was filled wrongly
 * puts the document back to a draft — which is the correct consequence, visible
 * immediately in the list behind this dialog.
 * ---------------------------------------------------------------------------
 */
export default function BookingDocumentDetails({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: Shipment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Record<string, string>>({
    container_type: shipment.container_type ?? "",
    package_count: shipment.package_count != null ? String(shipment.package_count) : "",
    package_type: shipment.package_type ?? "",
    hs_code: shipment.hs_code ?? "",
    net_weight_kg: shipment.net_weight_kg != null ? String(shipment.net_weight_kg) : "",
    invoice_value_inr:
      shipment.invoice_value_inr != null ? String(shipment.invoice_value_inr) : "",
    incoterm: shipment.incoterm ?? "",
    payment_terms: shipment.payment_terms ?? "",
  });
  const [loc, setLoc] = useState<boolean>(shipment.letter_of_credit === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  /** Empty becomes null, so clearing a field actually clears it. */
  const text = (k: string): string | null => (f[k]?.trim() ? f[k].trim() : null);
  const number = (k: string): number | null => {
    const raw = f[k]?.replace(/,/g, "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  async function save() {
    // Caught here rather than let through as null, which would silently discard
    // what somebody typed and look like the save had worked.
    for (const k of ["package_count", "net_weight_kg", "invoice_value_inr"]) {
      if (f[k]?.trim() && number(k) === null) {
        return setError(`"${f[k]}" is not a number.`);
      }
    }

    setBusy(true);
    setError(null);
    try {
      const patch: Partial<Details> = {
        container_type: text("container_type"),
        package_count: number("package_count"),
        package_type: text("package_type"),
        hs_code: text("hs_code"),
        net_weight_kg: number("net_weight_kg"),
        invoice_value_inr: number("invoice_value_inr"),
        incoterm: text("incoterm"),
        payment_terms: text("payment_terms"),
        letter_of_credit: loc,
      };
      await setBookingDocumentDetails(shipment.id, patch);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save those details.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col rounded-t-card shadow-pop sm:card sm:max-w-2xl"
        role="dialog"
        aria-label="Document details"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-medium text-text-primary">Document details</h2>
            <p className="text-[11.5px] text-text-muted">
              {shipment.id} · what the B/L, the invoice and the delivery order are waiting on
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-text-muted hover:text-text-primary disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/*
            The parties used to be edited here too, in five fields. They moved
            to the shipment's own Parties & B/L section, which holds the whole
            box a bill of lading prints — city, state, country codes, GSTIN, PAN
            and IEC, and the notify party, none of which fits in a dialog.

            Two forms writing the same five columns is one place too many, and
            the one somebody edits is whichever they happened to open.
          */}
          <div className="rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="text-[12px] text-text-secondary">
              Shipper, consignee and notify party are edited on{" "}
              <Link
                to={`/shipments/${shipment.id}/parties`}
                className="text-text-accent hover:underline"
              >
                Parties &amp; B/L
              </Link>
              , where the full B/L box lives.
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {shipment.consignee_name
                ? `Consignee is ${shipment.consignee_name}.`
                : "No consignee recorded yet — eight of the twelve documents wait on it."}
            </p>
          </div>

          <Group title="Particulars" hint="As they appear on the bill of lading.">
            <Row label="Container">
              <Select
                label="Container type"
                value={f.container_type}
                onChange={(v) => set("container_type", v)}
                options={[
                  { value: "", label: "Not stated" },
                  ...CONTAINER_TYPES.map((t) => ({
                    value: t.code,
                    label: `${t.label} · ${t.code}`,
                  })),
                ]}
              />
            </Row>
            <Row label="Packages">
              <div className="flex gap-2">
                <input
                  value={f.package_count}
                  onChange={(e) => set("package_count", e.target.value)}
                  inputMode="numeric"
                  placeholder="4"
                  className="w-24"
                  aria-label="Number of packages"
                />
                <input
                  value={f.package_type}
                  onChange={(e) => set("package_type", e.target.value)}
                  placeholder="Pallets, cartons, drums…"
                  className="min-w-0 flex-1"
                  aria-label="Package type"
                />
              </div>
            </Row>
            <Row label="HS code">
              <input
                value={f.hs_code}
                onChange={(e) => set("hs_code", e.target.value)}
                placeholder="5208.52"
                className="w-full font-mono"
              />
            </Row>
            <Row label="Net weight">
              <div className="flex items-center gap-2">
                <input
                  value={f.net_weight_kg}
                  onChange={(e) => set("net_weight_kg", e.target.value)}
                  inputMode="decimal"
                  placeholder="1720"
                  className="w-32"
                />
                <span className="text-[12px] text-text-muted">
                  kg
                  {shipment.gross_weight_kg != null && (
                    <span className="ml-2">gross is {shipment.gross_weight_kg} kg</span>
                  )}
                </span>
              </div>
            </Row>
          </Group>

          <Group title="Commercial terms" hint="For the invoice and the packing list.">
            <Row label="Invoice value">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted">₹</span>
                <input
                  value={f.invoice_value_inr}
                  onChange={(e) => set("invoice_value_inr", e.target.value)}
                  inputMode="decimal"
                  placeholder="412000"
                  className="w-40"
                />
                <span className="text-[11.5px] text-text-muted">
                  the cargo's value, not the freight
                </span>
              </div>
            </Row>
            <Row label="Incoterm">
              <input
                value={f.incoterm}
                onChange={(e) => set("incoterm", e.target.value)}
                placeholder="FOB"
                className="w-32"
              />
            </Row>
            <Row label="Payment">
              <input
                value={f.payment_terms}
                onChange={(e) => set("payment_terms", e.target.value)}
                placeholder="30 days from B/L date"
                className="w-full"
              />
            </Row>
            <Row label="L/C">
              <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={loc}
                  onChange={(e) => setLoc(e.target.checked)}
                  className="size-4"
                />
                Under a letter of credit
              </label>
            </Row>
          </Group>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="max-w-sm text-[11px] leading-relaxed text-text-muted">
            Anything left blank keeps its document printing as a draft naming what it needs.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-muted">{hint}</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-start sm:gap-3">
      <span className="text-[12px] text-text-secondary sm:leading-8">{label}</span>
      <div className="min-w-0">{children}</div>
    </label>
  );
}
