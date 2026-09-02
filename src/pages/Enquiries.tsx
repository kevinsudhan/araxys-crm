import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Search } from "lucide-react";
import PageHeader from "../components/PageHeader";
import {
  correspondenceFor,
  callsFor,
  getCustomer,
  searchEnquiries,
  unfiledMessages,
} from "../services/mockCaseFile";

/**
 * Every enquiry, searchable by anything a person would actually have to hand.
 *
 * Reference, customer, route, container number or bill of lading — because the
 * question is never "which enquiry id was that", it is "the Jebel Ali one for
 * Kavitha" or "whatever MSCU7291044 belongs to".
 */
export default function Enquiries() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchEnquiries(query), [query]);
  const unfiled = useMemo(() => unfiledMessages(), []);

  return (
    <div>
      <PageHeader
        title="Enquiries"
        subtitle="Every shipment as a case file — its mail, its calls, and everyone involved, under one reference."
      />

      <div className="relative max-w-md mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Reference, customer, route, container or B/L…"
          className="w-full pl-8"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        {results.map((e) => {
          const customer = getCustomer(e.customerId);
          const mail = correspondenceFor(e.ref).length;
          const calls = callsFor(e.ref).length;
          return (
            <Link
              key={e.ref}
              to={`/enquiries/${e.ref}`}
              className="block rounded-card border border-border bg-surface-1 p-4 hover:border-border-strong transition-colors"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-mono text-[12px] text-text-accent">{e.ref}</p>
                  <p className="mt-0.5 text-[14px] font-medium text-text-primary">
                    {customer?.company}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {e.origin} → {e.destination} · {e.cargo}
                    {e.volumeCbm ? ` · ${e.volumeCbm} CBM` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] font-medium text-text-accent capitalize">
                    {e.stage.replace("_", " ")}
                  </span>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {mail} mail · {calls} calls
                  </p>
                </div>
              </div>
            </Link>
          );
        })}

        {!results.length && (
          <p className="text-[13px] text-text-muted py-6">Nothing matches that.</p>
        )}
      </div>

      {/*
        Unfiled mail is shown rather than hidden. Anything a signal could not
        place stays here until somebody says where it belongs: a misfiled email
        puts one customer's correspondence into another's file, which is worse
        than one that has not been filed at all.
      */}
      {unfiled.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
            <AlertCircle size={12} className="text-text-warning" />
            Not filed to an enquiry
            <span className="text-text-muted">{unfiled.length}</span>
          </h2>
          <p className="text-[12px] text-text-secondary mb-2">
            No thread, subject reference or container number matched these. Open one to link it —
            the rest of its thread files itself afterwards.
          </p>
          <div className="space-y-2">
            {unfiled.map((m) => (
              <div key={m.id} className="rounded-card border border-border bg-surface-1 p-3">
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="text-text-primary">
                    {m.from.emailAddress.name || m.from.emailAddress.address}
                  </span>
                  <span>{m.from.emailAddress.address}</span>
                  <span className="ml-auto">via {m.mailbox.split("@")[0]}@</span>
                </div>
                <p className="mt-0.5 text-[13px] text-text-primary">{m.subject}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
