import { BUCKET_MAX_BYTES, extensionFor, formatName, planMailImage, uploadErrorText } from "../../src/lib/mailImage";

/** A picture in a mail or a signature: what is kept, shrunk, converted or refused (lib/mailImage.ts). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

const MB = 1024 * 1024;
const SIG = 220; // the signature editor's display width

console.log("\nphotos");
is("a phone photo is scaled to twice the display width", planMailImage({ name: "IMG_2041.jpg", type: "image/jpeg", size: 4.2 * MB, width: 4032 }, SIG), { action: "convert", type: "image/jpeg", width: 440 });
is("a big photo in a mail body, twice 640", planMailImage({ name: "site.jpg", type: "image/jpeg", size: 3 * MB, width: 3000 }, 640), { action: "convert", type: "image/jpeg", width: 1280 });
is("a small logo is left alone", planMailImage({ name: "logo.png", type: "image/png", size: 40_000, width: 300 }, SIG), { action: "keep", type: "image/png" });
is("…and kept when it already fits", planMailImage({ name: "logo.png", type: "image/png", size: 40_000, width: 400 }, SIG), { action: "keep", type: "image/png" });
is("a narrow but heavy PNG is redrawn at its own width", planMailImage({ name: "scan.png", type: "image/png", size: 1.8 * MB, width: 400 }, SIG), { action: "convert", type: "image/png", width: 400 });
is("a JPEG that fits is kept", planMailImage({ name: "me.jpg", type: "image/jpeg", size: 90_000, width: 440 }, SIG), { action: "keep", type: "image/jpeg" });

console.log("\nformats Outlook does not show");
is("WebP becomes PNG", planMailImage({ name: "logo.webp", type: "image/webp", size: 20_000, width: 300 }, SIG), { action: "convert", type: "image/png", width: 300 });
is("SVG becomes PNG", planMailImage({ name: "logo.svg", type: "image/svg+xml", size: 5_000, width: 440 }, SIG), { action: "convert", type: "image/png", width: 440 });
is("HEIC Safari could read becomes JPEG", planMailImage({ name: "IMG.HEIC", type: "image/heic", size: 2.5 * MB, width: 4032 }, SIG), { action: "convert", type: "image/jpeg", width: 440 });
is("BMP becomes JPEG", planMailImage({ name: "a.bmp", type: "image/bmp", size: 6 * MB, width: 1200 }, SIG), { action: "convert", type: "image/jpeg", width: 440 });

console.log("\nrefused, with what to do");
const heic = planMailImage({ name: "IMG_0001.HEIC", type: "image/heic", size: 2 * MB, width: null }, SIG);
is("HEIC the browser cannot read", heic.action === "reject" && heic.reason, "IMG_0001.HEIC is a HEIC picture, which this browser cannot read. Save it as a JPG or PNG and add it again.");
const gif = planMailImage({ name: "wave.gif", type: "image/gif", size: 3 * MB, width: 500 }, SIG);
is("a moving GIF over 2 MB", gif.action === "reject" && gif.reason.startsWith("wave.gif is a 3 MB GIF"), true);
is("a GIF under 2 MB keeps its movement", planMailImage({ name: "wave.gif", type: "image/gif", size: 1 * MB, width: 500 }, SIG), { action: "keep", type: "image/gif" });
const huge = planMailImage({ name: "raw.png", type: "image/png", size: 40 * MB, width: 9000 }, SIG);
is("over 25 MB", huge.action === "reject" && huge.reason.includes("over 25 MB"), true);
const pdf = planMailImage({ name: "a.pdf", type: "application/pdf", size: 1000, width: null }, SIG);
is("not a picture", pdf.action === "reject" && pdf.reason.startsWith("Only pictures"), true);

console.log("\nnames and messages");
is("format from the type", formatName({ name: "x", type: "image/x-tiff" }), "TIFF");
is("format from the name when the type is empty", formatName({ name: "IMG.heic", type: "" }), "HEIC");
is("extensions", ["image/png", "image/jpeg", "image/gif"].map(extensionFor), ["png", "jpg", "gif"]);
is("the bucket's size refusal", uploadErrorText("The object exceeded the maximum allowed size"), "The picture is still over 2 MB. Use a smaller picture.");
is("the bucket's type refusal", uploadErrorText("mime type image/heic is not supported"), "That kind of picture cannot be used. Save it as a JPG or PNG and add it again.");
is("anything else keeps its words", uploadErrorText("Network error"), "Could not upload the picture: Network error");
is("the limit is the bucket's", BUCKET_MAX_BYTES, 2097152);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
