/**
 * A sink for screenshots taken inside the browser.
 *
 *   node scripts/shot-sink.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The README wants real screenshots of the product, and the only thing that can
 * render the product is the browser. Nothing in the toolchain writes a PNG from
 * a page — headless Chrome is not installed and adding Puppeteer to devDeps to
 * take five pictures is a large dependency for a small job.
 *
 * So the page renders itself with html2canvas and POSTs the result here, and
 * this writes the file. Started for the capture, stopped afterwards; it is not
 * part of the app and nothing in the app knows it exists.
 *
 * Bound to 127.0.0.1 so it is reachable from the browser on this machine and
 * from nowhere else.
 * ---------------------------------------------------------------------------
 */
import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "docs", "images");
mkdirSync(OUT, { recursive: true });

const PORT = 7788;

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST") return res.writeHead(405).end();

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { name, dataUrl } = JSON.parse(body);

      // The name becomes a path. Anything but a plain file stem is refused —
      // this writes to disk from a browser request and that is the one thing
      // worth being strict about, short-lived or not.
      if (!/^[a-z0-9-]{1,60}$/.test(name ?? "")) {
        return res.writeHead(400).end("bad name");
      }
      const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, "");
      const file = resolve(OUT, `${name}.png`);
      if (!file.startsWith(resolve(OUT))) return res.writeHead(400).end("bad path");

      writeFileSync(file, Buffer.from(b64, "base64"));
      const kb = Math.round(Buffer.from(b64, "base64").length / 1024);
      console.log(`wrote docs/images/${name}.png  ${kb} KB`);
      res.writeHead(200).end("ok");
    } catch (e) {
      console.error(e);
      res.writeHead(500).end("failed");
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`shot sink on http://127.0.0.1:${PORT}`));
