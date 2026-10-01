/**
 * A table copied from a mail, a sheet or a web page, as the paste box keeps it.
 *
 * ---------------------------------------------------------------------------
 * A copied table travels twice on the clipboard: as HTML, which a mail draft
 * pastes as a table, and as plain text, which a text box takes. Gmail's plain
 * text puts every cell on a line of its own, so a six-column rate arrived as a
 * column of loose words and figures. The HTML is the table itself: each row
 * becomes one line here, its cells separated by tabs — the shape a sheet
 * copied from Excel already has, which reads row by row, on screen and for the
 * AI. Text around the table (a line above it, a note under it) comes with it.
 * ---------------------------------------------------------------------------
 */

const BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "BLOCKQUOTE", "CAPTION", "DD", "DIV", "DL", "DT", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6",
  "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "UL",
  // The rows and cells of a table that only lays a mail out (it holds another table).
  "TR", "TD", "TH",
]);
const SKIP = new Set(["HEAD", "META", "SCRIPT", "STYLE", "TITLE"]);

const tidy = (s: string) => s.replace(/[\s ​]+/g, " ").trim();

/** The clipboard's HTML as text with each table row on a line, cells tab-separated; null when it holds no table. */
export function tableTextFromHtml(html: string): string | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.querySelector("table")) return null;

  const lines: string[] = [""];
  const end = () => {
    if (lines[lines.length - 1].trim()) lines.push("");
  };
  let rows = 0;
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      lines[lines.length - 1] += n.textContent ?? "";
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (SKIP.has(el.tagName)) return;
    // A table of figures: a line per row. One that holds another table is
    // only the mail's layout, and is read through to the tables inside it.
    if (el.tagName === "TABLE" && !el.querySelector("table")) {
      end();
      for (const row of Array.from((el as HTMLTableElement).rows)) {
        const line = Array.from(row.cells)
          .map((c) => tidy(c.textContent ?? ""))
          .join("\t")
          .replace(/\t+$/, "");
        if (line.replace(/\t/g, "").trim()) {
          lines[lines.length - 1] = line;
          lines.push("");
          rows++;
        }
      }
      return;
    }
    if (el.tagName === "BR") {
      lines.push("");
      return;
    }
    const block = BLOCKS.has(el.tagName);
    if (block) end();
    el.childNodes.forEach(walk);
    if (block) end();
  };
  walk(doc.body);
  if (!rows) return null;

  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.includes("\t") ? raw : tidy(raw);
    if (!line && !out[out.length - 1]) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Pasted text as rows of cells, when it is a table (a row with a tab in it); null when it is not. */
export function tableRows(text: string): string[][] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.some((l) => l.includes("\t"))) return null;
  return lines.map((l) => l.split("\t").map((c) => c.trim()));
}
