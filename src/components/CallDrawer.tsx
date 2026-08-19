import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { getCallDetail, type CallDetail } from "../services/backend";
import StatusPill from "./StatusPill";

/** Splits SnapServe's flat transcript string into speaker turns for display. */
function parseTranscript(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(Agent|Caller):\s*([\s\S]*)$/);
      if (!m) return { speaker: "note" as const, text: line };
      return { speaker: m[1] === "Agent" ? ("agent" as const) : ("customer" as const), text: m[2] };
    })
    // Bracketed system/context notes are pipeline annotations, not anything either
    // person said — keep them out of the conversation view.
    .filter((t) => !(t.speaker !== "note" && /^\[(SYSTEM NOTE|Context:)/i.test(t.text)));
}

export default function CallDrawer({ callId, onClose }: { callId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const d = await getCallDetail(callId);
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    tick();
    // Keep refreshing while the call is live so the transcript appears the moment it lands.
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [callId]);

  const turns = detail?.transcript ? parseTranscript(detail.transcript) : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className="w-[520px] max-w-full h-full bg-surface-1 border-l border-border overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-1 border-b border-border px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Call {callId}</p>
            {detail && (
              <p className="text-xs text-text-secondary mt-0.5">
                {detail.agentName} · {detail.direction === "inbound" ? "inbound from" : "to"} {detail.fromNumber}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {detail && (
              <StatusPill tone={detail.inProgress ? "danger" : "neutral"}>
                {detail.inProgress ? "Live" : detail.status}
              </StatusPill>
            )}
            <button onClick={onClose} aria-label="Close" className="text-text-secondary hover:text-text-primary">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {error && <p className="text-[13px] text-text-danger">Couldn't load this call: {error}</p>}

          {!detail && !error && (
            <p className="text-[13px] text-text-muted flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          )}

          {detail?.inProgress && !detail.transcriptAvailable && (
            <div className="rounded-card bg-bg-warning px-4 py-3 mb-4">
              <p className="text-[13px] text-text-warning font-medium">Call in progress</p>
              <p className="text-xs text-text-warning mt-1">
                SnapServe publishes the transcript when the call ends — there's no per-turn stream on their public
                API, so the conversation will appear here the moment it wraps up. This panel refreshes on its own.
              </p>
            </div>
          )}

          {detail?.callSummary && (
            <div className="rounded-card bg-surface-2 px-4 py-3 mb-4">
              <p className="text-xs text-text-secondary mb-1">Summary</p>
              <p className="text-[13px] text-text-primary">{detail.callSummary}</p>
            </div>
          )}

          {turns.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {turns.map((t, i) =>
                t.speaker === "note" ? (
                  <p key={i} className="text-[11px] text-text-muted italic px-1">
                    {t.text}
                  </p>
                ) : (
                  <div key={i} className={`flex ${t.speaker === "agent" ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[80%] rounded-card px-3 py-2 text-[13px] ${
                        t.speaker === "agent" ? "bg-surface-2 text-text-primary" : "bg-bg-accent text-text-accent"
                      }`}
                    >
                      <p className="text-[11px] text-text-muted mb-0.5">
                        {t.speaker === "agent" ? detail?.agentName ?? "Agent" : "Caller"}
                      </p>
                      {t.text}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {detail && !detail.inProgress && !detail.transcriptAvailable && (
            <p className="text-[13px] text-text-muted">No transcript was captured for this call.</p>
          )}
        </div>
      </div>
    </div>
  );
}
