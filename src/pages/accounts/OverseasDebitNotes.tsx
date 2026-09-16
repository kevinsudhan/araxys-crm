import DocumentRegister from "../../components/DocumentRegister";

/**
 * Overseas debit notes.
 *
 * A thin page over the shared register: these documents are one row shape with
 * a different kind and a different party, so the list, the totals, the editor
 * and the export are written once.
 */
export default function OverseasDebitNotes() {
  return (
    <DocumentRegister
      spec={{
        kind: "debit_note",
        party: "partner",
        title: "Overseas debit notes",
        subtitle:
          "Billing an overseas agent their share of a job we handled. Usually in their currency, and netted on the next statement.",
        emptyHint:
          "Raise one against an agent from their statement, or from the console the job sat on.",
        exportAs: "overseas-debit-notes",
      }}
    />
  );
}
