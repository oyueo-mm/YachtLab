import * as CANNON from "cannon-es";

/**
 * Rigid-body dice throw, pre-simulated with cannon-es, with the result decided elsewhere.
 *
 * How the engine's value is shown without cheating the physics or snapping at the end:
 *  1. Simulate a real throw (gravity, floor/wall/dice collisions, friction, damping) until every die rests.
 *  2. Read which physical face of each body ended on top.
 *  3. Choose a fixed cube symmetry C (one of the 24 rotations) that maps the face carrying the engine's
 *     value onto that physical face, and render the die as `body orientation × C` for the whole throw.
 *     The visual cube is therefore rigidly attached to the body from the first frame — no face change.
 *  4. After all dice rest, slide each die along the floor into its row slot while turning only around
 *     the vertical axis to the canonical face orientation (the top face never changes during the slide).
 *
 * Units: one die edge = 1. Tray floor is y = 0, x ∈ [0, width], z ∈ [0, height] (screen down = +z).
 */
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const FPS = 60;
const SUBSTEPS = 2;
const GRAVITY = 52;
const MAX_PHYSICS_FRAMES = 96; // 1.6 s
const CORRECTION_FRAMES = 10;
const GLIDE_FRAMES = 15;
const SETTLE_FRAMES = 8;
const BLEND_FRAMES = 8;

/** Local face normals carrying each value (opposite faces sum to 7). */
export const FACE_NORMAL: Record<number, Vec3> = { 1: [0, 1, 0], 6: [0, -1, 0], 2: [1, 0, 0], 5: [-1, 0, 0], 3: [0, 0, 1], 4: [0, 0, -1] };
/** Texture "up" of each face in local coordinates (three.js BoxGeometry UVs, canvas texture with flipY). */
export const FACE_UP: Record<number, Vec3> = { 1: [0, 0, -1], 6: [0, 0, 1], 2: [0, 1, 0], 5: [0, 1, 0], 3: [0, 1, 0], 4: [0, 1, 0] };
/** BoxGeometry material groups are ordered +x, -x, +y, -y, +z, -z. */
export const MATERIAL_ORDER = [2, 5, 1, 6, 3, 4] as const;
/** Faces whose pip pattern looks the same after a quarter turn. */
const QUARTER_SYMMETRIC = new Set([1, 4, 5]);

/* ------------------------------------------------------------------- math ------------------------------------------------------------------- */

