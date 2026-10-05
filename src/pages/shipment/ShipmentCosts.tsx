import { useEffect, useState } from "react";
import BillsPanel from "../../components/BillsPanel";
import ProfitSharePanel from "../../components/ProfitSharePanel";
import { assignmentsFor } from "../../services/partners";
import { useShipment } from "../ShipmentDetail";

/**
 * What this job cost us.
 *
 * A thin wrapper around `BillsPanel`, which the console will mount too. What it
 * adds is the shell's `reload`, so recording a cost moves the margin in the
 * header without a manual refresh.
 *
 * A job on no console shares its profit with its overseas agent here (130):
 * the agent who routed it to us, or the one assigned on the enquiry. On a
 * console the share is the console's, on the console.
 */
export default function ShipmentCosts() {
  const { shipment, reload } = useShipment();
  const [agentIds, setAgentIds] = useState<string[] | null>(null);
  const routed = shipment.routed === "agent" ? shipment.routed_agent_id : null;

  useEffect(() => {
    if (shipment.console_id) return;
    let live = true;
    assignmentsFor(shipment.enquiry_ref)
      .then((a) => {
        if (!live) return;
        const assigned = a.filter((x) => x.role === "overseas_agent").map((x) => x.partner_id);
        setAgentIds([...new Set([...(routed ? [routed] : []), ...assigned])]);
      })
      .catch(() => live && setAgentIds(routed ? [routed] : []));
    return () => {
      live = false;
    };
  }, [shipment.enquiry_ref, shipment.console_id, routed]);

  return (
    <div className="space-y-6">
      <BillsPanel shipmentId={shipment.id} onChanged={() => void reload()} />
      {!shipment.console_id && agentIds && (
        <ProfitSharePanel subject={{ kind: "job", shipmentId: shipment.id, ref: shipment.enquiry_ref, agentIds }} onChanged={() => void reload()} />
      )}
    </div>
  );
}
