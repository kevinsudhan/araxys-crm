import { hasHit, kqlFor, plainText, searchTerms, snippetAround, splitHighlights } from "../../src/lib/searchHighlight";

/**
 * Mail search, shown the way Outlook shows it: the terms marked and a line of
 * the message around the first one (29 Sep 2026).
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

console.log("the terms in a search");
is("a reference, and its first part", searchTerms("ALG09012-26"), ["ALG09012-26", "ALG09012"]);
is("words, longest first", searchTerms("meena quotation"), ["quotation", "meena"]);
is("a quoted phrase stays whole", searchTerms('"jebel ali" rate'), ["jebel ali", "rate"]);
is("a field prefix is dropped", searchTerms("from:meena@x.com"), ["meena@x.com"]);
is("operators and wildcards go", searchTerms("chennai AND ship*"), ["chennai", "ship"]);
is("one letter is not a term", searchTerms("a"), []);
is("the same word twice is once", searchTerms("Rate rate"), ["Rate"]);

console.log("\nmarking");
is("case-insensitive, text kept as written", splitHighlights("Re: alg09012-26 booking", ["ALG09012-26"]), [
  { text: "Re: ", hit: false },
  { text: "alg09012-26", hit: true },
  { text: " booking", hit: false },
]);
is("the whole reference, not its part", splitHighlights("[ALG09012-26]", searchTerms("ALG09012-26")), [
  { text: "[", hit: false },
  { text: "ALG09012-26", hit: true },
  { text: "]", hit: false },
]);
is("no terms, nothing marked", splitHighlights("text", []), [{ text: "text", hit: false }]);
is("special characters are literal", splitHighlights("2 x 40'HC (DG)", ["(DG)"]), [
  { text: "2 x 40'HC ", hit: false },
  { text: "(DG)", hit: true },
]);
is("a hit is found", hasHit("please quote ALG09012", ["alg09012"]), true);
is("and a miss is not", hasHit("please quote", ["alg09012"]), false);

console.log("\nthe line under a result");
const long = "Dear team, good day. " + "Some words about the weather and the week. ".repeat(6) + "The reference is ALG09012-26 for the Jebel Ali booking. " + "More closing words follow here. ".repeat(4);
const snip = snippetAround(long, ["ALG09012-26"], 120);
is("it contains the match", snip.includes("ALG09012-26"), true);
is("it is cut on both sides", snip.startsWith("…") && snip.endsWith("…"), true);
is("it is about the width asked", snip.length <= 124, true);
is("no match: the start", snippetAround("Short body text", ["zzz"]), "Short body text");
is("a long body without a match is cut", snippetAround("word ".repeat(80), ["zzz"], 40).endsWith("…"), true);
is("HTML to text", plainText("<p>Hi&nbsp;<b>Meena</b></p><style>p{}</style>", true), "Hi Meena");

console.log("\nthe query sent to Outlook");
is("each word quoted", kqlFor("ALG09012-26 meena"), '"ALG09012-26" "meena"');
is("KQL passed through", kqlFor('from:meena "jebel ali"'), 'from:meena "jebel ali"');
is("empty stays empty", kqlFor("  "), "");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
