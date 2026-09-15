/**
 * Fixes what call 19816 exposed.
 *
 *   node supabase-v2/fix-email-loop.mjs
 *   node supabase-v2/fix-email-loop.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * 1. THE ".com.com.com.com"
 *
 * The caller asked her to check the spelling, which the prompt allows once. She
 * spelled it. Then the caller made ordinary backchannel noises -- "Mmm",
 * "Correct-a", "Yeah, correct" -- and she treated each one as the confirmation
 * still being outstanding, so she started the whole read-back again:
 *
 *   Agent: Let me confirm your email. <spell>k,e,v,i,n,s,
 *   Caller: Yeah, correct.
 *   Agent: Let me confirm your email. <spell>k,e,v,i,n,s,
 *   Caller: Mmm.
 *   Agent: Let me confirm your email. <spell>k,e,v,i,n,s,u,d,h,a,n,a,l,@,g,m,a,i,l,.,c,com</spell>
 *
 * Four restarts, each cut off partway, each ending in another "com" -- which is
 * the stutter the caller heard. The last spell string is malformed as well:
 * ".,c,com" reads aloud as "dot c com".
 *
 * The existing rule said two attempts then stop, but it was about the address
 * being WRONG. Nothing covered "they already said it was right", and nothing
 * forbade restarting a read-back that had been interrupted. Both are added.
 *
 * 2. "OKAY, 20 PIECES" -- INVENTED FROM NOISE
 *
 *   Agent:  how many pieces like that?
 *   Caller: train the beast          <- ASR garbage
 *   Agent:  Okay, 20 pieces.
 *
 * She turned unintelligible audio into a quantity, and then quoted 70.8 CBM and
 * Rs 2,97,360 off it. Pranay got a no-invention rule after call 19094 for
 * exactly this; the desk needs the same one, because a fabricated piece count
 * reaches a price and a container.
 *
 * 3. "RIGHT, BOOK PANNITEN" -- SHE SAID SHE HAD BOOKED IT
 *
 * The prompt already has a section saying she cannot book and must not say she
 * has. It is losing to the momentum of closing a sale, so the prohibition is
 * repeated where it actually happens: the sentence right after a yes.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const DESK = 1071;

/** The block being replaced, verbatim from the live prompt. */
const OLD_HEADING = "TAKING AN EMAIL ADDRESS OR A NUMBER -- TWO ATTEMPTS, THEN STOP:";

const NEW_BLOCK = `TAKING AN EMAIL ADDRESS -- SAY IT TWICE AT MOST, THEN STOP:
An email address is worth ten seconds and no more. Going round on one is how a call gets abandoned.
- Ask once, plainly. Let them finish. People read addresses slowly and pause between the name and the domain; that pause is not your turn.
- Read it back ONCE, as normal words: "kevinsudhan31 at gmail dot com — is that right?" NEVER letter by letter. Never use spelling markup for an email address. Spelling garbles over a phone line and invites another round of the same.
- YOU MAY SAY AN EMAIL ADDRESS ALOUD AT MOST TWICE IN THE WHOLE CALL. Count them. Once when you read it back, and at most once more if they correct it. After the second, you stop saying it, whatever happens next.

"CORRECT" ENDS IT. THIS IS THE RULE THAT WAS BROKEN:
The moment the caller says correct, yes, ama, sari, right, ok, or simply makes an agreeing noise after you have read the address back, IT IS CONFIRMED. It is now a settled fact.
- Do not read it back again. Do not spell it "just to be sure". Do not start the sentence "let me confirm your email" a second time. Say something brief like "perfect, noted" and MOVE ON TO THE NEXT THING.
- A short sound -- "mm", "hm", "haan", "ama" -- after a read-back is agreement, not a request to repeat. Treat it as yes.
- If you are unsure whether they agreed, ask "is that right?" ONCE in plain words. Never re-read the address to find out.

NEVER RESTART A READ-BACK:
If you are part-way through saying an address and the caller speaks over you, DO NOT begin again from the first letter. Starting again is what produces "dot com, dot com, dot com" and it is the single worst thing you can do on a phone line.
- Stop. Ask "sorry — did you get that?" and take their answer.
- If they say yes, it is confirmed and you never say the address again.
- If they say no, say it ONCE more as normal words, not letters, and that is your second and final time.

IF THEY ASK YOU TO SPELL IT:
Spell it once, plainly, and then never again in that call. One spelling attempt is a courtesy; a second is a loop. If it is still not agreed after that, say: "let's not keep going round on this — I'll take the rest of the details and confirm the address with you another way," and move on with a note for the desk.
Not having the address is a small problem. Spending two minutes of a customer's call spelling it at them is a much bigger one.`;

