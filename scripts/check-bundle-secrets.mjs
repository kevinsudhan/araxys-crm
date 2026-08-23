/**
 * Fails the build if a secret reached the browser bundle.
 *
 * Everything in dist/ is public the moment it deploys — minification is not concealment,
 * and "it's only in a variable name" is not either. The specific way this goes wrong with
 * Vite is quiet: any env var named VITE_* is INLINED into the bundle as a literal string
 * at build time. Nobody imports it, nothing warns, and one rename from ANTHROPIC_API_KEY
 * to VITE_ANTHROPIC_API_KEY is the whole distance between a server-side secret and a key
 * published on a CDN.
 *
 * So this runs after every build, including the one Netlify runs, and exits non-zero
 * rather than letting a leaky bundle deploy.
 *
 *   node scripts/check-bundle-secrets.mjs
 *
 * Two things are checked:
 *   1. dist/ for material that looks like a live credential.
 *   2. env files and source for a VITE_-prefixed name that sounds like a secret — the
 *      cause, caught even when the value is absent from this machine.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

/** Patterns chosen to be specific enough that a hit is a real finding, not a chore. */
const CREDENTIALS = [
  { name: "Anthropic API key", re: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI-style API key", re: /\bsk-[A-Za-z0-9]{32,}/ },
  // Supabase service_role and anon keys are JWTs. Neither belongs in the browser here:
  // the CRM talks to an Edge Function, which holds the keys itself.
  { name: "JWT (service_role / anon key)", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "service_role reference", re: /service_role/ },
  { name: "secret env var name", re: /\b(?:ANTHROPIC_API_KEY|SNAPSERVE_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|ARAXYS_CRON_SECRET)\b/ },
];

/** A VITE_ name containing any of these is a secret about to be published. */
const SUSPICIOUS_VITE = /\bVITE_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*\b/g;

/** Never print the value — a leak report that reproduces the leak into CI logs is worse. */
function redact(match) {
  return `${match.slice(0, 6)}…${match.slice(-4)} (${match.length} chars)`;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const findings = [];

// ---------------------------------------------------------------- the bundle
if (!existsSync(dist)) {
  console.error("dist/ not found — run the build before this check.");
  process.exit(1);
}

// Source maps are not shipped by this build, but if that ever changes they carry the
// original source and must be scanned like anything else.
const files = walk(dist).filter((f) => /\.(js|mjs|cjs|css|html|json|map|txt)$/i.test(f));

for (const file of files) {
  const text = readFileSync(file, "utf-8");
  for (const { name, re } of CREDENTIALS) {
    const hit = text.match(re);
    if (hit) findings.push(`${relative(root, file)}: ${name} — ${redact(hit[0])}`);
  }
}

// ------------------------------------------------------- the cause, not the symptom
const configFiles = [".env", ".env.local", ".env.production", ".env.development", "netlify.toml"]
  .map((f) => join(root, f))
  .filter(existsSync);

const sourceFiles = existsSync(join(root, "src"))
  ? walk(join(root, "src")).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
  : [];

for (const file of [...configFiles, ...sourceFiles]) {
  const text = readFileSync(file, "utf-8");
  for (const match of text.match(SUSPICIOUS_VITE) ?? []) {
    findings.push(
      `${relative(root, file)}: ${match} — a VITE_ name is inlined into the bundle. ` +
        `Drop the VITE_ prefix and read it server-side instead.`,
    );
  }
}

// ---------------------------------------------------------------- verdict
if (findings.length) {
  console.error("\nBUILD BLOCKED — credential material in the published bundle:\n");
  for (const f of new Set(findings)) console.error(`  ${f}`);
  console.error(
    "\nSecrets belong in Supabase function secrets, read with Deno.env.get() inside\n" +
      "supabase/functions/. The browser reaches them only through the Edge Function.\n",
  );
  process.exit(1);
}

console.log(`bundle clean — ${files.length} files scanned, no credential material`);
