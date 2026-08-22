import { cleanTranscript, extractFromTranscript } from "./transcripts";

const raw =
  "Agent: Hi, thisis Priyafromthe Araxysdesk.How canI helpyou? Hi, thisis Priyafromthe Araxysdesk.How canI helpyou?\n" +
  "Caller: I need details for BL number MSCU7291044, about 14 CBM to Colombo, quoted Rs. 18,500";

console.log("=== de-duplicated ===");
const cleaned = cleanTranscript(raw);
console.log(cleaned);

console.log("\n=== extracted ===");
console.log(JSON.stringify(extractFromTranscript(raw), null, 2));

let fail = 0;
const check = (label: string, cond: boolean) => {
  console.log(cond ? `  PASS  ${label}` : `  FAIL  ${label}`);
  if (!cond) fail++;
};

console.log("\n=== checks ===");
const agentLine = cleaned.split("\n")[0];
check("agent line no longer doubled", (agentLine.match(/How can/gi) ?? []).length === 1);
check("caller line untouched", cleaned.includes("MSCU7291044"));
const ex = extractFromTranscript(raw);
check("BL number found", ex.bl_number_mentioned === "MSCU7291044");
check("volume found", ex.volume_cbm === 14);
check("amount found", (ex.amounts_mentioned as number[])?.includes(18500));
check("port found", (ex.ports_mentioned as string[])?.includes("Colombo"));

process.exit(fail === 0 ? 0 : 1);
