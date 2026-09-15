/**
 * Two letters standing in for a sender.
 *
 * From the display name where there is one — "AAS INT" gives AI — and from the
 * local part of the address where there is not. Never from the domain: every
 * sender at one company would get the same two letters, which is the opposite
 * of what an avatar is for.
 *
 * Shared by the reading pane's header and by the list, so a sender is the same
 * two letters in both and the eye can move between them.
 */
export function initialsFor(name?: string | null, address?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return trimmed.slice(0, 2).toUpperCase();
  }
  const local = address?.split("@")[0] ?? "";
  return (local.slice(0, 2) || "?").toUpperCase();
}
