import DocumentRegister from "../../components/DocumentRegister";

/**
 * Proforma invoices.
 *
 * A thin page over the shared register: these documents are one row shape with
 * a different kind and a different party, so the list, the totals, the editor
 * and the export are written once.
 */
export default function Proformas() {
  return (
    <DocumentRegister
      spec={{
        kind: "proforma",
        party: "customer",
        title: "Proforma invoices",
        subtitle:
          "Sent before the work, so the customer knows what is coming. Not a tax document and not part of the statutory series.",
        emptyHint:
          "Raise one from a shipment when a customer wants the figure in writing before committing.",
        exportAs: "proformas",
      }}
    />
  );
}
