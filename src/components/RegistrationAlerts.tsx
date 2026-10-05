import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { istDay } from "../lib/enquiryRegister";
import { regAlerts } from "../lib/registrations";
import { listRegistrations } from "../services/registrations";

/**
 * A registration of the company's run out or running out (132): the MTO
 * registration the house B/Ls are issued under, the consol agent
 * registration, the bond, the guarantee. Said where the work is done — on
 * the consoles — because a lapsed one holds cargo at the port. Nothing is
 * shown while all is in order.
 */
export default function RegistrationAlerts({ className = "" }: { className?: string }) {
  const { session } = useAuth();
  const [alerts, setAlerts] = useState<ReturnType<typeof regAlerts>>([]);

  useEffect(() => {
    let live = true;
    listRegistrations()
      .then((r) => live && setAlerts(regAlerts(r, istDay(new Date().toISOString()))))
      .catch(() => live && setAlerts([]));
    return () => {
      live = false;
    };
  }, []);

  if (!alerts.length) return null;
  const urgent = alerts.some((a) => a.urgent);
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] ${urgent ? "bg-bg-danger text-text-danger" : "bg-bg-warning text-text-warning"} ${className}`}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {alerts.map((a) => (
          <p key={a.id}>{a.text}</p>
        ))}
        <p className="text-[11.5px] opacity-80">
          {session?.role === "admin" ? (
            <Link to="/admin" className="underline">
              Renew it in Admin → Registrations and bond
            </Link>
          ) : (
            "An administrator renews it in Admin → Registrations and bond."
          )}
        </p>
      </div>
    </div>
  );
}
