/**
 * A picture put into a mail, a signature or a partner request, made fit to send.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS RESHAPED BEFORE IT IS UPLOADED
 *
 * Pictures go to the public `signatures` bucket, which takes 2 MB at most and
 * only PNG, JPEG, GIF, WebP and SVG — and a phone photo is 3–5 MB, often HEIC.
 * The editor used to send the file as it was, so most photos failed with the
 * bucket's own "the object exceeded the maximum allowed size".
 *
 * And a picture that uploads is not yet one the recipient sees: Outlook shows
 * PNG, JPEG and GIF, not WebP or SVG. So:
 *
 *   PNG, JPEG  kept when small enough, else scaled down in the same format
 *   GIF        kept as it is (it may move); refused over 2 MB
 *   the rest   the browser draws it and it goes as PNG (a WebP or an SVG may
 *              be transparent) or JPEG (anything else, a photo)
 *
 * Scaled to twice the width it is shown at — sharp on a high-density screen,
 * and a fraction of a camera's pixels. A picture the browser cannot read at all
 * (HEIC, outside Safari) is refused with what to do about it.
 * ---------------------------------------------------------------------------
 */

/** The bucket's limit (migration 003). */
export const BUCKET_MAX_BYTES = 2 * 1024 * 1024;
/** Beyond this the browser is asked to hold too much to draw it; nobody's mail needs one. */
export const INPUT_MAX_BYTES = 25 * 1024 * 1024;
/** A picture already this small, and no wider than needed, goes untouched. */
const KEEP_MAX_BYTES = 1.5 * 1024 * 1024;

export type MailImageType = "image/png" | "image/jpeg" | "image/gif";

export type ImagePlan =
  | { action: "keep"; type: MailImageType }
  | { action: "convert"; type: "image/png" | "image/jpeg"; width: number }
  | { action: "reject"; reason: string };

export interface ImageInput {
  name: string;
  type: string;
  size: number;
  /** The picture's own width, or null when the browser could not read it. */
  width: number | null;
}

const MB = (n: number) => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;

/** What a person would call the format: "HEIC", "TIFF". */
export function formatName(i: Pick<ImageInput, "name" | "type">): string {
  const fromType = i.type.startsWith("image/") ? i.type.slice(6).replace(/^x-/, "").replace("+xml", "") : "";
  const fromName = i.name.includes(".") ? i.name.split(".").pop()! : "";
  return (fromType || fromName || "this").toUpperCase();
}

export function planMailImage(i: ImageInput, displayMax: number): ImagePlan {
  const label = i.name || "That picture";
  if (!i.type.startsWith("image/")) return { action: "reject", reason: "Only pictures go into the text. Attach other files with the paperclip." };
  if (i.size > INPUT_MAX_BYTES) return { action: "reject", reason: `${label} is ${MB(i.size)}. Pictures over 25 MB cannot be used; save a smaller copy first.` };
  if (i.width === null || i.width <= 0) {
    return { action: "reject", reason: `${label} is a ${formatName(i)} picture, which this browser cannot read. Save it as a JPG or PNG and add it again.` };
  }

  const target = Math.min(i.width, Math.max(1, Math.round(displayMax * 2)));
  if (i.type === "image/gif") {
    return i.size <= BUCKET_MAX_BYTES
      ? { action: "keep", type: "image/gif" }
      : { action: "reject", reason: `${label} is a ${MB(i.size)} GIF. A moving picture cannot be shrunk here; use one under 2 MB, or a JPG or PNG.` };
  }
  if (i.type === "image/png" || i.type === "image/jpeg") {
    if (i.width <= target && i.size <= KEEP_MAX_BYTES) return { action: "keep", type: i.type };
    return { action: "convert", type: i.type, width: target };
  }
  // WebP, SVG, BMP, AVIF, HEIC in Safari…: drawn and sent as something every mail client shows.
  const clear = i.type === "image/webp" || i.type === "image/svg+xml";
  return { action: "convert", type: clear ? "image/png" : "image/jpeg", width: target };
}

export const extensionFor = (type: string): string => ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" })[type] ?? "png";

/** Storage's refusals, in the desk's words. */
export function uploadErrorText(message: string): string {
  if (/maximum allowed size|payload too large|too large/i.test(message)) return "The picture is still over 2 MB. Use a smaller picture.";
  if (/mime type|not supported|invalid.*type/i.test(message)) return "That kind of picture cannot be used. Save it as a JPG or PNG and add it again.";
  if (/row-level security|unauthori[sz]ed|jwt|not signed/i.test(message)) return "Could not store the picture: sign in again and retry.";
  return `Could not upload the picture: ${message}`;
}

/* ---------------------------------------------------------------------------
 * In the browser: read the picture, and draw it again when the plan says so.
 * ------------------------------------------------------------------------- */

export type ReadyImage = { blob: Blob; type: MailImageType; ext: string; width: number };

/** Read through an <img>, which knows every format the browser does, SVG included. */
function load(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, width: number, type: "image/png" | "image/jpeg", quality: number): Promise<Blob | null> {
  const natural = img.naturalWidth || width;
  const height = Math.max(1, Math.round(((img.naturalHeight || natural) * width) / natural));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  if (type === "image/jpeg") {
    // A JPEG has no transparency: what was clear becomes white, not black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

export async function prepareMailImage(file: File, displayMax: number): Promise<ReadyImage | { error: string }> {
  const img = file.type.startsWith("image/") && file.size <= INPUT_MAX_BYTES ? await load(file) : null;
  // An SVG with no size of its own reads as 0 wide: draw it at twice the display width.
  const width = img ? img.naturalWidth || (file.type === "image/svg+xml" ? displayMax * 2 : 0) : null;
  const plan = planMailImage({ name: file.name, type: file.type, size: file.size, width }, displayMax);
  try {
    if (plan.action === "reject") return { error: plan.reason };
    if (plan.action === "keep") return { blob: file, type: plan.type, ext: extensionFor(plan.type), width: width! };

    let type: "image/png" | "image/jpeg" = plan.type;
    let w = plan.width;
    // Draw it; if it is still over the limit, as a JPEG, then smaller, until it fits.
    for (let tries = 0; tries < 6; tries++) {
      const blob = await draw(img!, w, type, 0.86);
      if (!blob) break;
      if (blob.size <= BUCKET_MAX_BYTES) return { blob, type, ext: extensionFor(type), width: w };
      if (type === "image/png") type = "image/jpeg";
      else w = Math.max(1, Math.round(w * 0.75));
    }
    return { error: `${file.name || "That picture"} could not be made small enough to send. Use a smaller picture.` };
  } finally {
    if (img) URL.revokeObjectURL(img.src);
  }
}
