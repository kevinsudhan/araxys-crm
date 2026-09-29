/**
 * The addresses typed or pasted into a To, Cc or Bcc box.
 *
 * Separated by commas or semicolons, the way Outlook separates them, and each
 * one either a bare address or Outlook's "Name <address>" — which is what
 * copying a recipient out of Outlook gives, and which used to be refused as
 * "not a valid email address". A comma or semicolon inside quotes or angle
 * brackets does not split ("Rajan, Meena" <meena@…>).
 *
 * Returns what was written, trimmed, with the angle-bracketed address taken
 * out where there is one; the caller still validates each.
 */
export function parseAddresses(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angled = true;
    else if (ch === ">") angled = false;
    if ((ch === "," || ch === ";") && !quoted && !angled) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const inside = part.match(/<([^<>]*)>/)?.[1]?.trim();
    const address = (inside || part).replace(/^mailto:/i, "").trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}
