import { useEffect, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import Select from "./Select";
import {
  captureIntake,
  updateIntake,
  CHANNEL_LABEL,
  type Intake,
  type IntakeChannel,
} from "../services/intake";

/**
 * Captures something that has arrived, or corrects it before it is pushed.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE IS REQUIRED
 *
 * Not one field is mandatory, and that is the point of the queue. A missed call
 * leaves a number and nothing else; somebody who rang while the desk was busy
 * leaves a name and a rough destination. Forcing a form to be complete before
 * it can be saved means the incomplete cases never get written down at all,
 * which is how a desk loses work.
 *
 * The one rule arrives later, at the push: an enquiry needs somebody's name to
 * belong to. That is enforced by the database, surfaced on the push panel, and
 * deliberately not enforced here.
 * ---------------------------------------------------------------------------
 */

const CHANNELS: IntakeChannel[] = ["call", "email", "whatsapp", "web", "walk_in", "manual"];

export default function IntakeForm({
  editing,
  onClose,
  onSaved,
}: {
  /** An existing row to correct. Omitted, this captures a new one. */
  editing?: Intake;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState<IntakeChannel>(editing?.channel ?? "call");
  const [contactName, setContactName] = useState(editing?.contact_name ?? "");
  const [company, setCompany] = useState(editing?.company ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [origin, setOrigin] = useState(editing?.origin ?? "");
  const [destination, setDestination] = useState(editing?.destination ?? "");
  const [cargo, setCargo] = useState(editing?.cargo ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields = {
        contact_name: contactName,
        company,
        phone,
        email,
        origin,
        destination,
        cargo,
        notes,
      };
      if (editing) {
        const blank = (v: string) => (v.trim() ? v.trim() : null);
        await updateIntake(editing.id, {
          channel,
          contact_name: blank(contactName),
          company: blank(company),
          phone: blank(phone),
          email: blank(email)?.toLowerCase() ?? null,
          origin: blank(origin),
          destination: blank(destination),
          cargo: blank(cargo),
          notes: blank(notes),
        });
      } else {
        await captureIntake({ channel, ...fields });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg card shadow-xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={editing ? "Edit intake" : "Capture an enquiry"}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">
            {editing ? "Edit this intake" : "Capture an enquiry"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" noValidate>
          {editing?.message_id && (
            <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px]">
              <p className="text-text-muted">Captured from an email</p>
              <p className="mt-0.5 text-text-primary">{editing.subject || "No subject"}</p>
              <p className="mt-1 text-[11px] text-text-muted">
                {editing.conversation_id
                  ? "Pushing this through links the whole thread, so replies file themselves."
                  : "The message will be pinned to the new case file."}
              </p>
            </div>
          )}

          {editing?.call_id && (
            <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px]">
              <p className="text-text-muted">Captured from a call</p>
              <p className="mt-0.5 font-mono text-text-primary">{editing.call_id}</p>
              <p className="mt-1 text-[11px] text-text-muted">
                Pushing this through moves the call and its transcript onto the new case file.
              </p>
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              How it reached us
            </label>
            <Select
              label="How it reached us"
              value={channel}
              onChange={(v) => setChannel(v as IntakeChannel)}
              options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Caller" value={contactName} onChange={setContactName} placeholder="Who rang" />
            <Field label="Company" value={company} onChange={setCompany} placeholder="Their company" />
            <Field label="Phone" value={phone} onChange={setPhone} placeholder="+91…" />
            <Field label="Email" value={email} onChange={setEmail} placeholder="name@company.com" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Origin" value={origin} onChange={setOrigin} placeholder="Chennai" />
            <Field
              label="Destination"
              value={destination}
              onChange={setDestination}
              placeholder="Jebel Ali"
            />
          </div>

          <Field label="Cargo" value={cargo} onChange={setCargo} placeholder="Roughly what" />

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What they said, what to check, who to call back"
              className="w-full resize-y"
            />
          </div>

          <p className="text-[11px] text-text-muted leading-relaxed">
            Nothing here is required. Write down what you have; a reference is only allocated when
            this is pushed into the inbound pipeline.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium transition-colors"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {editing ? "Save" : "Add to the queue"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-text-secondary mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full"
      />
    </div>
  );
}
