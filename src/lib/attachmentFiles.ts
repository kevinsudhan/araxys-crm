/**
 * What the in-app viewer can show, and saving a file to this device. Kept out
 * of AttachmentViewer so that knowing whether a file can be shown does not load
 * PDF.js with the page.
 */
export interface ViewerFile {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export type ViewKind = "pdf" | "image" | "text" | "other";

export function kindOf(f: { name: string; contentType?: string }): ViewKind {
  const t = (f.contentType || "").toLowerCase();
  const n = f.name.toLowerCase();
  if (t === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(t) || /\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return "image";
  if (t.startsWith("text/plain") || /\.(txt|csv|log)$/.test(n)) return "text";
  return "other";
}

/** Whether the viewer can show it, rather than only download it. */
export const canView = (f: { name: string; contentType?: string }) => kindOf(f) !== "other";

/** Saves the file to this device, under its own name. */
export function downloadBytes(f: ViewerFile) {
  const url = URL.createObjectURL(new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.contentType || "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = f.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
