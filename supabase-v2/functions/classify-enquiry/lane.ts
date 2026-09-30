// Pure: no Deno APIs, so scripts/tests/lane.test.ts runs it under Node.

/*
  The lane, copied out of a subject line when the model leaves it blank.

  This trade writes "SEA SHIPMENT FROM XIAMEN TO CHENNAI//AAS//ENQ NO: 0217"
  and "FOB SHIPMENT FROM SHANGHAI TO CHENNAI // …"; a model reading a thread
  whose bodies say only "we will revert" came back with nothing, and those
  enquiries sat with "Route not captured" (30 Sep). The words are copied,
  never interpreted: "EX-SHANGHAI" is Shanghai, a country stays a country.
*/
export const tidyPlace = (raw: string): string | null => {
  const t = raw
    .replace(/^(ex[-\s]+|port of\s+)/i, "")
    .replace(/\s+(port|sea ?port|airport)$/i, "")
    .replace(/[.,;:\-\s]+$/g, "")
    .trim();
  if (t.length < 2 || t.length > 40 || /\d{3,}/.test(t)) return null;
  // Written in capitals, as subjects are: "CHENNAI" → "Chennai".
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : t;
};

export function laneFromSubjects(subjects: string[]): { origin: string | null; destination: string | null; air: boolean } {
  for (const subject of subjects) {
    const m = subject.match(/\bFROM\s+(.+?)\s+TO\s+(.+?)(?=\s*(\/|\||\/\/|\s-\s|,|\(|\bVIA\b|\bON\b|\bBY\b|\bWEEK\b|\bFOR\b|$))/i);
    if (m) {
      const origin = tidyPlace(m[1]);
      const destination = tidyPlace(m[2]);
      if (origin || destination) return { origin, destination, air: /\bAIR\s*(FREIGHT|SHIPMENT|CARGO|QUOTE|RATE|EXPORT|IMPORT)\b/i.test(subject) };
    }
  }
  return { origin: null, destination: null, air: subjects.some((x) => /\bAIR\s*(FREIGHT|SHIPMENT|CARGO|QUOTE|RATE|EXPORT|IMPORT)\b/i.test(x)) };
}
