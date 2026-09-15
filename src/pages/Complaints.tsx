import { MessageSquareWarning } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { NotWired } from "../components/EmptyState";

/**
 * Complaints and exceptions.
 *
 * Same story as billing: it mapped over an array that no longer holds anything,
 * so it drew a heading over an empty page. There is no complaints store yet,
 * and the page says so rather than implying the desk has never had one.
 */
export default function Complaints() {
  return (
    <div>
      <PageHeader
        title="Complaints & exceptions"
        subtitle="Resolved on the call where possible, escalated with a real next step otherwise — never a bare 'we'll get back to you.'"
      />
      <NotWired
        what="Complaint handling"
        icon={MessageSquareWarning}
        source="Complaints raised on a call or by email will land here once they are recorded against a shipment."
      />
    </div>
  );
}
