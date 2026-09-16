import DocumentRegister from "../../components/DocumentRegister";

/**
 * Invoices.
 *
 * A thin page over the shared register: these documents are one row shape with
 * a different kind and a different party, so the list, the totals, the editor
 * and the export are written once.
 */
export default function Invoices() {
  return (
    <DocumentRegister
      spec={{
        kind: "tax_invoice",
        party: "customer",
        title: "Invoices",
        subtitle:
          "Every tax invoice the desk has raised. Raising one happens on the shipment, because an invoice is about a job.",
        emptyHint:
          "Open a shipment and raise one from its Invoices section. The customer, the B/L, the tonnage and the accepted quote's charges all come across.",
        exportAs: "invoices",
      }}
    />
  );
}
