/**
 * Axonometric camera for the container load plan.
 *
 * The load plan was previously a fixed 30-degree isometric drawing -- correct, but you
 * could only ever see it from one corner, and a stow is exactly the kind of thing you
 * need to look at from the other side. This turns that single angle into a camera you
 * can orbit, while keeping the projection *parallel* rather than perspective: in a load
 * plan two boxes of the same size must read as the same size wherever they sit, and
 * perspective would quietly break that.
 *
 * World axes, matching the fit engine: x runs along the container from the back wall to
 * the doors, y is up, z runs across the width.
 */

export interface Camera {
  /** Rotation about the vertical axis, radians. */
  yaw: number;
  /** Elevation above the horizontal, radians. 0 is eye level, PI/2 is straight down. */
  pitch: number;
  /** Multiplier on the fitted scale. */
  zoom: number;
  /** Screen-space offset in projected units, applied after projection. */
  panX: number;
  panY: number;
}

export const DEFAULT_CAMERA: Camera = {
  yaw: Math.PI / 4,
  pitch: Math.PI / 6,
  zoom: 1,
  panX: 0,
  panY: 0,
};

export const PRESETS: Record<string, { yaw: number; pitch: number }> = {
  // The classic corner view this component started life as.
  iso: { yaw: Math.PI / 4, pitch: Math.PI / 6 },
  // Looking in through the container doors.
  doors: { yaw: Math.PI / 2, pitch: Math.PI / 10 },
  // Straight down: the honest answer to "how much floor is left".
  top: { yaw: 0, pitch: Math.PI / 2 - 0.001 },
  // Side elevation: the honest answer to "how high is it stacked".
  side: { yaw: 0, pitch: 0.001 },
  // The far corner -- what the fixed isometric view could never show.
  reverse: { yaw: (Math.PI * 5) / 4, pitch: Math.PI / 6 },
};

export interface Vec2 {
  x: number;
  y: number;
}

/** Clamps pitch to keep the container from turning inside out at the poles. */
export const clampPitch = (p: number) => Math.max(0.001, Math.min(Math.PI / 2 - 0.001, p));
export const clampZoom = (z: number) => Math.max(0.35, Math.min(4, z));

/** Wraps to [0, 2PI) so preset comparisons and tweens behave. */
export const normaliseYaw = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/**
 * Projects a world point to unscaled screen space.
 *
 * Yaw spins the world about y, then the result is flattened: screen x is the rotated x,
 * and screen y combines depth (how far across the floor) with height (how far up).
 * Because both terms are linear, parallel edges stay parallel.
 */
export function project(cam: Camera, x: number, y: number, z: number): Vec2 {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const rx = x * cy - z * sy;
  const rz = x * sy + z * cy;
  return { x: rx, y: rz * Math.sin(cam.pitch) - y * Math.cos(cam.pitch) };
}

/** Depth key for the painter ordering: larger is nearer the camera. */
export function depthOf(cam: Camera, x: number, y: number, z: number): number {
  return x * Math.sin(cam.yaw) + z * Math.cos(cam.yaw);
}

export type FaceName = "top" | "bottom" | "xNear" | "xFar" | "zNear" | "zFar";

/**
 * Which of a box's faces the camera can actually see.
 *
 * A face is visible when its outward normal points towards the viewer. The viewer sits
 * along (sin yaw, ., cos yaw) in the horizontal plane, so the sign of those two terms
 * decides the sides, and pitch decides the top. Recomputing this per frame is what lets
 * a box stay solid-looking as you orbit past a corner, instead of showing its inside.
 */
export function visibleFaces(cam: Camera): FaceName[] {
  const out: FaceName[] = [];
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  if (sy > 0) out.push("xNear");
  else if (sy < 0) out.push("xFar");
  if (cy > 0) out.push("zNear");
  else if (cy < 0) out.push("zFar");
  if (cam.pitch > 0) out.push("top");
  return out;
}

/** The four world-space corners of one face of an axis-aligned box. */
export function faceCorners(
  face: FaceName,
  b: { x: number; y: number; z: number; l: number; w: number; h: number }
): Array<[number, number, number]> {
  const { x, y, z, l, w, h } = b;
  switch (face) {
    case "top":
      return [[x, y + h, z], [x + l, y + h, z], [x + l, y + h, z + w], [x, y + h, z + w]];
    case "bottom":
      return [[x, y, z], [x + l, y, z], [x + l, y, z + w], [x, y, z + w]];
    case "xNear":
      return [[x + l, y, z], [x + l, y + h, z], [x + l, y + h, z + w], [x + l, y, z + w]];
    case "xFar":
      return [[x, y, z], [x, y + h, z], [x, y + h, z + w], [x, y, z + w]];
    case "zNear":
      return [[x, y, z + w], [x + l, y, z + w], [x + l, y + h, z + w], [x, y + h, z + w]];
    case "zFar":
      return [[x, y, z], [x + l, y, z], [x + l, y + h, z], [x, y + h, z]];
  }
}

