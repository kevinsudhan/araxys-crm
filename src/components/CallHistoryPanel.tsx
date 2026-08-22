import { useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import StatusPill from "./StatusPill";
import { getCallLogs, type CallLog } from "../services/backend";

/**
 * Calls for one customer: the generated summary first, the full transcript behind a
 * toggle. Ops staff read summaries constantly and transcripts rarely, so the transcript
 * is available without getting in the way.
 */
export default function CallHistoryPanel({ phone }: { phone: string }) {
  const [logs, setLogs] = useState<CallLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTranscript, setOpenTranscript] = useState<string | null>(null);

  useEffect(() => {
    getCallLogs(phone)
      .then((r) => setLogs(r.logs))
      .catch((e) => setError(String(e)));
  }, [phone]);

  if (error) return <p className="text-xs text-text-danger px-4 py-3">Couldn't load calls: {error}</p>;
  if (!logs)
    return (
      <p className="text-xs text-text-muted px-4 py-3 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Loading calls…
      </p>
    );
  if (!logs.length) return <p className="text-xs text-text-muted px-4 py-3">No calls recorded for this number yet.</p>;

  return (
    <div className="px-4 py-3 bg-surface-2 rounded-card mb-2">
      <p className="text-xs font-medium text-text-primary mb-2 flex items-center gap-1.5">
        <MessageSquare size={13} /> {logs.length} call{logs.length === 1 ? "" : "s"} on this number
      </p>

      {logs.map((log) => {
        const lines = (log.summary ?? "").split("\n").filter(Boolean);
        const headline = lines[0] ?? "No summary available";
        const bullets = lines.filter((l) => l.startsWith("•")).map((l) => l.replace(/^•\s*/, ""));
        const outcome = lines.find((l) => l.startsWith("Outcome:"))?.replace("Outcome: ", "");
        const isOpen = openTranscript === log.call_id;

        return (
          <div key={log.call_id} className="border-t border-border first:border-t-0 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-text-primary">{headline}</p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Call {log.call_id} · {log.direction ?? "unknown"} ·{" "}
                  {log.started_at ? new Date(log.started_at).toLocaleString() : "no timestamp"}
                </p>
              </div>
              {outcome && (
                <StatusPill
                  tone={
                    /agreed|proceed/i.test(outcome)
                      ? "success"
                      : /callback|revert|follow-up/i.test(outcome)
                      ? "warning"
                      : "neutral"
                  }
                >
                  {outcome}
                </StatusPill>
              )}
            </div>

            {bullets.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {bullets.map((b, i) => (
                  <li
                    key={i}
                    className={`text-xs ${
                      /follow-up owed/i.test(b) ? "text-text-warning font-medium" : "text-text-secondary"
                    }`}
                  >
                    • {b}
                  </li>
                ))}
              </ul>
            )}

            {log.transcript && (
              <>
                <button
                  onClick={() => setOpenTranscript(isOpen ? null : log.call_id)}
                  className="text-xs text-text-accent hover:underline mt-1.5"
                >
                  {isOpen ? "Hide transcript" : "Show transcript"}
                </button>
                {isOpen && (
                  <div className="mt-2 rounded-card bg-surface-1 border border-border p-3 max-h-72 overflow-y-auto">
                    {log.transcript.split("\n").map((line, i) => {
                      const m = line.match(/^(Agent|Caller):\s*(.*)$/);
                      if (!m) return null;
                      const isAgent = m[1] === "Agent";
                      return (
                        <div key={i} className={`flex mb-1.5 ${isAgent ? "justify-start" : "justify-end"}`}>
                          <div
                            className={`max-w-[80%] rounded-card px-2.5 py-1.5 text-xs ${
                              isAgent ? "bg-surface-2 text-text-primary" : "bg-bg-accent text-text-accent"
                            }`}
                          >
                            <span className="block text-[10px] text-text-muted mb-0.5">
                              {isAgent ? "Priya" : "Caller"}
                            </span>
                            {m[2]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
