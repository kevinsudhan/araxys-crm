import { invalidate, noteWrite, shared } from "../../src/lib/queryCache";

/** Shared reads (7 Oct 2026): one trip for reads made at once, never one that predates a save. */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

/** A read that answers when told to, counting how often it was made. */
function reader<T>(value: () => T) {
  let calls = 0;
  const pending: Array<() => void> = [];
  const fn = () => {
    calls++;
    return new Promise<T>((resolve) => pending.push(() => resolve(value())));
  };
  return {
    fn,
    calls: () => calls,
    answer: () => {
      for (const go of pending.splice(0)) go();
      return new Promise((r) => setTimeout(r, 0));
    },
  };
}

async function main() {
  console.log("at once");
  {
    const r = reader(() => [1, 2]);
    const a = shared("t1:x", r.fn);
    const b = shared("t1:x", r.fn);
    await r.answer();
    const [va, vb] = await Promise.all([a, b]);
    is("two callers, one trip", r.calls(), 1);
    is("both have the answer", [va, vb], [[1, 2], [1, 2]]);
    va.push(3);
    is("each its own list", vb, [1, 2]);
    const c = shared("t1:x", r.fn);
    await r.answer();
    await c;
    is("asked again after it came back: a new trip", r.calls(), 2);
  }

  console.log("a save in between");
  {
    let row = "before";
    const r = reader(() => row);
    const first = shared("t2:x", r.fn);
    noteWrite();
    row = "after";
    const second = shared("t2:x", r.fn);
    is("a read asked for after a save does not join one sent before it", r.calls(), 2);
    const third = shared("t2:x", r.fn);
    is("but one asked for after that joins the newer one", r.calls(), 2);
    await r.answer();
    is("the newer readers see the save", [await second, await third], ["after", "after"]);
    await first;
  }
  {
    // The older read finishing must not drop the newer one from the table.
    const r = reader(() => "x");
    const old = shared("t3:x", r.fn);
    noteWrite();
    const fresh = shared("t3:x", r.fn);
    is("two trips", r.calls(), 2);
    await r.answer();
    await Promise.all([old, fresh]);
    const again = shared("t3:x", r.fn);
    is("both done: the next read goes again", r.calls(), 3);
    await r.answer();
    await again;
  }

  console.log("kept a while (ttl)");
  {
    const r = reader(() => ["p"]);
    const a = shared("t4:list", r.fn, 60_000);
    await r.answer();
    await a;
    await shared("t4:list", r.fn, 60_000);
    is("within its time: no trip", r.calls(), 1);
    invalidate("t4:");
    const b = shared("t4:list", r.fn, 60_000);
    await r.answer();
    await b;
    is("invalidated: a trip", r.calls(), 2);
  }
  {
    const r = reader(() => ["q"]);
    const a = shared("t5:list", r.fn, 60_000);
    noteWrite();
    await r.answer();
    await a;
    const b = shared("t5:list", r.fn, 60_000);
    await r.answer();
    await b;
    is("an answer that may predate a save is not kept", r.calls(), 2);
  }

  console.log("invalidate");
  {
    const r = reader(() => "v");
    const a = shared("t6:x", r.fn);
    invalidate("t6:");
    const b = shared("t6:x", r.fn);
    is("a change heard: the next read does not join the one on its way", r.calls(), 2);
    await r.answer();
    await Promise.all([a, b]);
  }

  console.log("a failure");
  {
    let n = 0;
    const boom = () => {
      n++;
      return Promise.reject(new Error("down"));
    };
    await shared("t7:x", boom, 60_000).catch(() => null);
    await shared("t7:x", boom, 60_000).catch(() => null);
    is("not kept: asked again", n, 2);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main();
