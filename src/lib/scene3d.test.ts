/**
 * Checks on the load-plan camera.
 *
 *   npm run test:scene
 *
 * The interesting failures here are silent ones: a box that renders its inside face, or a
 * drag that flings a consignment down the container when the view is nearly end-on. Both
 * look like nothing at all in a screenshot, so they get asserted rather than eyeballed.
 */
import {
  DEFAULT_CAMERA,
  PRESETS,
  clampPitch,
  clampZoom,
  compact,
  depthOf,
  dragToMetres,
  indexForX,
  mixHex,
  normaliseYaw,
  nudgeOrder,
  reorderTo,
  sequenceOf,
  project,
  proposeMove,
  shade,
  visibleFaces,
  xAxisOnScreen,
  type Camera,
  type StowItem,
} from "./scene3d";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const cam = (yaw: number, pitch: number): Camera => ({ ...DEFAULT_CAMERA, yaw, pitch });
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

console.log("\n1. Projection is parallel, not perspective");
{
  // Two identical edges at opposite ends of the container must project to the same
  // length. If they ever differ, perspective has crept in and the plan is lying about
  // relative sizes -- the one thing a load plan may not do.
  const c = cam(Math.PI / 4, Math.PI / 6);
  const nearEdge = project(c, 1, 0, 0);
  const nearEdgeTop = project(c, 1, 1, 0);
  const farEdge = project(c, 11, 0, 2);
  const farEdgeTop = project(c, 11, 1, 2);
  const lenNear = Math.hypot(nearEdgeTop.x - nearEdge.x, nearEdgeTop.y - nearEdge.y);
  const lenFar = Math.hypot(farEdgeTop.x - farEdge.x, farEdgeTop.y - farEdge.y);
  check("a 1m vertical edge projects the same at both ends", near(lenNear, lenFar), [lenNear, lenFar]);
  check("origin projects to the origin", near(project(c, 0, 0, 0).x, 0) && near(project(c, 0, 0, 0).y, 0));
}

console.log("\n2. Height always reads as up the screen");
{
  for (const p of [0.1, Math.PI / 6, Math.PI / 3, 1.5]) {
    const c = cam(0.7, p);
    const floor = project(c, 2, 0, 1);
    const stacked = project(c, 2, 1.5, 1);
    check(`stacked cargo sits higher on screen at pitch ${p.toFixed(2)}`, stacked.y < floor.y, [floor.y, stacked.y]);
  }
}

console.log("\n3. Face culling follows the camera around");
{
  // At the default corner the doors end and the near side are what you see.
  const iso = visibleFaces(cam(Math.PI / 4, Math.PI / 6));
  check("iso view shows the doors end", iso.includes("xNear"), iso);
  check("iso view shows the near side wall", iso.includes("zNear"), iso);
  check("iso view shows the top", iso.includes("top"), iso);
  check("iso view hides the back wall", !iso.includes("xFar"), iso);

  // Orbit to the opposite corner and the opposite faces must take over. This is the
  // check that catches boxes rendering inside-out after a rotation.
  const rev = visibleFaces(cam((Math.PI * 5) / 4, Math.PI / 6));
  check("reverse view shows the back wall", rev.includes("xFar"), rev);
  check("reverse view shows the far side wall", rev.includes("zFar"), rev);
  check("reverse view hides the doors end", !rev.includes("xNear"), rev);

  check("never shows a face and its opposite at once", [0, 1, 2, 3, 4, 5, 6].every((i) => {
    const f = visibleFaces(cam((i * Math.PI) / 3.5, 0.4));
    return !(f.includes("xNear") && f.includes("xFar")) && !(f.includes("zNear") && f.includes("zFar"));
  }));
  check("bottom is never drawn", [0, 1, 2, 3, 4, 5].every((i) => !visibleFaces(cam(i, 0.4)).includes("bottom")));
}

console.log("\n4. Depth ordering matches what the camera sees");
{
  const c = cam(Math.PI / 4, Math.PI / 6);
  check("a box nearer the doors is nearer the camera", depthOf(c, 5, 0, 1) > depthOf(c, 1, 0, 1));
  const r = cam((Math.PI * 5) / 4, Math.PI / 6);
  check("orbiting reverses that ordering", depthOf(r, 5, 0, 1) < depthOf(r, 1, 0, 1));
}

console.log("\n5. Shading is fixed to the world, so it changes as you orbit");
{
  const a = shade("xNear");
  const b = shade("zNear");
  check("adjacent faces take different tones", Math.abs(a - b) > 0.05, [a, b]);
  check("top is the lightest face", shade("top") >= Math.max(a, b));
  check("every factor stays in range", (["xNear", "xFar", "zNear", "zFar", "top", "bottom"] as const)
    .every((f) => shade(f) >= 0 && shade(f) <= 1));
  check("opposite faces are complementary", near(shade("xNear") + shade("xFar"), 1, 1e-9));
}

