import { useEffect, useState } from "react";
import { getLiveCalls, type LiveCall, type RecentCall } from "../services/backend";

/**
 * Polls the backend for calls currently in progress.
 *
 * Polling rather than websockets because SnapServe's public API exposes call-lifecycle
 * state, not a live stream — see server/index.ts. 4s is frequent enough that a tag
 * appears while someone is still talking, without hammering the API.
 */
export function useLiveCalls(intervalMs = 4000) {
  const [live, setLive] = useState<LiveCall[]>([]);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const data = await getLiveCalls();
        if (cancelled) return;
        setLive(data.live);
        setRecent(data.recent);
        setConnected(true);
      } catch {
        if (!cancelled) setConnected(false);
      }
    }

    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [intervalMs]);

  return { live, recent, connected };
}
