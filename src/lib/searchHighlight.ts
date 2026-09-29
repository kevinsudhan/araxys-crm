/**
 * Mail search, the way Outlook shows it: the words searched for marked
 * wherever they appear, and a line of the message around the first one.
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * Searching "ALG09012-26" used to return a plain list of mails and nothing
 * saying where the reference was in any of them — the subject, the third
 * paragraph, a quoted reply at the bottom. Every result had to be opened to
 * find out why it was there.
 *
 * These are the pure parts: what the terms are, where they fall in a piece of
 * text, and which line of a body to show. The marking of an HTML body is in
 * MailBody, which has a DOM to do it with.
 * ---------------------------------------------------------------------------
 */

/** KQL's words, which are operators rather than things to find. */
const OPERATORS = new Set(["and", "or", "not", "near"]);

/**
 * The words and phrases in a search, as they should be marked.
 *
 * "quoted phrases" stay whole; `from:` and similar prefixes are dropped and
 * their value kept; KQL operators and wildcards go. A reference with a hyphen
 * or slash in it is also marked by its first part, because the search itself
 * matches "ALG09012" alone and a result found that way should still show where.
 */
export function searchTerms(query: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const term = t.replace(/\*/g, "").trim();
    if (term.length < 2 || OPERATORS.has(term.toLowerCase())) return;
    if (!out.some((x) => x.toLowerCase() === term.toLowerCase())) out.push(term);
  };
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    let token = (m[1] ?? m[2] ?? "").trim();
    if (!m[1]) {
      const field = token.match(/^[a-z]+:(.*)$/i);
      if (field) token = field[1].replace(/^"|"$/g, "");
    }
    add(token);
    if (!m[1]) {
      const [first] = token.split(/[-/]/);
      if (first && first !== token && first.length >= 4) add(first);
    }
  }
  // Longest first, so a whole reference wins over its first part.
  return out.sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One pattern for all the terms, case-insensitive; null when there are none. */
export function termsPattern(terms: string[]): RegExp | null {
  const usable = terms.filter(Boolean);
  if (!usable.length) return null;
  return new RegExp(`(${usable.map(escapeRe).join("|")})`, "gi");
}

/** A piece of text cut at every match, for drawing the matches marked. */
export function splitHighlights(text: string, terms: string[]): Array<{ text: string; hit: boolean }> {
  const re = termsPattern(terms);
  if (!re || !text) return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), hit: false });
    parts.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

/** Whether any term appears in the text. */
export function hasHit(text: string, terms: string[]): boolean {
  const re = termsPattern(terms);
  return !!re && re.test(text);
}

/** Tags and entities out of a body, and its whitespace run together. */
export function plainText(content: string, html: boolean): string {
  const text = html
    ? content
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
    : content;
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The line of a message to show under a search result: the text around the
 * first match, cut at word boundaries, with an ellipsis where it was cut.
 * Without a match in the body it is the body's start, as the preview was.
 */
export function snippetAround(text: string, terms: string[], width = 150): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const re = termsPattern(terms);
  const m = re ? re.exec(t) : null;
  if (!m) return t.length > width ? `${t.slice(0, width).replace(/\s+\S*$/, "")}…` : t;

  const lead = Math.floor(width * 0.3);
  let start = Math.max(0, m.index - lead);
  let end = Math.min(t.length, start + width);
  start = Math.max(0, end - width);
  if (start > 0) {
    const space = t.indexOf(" ", start);
    if (space >= 0 && space < m.index) start = space + 1;
  }
  if (end < t.length) {
    const space = t.lastIndexOf(" ", end);
    if (space > m.index + m[0].length) end = space;
  }
  return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}

/**
 * The query as KQL for Graph's $search.
 *
 * Each word is quoted, so "ALG09012-26" is looked for as written rather than
 * read as ALG09012 NOT 26, and several words must all appear, in any order —
 * how Outlook treats them. Somebody who writes their own KQL (a colon or a
 * quote) gets it passed through as written.
 */
export function kqlFor(query: string): string {
  const q = query.trim();
  if (!q) return "";
  if (/[:"]/.test(q)) return q;
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w}"`)
    .join(" ");
}
