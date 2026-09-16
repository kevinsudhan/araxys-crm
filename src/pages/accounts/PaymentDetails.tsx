import SettlementDetail from "../../components/SettlementDetail";

/** Which payment cleared which bill, and how much of it was TDS we withheld. */
export default function PaymentDetails() {
  return (
    <SettlementDetail
      direction="out"
      title="Payment details"
      subtitle="Every payment broken down to the bills it settled, including tax deducted at source on the way out."
      exportAs="payment-details"
    />
  );
}
