import DocumentRegister from "../../components/DocumentRegister";

/**
 * Overseas credit notes.
 *
 * A thin page over the shared register: these documents are one row shape with
 * a different kind and a different party, so the list, the totals, the editor
 * and the export are written once.
 */
export default function OverseasCreditNotes() {
  return (
    <DocumentRegister
      spec={{
        kind: "credit_note",
        party: "partner",
        title: "Overseas credit notes",
        subtitle:
          "Crediting an overseas agent something back, which reduces what they owe us on the next statement.",
        emptyHint:
          "Raise one against an agent when something billed to them has to come off.",
        exportAs: "overseas-credit-notes",
      }}
    />
  );
}
