import { canonicalCountry, COUNTRIES, countryProblem, groupByCountry } from "../../src/lib/countries";

/** Where a partner is, read against one list so Live rates groups them by country (116, 1 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log("the list");
is("no country twice", new Set(COUNTRIES).size, COUNTRIES.length);
is("alphabetical, so the picker reads in order", [...COUNTRIES].sort((a, b) => a.localeCompare(b)), COUNTRIES);

console.log("\nwhat is typed, to the list's spelling");
is("as written", canonicalCountry("Taiwan"), "Taiwan");
is("any case, any spacing", [canonicalCountry("taiwan"), canonicalCountry("  TAIWAN "), canonicalCountry("Taiwan, ROC")], ["Taiwan", "Taiwan", "Taiwan"]);
is("the short forms", [canonicalCountry("UAE"), canonicalCountry("usa"), canonicalCountry("U.K."), canonicalCountry("KSA")], [
  "United Arab Emirates",
  "United States",
  "United Kingdom",
  "Saudi Arabia",
]);
is("older and other names", [canonicalCountry("Burma"), canonicalCountry("Viet Nam"), canonicalCountry("Türkiye"), canonicalCountry("Korea")], [
  "Myanmar",
  "Vietnam",
  "Turkey",
  "South Korea",
]);
is("accents optional", [canonicalCountry("Cote d'Ivoire"), canonicalCountry("Côte d’Ivoire")], ["Côte d'Ivoire", "Côte d'Ivoire"]);
is("Hong Kong is its own", [canonicalCountry("Hong Kong"), canonicalCountry("HK")], ["Hong Kong", "Hong Kong"]);
is("not a country", [canonicalCountry("Jebel Ali"), canonicalCountry("Narnia"), canonicalCountry("")], [null, null, null]);

console.log("\nthe form's sentence");
is("none given", countryProblem("  "), "Say which country they are in. Live rates lists partners by country.");
is("not on the list", countryProblem("Kaohsiung"), '"Kaohsiung" is not a country on the list. Pick one from the suggestions.');
is("on the list", countryProblem("taiwan"), null);

console.log("\nby country");
const p = (organisation: string, country: string | null, name = "") => ({ organisation, name, country });
const groups = groupByCountry([
  p("Formosa Freight", "Taiwan"),
  p("Gulf Line Freight LLC", "UAE"),
  p("Old Partner", null),
  p("Asia Pacific Logistics", "taiwan"),
  p("Desert Star", "United Arab Emirates"),
  p("Blank Country", ""),
]);
is("countries in order, the unset last", groups.map((g) => g.country), ["Taiwan", "United Arab Emirates", ""]);
is("one spelling, one group", groups[0].partners.map((x) => x.organisation), ["Asia Pacific Logistics", "Formosa Freight"]);
is("UAE and United Arab Emirates together", groups[1].partners.map((x) => x.organisation), ["Desert Star", "Gulf Line Freight LLC"]);
is("those saved before it was asked, together", groups[2].partners.map((x) => x.organisation), ["Blank Country", "Old Partner"]);
is("nobody, no groups", groupByCountry([]), []);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
