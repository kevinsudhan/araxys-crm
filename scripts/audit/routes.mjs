/**
 * Dead links: every absolute path the app links to or navigates to, checked
 * against the routes App.tsx declares. Reads the code only.
 *
 *   node scripts/audit/routes.mjs
 *
 * A link to a route that was renamed or removed builds, typechecks and lands
 * on the catch-all. Template literals are checked with their ${…} parts as
 * wildcards ("/shipments/${id}/tracking" matches "/shipments/:id/tracking").
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const app = readFileSync(join(root, "src/App.tsx"), "utf-8");

// ---- the routes, nested paths joined to their parents ----
const sf = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const routes = [];
function attr(el, name) {
  const a = el.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
  if (!a || !a.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  return null;
}
function collect(node, base) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const open = ts.isJsxElement(node) ? node.openingElement : node;
    if (open.tagName.getText(sf) === "Route") {
      const path = attr(open, "path");
      const index = open.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "index");
      const full = path == null ? base : path.startsWith("/") ? path : `${base.replace(/\/$/, "")}/${path}`;
      if (path != null || index) routes.push(full || "/");
      if (ts.isJsxElement(node)) node.children.forEach((c) => collect(c, full));
      return;
    }
  }
  ts.forEachChild(node, (c) => collect(c, base));
}
collect(sf, "");
const patterns = routes.map((r) => ({
  route: r,
  re: new RegExp("^" + r.replace(/\*$/, ".*").replace(/:[a-zA-Z]+/g, "[^/]+").replace(/\/$/, "") + "/?$"),
}));

// ---- every absolute path in the code ----
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const problems = [];
let checked = 0;
for (const file of walk(join(root, "src"))) {
  const text = readFileSync(file, "utf-8");
  const f = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const check = (node, value) => {
    const path = value.split(/[?#]/)[0];
    if (!path.startsWith("/") || path.startsWith("//") || /^\/(assets|brand|icons|data|rest|functions|auth)\b/.test(path) || /\.[a-z0-9]{2,5}$/i.test(path)) return;
    checked++;
    if (!patterns.some((p) => p.re.test(path))) {
      const { line } = f.getLineAndCharacterOfPosition(node.getStart(f));
      problems.push(`${relative(root, file).replace(/\\/g, "/")}:${line + 1}  "${value}" matches no route`);
    }
  };
  const visit = (node) => {
    let target = null;
    if (ts.isJsxAttribute(node) && ["to", "href"].includes(node.name.getText(f)) && node.initializer) {
      target = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["navigate", "Navigate"].includes(node.expression.text)) target = node.arguments[0];
    if (ts.isPropertyAssignment(node) && ["to", "href", "path"].includes(node.name.getText(f))) target = node.initializer;
    if (target) {
      if (ts.isStringLiteral(target) || ts.isNoSubstitutionTemplateLiteral(target)) check(target, target.text);
      else if (ts.isTemplateExpression(target)) {
        const v = target.head.text + target.templateSpans.map((s) => "x" + s.literal.text).join("");
        check(target, v);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(f);
}
console.log(`${routes.length} routes · ${checked} absolute links checked`);
if (!problems.length) console.log("no dead links");
else {
  console.log(`\n${problems.length} dead link(s):`);
  for (const p of problems) console.log("  " + p);
}
process.exit(problems.length ? 1 : 0);
