import { checkContainerNo, isoFor, SIZE_TYPES } from "../../src/lib/containerNo";

/**
 * The container number check digit, and the ISO code that follows the size.
 *
 * Both exist so that an operator does not have to be the one who notices. The
 * check digit is the only thing in a container number that can catch a typo,
 * and the ISO code is a constant somebody would otherwise be looking up.
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

console.log("\nthe letter values skip every multiple of 11");
// Not exported, so it is tested through numbers whose check digit only comes
// out right if the mapping is: A=10, B=12 (11 skipped), L=23 (22), V=34 (33).
is("CSQU3054383 — the ISO 6346 worked example", checkContainerNo("CSQU3054383"), "ok");
is("MSKU9070323", checkContainerNo("MSKU9070323"), "ok");
is("TGHU7799745", checkContainerNo("TGHU7799745"), "ok");

console.log("\na wrong digit is caught");
is("last digit off by one", checkContainerNo("CSQU3054384"), "bad-check-digit");
is("a transposition inside the serial", checkContainerNo("CSQU3045383"), "bad-check-digit");

console.log("\nshape is checked before the arithmetic");
is("too few digits", checkContainerNo("CSQU305438"), "malformed");
is("digits where the owner code goes", checkContainerNo("CS1U3054383"), "malformed");
is("empty", checkContainerNo(""), "malformed");

console.log("\nspaces and dashes are how people write them, not errors");
is("spaced", checkContainerNo("CSQU 305438 3"), "ok");
is("dashed", checkContainerNo("CSQU-3054383"), "ok");
is("lower case", checkContainerNo("csqu3054383"), "ok");

console.log("\nthe ISO code follows the size, so nobody types it");
is("40ft high cube", isoFor("40' HC"), "45G1");
is("20ft general purpose", isoFor("20' GP"), "22G1");
is("40ft reefer", isoFor("40' RF"), "45R1");
is("an unknown size gives nothing rather than a guess", isoFor("30' GP"), "");
is("every size in the list has a code", SIZE_TYPES.every((s) => s.iso.length === 4), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
