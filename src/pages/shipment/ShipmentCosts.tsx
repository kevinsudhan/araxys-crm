import BillsPanel from "../../components/BillsPanel";
import { useShipment } from "../ShipmentDetail";

/**
 * What this job cost us.
 *
 * A thin wrapper around `BillsPanel`, which the console will mount too. What it
 * adds is the shell's `reload`, so recording a cost moves the margin in the
 * header without a manual refresh.
 */
export default function ShipmentCosts() {
  const { shipment, reload } = useShipment();
  return <BillsPanel shipmentId={shipment.id} onChanged={() => void reload()} />;
}
