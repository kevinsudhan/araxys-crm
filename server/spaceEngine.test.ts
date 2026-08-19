import { checkFit, remainingCbm, type ContainerDims } from "./spaceEngine";

const c20GP: ContainerDims = {
  code: "20GP",
  internalLengthM: 5.9,
  internalWidthM: 2.35,
  internalHeightM: 2.39,
  maxPayloadKg: 28180,
};

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

console.log("\n1. Tall upright-only crate that volume-math would wrongly accept");
// One crate 260cm tall, "this way up" (machinery). Volume is tiny (~2.8 CBM) against a
// 33 CBM container, so naive volume math says "fits". It cannot: 2.6m exceeds the 2.39m
// internal height, and because it must stay upright it can't be laid down to compensate.
{
  const r = checkFit(c20GP, { lengthM: 5.9, payloadKg: 28180 }, {
    lengthCm: 120, widthCm: 90, heightCm: 260, quantity: 1, weightKgEach: 300, uprightOnly: true,
  });
  check("rejects a 2.6m-tall upright-only crate", r.fits === false, r);
  check("reason is piece_too_large_for_container", r.reason === "piece_too_large_for_container", r.reason);
  check("explains the upright constraint", (r.explanation ?? "").includes("upright"), r.explanation);
}

console.log("\n1b. Same crate, but tipping IS allowed -- should fit lying down");
{
  const r = checkFit(c20GP, { lengthM: 5.9, payloadKg: 28180 }, {
    lengthCm: 120, widthCm: 90, heightCm: 260, quantity: 1, weightKgEach: 300,
  });
  check("accepts when it may be laid on its side", r.fits === true, r);
}

console.log("\n2. Same crate lying down DOES fit (orientation awareness)");
{
  // 260 x 90 x 120 -- can lie along the 5.9m length.
  const r = checkFit(c20GP, { lengthM: 5.9, payloadKg: 28180 }, {
    lengthCm: 260, widthCm: 90, heightCm: 120, quantity: 1, weightKgEach: 300,
  });
  check("accepts it when a valid orientation exists", r.fits === true, r);
}

console.log("\n3. Normal multi-piece consignment");
{
  // 100x100x100cm boxes: 2 across (2.35/1.0), 2 high (2.39/1.0), 4 per row.
  const r = checkFit(c20GP, { lengthM: 5.9, payloadKg: 28180 }, {
    lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 8, weightKgEach: 200,
  });
  check("fits 8 one-metre boxes", r.fits === true, r);
  check("2 across", r.piecesAcrossWidth === 2, r.piecesAcrossWidth);
  check("2 high", r.piecesStackedHigh === 2, r.piecesStackedHigh);
  check("4 per row", r.piecesPerRow === 4, r.piecesPerRow);
  check("2 rows", r.rowsNeeded === 2, r.rowsNeeded);
  check("consumes 2m of floor", r.lengthConsumedM === 2, r.lengthConsumedM);
  check("total weight 1600kg", r.totalWeightKg === 1600, r.totalWeightKg);
  check("remaining length 3.9m", r.remainingAfter?.lengthM === 3.9, r.remainingAfter);
}

console.log("\n4. Non-stackable cargo uses more floor");
{
  const r = checkFit(c20GP, { lengthM: 5.9, payloadKg: 28180 }, {
    lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 8, weightKgEach: 200, stackable: false,
  });
  check("only 1 high when not stackable", r.piecesStackedHigh === 1, r.piecesStackedHigh);
  check("needs 4 rows instead of 2", r.rowsNeeded === 4, r.rowsNeeded);
  check("consumes 4m of floor", r.lengthConsumedM === 4, r.lengthConsumedM);
}

console.log("\n5. Runs out of length in a partly-full container");
{
  // Only 1.5m of floor left.
  const r = checkFit(c20GP, { lengthM: 1.5, payloadKg: 20000 }, {
    lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 12, weightKgEach: 100,
  });
  check("rejects when length runs out", r.fits === false, r);
  check("reason is not_enough_length_remaining", r.reason === "not_enough_length_remaining", r.reason);
  check("reports partial capacity (4 fit in 1m usable)", r.maxPiecesThatFit === 4, r.maxPiecesThatFit);
}

console.log("\n6. Overweight but physically fits");
{
  const r = checkFit(c20GP, { lengthM: 5.9, payloadKg: 1000 }, {
    lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 8, weightKgEach: 500,
  });
  check("rejects on payload", r.fits === false, r);
  check("reason is over_payload_limit", r.reason === "over_payload_limit", r.reason);
}

console.log("\n7. Invalid input");
{
  const r = checkFit(c20GP, { lengthM: 5.9, payloadKg: 28180 }, {
    lengthCm: 0, widthCm: 100, heightCm: 100, quantity: 5, weightKgEach: 10,
  });
  check("rejects zero dimension", r.fits === false && r.reason === "invalid_input", r);
}

console.log("\n8. remainingCbm reporting");
{
  check("full 20GP ~33.1 CBM", Math.abs(remainingCbm(c20GP, 5.9) - 33.14) < 0.05, remainingCbm(c20GP, 5.9));
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
