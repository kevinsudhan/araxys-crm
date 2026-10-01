/**
 * A shipper's details as the customer types them into one box (114, 1 Oct):
 * usually pasted from a mail, a name on the first line and the address under
 * it, often with a contact and an email at the end.
 *
 * The first line is the name and the rest the address, kept as written — the
 * contact lines stay in it, as the desk would read them. A single line splits
 * at its first comma ("ABC Exports, 12 Main Road, Tiruppur 641601"). An email
 * address anywhere in it is kept as the email too. Too little to collect
 * from — no address after the name — is null, and the box says so.
 */
export interface ShipperParts {
  name: string;
  address: string;
  contact: string | null;
  email: string | null;
}

export function shipperFrom(text: string): ShipperParts | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  let name: string;
  let rest: string[];
  if (lines.length === 1) {
    const comma = lines[0].indexOf(",");
    if (comma < 0) return null;
    name = lines[0].slice(0, comma).trim();
    rest = [lines[0].slice(comma + 1).trim()];
  } else {
    name = lines[0];
    rest = lines.slice(1);
  }
  const address = rest.join("\n").trim();
  if (name.length < 2 || address.length < 5) return null;
  const email = text.match(/[^\s@,;:<>()"']+@[^\s@,;:<>()"']+\.[a-z]{2,}/i)?.[0].toLowerCase() ?? null;
  return { name: name.slice(0, 200), address: address.slice(0, 1000), contact: null, email };
}

/** What was given, back in the box to correct: the name, the address, and anything kept apart from it. */
export function shipperText(s: { name: string; address: string; contact?: string | null; email?: string | null }): string {
  const lower = s.address.toLowerCase();
  return [s.name, s.address, ...[s.contact, s.email].filter((x): x is string => !!x && !lower.includes(x.toLowerCase()))].join("\n");
}