const INVENT_HEADING = "NEVER TURN NOISE INTO A NUMBER:";

const INVENT_BLOCK = `${INVENT_HEADING}
Every figure you accept goes into a volume, then a price, then a container booking. A number you supplied because one was needed is not a small slip; it is a quotation for a shipment that does not exist.
- If the answer to "how many pieces?" is not a number you clearly heard, YOU DO NOT HAVE A PIECE COUNT. Words that sound like nothing in particular are not a quantity. On a real call "how many pieces?" was answered with an unintelligible fragment and it became "okay, 20 pieces" — and then a rate for 70.8 CBM and nearly three lakh rupees.
- NEVER round an unclear answer to a plausible-sounding figure. Not 10, not 20, not 100.
- When you did not catch it, say so and ask that ONE thing again: "sorry, the line broke up — how many pieces is it?" Two attempts, then take the rest of the details and note that the count is outstanding.
- The same applies to weights, dimensions and dates. A missing number costs one follow-up question. An invented one costs a container.
- If you have no piece count you CANNOT give a total. You may give the rate per CBM and say the total follows once you know how many pieces there are. Never multiply by a number you guessed.

AFTER THEY SAY YES, DO NOT SAY YOU HAVE BOOKED IT:
You have a whole section above about this and it is still going wrong: on a real call you answered a yes with "right, I've booked it." You have not. The desk places the booking against live space and it can be refused.
- Say what is true: "right, I'll put that through for the 8th at that rate and the desk will confirm it back to you."
- Never "booked", never "confirmed", never "you're on that sailing".
- A customer told "booked" arranges a truck, a warehouse slot and their buyer's delivery date around it.`;

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", `.agent-${DESK}-emailloop-backup.json`);

const live = await fetch(`${BASE}/agents/${DESK}`, { headers: H }).then((r) => r.json());
const current = (live.systemPrompt ?? "").replace(/\r/g, "");

let next;
if (revert) {
  if (!existsSync(backupPath)) {
    console.error("no backup to revert to");
    process.exit(1);
  }
  next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
} else {
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));

  // Replace the old two-attempts block: from its heading to the blank line
  // before the next ALL-CAPS heading.
  const start = current.indexOf(OLD_HEADING);
  if (start === -1) {
    console.error("could not find the email block — nothing changed");
    process.exit(1);
  }
  const after = current.indexOf("\n\n", start);
  const end = after === -1 ? current.length : after;
  next = current.slice(0, start) + NEW_BLOCK + current.slice(end);

  if (!next.includes(INVENT_HEADING)) next = `${next.trimEnd()}\n\n${INVENT_BLOCK}`;
}

const r = await fetch(`${BASE}/agents/${DESK}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const check = (await fetch(`${BASE}/agents/${DESK}`, { headers: H }).then((x) => x.json()))
  .systemPrompt;

console.log(
  `  Vaishnavi ${r.status}  ${current.length} -> ${check.length} chars\n` +
    `    "correct" ends it : ${check.includes('"CORRECT" ENDS IT') ? "ok" : "FAIL"}\n` +
    `    no restart        : ${check.includes("NEVER RESTART A READ-BACK") ? "ok" : "FAIL"}\n` +
    `    twice at most     : ${check.includes("AT MOST TWICE IN THE WHOLE CALL") ? "ok" : "FAIL"}\n` +
    `    no invented count : ${check.includes(INVENT_HEADING) ? "ok" : "FAIL"}\n` +
    `    old block gone    : ${check.includes(OLD_HEADING) ? "STILL THERE" : "ok"}`
);
