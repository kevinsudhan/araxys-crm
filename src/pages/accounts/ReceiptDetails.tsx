import SettlementDetail from "../../components/SettlementDetail";

/** Which receipt cleared which invoice, and how much of it was TDS. */
export default function ReceiptDetails() {
  return (
    <SettlementDetail
      direction="in"
      title="Receipt details"
      subtitle="Every receipt broken down to the invoices it settled — one line per invoice, so a single one can be reconciled."
      exportAs="receipt-details"
    />
  );
}
