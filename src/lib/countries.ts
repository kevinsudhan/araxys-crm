/**
 * Countries, for where a partner is (116).
 *
 * ---------------------------------------------------------------------------
 * WHY A FIXED LIST AND NOT FREE TEXT
 *
 * Live rates groups the partners by country, and a group is only as good as
 * its spelling: "Taiwan", "taiwan", "TW" and "Taiwan, ROC" typed by four people
 * would be four countries with one agent each. So what is typed is read
 * against this list -- names as the desk writes them, plus the short forms and
 * older names people use ("UAE", "USA", "Korea", "Burma") -- and the one
 * spelling here is what is saved. Anything not on it is refused with a
 * sentence, never guessed at.
 *
 * Hong Kong and Macau are listed apart from China, as the desk quotes them
 * apart (their own ports, customs and agents).
 * ---------------------------------------------------------------------------
 */

export const COUNTRIES: string[] = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia",
  "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin",
  "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
  "Cambodia", "Cameroon", "Canada", "Cape Verde", "Central African Republic", "Chad", "Chile", "China", "Colombia",
  "Comoros", "Congo", "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt",
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon",
  "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti",
  "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia",
  "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Macau", "Madagascar", "Malawi",
  "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
  "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
  "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman",
  "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
  "Puerto Rico", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "São Tomé and Príncipe", "Saudi Arabia", "Senegal", "Serbia",
  "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa",
  "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan",
  "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey",
  "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
  "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

/** Short forms and other names, to the spelling above. Keys are compared as `key()` writes them. */
const ALIASES: Record<string, string> = {
  uae: "United Arab Emirates",
  emirates: "United Arab Emirates",
  dubai: "United Arab Emirates",
  usa: "United States",
  us: "United States",
  america: "United States",
  "united states of america": "United States",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  korea: "South Korea",
  "republic of korea": "South Korea",
  "korea republic of": "South Korea",
  "korea south": "South Korea",
  "taiwan roc": "Taiwan",
  roc: "Taiwan",
  "chinese taipei": "Taiwan",
  prc: "China",
  "mainland china": "China",
  "peoples republic of china": "China",
  "hong kong sar": "Hong Kong",
  hk: "Hong Kong",
  "macao": "Macau",
  "viet nam": "Vietnam",
  burma: "Myanmar",
  "ivory coast": "Côte d'Ivoire",
  "cote divoire": "Côte d'Ivoire",
  ksa: "Saudi Arabia",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  turkiye: "Turkey",
  czechia: "Czech Republic",
  "russian federation": "Russia",
  ceylon: "Sri Lanka",
  "lao pdr": "Laos",
  swaziland: "Eswatini",
  "east timor": "Timor-Leste",
  "cabo verde": "Cape Verde",
  macedonia: "North Macedonia",
  "dr congo": "Democratic Republic of the Congo",
  drc: "Democratic Republic of the Congo",
  "republic of the congo": "Congo",
  "sao tome and principe": "São Tomé and Príncipe",
  "the gambia": "Gambia",
  "the bahamas": "Bahamas",
};

/** Lower case, accents off, punctuation to spaces: "Côte d'Ivoire" and "cote divoire" meet, and "U.K." is "uk". */
function key(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BY_KEY = new Map<string, string>([
  ...COUNTRIES.map((c) => [key(c), c] as [string, string]),
  ...Object.entries(ALIASES).map(([k, c]) => [key(k), c] as [string, string]),
]);

/** The list's spelling of what was typed, or null when it is not a country on the list. */
export function canonicalCountry(typed: string | null | undefined): string | null {
  const k = key(typed ?? "");
  return k ? BY_KEY.get(k) ?? null : null;
}

/** The sentence for a country the list does not know, or for none at all. */
export function countryProblem(typed: string | null | undefined): string | null {
  if (!(typed ?? "").trim()) return "Say which country they are in. Live rates lists partners by country.";
  return canonicalCountry(typed) ? null : `"${(typed ?? "").trim()}" is not a country on the list. Pick one from the suggestions.`;
}

export interface CountryGroup<P> {
  /** The country, or "" for partners saved before it was asked (116). */
  country: string;
  partners: P[];
}

/**
 * Partners by country, the countries in alphabetical order and anyone without
 * one last; within a country, by company then contact.
 */
export function groupByCountry<P extends { country?: string | null; organisation: string; name: string }>(partners: P[]): CountryGroup<P>[] {
  const groups = new Map<string, P[]>();
  for (const p of partners) {
    const c = canonicalCountry(p.country) ?? (p.country ?? "").trim();
    groups.set(c, [...(groups.get(c) ?? []), p]);
  }
  const byName = (a: P, b: P) => (a.organisation || a.name).localeCompare(b.organisation || b.name) || a.name.localeCompare(b.name);
  return [...groups.entries()]
    .map(([country, ps]) => ({ country, partners: [...ps].sort(byName) }))
    .sort((a, b) => (a.country === "" ? 1 : b.country === "" ? -1 : a.country.localeCompare(b.country)));
}
