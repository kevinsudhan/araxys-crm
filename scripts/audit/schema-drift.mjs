/**
 * Schema drift: every table, column, function, bucket and edge function the
 * code names, checked against the live v2 project. Reads only.
 *
 *   node scripts/audit/schema-drift.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * PostgREST resolves names at run time. A column renamed in a migration, an
 * RPC whose parameter is called p_id in SQL and p_shipment_id in the browser,
 * a function dropped (102 dropped two): each typechecks, builds and passes
 * every unit test, and fails only when somebody opens that screen. This reads
 * the code's own chains — supabase.from("t").select("a, b").eq("c", …),
 * .rpc("fn", { p_x: … }), .storage.from("b"), .functions.invoke("f") — with
 * the TypeScript compiler, and asks the live catalogue whether each exists.
 *
 * What it cannot see it says so: a table or select built from a variable is
 * counted as unresolved rather than guessed.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { accessToken, PROJECT } from "../../supabase-v2/token.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// ---- the live catalogue ----------------------------------------------------
const [cols, fns, buckets, published] = await Promise.all([
  sql(`select table_name t, column_name c from information_schema.columns where table_schema = 'public'`),
  sql(`select p.proname n, coalesce(p.proargnames, '{}') a, p.pronargs na, p.pronargdefaults nd,
              coalesce(array_length(p.proargmodes, 1), 0) m, p.proargmodes::text[] modes
         from pg_proc p where p.pronamespace = 'public'::regnamespace`),
  sql(`select id from storage.buckets`),
  sql(`select tablename t from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`),
]);
const fnList = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/functions`, {
  headers: { Authorization: `Bearer ${accessToken()}` },
}).then((r) => r.json());

const tables = new Map();
for (const { t, c } of cols) {
  if (!tables.has(t)) tables.set(t, new Set());
  tables.get(t).add(c);
}
const functions = new Map();
for (const f of fns) {
  // Only IN arguments are named in a call; OUT/TABLE columns are not.
  const names = f.a.filter((_, i) => !f.modes || ["i", "b", "v"].includes(f.modes[i]));
  const required = names.slice(0, Math.max(0, names.length - f.nd));
  if (!functions.has(f.n)) functions.set(f.n, []);
  functions.get(f.n).push({ names, required });
}
const bucketIds = new Set(buckets.map((b) => b.id));
const deployed = new Set((Array.isArray(fnList) ? fnList : []).map((f) => f.slug));
const live = new Set(published.map((p) => p.t));

// ---- the code --------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const files = [...walk(join(root, "src")), ...walk(join(root, "supabase-v2", "functions"))];

const problems = [];
const seen = { tables: new Set(), rpcs: new Set(), buckets: new Set(), invokes: new Set(), chains: 0, unresolved: 0 };
const CLIENTS = new Set(["supabase", "db", "admin", "sb", "client", "service", "svc"]);
const COLUMN_ARG = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy", "order", "not", "filter", "textSearch", "overlaps"]);

const where = (sf, node) => {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${relative(root, sf.fileName).replace(/\\/g, "/")}:${line + 1}`;
};
const flag = (sf, node, what) => problems.push(`${where(sf, node)}  ${what}`);

/** A string literal, or a const in the same file that holds one. */
function literal(sf, node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) {
    let found = null;
    const visit = (n) => {
      if (found) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === node.text && n.initializer) {
        if (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer)) found = n.initializer.text;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  }
  return null;
}