/**
 * Lambert-ish shading factor in 0..1 for a face, with the light fixed in world space.
 *
 * Fixing the light to the world rather than the camera is the detail that sells the
 * rotation: faces brighten and darken as the container turns under a stationary light,
 * the way a real object does. A camera-fixed light would leave every face at a constant
 * tone and the whole thing would look like a flat sticker that happens to be moving.
 */
export function shade(face: FaceName, lightYaw = -Math.PI / 3): number {
  if (face === "top") return 1;
  if (face === "bottom") return 0;
  const n: Vec2 =
    face === "xNear"
      ? { x: 1, y: 0 }
      : face === "xFar"
      ? { x: -1, y: 0 }
      : face === "zNear"
      ? { x: 0, y: 1 }
      : { x: 0, y: -1 };
  const lx = Math.sin(lightYaw);
  const lz = Math.cos(lightYaw);
  return 0.5 + 0.5 * (n.x * lx + n.y * lz);
}

/** Mixes two #rrggbb colours. t=0 gives a, t=1 gives b. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const k = Math.max(0, Math.min(1, t));
  const to = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${to(ar + (br - ar) * k)}${to(ag + (bg - ag) * k)}${to(ab + (bb - ab) * k)}`;
}

/**
 * Exact projected bounds of a box, used to fit the drawing to its frame.
 *
 * Fitting to the real extent every frame rather than to a worst case sounds like it would
 * make the drawing breathe as you orbit, and at a top-down angle it does -- there, a
 * quarter turn genuinely swaps a 12m length for a 2.4m width and the plan grows to suit,
 * which is the behaviour you want. At the angles people actually orbit through, the
 * extent varies by about two percent between face-on and corner-on, so the scale is
 * visually constant. A worst-case fit would instead leave the top-down view using a third
 * of the frame at every angle, permanently, to protect against a rotation nobody made.
 */
