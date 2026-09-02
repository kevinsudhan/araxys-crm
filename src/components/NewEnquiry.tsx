import { useEffect, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import {
  createEnquiry,
  findOrCreateCustomer,
  addParty,
  bindThread,
  listCustomers,
  type Customer,
  type EnquirySource,
} from "../services/enquiries";
import type { MailMessage } from "../services/backend";

/**
 * Opens an enquiry, either from an email or from a phone call.
 *
 * When it starts from a message, three things happen together: the customer is
 * found or created from the sender's address, the sender is recorded as a
 * client-side party, and the mail thread is bound to the new reference. That
 * last step is what makes the rest of the conversation file itself without
 * anyone touching it again.
 */
export default function NewEnquiry({
  fromMessage,
  onClose,
  onCreated,
}: {
  fromMessage?: MailMessage;
  onClose: () => void;
  onCreated: (ref: string) => void;
}) {
  const sender = fromMessage?.from.emailAddress;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [name, setName] = useState(sender?.name ?? "");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState(sender?.address ?? "");
  const [phone, setPhone] = useState("");

  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [cargo, setCargo] = useState("");
  const [source, setSource] = useState<EnquirySource>(fromMessage ? "email" : "call");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listCustomers().then((list) => {
      setCustomers(list);
      // An address we already know belongs to a customer we already have.
      if (sender?.address) {
        const known = list.find((c) =>
          c.emails.some((e) => e.toLowerCase() === sender.address.toLowerCase())
        );
        if (known) setCustomerId(known.id);
      }
    });
  }, [sender?.address]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const newCustomer = !customerId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newCustomer && !name.trim()) return setError("Enter the customer's name.");

    setBusy(true);
    try {
      const customer = customerId
        ? customers.find((c) => c.id === customerId)!
        : await findOrCreateCustomer({
            name: name.trim(),
            company: company.trim(),
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
          });

      const enquiry = await createEnquiry({
        customerId: customer.id,
        source,
        origin: origin.trim() || undefined,
        destination: destination.trim() || undefined,
        cargo: cargo.trim() || undefined,
      });

      if (fromMessage && sender?.address) {
        await addParty({
          enquiryRef: enquiry.ref,
          role: "client",
          name: sender.name || sender.address,
          organisation: company.trim() || customer.company,
          emails: [sender.address],
        });
        // Bind the thread so every reply files itself from here on.
        await bindThread(enquiry.ref, fromMessage.conversationId, fromMessage.id);
      }

      onCreated(enquiry.ref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the enquiry.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-card border border-border bg-surface-1 shadow-xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New enquiry"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">New enquiry</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" noValidate>
          {fromMessage && (
            <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px]">
              <p className="text-text-muted">Opening from</p>
              <p className="mt-0.5 text-text-primary">{fromMessage.subject}</p>
              <p className="text-text-secondary">{sender?.address}</p>
              <p className="mt-1 text-[11px] text-text-muted">
                This thread will be linked, so replies file themselves.
              </p>
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Customer
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full"
            >
              <option value="">— New customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.name} ({c.id})
                </option>
              ))}
            </select>
          </div>

          {newCustomer && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} placeholder="Contact name" />
              <Field label="Company" value={company} onChange={setCompany} placeholder="Company" />
              <Field label="Email" value={email} onChange={setEmail} placeholder="name@company.com" />
              <Field label="Phone" value={phone} onChange={setPhone} placeholder="+91…" />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Origin" value={origin} onChange={setOrigin} placeholder="Chennai" />
            <Field label="Destination" value={destination} onChange={setDestination} placeholder="Jebel Ali" />
          </div>

          <Field label="Cargo" value={cargo} onChange={setCargo} placeholder="What is being shipped" />

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Came in by
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as EnquirySource)}
              className="w-full"
            >
              <option value="email">Email</option>
              <option value="call">Phone call</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="web">Web form</option>
              <option value="manual">Entered by hand</option>
            </select>
          </div>

          <p className="text-[11px] text-text-muted">
            Only the customer is required. Route, cargo and dimensions can be filled in as the
            conversation goes on — the enquiry needs a reference now so everything else can hang
            off it.
          </p>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? "Opening…" : "Open enquiry"}
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
        autoComplete="off"
      />
    </div>
  );
}