/** Top-level comma split, respecting parentheses. */
function splitTop(s) {
  const out = [];
  let depth = 0,
    cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Check a PostgREST select string against a table, embeds included. */
function checkSelect(sf, node, table, select) {
  const known = tables.get(table);
  for (let item of splitTop(select.replace(/\s+/g, " "))) {
    if (!item || item === "*" || item === "count") continue;
    if (item.startsWith("...")) item = item.slice(3);
    const embed = item.match(/^(?:([\w]+):)?([\w]+)(?:!([\w]+))?\s*\((.*)\)$/s);
    if (embed) {
      const rel = embed[2];
      if (tables.has(rel)) checkSelect(sf, node, rel, embed[4]);
      else if (!(known && known.has(rel))) flag(sf, node, `select on ${table}: embedded "${rel}" is neither a table nor a column`);
      continue;
    }
    const col = item.includes(":") ? item.split(":").slice(-1)[0] : item;
    const name = col.split("::")[0].split("->")[0].trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) continue;
    if (known && !known.has(name)) flag(sf, node, `select on ${table}: no column "${name}"`);
  }
}

function checkColumn(sf, node, table, col, how) {
  const known = tables.get(table);
  const raw = String(col).split("->")[0].trim();
  if (raw.includes(".")) {
    const [rel, inner] = raw.split(".");
    if (tables.has(rel)) return checkColumn(sf, node, rel, inner, `${how} (embedded ${rel})`);
  }
  const name = raw.split(".")[0];
  if (known && name && !known.has(name) && /^[a-z_][a-z0-9_]*$/i.test(name)) flag(sf, node, `${how} on ${table}: no column "${name}"`);
}

