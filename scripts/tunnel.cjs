/**
 * Starts the public tunnel AND re-registers the agent tools against its URL.
 *
 * Why this exists: quick tunnels get a new random hostname every start. If the tunnel is
 * restarted without re-registering, Priya's tools keep pointing at a dead host, every
 * lookup fails silently mid-call, and the agent falls back to guessing — which on the
 * phone is indistinguishable from the model hallucinating. Doing both in one command
 * makes that desync impossible.
 *
 *   npm run tunnel
 */
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const { bin } = require("cloudflared");

// 127.0.0.1, not "localhost": cloudflared resolves localhost to IPv6 [::1] on Windows,
// while the backend listens on IPv4 only — which shows up as intermittent "connection
// refused" and, on a live call, as the agent silently losing its tools and guessing.
const BACKEND = "http://127.0.0.1:8787";
const root = path.join(__dirname, "..");

async function backendUp() {
  try {
    const r = await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

(async () => {
  if (!(await backendUp())) {
    console.error("Backend is not responding on " + BACKEND);
    console.error("Start it first in another terminal:  npm run server");
    process.exit(1);
  }
  console.log("[tunnel] backend is up");

  const proc = spawn(bin, ["tunnel", "--url", BACKEND, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });

  let registered = false;
  const onData = async (buf) => {
    const text = buf.toString();
    process.stdout.write(text);
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m || registered) return;
    registered = true;
    const url = m[0];

    // Give the edge a moment to start routing before we point SnapServe at it.
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(20000) });
      if (!health.ok) throw new Error("health check returned " + health.status);
    } catch (e) {
      console.error(`\n[tunnel] ${url} is not reachable yet (${e.message}).`);
      console.error(`[tunnel] Register manually once it settles:`);
      console.error(`         node snapserve-setup/register-space-tool.cjs ${url}\n`);
      return;
    }

    console.log(`\n[tunnel] public URL: ${url}`);
    console.log("[tunnel] registering agent tools against it...");
    try {
      const out = execFileSync(
        process.execPath,
        [path.join(root, "snapserve-setup", "register-space-tool.cjs"), url],
        { encoding: "utf-8" }
      );
      process.stdout.write(out);
      console.log("[tunnel] tools registered. Priya can now look up real shipments.\n");
    } catch (e) {
      console.error("[tunnel] tool registration FAILED:", e.stdout || e.message);
      console.error(`[tunnel] retry with: node snapserve-setup/register-space-tool.cjs ${url}\n`);
    }
  };

  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData); // cloudflared prints the URL on stderr
  proc.on("exit", (code) => {
    console.error(`\n[tunnel] cloudflared exited (${code}). Priya's tools now point at a dead host —`);
    console.error("[tunnel] re-run `npm run tunnel` before taking any more calls.\n");
    process.exit(code ?? 1);
  });
})();
