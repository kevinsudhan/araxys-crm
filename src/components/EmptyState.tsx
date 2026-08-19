import { Inbox } from "lucide-react";

export default function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-text-muted">
      <Inbox size={28} className="mb-2" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
