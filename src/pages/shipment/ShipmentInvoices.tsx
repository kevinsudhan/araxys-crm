import JobBilling from "../../components/JobBilling";
import { useShipment } from "../ShipmentDetail";

/**
 * The invoices section of a shipment.
 *
 * A thin wrapper: the work is in `JobBilling`, which the case file mounts too.
 * What this adds is the shell's `reload`, so issuing an invoice moves the billed
 * figure in the header without a manual refresh.
 */
export default function ShipmentInvoices() {
  const { shipment, reload } = useShipment();
  return <JobBilling shipmentId={shipment.id} onChanged={() => void reload()} />;
}