export const qMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const r = qMul(qMul(q, [v[0], v[1], v[2], 0]), qConj(q));
  return [r[0], r[1], r[2]];
}
export const qAxisAngle = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const qNormalize = (q: Quat): Quat => {
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};
export const qDot = (a: Quat, b: Quat) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let d = qDot(a, b);
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) return qNormalize([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  const th = Math.acos(d),
    s = Math.sin(th),
    wa = Math.sin((1 - t) * th) / s,
    wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}
/** Angle (radians) between two orientations. */
export const qAngle = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(qDot(a, b))));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Quaternion of the rotation matrix whose columns are the images of the local basis. */
function qFromColumns(c0: Vec3, c1: Vec3, c2: Vec3): Quat {
  const [m00, m10, m20] = c0,
    [m01, m11, m21] = c1,
    [m02, m12, m22] = c2;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return qNormalize([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return qNormalize([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return qNormalize([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qNormalize([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}
/** Rotation R with R·a = A and R·b = B for orthonormal pairs (a ⟂ b, A ⟂ B). */
function qAlign(a: Vec3, b: Vec3, A: Vec3, B: Vec3): Quat {
  // R = W · Lᵀ where L = [a b a×b], W = [A B A×B]
  const c = cross(a, b),
    C = cross(A, B);
  const col = (j: number): Vec3 => [A[0] * a[j] + B[0] * b[j] + C[0] * c[j], A[1] * a[j] + B[1] * b[j] + C[1] * c[j], A[2] * a[j] + B[2] * b[j] + C[2] * c[j]];
  return qFromColumns(col(0), col(1), col(2));
}

/** Orientation that shows `value` on top with its pips upright on screen (screen up = world −z). */
export const canonicalOrientation = (value: number): Quat => qAlign(FACE_NORMAL[value], FACE_UP[value], [0, 1, 0], [0, 0, -1]);

/** The value whose face points up for a visual orientation, and how flat the die lies (1 = flat). */
export function topFace(q: Quat): { value: number; flatness: number } {
  let best = 1,
    flatness = -2;
  for (const v of [1, 2, 3, 4, 5, 6]) {
    const up = qRotate(q, FACE_NORMAL[v])[1];
    if (up > flatness) {
      flatness = up;
      best = v;
    }
  }
  return { value: best, flatness };
}

/** One of the 24 cube rotations, taking local normal `from` onto local normal `to`. */
function cubeTurn(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d > 0.5) return [0, 0, 0, 1];
  if (d < -0.5) {
    const axis: Vec3 = Math.abs(from[0]) < 0.5 ? [1, 0, 0] : [0, 1, 0];
    return qAxisAngle(axis, Math.PI);
  }
  return qAxisAngle(cross(from, to), Math.PI / 2);
}

function mulberry(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomQuat(r: () => number): Quat {
  const u1 = r(),
    u2 = r() * 2 * Math.PI,
    u3 = r() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1),
    b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

/* ---------------------------------------------------------------- simulation ---------------------------------------------------------------- */

export type SimDie = { id: number; value: number; held: boolean; x: number; z: number };
export type SimInput = {
  width: number;
  height: number;
  dice: SimDie[];
  direction: -1 | 1;
  seed: number;
  maxAttempts?: number;
  /**
   * "free" (default for the game): dice stay exactly where and how physics left them.
   * "slots": after resting, dice glide into their row slots (previous presentation, kept for comparison).
   */
  landing?: "free" | "slots";
  /** Current resting place of moving dice (re-rolls start from there instead of the tray edge). */
  starts?: Record<number, { x: number; z: number; quat?: Quat }>;
};
export type Impact = { frame: number; id: number; strength: number; kind: "floor" | "wall" | "die" };
export type DieTrack = {
  id: number;
  value: number;
  /** frameCount × 7 floats: x, y, z (center), qx, qy, qz, qw of the visual cube. */
  frames: Float32Array;
  /** First frame from which this die no longer moves in the physics phase. */
  restFrame: number;
  /** Fixed visual offset (cube symmetry) applied to the physics body. */
  label: Quat;
};
export type SimResult = {
  fps: number;
  frameCount: number;
  physicsFrames: number;
  glideStart: number;
  tracks: DieTrack[];
  impacts: Impact[];
  attempts: number;
  /** False when no attempt produced a clean landing (all flat on the floor, inside the tray); callers should use the 2.5D fallback. */
  ok: boolean;
  /** Dice that needed the short tip-over correction (were resting on an edge when time ran out). */
  corrected: number;
  stats: { settled: boolean; minFlatness: number; minDistance: number; inBounds: boolean; maxEndStepDeg: number; simMs: number };
};

type RawRun = {
  frames: Map<number, { pos: Vec3; quat: Quat }[]>;
  impacts: Impact[];
  physicsFrames: number;
  restFrame: Map<number, number>;
  settled: boolean;
  flat: Map<number, number>;
  inBounds: boolean;
  minDistance: number;
};

function runOnce(input: SimInput, seed: number): RawRun {
  const r = mulberry(seed);
  const { width: W, height: H } = input;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
  world.allowSleep = false;
  (world.solver as CANNON.GSSolver).iterations = 14;
  const dieMat = new CANNON.Material("die"),
    floorMat = new CANNON.Material("floor"),
    wallMat = new CANNON.Material("wall");
  world.addContactMaterial(new CANNON.ContactMaterial(dieMat, floorMat, { friction: 0.4, restitution: 0.3 }));
  world.addContactMaterial(new CANNON.ContactMaterial(dieMat, wallMat, { friction: 0.08, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(dieMat, dieMat, { friction: 0.2, restitution: 0.3 }));
  const kinds = new Map<CANNON.Body, Impact["kind"] | number>();
  const floor = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  kinds.set(floor, "floor");
  const walls: [number, number, number, number][] = [
    [0, 0, 0, Math.PI / 2], // x = 0, facing +x
    [W, 0, 0, -Math.PI / 2], // x = W, facing −x
    [0, 0, 0, 0], // z = 0, facing +z
    [0, 0, H, Math.PI], // z = H, facing −z
  ];
  for (const [x, y, z, yaw] of walls) {
    const wall = new CANNON.Body({ mass: 0, material: wallMat, shape: new CANNON.Plane() });
    wall.position.set(x, y, z);
    wall.quaternion.setFromEuler(0, yaw, 0);
    world.addBody(wall);
    kinds.set(wall, "wall");
  }
  const half = new CANNON.Vec3(0.5, 0.5, 0.5);
  for (const d of input.dice.filter((d) => d.held)) {
    const body = new CANNON.Body({ mass: 0, material: dieMat, shape: new CANNON.Box(half) });
    body.position.set(d.x, 0.5, d.z);
    world.addBody(body);
    kinds.set(body, "die");
  }
  const moving = input.dice.filter((d) => !d.held);
  const bodies = new Map<number, CANNON.Body>();
  const impacts: Impact[] = [];
  let frame = 0;
  // Launch from the player's edge (bottom), spread so no two dice start inside each other.
  const n = moving.length;
  // How crowded the tray is (dice area / floor area): small phone trays get calmer throws.
  const crowd = (input.dice.length * 1.6) / (W * H);
  const span = Math.max(0, Math.min(W - 1.6, (n - 1) * 1.25));
  moving.forEach((d, i) => {
    const body = new CANNON.Body({ mass: 1, material: dieMat, shape: new CANNON.Box(half), linearDamping: crowd > 0.5 ? 0.32 : 0.2, angularDamping: crowd > 0.5 ? 0.38 : 0.26 });
    const start = input.starts?.[d.id];
    const speed = Math.min(1.4, Math.max(0.55, H / 5.5)) * (crowd > 0.5 ? 0.8 : 1);
    if (start) {
      // Re-roll from where the die lies: scooped up and tossed again inside the tray.
      body.position.set(Math.min(W - 0.6, Math.max(0.6, start.x)), 1.1 + r() * 0.5, Math.min(H - 0.6, Math.max(0.6, start.z)));
      const q = start.quat ?? randomQuat(r);
      body.quaternion.set(q[0], q[1], q[2], q[3]);
      const toCenterX = (W / 2 - start.x) * 0.6,
        toCenterZ = (H / 2 - start.z) * 0.6;
      body.velocity.set(toCenterX + input.direction * (0.8 + r() * 1.6), 3 + r() * 1.6, toCenterZ + (r() - 0.5) * 2.4 * speed);
    } else {
      const x = W / 2 - span / 2 + (n > 1 ? (span * i) / (n - 1) : 0) - input.direction * 0.25 + (r() - 0.5) * 0.2;
      const layer = span < (n - 1) * 1.15 ? i % 2 : 0; // narrow trays: alternate heights
      body.position.set(Math.min(W - 0.8, Math.max(0.8, x)), 1.25 + layer * 1.2 + r() * 0.3, H - 0.75 - r() * 0.25);
      const q = randomQuat(r);
      body.quaternion.set(q[0], q[1], q[2], q[3]);
      body.velocity.set(input.direction * (1.2 + r() * 2.4), 0.6 + r() * 1.4, -(4.2 + r() * 2.6) * speed);
    }
    body.angularVelocity.set((r() - 0.5) * 30, (r() - 0.5) * 18, (r() - 0.5) * 30);
    body.addEventListener("collide", (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      const strength = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (strength < 0.6) return;
      const other = kinds.get(e.body);
      if (typeof other === "number" && other < d.id) return; // die–die: record once
      impacts.push({ frame, id: d.id, strength, kind: typeof other === "number" ? "die" : (other ?? "die") });
    });
    world.addBody(body);
    bodies.set(d.id, body);
    kinds.set(body, d.id);
  });
  const frames = new Map<number, { pos: Vec3; quat: Quat }[]>();
  const restFrame = new Map<number, number>();
  for (const d of moving) frames.set(d.id, []);
  const record = () => {
    bodies.forEach((b, id) => frames.get(id)!.push({ pos: [b.position.x, b.position.y, b.position.z], quat: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] }));
  };
  record();
  let still = 0,
    settled = false;
  for (frame = 1; frame <= MAX_PHYSICS_FRAMES; frame++) {
    for (let s = 0; s < SUBSTEPS; s++) world.step(1 / (FPS * SUBSTEPS));
    record();
    let allStill = true;
    bodies.forEach((b, id) => {
      const calm = b.velocity.length() < 0.09 && b.angularVelocity.length() < 0.18 && b.position.y < 0.56;
      if (!calm) {
        allStill = false;
        restFrame.delete(id);
      } else if (!restFrame.has(id)) restFrame.set(id, frame);
    });
    still = allStill ? still + 1 : 0;
    if (still >= SETTLE_FRAMES) {
      settled = true;
      break;
    }
  }
  const physicsFrames = frames.get(moving[0]?.id ?? -1)?.length ?? 1;
  const flat = new Map<number, number>();
  let inBounds = true;
  bodies.forEach((b, id) => {
    const q: Quat = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
    flat.set(id, topFace(q).flatness);
    if (b.position.x < 0.45 || b.position.x > W - 0.45 || b.position.z < 0.45 || b.position.z > H - 0.45 || b.position.y < 0.4) inBounds = false;
  });
  const all = [...bodies.values()].map((b) => b.position).concat(input.dice.filter((d) => d.held).map((d) => new CANNON.Vec3(d.x, 0.5, d.z)));
  let minDistance = Infinity;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) minDistance = Math.min(minDistance, all[i].distanceTo(all[j]));
  return { frames, impacts, physicsFrames, restFrame, settled, flat, inBounds, minDistance };
}

/** Pre-simulate a throw that lands on the given values. Deterministic for a given input + seed. */
export function simulateThrow(input: SimInput): SimResult {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const moving = input.dice.filter((d) => !d.held);
  const attemptsAllowed = input.maxAttempts ?? 10;
  let chosen: RawRun | null = null,
    best: RawRun | null = null,
    bestScore = -Infinity,
    attempts = 0;
  for (; attempts < attemptsAllowed && !chosen; attempts++) {
    const run = runOnce(input, (input.seed + attempts * 7919) >>> 0);
    const flatCount = [...run.flat.values()].filter((f) => f > 0.985).length;
    const score = (run.settled ? 100 : 0) + (run.inBounds ? 50 : 0) + flatCount;
    if (run.settled && run.inBounds && flatCount === moving.length) chosen = run;
    if (score > bestScore) {
      bestScore = score;
      best = run;
    }
  }
  const run = chosen ?? best!;
  let corrected = 0;
  const tracks: DieTrack[] = [];
  const extra = moving.some((d) => (run.flat.get(d.id) ?? 1) <= 0.985) || !run.settled ? CORRECTION_FRAMES : 0;
  const glideStart = run.physicsFrames + extra;
  const glideFrames = (input.landing ?? "slots") === "slots" ? GLIDE_FRAMES : 0;
  const frameCount = glideStart + glideFrames;
  for (const d of moving) {
    const raw = run.frames.get(d.id)!;
    const bodyQuats: Quat[] = raw.map((f) => f.quat);
    const positions: Vec3[] = raw.map((f) => f.pos);
    // Tip-over correction: a die that was still on an edge falls flat onto its nearest face.
    if (extra) {
      const last = bodyQuats[bodyQuats.length - 1],
        lastPos = positions[positions.length - 1];
      const { value: up } = topFace(last);
      const n = qRotate(last, FACE_NORMAL[up]);
      const axis = cross(n, [0, 1, 0]);
      const len = Math.hypot(...axis);
      const fix: Quat = len < 1e-6 ? [0, 0, 0, 1] : qAxisAngle([axis[0] / len, axis[1] / len, axis[2] / len], Math.asin(Math.min(1, len)));
      const target = qNormalize(qMul(fix, last));
      if (qAngle(last, target) > 0.01) corrected++;
      for (let k = 1; k <= extra; k++) {
        const t = k / extra,
          e = t * t * (3 - 2 * t);
        bodyQuats.push(qSlerp(last, target, e));
        positions.push([lastPos[0], lastPos[1] + (0.5 - lastPos[1]) * e, lastPos[2]]);
      }
    }
    const rest = bodyQuats[bodyQuats.length - 1];
    const physicalTop = topFace(rest).value; // body face (base numbering) that ended on top
    const label = cubeTurn(FACE_NORMAL[d.value], FACE_NORMAL[physicalTop]);
    const visual = bodyQuats.map((q) => qNormalize(qMul(q, label)));
    // Glide into the row slot, turning only about the vertical axis to the upright face.
    const restVisual = visual[visual.length - 1];
    const canonical = canonicalOrientation(d.value);
    const turns = QUARTER_SYMMETRIC.has(d.value) ? [0, 1, 2, 3] : [0, 2];
    let end = canonical,
      endDot = -1;
    for (const k of turns) {
      const cand = qNormalize(qMul(qAxisAngle([0, 1, 0], (k * Math.PI) / 2), canonical));
      if (Math.abs(qDot(cand, restVisual)) > endDot) {
        endDot = Math.abs(qDot(cand, restVisual));
        end = cand;
      }
    }
    const restPos = positions[positions.length - 1];
    for (let k = 1; k <= glideFrames; k++) {
      const t = k / GLIDE_FRAMES,
        e = t * t * (3 - 2 * t);
      visual.push(qSlerp(restVisual, end, e));
      positions.push([restPos[0] + (d.x - restPos[0]) * e, 0.5 + Math.sin(Math.PI * t) * 0.06, restPos[2] + (d.z - restPos[2]) * e]);
    }
    // Re-roll from a resting die: blend from its current pose into the toss, so nothing jumps on frame 0.
    const from = input.starts?.[d.id];
    if (from?.quat) {
      const p0: Vec3 = [from.x, 0.5, from.z];
      for (let k = 0; k < Math.min(BLEND_FRAMES, visual.length); k++) {
        const t = (k + 1) / (BLEND_FRAMES + 1),
          e = t * t * (3 - 2 * t);
        visual[k] = qSlerp(from.quat, visual[k], e);
        positions[k] = [p0[0] + (positions[k][0] - p0[0]) * e, p0[1] + (positions[k][1] - p0[1]) * e, p0[2] + (positions[k][2] - p0[2]) * e];
      }
    }
    // Pad every track to the same length.
    while (visual.length < frameCount) {
      visual.push(visual[visual.length - 1]);
      positions.push(positions[positions.length - 1]);
    }
    const frames = new Float32Array(frameCount * 7);
    for (let f = 0; f < frameCount; f++) {
      frames.set(positions[f], f * 7);
      frames.set(visual[f], f * 7 + 3);
    }
    tracks.push({ id: d.id, value: d.value, frames, restFrame: run.restFrame.get(d.id) ?? run.physicsFrames, label });
  }
  // Largest single-frame rotation over the last physics frames + glide (detects end-of-roll snapping).
  let maxEndStep = 0;
  for (const t of tracks)
    for (let f = Math.max(1, glideStart - 12); f < frameCount; f++) {
      const a = Array.from(t.frames.subarray((f - 1) * 7 + 3, f * 7)) as Quat;
      const b = Array.from(t.frames.subarray(f * 7 + 3, f * 7 + 7)) as Quat;
      maxEndStep = Math.max(maxEndStep, qAngle(a, b));
    }
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    fps: FPS,
    frameCount,
    physicsFrames: run.physicsFrames,
    glideStart,
    tracks,
    impacts: run.impacts.filter((i) => i.frame < glideStart),
    attempts: Math.min(attempts, attemptsAllowed),
    ok: chosen !== null || (run.inBounds && moving.every((d) => (run.flat.get(d.id) ?? 1) > 0.6 && run.frames.get(d.id)!.at(-1)!.pos[1] < 0.62)),
    corrected,
    stats: {
      settled: run.settled,
      minFlatness: Math.min(1, ...run.flat.values()),
      minDistance: run.minDistance,
      inBounds: run.inBounds,
      maxEndStepDeg: (maxEndStep * 180) / Math.PI,
      simMs: ended - started,
    },
  };
}

/** Final visible value of a track (what the renderer shows when the die stops). */
export const finalValue = (track: DieTrack, frameCount: number) => topFace(Array.from(track.frames.subarray((frameCount - 1) * 7 + 3, frameCount * 7)) as Quat).value;