export function projectedBounds(
  cam: Camera,
  l: number,
  w: number,
  h: number
): { minX: number; maxX: number; minY: number; maxY: number; spanX: number; spanY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [0, l]) {
    for (const y of [0, h]) {
      for (const z of [0, w]) {
        const p = project(cam, x, y, z);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  return { minX, maxX, minY, maxY, spanX: maxX - minX, spanY: maxY - minY };
}

/**
 * How far one metre along the container's x axis moves on screen, at the current angle.
 *
 * Dragging a consignment needs this: the pointer moves in screen pixels but the
 * consignment may only slide along x, so the pointer delta is projected onto the screen
 * image of the x axis. Near an end-on view that image gets very short, which is exactly
 * when a naive mapping would send a box flying -- hence the guard in dragToMetres.
 */
export function xAxisOnScreen(cam: Camera): Vec2 {
  const a = project(cam, 0, 0, 0);
  const b = project(cam, 1, 0, 0);
  return { x: b.x - a.x, y: b.y - a.y };
}

/**
 * Converts a pointer movement into metres along the container.
 *
 * Returns null when the x axis is too close to edge-on to be draggable -- better to
 * refuse the gesture than to let a two-pixel wobble throw a consignment down the box.
 */
export function dragToMetres(cam: Camera, dxPx: number, dyPx: number, scale: number): number | null {
  const ax = xAxisOnScreen(cam);
  const len2 = ax.x * ax.x + ax.y * ax.y;
  if (len2 < 0.02) return null;
  return (dxPx * ax.x + dyPx * ax.y) / (len2 * scale);
}

export interface StowItem {
  id: string;
  xM: number;
  lengthM: number;
}

/**
 * Slides one consignment to a new position, refusing anything physically impossible.
 *
 * A stow is a sequence of blocks sharing one floor: they may not overlap, and nothing may
 * hang out of the doors. Returning a reason rather than silently clamping means the UI
 * can say *why* a move is refused while the box is still under the pointer.
 */
export function proposeMove(
  items: StowItem[],
  id: string,
  desiredX: number,
  containerLengthM: number,
  snapM = 0.05
): { xM: number; ok: boolean; reason?: string } {
  const me = items.find((i) => i.id === id);
  if (!me) return { xM: desiredX, ok: false, reason: "unknown consignment" };

  const maxX = containerLengthM - me.lengthM;
  if (maxX < 0) return { xM: 0, ok: false, reason: "longer than the container" };

  let x = Math.max(0, Math.min(maxX, desiredX));

  // Snap to the back wall, the doors, and the faces of its neighbours. Stowing is done in
  // contact -- a 4cm gap between blocks is a mistake, not a decision.
  const anchors = [0, maxX];
  for (const o of items) {
    if (o.id === id) continue;
    anchors.push(o.xM + o.lengthM, o.xM - me.lengthM);
  }
  for (const a of anchors) {
    if (a >= -0.001 && a <= maxX + 0.001 && Math.abs(a - x) <= snapM) {
      x = Math.max(0, Math.min(maxX, a));
      break;
    }
  }

  const clash = items.find(
    (o) => o.id !== id && x < o.xM + o.lengthM - 0.001 && x + me.lengthM > o.xM + 0.001
  );
  if (clash) return { xM: x, ok: false, reason: `overlaps ${clash.id}` };

  const held = desiredX < -0.001 || desiredX > maxX + 0.001;
  return { xM: Math.round(x * 1000) / 1000, ok: true, reason: held ? "held at the container wall" : undefined };
}

/**
 * Lays blocks out end to end in the order they are given, starting at the back wall.
 *
 * Array order is the loading order here, which is the whole point -- this is what a
 * reorder uses, and it must not consult the old positions or it would undo itself.
 */
export function packInOrder(items: StowItem[]): StowItem[] {
  let cursor = 0;
  return items.map((i) => {
    const moved = { ...i, xM: Math.round(cursor * 1000) / 1000 };
    cursor += i.lengthM;
    return moved;
  });
}

/**
 * Pushes every block back against the one before it, closing gaps left by removals.
 *
 * Keeps the existing loading order -- this tidies a stow, it does not resequence one.
 * Use packInOrder when the array order is the intent.
 */
export function compact(items: StowItem[]): StowItem[] {
  return packInOrder([...items].sort((a, b) => a.xM - b.xM));
}

/**
 * The loading order: back wall first, doors last.
 *
 * This is the sequence the container is actually packed in, and it is not cosmetic --
 * whatever is nearest the doors comes off first, so on a groupage box the order has to
 * match the order the consignments are wanted in. Reading it off the x positions rather
 * than storing a separate index means the drawing and the order can never disagree.
 */
export function sequenceOf(items: StowItem[]): string[] {
  return [...items].sort((a, b) => a.xM - b.xM).map((i) => i.id);
}

/**
 * Moves one consignment to a different place in the loading order.
 *
 * Everything else closes up around it, so the result is always a container that can
 * actually be packed: no gaps, no overlaps, nothing hanging out of the doors. That is the
 * difference between this and proposeMove -- proposeMove slides a block within the space
 * its neighbours leave it, and refuses to pass them; this one changes who the neighbours
 * are.
 */
export function reorderTo(items: StowItem[], id: string, targetIndex: number): StowItem[] {
  const sorted = [...items].sort((a, b) => a.xM - b.xM);
  const from = sorted.findIndex((i) => i.id === id);
  if (from === -1) return packInOrder(sorted);
  const [me] = sorted.splice(from, 1);
  const to = Math.max(0, Math.min(sorted.length, targetIndex));
  sorted.splice(to, 0, me);
  return packInOrder(sorted);
}

/**
 * Which place in the order a dragged consignment is asking for.
 *
 * Measured against where the *other* blocks would sit once this one is lifted out of the
 * line, which is what makes the swap happen at the moment the dragged block passes its
 * neighbour's midpoint rather than only after it has cleared the whole block. Comparing
 * against the neighbours' current positions instead would make short blocks impossible to
 * drag past long ones.
 */
export function indexForX(items: StowItem[], id: string, desiredX: number): number {
  const me = items.find((i) => i.id === id);
  if (!me) return 0;
  const others = compact(items.filter((i) => i.id !== id));
  const myCentre = desiredX + me.lengthM / 2;
  let idx = 0;
  for (const o of others) {
    if (o.xM + o.lengthM / 2 < myCentre) idx++;
    else break;
  }
  return idx;
}

/** Steps one consignment one place earlier (-1) or later (+1) in the loading order. */
export function nudgeOrder(items: StowItem[], id: string, direction: -1 | 1): StowItem[] {
  const order = sequenceOf(items);
  const at = order.indexOf(id);
  if (at === -1) return compact(items);
  return reorderTo(items, id, Math.max(0, Math.min(order.length - 1, at + direction)));
}
