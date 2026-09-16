import DocumentRegister from "../../components/DocumentRegister";

/**
 * Credit notes.
 *
 * A thin page over the shared register: these documents are one row shape with
 * a different kind and a different party, so the list, the totals, the editor
 * and the export are written once.
 */
export default function CreditNotes() {
  return (
    <DocumentRegister
      spec={{
        kind: "credit_note",
        party: "customer",
        title: "Credit notes",
        subtitle:
          "Raised when an invoice charged more than it should have, or the service was not supplied as billed.",
        emptyHint:
          "A credit note is raised from the invoice it corrects. Section 34 lets it adjust tax only until the 30th of November following that year.",
        exportAs: "credit-notes",
      }}
    />
  );
}