console.log("\n6. Colour mixing");
{
  check("t=0 returns the first colour", mixHex("#1D9E75", "#0F6E56", 0) === "#1d9e75");
  check("t=1 returns the second", mixHex("#1D9E75", "#0F6E56", 1) === "#0f6e56");
  check("t is clamped, not wrapped", mixHex("#000000", "#ffffff", 5) === "#ffffff");
  check("midpoint is between the two", mixHex("#000000", "#ffffff", 0.5) === "#808080");
}

console.log("\n7. Dragging maps pixels to metres along the container");
{
  const c = { ...cam(Math.PI / 4, Math.PI / 6), zoom: 1 };
  const scale = 40;
  const ax = xAxisOnScreen(c);
  // Pushing the pointer exactly along the screen image of the x axis by `scale` pixels
  // worth of one metre should move the box one metre.
  const oneMetre = dragToMetres(c, ax.x * scale, ax.y * scale, scale);
  check("one metre of pointer travel moves one metre", oneMetre !== null && near(oneMetre, 1, 1e-9), oneMetre);
  const back = dragToMetres(c, -ax.x * scale, -ax.y * scale, scale);
  check("dragging back moves back", back !== null && near(back, -1, 1e-9), back);
  // Perpendicular movement is the operator sliding across the container, which is not a
  // legal move -- it must not leak into the x position.
  const perp = dragToMetres(c, -ax.y * scale, ax.x * scale, scale);
  check("movement across the axis is ignored", perp !== null && near(perp, 0, 1e-9), perp);
}

console.log("\n7b. Dragging refuses to guess when the axis is edge-on");
{
  // Standing at the doors at eye level, the container's length runs directly away from
  // the viewer and collapses to a point on screen. A naive projection would divide by
  // that and hurl the consignment out of the doors on a two-pixel wobble.
  const endOn = cam(Math.PI / 2, 0.001);
  check("returns null instead of a wild number", dragToMetres(endOn, 3, 3, 40) === null, dragToMetres(endOn, 3, 3, 40));

  // Top-down is the view an operator would actually restow in, so it had better stay
  // draggable -- the guard must not be so eager that it disables the useful angle.
  const topDown = cam(Math.PI / 2, Math.PI / 2 - 0.001);
  const moved = dragToMetres(topDown, 0, 40, 40);
  check("top-down view is still draggable", moved !== null && near(moved, 1, 1e-3), moved);
}

console.log("\n8. Stow moves respect the physical container");
{
  const items: StowItem[] = [
    { id: "a", xM: 0, lengthM: 2 },
    { id: "b", xM: 2, lengthM: 1.5 },
    { id: "c", xM: 4, lengthM: 1 },
  ];
  const L = 12;

  const overlap = proposeMove(items, "c", 2.5, L);
  check("refuses a move that overlaps a neighbour", overlap.ok === false, overlap);
  check("names the consignment it would hit", overlap.reason === "overlaps b", overlap.reason);

  const past = proposeMove(items, "c", 11.6, L);
  check("will not let cargo hang out of the doors", past.xM <= L - 1 + 1e-9, past);
  check("says it was held at the wall", past.reason === "held at the container wall", past);

  const behind = proposeMove(items, "c", -3, L);
  check("will not let cargo pass through the back wall", behind.xM >= -1e-9, behind);

  const snapped = proposeMove(items, "c", 3.53, L);
  check("snaps flush against the block in front", near(snapped.xM, 3.5, 1e-9), snapped);
  check("and that snap is a legal position", snapped.ok === true, snapped);

  const free = proposeMove(items, "c", 7.4, L);
  check("a clear position is accepted as-is", free.ok === true && near(free.xM, 7.4, 1e-9), free);

  const tooLong = proposeMove([{ id: "x", xM: 0, lengthM: 20 }], "x", 1, L);
  check("rejects a consignment longer than the container", tooLong.ok === false, tooLong);

  const unknown = proposeMove(items, "nope", 1, L);
  check("rejects an unknown consignment", unknown.ok === false, unknown);
}

console.log("\n9. Compaction closes gaps without reordering");
{
  const gapped: StowItem[] = [
    { id: "a", xM: 0.5, lengthM: 2 },
    { id: "b", xM: 5, lengthM: 1.5 },
    { id: "c", xM: 9, lengthM: 1 },
  ];
  const c = compact(gapped);
  check("first block goes to the back wall", near(c[0].xM, 0));
  check("blocks end up touching", near(c[1].xM, 2) && near(c[2].xM, 3.5), c);
  check("order is preserved", c.map((i) => i.id).join("") === "abc", c.map((i) => i.id));
  check("no overlaps remain", c.every((i, n) => n === 0 || i.xM >= c[n - 1].xM + c[n - 1].lengthM - 1e-9));
}

