import { extractCustomerFromTranscript, isWorthRecording } from "./extractCustomer";

let fail = 0;
const check = (label: string, cond: boolean, got?: unknown) => {
  console.log(cond ? `  PASS  ${label}` : `  FAIL  ${label} -> ${JSON.stringify(got)}`);
  if (!cond) fail++;
};

console.log("\n1. Full introduction with route and cargo");
{
  const t = [
    "Agent: Hi, this is Priya from the Araxys forwarder desk. How can I help you today?",
    "Caller: Hi, this is Kevin from Sudhan Exports. I need to ship some spices from Chennai to Male.",
    "Agent: Sure. How much volume are we talking about?",
    "Caller: About 14 CBM, LCL is fine.",
    "Agent: For Chennai to Male on LCL that comes to about Rs. 18,500 all in.",
  ].join("\n");
  const r = extractCustomerFromTranscript(t);
  check("name", r.customerName === "Kevin", r.customerName);
  check("company", r.company === "Sudhan Exports", r.company);
  check("origin", r.origin === "Chennai", r.origin);
  check("destination", r.destination === "Male", r.destination);
  check("volume", r.volumeCbm === 14, r.volumeCbm);
  check("container", r.containerType === "LCL", r.containerType);
  check("quote", r.quotedAmountInr === 18500, r.quotedAmountInr);
  check("cargo", (r.cargoDescription ?? "").includes("spices"), r.cargoDescription);
}

console.log("\n2. Route direction is not reversed");
{
  const t = "Caller: I want to send garments from Tuticorin to Colombo please.";
  const r = extractCustomerFromTranscript(t);
  check("origin Tuticorin", r.origin === "Tuticorin", r.origin);
  check("destination Colombo", r.destination === "Colombo", r.destination);
}

console.log("\n3. Sparse call yields blanks, not guesses");
{
  const t = "Caller: yeah hi\nCaller: I was just checking something";
  const r = extractCustomerFromTranscript(t);
  check("no invented company", r.company === undefined, r.company);
  check("no invented route", r.origin === undefined && r.destination === undefined, r);
}

console.log("\n4. Agent's own words are not read as the caller's identity");
{
  const t = "Agent: This is Priya from the Araxys forwarder desk.\nCaller: okay tell me the rate to Colombo";
  const r = extractCustomerFromTranscript(t);
  check("company is not Araxys", r.company === undefined || !/araxys/i.test(r.company), r.company);
  check("name is not Priya", r.customerName === undefined || !/priya/i.test(r.customerName), r.customerName);
}

console.log("\n5. Filler words are not mistaken for names");
{
  // Seen for real: a record was created with the customer's name saved as "Calling".
  const a = extractCustomerFromTranscript("Caller: hi this is Kevin calling from Sudhan Exports");
  check("trailing filler stripped from name", a.customerName === "Kevin", a.customerName);
  check("company still found", a.company === "Sudhan Exports", a.company);

  const b = extractCustomerFromTranscript("Caller: this is calling from Sudhan Exports about a shipment");
  check("no name invented when only filler present", b.customerName === undefined, b.customerName);

  const c = extractCustomerFromTranscript("Caller: yeah I'm just checking on something");
  check("'just' not saved as a name", c.customerName === undefined, c.customerName);
}

console.log("\n6. The phrasings callers actually use");
{
  // Taken verbatim from a real call: the agent asked "can I take your name for the file?"
  // and the caller replied like this. The original patterns missed it entirely.
  const a = extractCustomerFromTranscript("Caller: Yes, my name is Kevin.");
  check("'my name is Kevin'", a.customerName === "Kevin", a.customerName);

  const b = extractCustomerFromTranscript("Caller: name is Priya Raman");
  check("'name is Priya Raman'", b.customerName === "Priya Raman", b.customerName);

  const c = extractCustomerFromTranscript("Caller: you can call me Deepa");
  check("'you can call me Deepa'", c.customerName === "Deepa", c.customerName);

  const d = extractCustomerFromTranscript("Caller: my name is Kevin from Sudhan Exports");
  check("name + company together", d.customerName === "Kevin" && d.company === "Sudhan Exports", d);
}

console.log("\n7. Junk calls are filtered out");
{
  check(
    "hang-up rejected",
    !isWorthRecording({ direction: "inbound", durationSecs: 6, transcript: "Caller: hello" })
  );
  check(
    "outbound rejected",
    !isWorthRecording({ direction: "outbound", durationSecs: 90, transcript: "Caller: hi there friend how are you" })
  );
  check(
    "real enquiry accepted",
    isWorthRecording({
      direction: "inbound",
      durationSecs: 65,
      transcript: "Caller: hi this is Kevin from Sudhan Exports\nCaller: I need a quote to Colombo please",
    })
  );
}

console.log(fail === 0 ? "\nAll checks passed.\n" : `\n${fail} CHECK(S) FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
