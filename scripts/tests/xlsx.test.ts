import {
  buildWorkbook,
  colName,
  crc32,
  esc,
  excelSerial,
  safeSheetName,
} from "../../src/lib/xlsx";

/**
 * The spreadsheet writer.
 *
 * An .xlsx that will not open is worse than no export at all — the desk finds
 * out in front of the customer they were sending it to. The zip has to be
 * byte-correct, so the CRC is checked against the standard value for the
 * polynomial, and the parts that silently corrupt a file (an unescaped
 * ampersand, a slash in a tab name) are checked individually.
 */

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

console.log("\nthe checksum the whole zip depends on");
is(
  "crc32 of '123456789' is the published check value",
  crc32(new TextEncoder().encode("123456789")),
  0xcbf43926
);
is("crc32 of nothing", crc32(new Uint8Array()), 0);

console.log("\ncolumn letters past Z");
is("first", colName(0), "A");
is("twenty-sixth", colName(25), "Z");
is("the one that catches off-by-one", colName(26), "AA");
is("AZ to BA", colName(51), "AZ");
is("BA", colName(52), "BA");

console.log("\nExcel counts days from 30 December 1899");
is("the epoch itself", excelSerial(new Date(1899, 11, 30)), 0);
is("1 March 1900, after the leap bug it inherits", excelSerial(new Date(1900, 2, 1)), 61);
is("1 January 2026", excelSerial(new Date(2026, 0, 1)), 46023);
is("15 September 2026", excelSerial(new Date(2026, 8, 15)), 46280);

console.log("\nwhat breaks a file rather than a cell");
is("ampersand", esc("Sunrise & Co"), "Sunrise &amp; Co");
is("angle brackets", esc("<script>"), "&lt;script&gt;");
is("quotes, for attributes", esc('say "hi"'), "say &quot;hi&quot;");
is("a stray control character is dropped, not encoded", esc("a\u0001b"), "ab");
is("tabs and newlines survive", esc("a\tb\nc"), "a\tb\nc");

console.log("\ntab names Excel will accept");
is("slashes and brackets go", safeSheetName("P/L [2026]"), "P L 2026");
is("truncated to 31", safeSheetName("x".repeat(40)).length, 31);
is("an empty name still gives a sheet", safeSheetName("   "), "Sheet");

console.log("\nthe archive");
const bytes = buildWorkbook([
  { name: "One", columns: [{ header: "A" }], rows: [["x", 1, null]] },
]);
is("starts with the local file header signature", Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
is(
  "ends with the end-of-central-directory signature",
  Array.from(bytes.slice(-22, -18)),
  [0x50, 0x4b, 0x05, 0x06]
);
is("six parts for a one-sheet book", new DataView(bytes.buffer).getUint16(bytes.length - 14, true), 6);

const xml = new TextDecoder().decode(bytes);
is("an empty cell is omitted rather than written blank", xml.includes('r="C2"'), false);
is("a number is not quoted as a string", xml.includes('<c r="B2" s="0"><v>1</v></c>'), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