console.log("\n9b. Changing the loading order");
{
  // Back wall first, doors last. Whatever is nearest the doors comes off first, so on a
  // groupage box this sequence has to match the order the consignments are wanted in.
  const items: StowItem[] = [
    { id: "a", xM: 0, lengthM: 3.6 },
    { id: "b", xM: 3.6, lengthM: 3.2 },
    { id: "c", xM: 6.8, lengthM: 2 },
  ];
  check("order is read off the positions", sequenceOf(items).join("") === "abc", sequenceOf(items));

  const cFirst = reorderTo(items, "c", 0);
  check("a block can be moved to the back wall", sequenceOf(cFirst).join("") === "cab", sequenceOf(cFirst));
  check("and everything closes up behind it", near(cFirst[0].xM, 0) && near(cFirst[1].xM, 2) && near(cFirst[2].xM, 5.6), cFirst);

  const aLast = reorderTo(items, "a", 2);
  check("a block can be moved to the doors", sequenceOf(aLast).join("") === "bca", sequenceOf(aLast));

  check("reordering never leaves a gap", [0, 1, 2].every((t) => {
    const r = reorderTo(items, "b", t);
    return r.every((i, n) => n === 0 || near(i.xM, r[n - 1].xM + r[n - 1].lengthM, 1e-9));
  }));
  check("reordering never drops or duplicates a block", [0, 1, 2].every((t) =>
    reorderTo(items, "c", t).map((i) => i.id).sort().join("") === "abc"
  ));

  const past = reorderTo(items, "a", 99);
  check("an out-of-range index lands at the doors", sequenceOf(past).join("") === "bca", sequenceOf(past));
  check("an unknown id leaves the order alone", sequenceOf(reorderTo(items, "zz", 0)).join("") === "abc");
}

console.log("\n9c. Deciding the order from a drag");
{
  const items: StowItem[] = [
    { id: "a", xM: 0, lengthM: 3.6 },
    { id: "b", xM: 3.6, lengthM: 3.2 },
    { id: "c", xM: 6.8, lengthM: 2 },
  ];
  check("staying put keeps the same place", indexForX(items, "c", 6.8) === 2, indexForX(items, "c", 6.8));
  check("dragged to the back wall it takes first place", indexForX(items, "c", -1) === 0, indexForX(items, "c", -1));
  check("dragged between the two it takes the middle", indexForX(items, "c", 2.8) === 1, indexForX(items, "c", 2.8));

  // The swap must fire as the dragged block passes its neighbour's midpoint, measured
  // against where the others sit once it is lifted out of the line. Comparing against
  // their unlifted positions would make a short block unable to pass a long one -- it
  // could never travel far enough to clear it.
  check("a 2m block can pass a 3.6m one", indexForX(items, "c", 0.9) === 1, indexForX(items, "c", 0.9));
  check("index never exceeds the number of neighbours", indexForX(items, "a", 999) === 2, indexForX(items, "a", 999));
  check("index is never negative", indexForX(items, "a", -999) === 0);
}

console.log("\n9d. Stepping one place at a time");
{
  const items: StowItem[] = [
    { id: "a", xM: 0, lengthM: 3.6 },
    { id: "b", xM: 3.6, lengthM: 3.2 },
    { id: "c", xM: 6.8, lengthM: 2 },
  ];
  check("later moves it towards the doors", sequenceOf(nudgeOrder(items, "a", 1)).join("") === "bac");
  check("earlier moves it towards the back wall", sequenceOf(nudgeOrder(items, "c", -1)).join("") === "acb");
  check("earlier at the back wall is a no-op", sequenceOf(nudgeOrder(items, "a", -1)).join("") === "abc");
  check("later at the doors is a no-op", sequenceOf(nudgeOrder(items, "c", 1)).join("") === "abc");
  check("a no-op still returns a packed stow", nudgeOrder(items, "a", -1).every((i, n, all) => n === 0 || near(i.xM, all[n - 1].xM + all[n - 1].lengthM, 1e-9)));
}

console.log("\n10. Camera guards");
{
  check("pitch cannot reach the pole", clampPitch(9) < Math.PI / 2 && clampPitch(-9) > 0);
  check("zoom is bounded", clampZoom(999) === 4 && clampZoom(0) === 0.35);
  check("yaw wraps into one turn", near(normaliseYaw(-Math.PI / 2), (Math.PI * 3) / 2, 1e-9), normaliseYaw(-Math.PI / 2));
  check("every preset is a legal camera", Object.values(PRESETS).every((p) => clampPitch(p.pitch) === p.pitch));
  check("top preset really looks down", PRESETS.top.pitch > 1.5);
  check("side preset really looks level", PRESETS.side.pitch < 0.01);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
