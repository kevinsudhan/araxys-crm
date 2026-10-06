/**
 * The connection to the database kept open while somebody is working (7 Oct).
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * Measured from Chennai: a request on an open connection to the database's
 * gateway takes ~50 ms; the first after 40–50 seconds of quiet takes 270–320,
 * because the connection was closed meanwhile and has to be opened again. At
 * a desk that is most clicks — read a mail for a minute, then open the next
 * job. A tiny request every 20 seconds keeps it open.
 *
 * WHAT IT COSTS AND WHEN IT STOPS
 *
 * The gateway's health check, with the public key in the address so the
 * browser sends it as it is (no CORS preflight): a few hundred bytes. Only
 * while the tab is in view and somebody has moved the mouse or typed in the
 * last ten minutes; a tab left open overnight sends nothing. Coming back to
 * the tab, or moving the mouse after a pause, opens the line at once, while
 * the person is still finding what to click.
 * ---------------------------------------------------------------------------
 */

const EVERY_MS = 20_000;
const ACTIVE_MS = 10 * 60_000;

export function keepLineWarm(): () => void {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !key) return () => {};
  const url = `${base.replace(/\/+$/, "")}/auth/v1/health?apikey=${encodeURIComponent(key)}`;

  let lastActive = Date.now();
  let lastSent = Date.now();
  const send = () => {
    lastSent = Date.now();
    void fetch(url, { cache: "no-store", credentials: "omit" }).catch(() => {});
  };
  const tick = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastActive > ACTIVE_MS) return;
    if (Date.now() - lastSent < EVERY_MS - 1_000) return;
    send();
  };
  const onActive = () => {
    const now = Date.now();
    const quiet = now - lastActive;
    lastActive = now;
    // Back after a pause long enough for the line to have closed: open it now.
    if (quiet > EVERY_MS && now - lastSent > EVERY_MS) send();
  };
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    lastActive = Date.now();
    if (Date.now() - lastSent > EVERY_MS) send();
  };

  const timer = window.setInterval(tick, EVERY_MS);
  window.addEventListener("pointermove", onActive, { passive: true });
  window.addEventListener("keydown", onActive, { passive: true });
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("pointermove", onActive);
    window.removeEventListener("keydown", onActive);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