function objectKeys(node) {
  if (!node) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((e) => objectKeys(e) ?? []);
  if (!ts.isObjectLiteralExpression(node)) return null;
  return node.properties
    .filter((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name)
    .map((p) => (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null))
    .filter(Boolean);
}

/** From a .from(...) call, the methods chained after it. */
function chainAfter(call) {
  const out = [];
  let n = call;
  while (n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.parent && ts.isCallExpression(n.parent.parent)) {
    out.push({ method: n.parent.name.text, args: n.parent.parent.arguments, node: n.parent.parent });
    n = n.parent.parent;
  }
  return out;
}

function checkTableChain(sf, call, table) {
  seen.chains++;
  seen.tables.add(table);
  if (!tables.has(table)) return flag(sf, call, `table or view "${table}" does not exist`);
  for (const { method, args, node } of chainAfter(call)) {
    if (method === "select") {
      const s = literal(sf, args[0]);
      if (s != null) checkSelect(sf, node, table, s);
      else if (args[0]) seen.unresolved++;
    } else if (COLUMN_ARG.has(method)) {
      const c = literal(sf, args[0]);
      if (c != null) checkColumn(sf, node, table, c, `.${method}()`);
    } else if (method === "match") {
      for (const k of objectKeys(args[0]) ?? []) checkColumn(sf, node, table, k, ".match()");
    } else if (method === "or") {
      const s = literal(sf, args[0]);
      if (s != null) for (const part of splitTop(s)) if (!/^(and|or|not)\(/.test(part)) checkColumn(sf, node, table, part.split(".")[0], ".or()");
    } else if (method === "insert" || method === "update" || method === "upsert") {
      const keys = objectKeys(args[0]);
      if (keys) for (const k of keys) checkColumn(sf, node, table, k, `.${method}()`);
      if (method === "upsert" && args[1] && ts.isObjectLiteralExpression(args[1])) {
        const oc = args[1].properties.find((p) => p.name && p.name.text === "onConflict");
        const v = oc && ts.isPropertyAssignment(oc) ? literal(sf, oc.initializer) : null;
        if (v) for (const c of v.split(",")) checkColumn(sf, node, table, c.trim(), "onConflict");
      }
    }
  }
}

function checkRpc(sf, call, name) {
  seen.rpcs.add(name);
  const overloads = functions.get(name);
  if (!overloads) return flag(sf, call, `rpc "${name}" does not exist`);
  const keys = objectKeys(call.arguments[1]);
  if (keys === null && call.arguments[1]) return; // built elsewhere: cannot say
  const given = new Set(keys ?? []);
  const fits = overloads.some((o) => [...given].every((k) => o.names.includes(k)) && o.required.every((k) => given.has(k)));
  if (!fits) {
    const sig = overloads.map((o) => `(${o.names.map((n) => (o.required.includes(n) ? n : n + "?")).join(", ")})`).join(" | ");
    flag(sf, call, `rpc "${name}" called with {${[...given].join(", ")}} but takes ${sig}`);
  }
}

for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf-8"), ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const recv = node.expression.expression;
      const recvText = recv.getText(sf);
      const arg = literal(sf, node.arguments[0]);
      if (method === "from" && /\.storage$/.test(recvText)) {
        if (arg) {
          seen.buckets.add(arg);
          if (!bucketIds.has(arg)) flag(sf, node, `storage bucket "${arg}" does not exist`);
        } else seen.unresolved++;
      } else if (method === "from" && ts.isIdentifier(recv) && CLIENTS.has(recv.text)) {
        if (arg) checkTableChain(sf, node, arg);
        else seen.unresolved++;
      } else if (method === "rpc" && ts.isIdentifier(recv) && CLIENTS.has(recv.text)) {
        if (arg) checkRpc(sf, node, arg);
        else seen.unresolved++;
      } else if (method === "invoke" && /\.functions$/.test(recvText)) {
        if (arg) {
          seen.invokes.add(arg);
          if (!deployed.has(arg)) flag(sf, node, `edge function "${arg}" is not deployed`);
        }
      }
    }
    // whereIn("table", "select", "column", ids) — services/paging.ts
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "whereIn") {
      const [t, s, c] = node.arguments.map((a) => literal(sf, a));
      if (t) {
        seen.tables.add(t);
        if (!tables.has(t)) flag(sf, node, `table "${t}" does not exist (whereIn)`);
        else {
          if (s) checkSelect(sf, node, t, s);
          if (c) checkColumn(sf, node, t, c, "whereIn column");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Realtime: every table a page listens to must be published, or it hears nothing.
const listened = new Set();
const HOOKS = new Set(["useLiveVersion", "useLiveVersions", "useTableChanges", "useTablesChanges"]);
for (const file of files.filter((f) => !f.includes("functions"))) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf-8"), ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && HOOKS.has(node.expression.text)) {
      const name = node.expression.text;
      if (name === "useLiveVersion") for (const a of node.arguments) literal(sf, a) && listened.add(literal(sf, a));
      else if (name === "useTableChanges") literal(sf, node.arguments[0]) && listened.add(literal(sf, node.arguments[0]));
      else {
        // [[table, filter], …] — the first element of each tuple
        const scan = (n) => {
          if (ts.isArrayLiteralExpression(n) && n.elements.length === 2) {
            const t = literal(sf, n.elements[0]);
            if (t) listened.add(t);
          }
          ts.forEachChild(n, scan);
        };
        if (node.arguments[0]) scan(node.arguments[0]);
      }
    }
    // SHIPMENT_TABLES / ENQUIRY_TABLES
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /_TABLES$/.test(node.name.text) && node.initializer) {
      const init = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isArrayLiteralExpression(init)) for (const e of init.elements) literal(sf, e) && listened.add(literal(sf, e));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
for (const t of listened) {
  if (!tables.has(t)) problems.push(`realtime: "${t}" is listened to but is not a table`);
  else if (!live.has(t)) problems.push(`realtime: "${t}" is listened to but not in the supabase_realtime publication — its page never hears changes`);
}

console.log(`files ${files.length} · chains ${seen.chains} · tables ${seen.tables.size} · rpcs ${seen.rpcs.size} · buckets ${seen.buckets.size} · functions invoked ${seen.invokes.size} · listened ${listened.size} · unresolved ${seen.unresolved}`);
console.log(`deployed functions: ${[...deployed].sort().join(", ")}`);
if (!problems.length) console.log("no drift");
else {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log("  " + p);
}
process.exit(problems.length ? 1 : 0);
