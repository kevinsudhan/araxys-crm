import { useState } from "react";
import { Radio, WifiOff } from "lucide-react";
import PageHeader from "../components/PageHeader";
import RowCard from "../components/RowCard";
import StatusPill, { toneForRequestStatus } from "../components/StatusPill";
import ChannelBadge from "../components/ChannelBadge";
import EmptyState from "../components/EmptyState";
import CallDrawer from "../components/CallDrawer";
import { useLiveCalls } from "../hooks/useLiveCalls";
import { inboundRequests } from "../data/mockData";
import type { Channel } from "../types";

const channels: (Channel | "all")[] = ["all", "voice", "email", "whatsapp", "web_form"];

/** Phone numbers arrive in mixed shapes (+91 98765 43210 vs 918939153390). */
function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

function elapsed(startedAt: string) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function InboundRequests() {
  const [filter, setFilter] = useState<Channel | "all">("all");
  const [openCallId, setOpenCallId] = useState<number | null>(null);
  const { live, connected } = useLiveCalls();

  const list = inboundRequests.filter((r) => filter === "all" || r.channel === filter);

  // A request is "live" when one of its known phone numbers is on an active call.
  const liveByPhone = new Map(live.map((c) => [digitsOnly(c.fromNumber).slice(-10), c]));

  // Active calls from numbers we don't have a request row for yet — a brand new caller.
  const knownDigits = new Set(inboundRequests.map((r) => digitsOnly(r.phone).slice(-10)));
  const unknownLive = live.filter((c) => !knownDigits.has(digitsOnly(c.fromNumber).slice(-10)));

  return (
    <div>
      <PageHeader
        title="Inbound requests"
        subtitle="Multi-channel intake (voice, email, WhatsApp, web form) routed through one unified channel router into the intake & quote agent."
        action={
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            {connected === false ? (
              <>
                <WifiOff size={13} /> backend offline
              </>
            ) : (
              <>
                <Radio size={13} className={live.length ? "text-text-danger" : ""} />
                {live.length ? `${live.length} live now` : "watching for calls"}
              </>
            )}
          </span>
        }
      />

      {unknownLive.map((c) => (
        <RowCard key={`live-${c.id}`} onClick={() => setOpenCallId(c.id)}>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-text-danger animate-pulse" />
            <StatusPill tone="danger">Live</StatusPill>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text-primary font-medium truncate">New caller · {c.fromNumber}</p>
            <p className="text-xs text-text-secondary truncate">
              On the line with {c.agentName} — no request record yet
            </p>
          </div>
          <span className="text-xs text-text-secondary w-14 text-right">{elapsed(c.startedAt)}</span>
        </RowCard>
      ))}

      <div className="flex gap-1.5 mb-4 mt-1">
        {channels.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3 py-1.5 rounded-lg text-xs border ${
              filter === c
                ? "bg-surface-2 border-border-strong text-text-primary font-medium"
                : "border-border text-text-secondary hover:bg-surface-2"
            }`}
          >
            {c === "all" ? "All channels" : c.replace("_", " ")}
          </button>
        ))}
      </div>

      {list.length === 0 && <EmptyState label="No requests on this channel yet." />}

      {list.map((r) => {
        const onCall = liveByPhone.get(digitsOnly(r.phone).slice(-10));
        return (
          <RowCard key={r.id} onClick={onCall ? () => setOpenCallId(onCall.id) : undefined}>
            {onCall ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-text-danger animate-pulse" />
                <StatusPill tone="danger">Live</StatusPill>
              </span>
            ) : (
              <ChannelBadge channel={r.channel} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-text-primary font-medium truncate">{r.company}</p>
              <p className="text-xs text-text-secondary truncate">
                {onCall
                  ? `On the line with ${onCall.agentName} — click to open the conversation`
                  : `${r.origin} → ${r.destination} · ${r.volumeCbm} CBM · ${r.pastShipmentsCount} past shipments`}
              </p>
            </div>
            {onCall ? (
              <span className="text-xs text-text-secondary w-14 text-right">{elapsed(onCall.startedAt)}</span>
            ) : (
              <>
                {r.quoteAmount && (
                  <span className="text-xs text-text-secondary w-20 text-right">
                    ₹{r.quoteAmount.toLocaleString("en-IN")}
                  </span>
                )}
                <StatusPill tone={r.routedTo === "human_review" ? "warning" : "accent"}>
                  {r.routedTo === "human_review" ? "Human review" : "Quote agent"}
                </StatusPill>
                <StatusPill tone={toneForRequestStatus(r.status)}>{r.status.replace("_", " ")}</StatusPill>
              </>
            )}
          </RowCard>
        );
      })}

      {openCallId !== null && <CallDrawer callId={openCallId} onClose={() => setOpenCallId(null)} />}
    </div>
  );
}
