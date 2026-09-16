import DocumentRegister from "../../components/DocumentRegister";

/**
 * Debit notes.
 *
 * A thin page over the shared register: these documents are one row shape with
 * a different kind and a different party, so the list, the totals, the editor
 * and the export are written once.
 */
export default function DebitNotes() {
  return (
    <DocumentRegister
      spec={{
        kind: "debit_note",
        party: "customer",
        title: "Debit notes",
        subtitle:
          "Raised when an invoice charged less than it should have — the taxable value or the tax was understated.",
        emptyHint:
          "A debit note is raised from the invoice it corrects, so its number and date are printed on it as Rule 53(1A) requires.",
        exportAs: "debit-notes",
      }}
    />
  );
}
