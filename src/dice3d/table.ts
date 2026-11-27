import { FxCanvas } from "./fx-canvas";
import { diceFx, type DiceFxProfile } from "./dice-fx";
import { emitFx } from "../fx-bus";
import { fxBudget } from "../settings";
import * as THREE from "three";
import { MATERIAL_ORDER, canonicalOrientation, finalValue, playRate, prepareThrow, throwKey, qAxisAngle, qDot, qMul, qSlerp, simulateThrow, topFace, type PreparedThrow, type Quat, type SimResult } from "./physics";
import { CLASSIC_DICE, blobTexture, faceTexture, glowTexture, type DiceColors, type Quality } from "./stage";

/**
 * Persistent 3D dice table: a roll tray and a hold shelf below it, drawn on one canvas.
 * Dice stay exactly where physics left them (no row alignment, no 2D swap). Rendering happens on
 * demand — the GPU is idle unless a die is moving.
 *
 * Look: matte. Even, soft light, no glossy highlights, no cast-shadow map — the only shadow is a
 * small contact shadow under each die that tightens as the die touches the floor.
 *
 * World units are die edges; x → right, z → down the screen. The tray is z ∈ [0, trayH],
 * the hold shelf is z ∈ [trayH, totalH]. The camera maps the top-face plane (y = 1) 1:1 to CSS pixels,
 * so DOM hit targets can be placed exactly over each die.
 */
export { simulateThrow, prepareThrow, throwKey, finalValue, canonicalOrientation, topFace, playRate };
export type { PreparedThrow };

/**
 * Canvas resolution policy (CSS px → canvas px). Before: phones used the "3d" tier at 1.25 px per
 * CSS px with 128 px face textures — on 2.6–3× screens the dice were drawn at under half resolution
 * and scaled up (blurry pips and edges).
 *  - "3d-high" (고화질; also 자동): up to 2× device pixels; MSAA only where it matters (screens
 *    below 1.5×) — at 2× the extra pixels already smooth edges and MSAA would cost far more.
 *  - "3d" (성능 우선): up to 1.5×, no MSAA.
 *  - adaptive level (자동 only): 0 → 2×, 1 → 1.5×, 2 → 1.25× after repeatedly slow throws.
 */
export function renderPolicy(quality: Quality, dpr: number, level = 0): { pixelRatio: number; antialias: boolean } {
  const cap = Math.min(quality === "3d-high" ? 2 : 1.5, [2, 1.5, 1.25][Math.max(0, Math.min(2, level))]);
  const pixelRatio = Math.max(1, Math.min(dpr, cap));
  return { pixelRatio, antialias: quality === "3d-high" && pixelRatio < 1.5 };
}
const LEVEL_KEY = "yachtlab.render.level";
export function adaptiveLevel(): number {
  try {
    const n = Number(sessionStorage.getItem(LEVEL_KEY));
    return Number.isInteger(n) && n >= 0 && n <= 2 ? n : 0;
  } catch {
    return 0;
  }
}
function setAdaptiveLevel(level: number) {
  try {
    sessionStorage.setItem(LEVEL_KEY, String(level));
  } catch {
    /* private mode */
  }
}
export type { Quat, SimResult };
export type Pose = { x: number; y: number; z: number; quat: Quat };
const QUARTER = new Set([1, 4, 5]);

/** Upright orientation for `value`, turned about the vertical axis to the closest of its symmetric yaws. */
export function uprightNear(value: number, near: Quat): Quat {
  const base = canonicalOrientation(value);
  let best = base,
    dot = -1;
  for (const k of QUARTER.has(value) ? [0, 1, 2, 3] : [0, 2]) {
    const cand = qMul(qAxisAngle([0, 1, 0], (k * Math.PI) / 2), base);
    const d = Math.abs(qDot(cand, near));
    if (d > dot) {
      dot = d;
      best = cand;
    }
  }
  return best;
}

const easeOutBack = (t: number) => {
  const c1 = 1.9,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Hold / release carry (5th pass): picked up, carried in an arc that rises with the distance, tipped a
 * few degrees toward the direction of travel (≤ 7°, so the top face stays readable), then set down with a
 * short touchdown dip instead of gliding in at constant height. Ends exactly at `to`.
 */
export function carryPose(from: Pose, to: Pose, t: number): Pose {
  const dx = to.x - from.x, dz = to.z - from.z, dist = Math.hypot(dx, dz);
  // ease: quick pick-up, slower set-down
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2.2) / 2;
  const lift = Math.sin(Math.PI * Math.min(1, t / 0.92)) * Math.min(0.7, 0.22 + dist * 0.09);
  // touchdown: the last 8 % press 0.03 into the felt and come back (reads as weight)
  const dip = t > 0.92 ? -Math.sin(((t - 0.92) / 0.08) * Math.PI) * 0.03 : 0;
  const base = qSlerp(from.quat, to.quat, smooth(t));
  let quat = base;
  if (dist > 0.05) {
    const tilt = Math.sin(Math.PI * t) * Math.min(0.12, dist * 0.04);
    // axis = up × travel direction: the leading edge dips, as when a die is carried by its top
    quat = qMul(qAxisAngle([dz / dist, 0, -dx / dist], tilt), base);
  }
  if (t >= 1) return { ...to };
  return { x: from.x + dx * e, y: from.y + (to.y - from.y) * e + lift + dip, z: from.z + dz * e, quat };
}

export type CelebrateOptions = {
  /** Dice (ids) that make the combination. They come toward the camera; the rest stay down. */
  ids: number[];
  ms: number;
  /** Bigger rise and a brief second pulse (large straight, yacht). */
  grand?: boolean;
  /** Reduce the foreground scale on small screens while keeping the combo effect. */
  compact?: boolean;
  /** Called once when the highlighted dice reach the top of the motion (for the sound). */
  onPeak?: () => void;
  onDone: () => void;
};

/** Lv.3 landing accent sound of a dice item (null when it has none). */
export const landSoundOf = (id?: string) => diceFx(id)?.sound ?? null;

/** Emission level of glowing pips (they are masked, so this no longer tints the whole die). */
const GLOW_BASE = 0.55;

export class DiceTable {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private materials: THREE.MeshStandardMaterial[];
  private meshes = new Map<number, THREE.Mesh>();
  private blobs = new Map<number, THREE.Mesh>();
  private light: THREE.DirectionalLight;
  private blob: THREE.CanvasTexture;
  private blobGeometry = new THREE.PlaneGeometry(1.5, 1.5);
  private blobMaterials: THREE.MeshBasicMaterial[] = [];
  private queued = 0;
  /** Upgrade effects overlay (Lv.2 / Lv.3), created on first use. */
  private fx: FxCanvas | null = null;
  private stopFx: (() => void) | undefined;
  private profile: DiceFxProfile | null = null;
  private fxLevel = 1;
  private effectPoint = new THREE.Vector3();
  /** One running animation per die: a new one for the same die replaces the old one. */
  private moves = new Map<number, () => void>();
  private disposed = false;
  private warmed = false;
  private warmTimer = 0;
  width = 1;
  height = 1;
  private cameraDistance = 16;
  /** Called whenever a die is drawn at a new place (DOM hit targets follow it). */
  onPose: ((id: number, pose: Pose) => void) | null = null;
  /** Frame-time samples (ms) of the most recent roll. */
  frameTimes: number[] = [];

  constructor(private host: HTMLElement, readonly quality: Quality, private readonly options: { adaptive?: boolean } = {}) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "dice-table-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    const policy = renderPolicy(quality, window.devicePixelRatio || 1, options.adaptive ? adaptiveLevel() : 0);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: policy.antialias, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(policy.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    // Matte dice: high roughness, no metalness, no environment reflections. Faces are always 256 px
    // (cheap: six small textures) with mipmaps and the GPU's anisotropic filtering, so pips stay crisp.
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy?.() ?? 4);
    this.materials = MATERIAL_ORDER.map((v) => {
      const map = faceTexture(v, 256);
      map.anisotropy = anisotropy;
      return new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 });
    });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa8a8a8, 1.55));
    this.light = new THREE.DirectionalLight(0xffffff, 0.85);
    this.scene.add(this.light, this.light.target);
    this.blob = blobTexture();
    host.appendChild(this.canvas);
  }

  private mesh(id: number) {
    let m = this.meshes.get(id);
    if (!m) {
      m = new THREE.Mesh(this.geometry, this.materials);
      this.scene.add(m);
      this.meshes.set(id, m);
      const material = new THREE.MeshBasicMaterial({ map: this.blob, transparent: true, depthWrite: false });
      this.blobMaterials.push(material);
      const b = new THREE.Mesh(this.blobGeometry, material);
      b.rotation.x = -Math.PI / 2;
      b.renderOrder = -1;
      this.scene.add(b);
      this.blobs.set(id, b);
    }
    return m;
  }

  /** Effective canvas pixels per CSS pixel (diagnostics / tests). */
  get pixelRatio() {
    return this.renderer.getPixelRatio();
  }

  private cssSize = { w: 1, h: 1 };
  layout(widthPx: number, heightPx: number, size: number) {
    this.width = widthPx / size;
    this.height = heightPx / size;
    this.cssSize = { w: widthPx, h: heightPx };
    this.fx?.layout(widthPx, heightPx);
    this.renderer.setSize(widthPx, heightPx, false);
    const distance = this.height / 2 / Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    this.cameraDistance = distance;
    this.camera.aspect = widthPx / heightPx;
    this.camera.position.set(this.width / 2, 1 + distance, this.height / 2);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.width / 2, 0, this.height / 2);
    this.camera.near = Math.max(0.1, distance - 8);
    this.camera.far = distance + 4;
    this.camera.updateProjectionMatrix();
    this.light.position.set(this.width / 2 - 2.5, 9, this.height / 2 - 4);
    this.light.target.position.set(this.width / 2, 0, this.height / 2);
    this.scheduleWarmUp();
    this.requestRender();
  }

  /** Warm up soon after the first layout, when the main thread is idle (never later than ~0.6 s). */
  private scheduleWarmUp() {
    if (this.warmed || this.warmTimer) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const run = () => {
      this.warmTimer = 0;
      this.warmUp();
    };
    this.warmTimer = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 600 }) : window.setTimeout(run, 120);
  }

  /**
   * Prepare the GPU before the first throw, in idle time after the table is laid out:
   * compile both programs (dice, contact shadows), upload the face/shadow textures with their mipmaps,
   * and issue one real draw with every die in view, then clear the canvas in the same task (nothing is
   * ever shown). GPU drivers (and Chrome's GPU process) finish linking a program and preparing a texture
   * only on the first draw that uses them, so `compile()` alone left that work for the first thrown frame.
   * Measured: the first throw's worst frame came from exactly this wait (docs/ui/PHASE-A-2026-11.md).
   */
  warmUp() {
    if (this.warmed || this.disposed) return;
    this.warmed = true;
    const ids = [0, 1, 2, 3, 4];
    const hidden = ids.filter((id) => !this.meshes.get(id)?.visible);
    hidden.forEach((id, k) => {
      const m = this.mesh(id);
      this.setVisible(id, m, true);
      m.position.set(this.width / 2 + (k - 2) * 1.2, 0.5, this.height / 2);
      const b = this.blobs.get(id)!;
      b.position.set(m.position.x, 0.002, m.position.z);
    });
    try {
      this.renderer.compile(this.scene, this.camera);
      for (const m of this.materials) if (m.map) this.renderer.initTexture(m.map);
      this.renderer.initTexture(this.blob);
      if (hidden.length) {
        this.renderer.render(this.scene, this.camera);
        this.renderer.clear();
      }
    } catch {
      // an optimization only
    }
    for (const id of hidden) this.setVisible(id, this.meshes.get(id)!, false);
    this.requestRender();
  }

  /** Place dice statically; dice not listed are removed from view. Running slides are stopped. */
  setPoses(poses: Map<number, Pose>) {
    for (const [id, m] of this.meshes) if (!poses.has(id)) this.setVisible(id, m, false);
    for (const [id, p] of poses) {
      this.cancelMove(id);
      this.apply(id, p);
    }
    this.requestRender();
  }

  pose(id: number): Pose | null {
    const m = this.meshes.get(id);
    if (!m || !m.visible) return null;
    return { x: m.position.x, y: m.position.y, z: m.position.z, quat: [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w] };
  }

  private setVisible(id: number, m: THREE.Mesh, v: boolean) {
    m.visible = v;
    const b = this.blobs.get(id);
    if (b) b.visible = v;
  }

  private apply(id: number, p: Pose, scale = 1) {
    const m = this.mesh(id);
    this.setVisible(id, m, true);
    m.position.set(p.x, p.y, p.z);
    m.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
    m.scale.setScalar(scale);
    const b = this.blobs.get(id);
    if (b) {
      const h = Math.max(0, p.y - 0.5);
      b.position.set(p.x + 0.04, 0.002, p.z + 0.07);
      b.scale.setScalar((0.82 + h * 0.3) * scale);
      (b.material as THREE.MeshBasicMaterial).opacity = Math.max(0.1, 0.62 - h * 0.34);
    }
    this.onPose?.(id, p);
  }

  private colors: DiceColors = CLASSIC_DICE;
  /** Dice theme of the player whose turn it is (repaints the six face textures; no physics change). */
  setColors(colors: DiceColors | null) {
    const next = colors ?? CLASSIC_DICE;
    if (JSON.stringify(next) === JSON.stringify(this.colors)) return;
    this.colors = next;
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy?.() ?? 4);
    const finish = next.finish ?? "matte";
    const surface = { matte: [0.62, 0], satin: [0.42, 0.05], gloss: [0.22, 0.05], metal: [0.32, 0.55], glass: [0.12, 0] }[finish];
    MATERIAL_ORDER.forEach((v, i) => {
      const m = this.materials[i];
      const map = faceTexture(v, 256, next);
      map.anisotropy = anisotropy;
      m.map?.dispose();
      m.map = map;
      m.roughness = surface[0];
      m.metalness = surface[1];
      m.transparent = finish === "glass";
      m.opacity = finish === "glass" ? 0.86 : 1;
      // Glow lights the pips (and a neon rim) through an emission mask; the body keeps its colour.
      m.emissiveMap?.dispose();
      m.emissiveMap = next.glow ? glowTexture(v, 128, next) : null;
      m.emissive.set(next.glow ?? "#000000");
      m.emissiveIntensity = next.glow ? GLOW_BASE : 0;
      m.needsUpdate = true;
    });
    this.profile = diceFx(next.fx);
    this.fxLevel = this.profile ? (next.fxLevel ?? 1) : 1;
    this.setAnimation(next.glow ? (next.anim ?? null) : null);
    this.requestRender();
  }

  /**
   * Lv.2/Lv.3 dice themes: a gentle glow animation while the table is on screen. Throttled to ~15 fps,
   * paused when the tab is hidden or the table is scrolled out of view, off for "효과 줄이기" (the
   * caller passes no animation then). Purely cosmetic: no physics, no result.
   */
  private animTimer = 0;
  private anim: DiceColors["anim"] | null = null;
  private visible = true;
  private observer: IntersectionObserver | null = null;
  setAnimation(anim: DiceColors["anim"] | null) {
    this.anim = anim;
    if (anim && !this.observer && typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver((entries) => (this.visible = entries.some((e) => e.isIntersecting)));
      this.observer.observe(this.canvas);
    }
    if (anim && !this.animTimer) {
      const start = performance.now();
      this.animTimer = window.setInterval(() => {
        if (this.disposed || !this.anim) return;
        if (document.visibilityState === "hidden" || !this.visible) return;
        const t = (performance.now() - start) / 1000;
        const base = GLOW_BASE;
        const level = this.anim === "pulse" ? base + 0.5 * (0.5 + 0.5 * Math.sin(t * 2.4)) : this.anim === "sparkle" ? base + 0.7 * Math.abs(Math.sin(t * 5.1) * Math.sin(t * 1.7)) : base + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3));
        this.materials.forEach((m, i) => {
          m.emissiveIntensity = level;
          if (this.anim === "shimmer") m.emissive.offsetHSL(0.004 * (i % 2 ? 1 : -1), 0, 0);
        });
        this.requestRender();
      }, 66);
    }
    if (!anim && this.animTimer) {
      window.clearInterval(this.animTimer);
      this.animTimer = 0;
    }
  }

  requestRender() {
    if (this.queued || this.disposed) return;
    this.queued = requestAnimationFrame(() => {
      this.queued = 0;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  }

  private cancelMove(id: number) {
    this.moves.get(id)?.();
    this.moves.delete(id);
  }

  /**
   * One animation ticker for the whole table: every running animation (a throw, several dice sliding
   * to the shelf, a score effect) updates its dice, then the scene is drawn once for that frame.
   * (Previously each animation rendered the full scene itself, so five sliding dice drew it five times.)
   */
  private steps = new Set<(now: number) => boolean>();
  /** True while any animation is running on the table. */
  get animating() {
    return this.steps.size > 0;
  }
  private tickRaf = 0;
  private loop(step: (now: number) => boolean) {
    this.steps.add(step);
    if (!this.tickRaf && !this.disposed) this.tickRaf = requestAnimationFrame(this.tick);
    return () => {
      this.steps.delete(step);
    };
  }
  private tick = (now: number) => {
    this.tickRaf = 0;
    if (this.disposed) return;
    for (const step of [...this.steps]) if (!step(now)) this.steps.delete(step);
    if (this.queued) {
      cancelAnimationFrame(this.queued);
      this.queued = 0;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.steps.size && !this.tickRaf) this.tickRaf = requestAnimationFrame(this.tick);
  };

  /**
   * Adaptive quality ("자동"): after a throw whose frames were slow (p95 over ~22 ms, i.e. under
   * ~45 fps) twice in a row, render with fewer canvas pixels from then on (2 → 1.5 → 1.25 per CSS px).
   * Remembered for this browser session. Never changes what is shown, only how sharply.
   */
  private slowThrows = 0;
  private adapt(frameTimes: number[]) {
    if (!this.options.adaptive || frameTimes.length < 20) return;
    const sorted = [...frameTimes].slice(1).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    this.slowThrows = p95 > 22 ? this.slowThrows + 1 : 0;
    if (this.slowThrows < 2) return;
    this.slowThrows = 0;
    const level = Math.min(2, adaptiveLevel() + 1);
    if (level === adaptiveLevel()) return;
    setAdaptiveLevel(level);
    const policy = renderPolicy(this.quality, window.devicePixelRatio || 1, level);
    if (policy.pixelRatio >= this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(policy.pixelRatio);
    this.renderer.setSize(this.cssSize.w, this.cssSize.h, false);
    this.requestRender();
  }

  /** Screen position (CSS px inside the canvas) of a die. */
  private screen(id: number) {
    const mesh = this.meshes.get(id);
    if (!mesh) return null;
    const point = this.effectPoint.copy(mesh.position).project(this.camera);
    return { x: ((point.x + 1) * this.cssSize.w) / 2, y: ((1 - point.y) * this.cssSize.h) / 2 };
  }
  private clientRect: DOMRect | null = null;
  private clientRectAt = 0;
  /** Same point in viewport coordinates (for the board's reactions). */
  private client(id: number) {
    const p = this.screen(id);
    if (!p) return null;
    // one layout read per animation frame at most (several dice ask in the same frame)
    const now = performance.now();
    if (!this.clientRect || now - this.clientRectAt > 16) {
      this.clientRect = this.canvas.getBoundingClientRect();
      this.clientRectAt = now;
    }
    const r = this.clientRect;
    return { x: r.left + p.x, y: r.top + p.y };
  }
  private ensureFx() {
    if (!this.profile || this.fxLevel < 2) return null;
    if (!this.fx) {
      this.fx = new FxCanvas(this.host);
      this.fx.layout(this.cssSize.w, this.cssSize.h);
    }
    this.fx.budget = fxBudget();
    return this.fx.budget > 0 ? this.fx : null;
  }
  /** Keep drawing the overlay until its particles have faded. */
  private drainFx() {
    const fx = this.fx;
    if (!fx || !fx.busy) return;
    this.stopFx?.();
    this.stopFx = this.loop((stamp) => fx.frame(stamp));
  }
  private trailAt(id: number, now: number, scale = 1) {
    const fx = this.fx, profile = this.profile;
    if (!fx || !profile) return;
    const p = this.screen(id);
    if (!p) return;
    for (const spec of profile.trail) fx.emit(spec, p.x, p.y, scale);
    if (profile.streak) fx.streak(id, profile.streak, p.x, p.y, now);
  }
  private burstAt(id: number, part: "impact" | "land") {
    const fx = this.fx, profile = this.profile;
    if (!fx || !profile || this.fxLevel < 3) return;
    const p = this.screen(id);
    if (!p) return;
    const spec = profile[part];
    for (const b of spec.burst) fx.emit(b, p.x, p.y);
    spec.ring?.forEach((r) => fx.ring(r, p.x, p.y + 6));
    spec.lines?.forEach((l) => fx.line(l, p.x, p.y + 6));
  }

  /** Play a pre-simulated throw for the dice in `result.tracks`; they stay at their final pose. */
  play(result: SimResult, opts: { rate?: number; onFrame?: () => void; onRoll?: (level: number) => void; onImpact?: (i: { strength: number; kind: "floor" | "wall" | "die"; x: number }) => void; onDone: () => void }): () => void {
    this.warmUp();
    for (const t of result.tracks) this.cancelMove(t.id);
    const rate = opts.rate ?? 1.2;
    const impacts = [...result.impacts].sort((a, b) => a.frame - b.frame);
    let next = 0;
    const started = performance.now();
    let last = started,
      lastRoll = started;
    this.frameTimes = [];
    const q0 = new THREE.Quaternion(),
      q1 = new THREE.Quaternion();
    this.stopFx?.();
    this.fx?.clear();
    const fx = this.ensureFx();
    let lastTrail = started;
    let lastBurst = started;
    const lastBus = new Map<number, number>();
    let lastTrailBus = 0;
    const landStrength = new Map<number, number>();
    emitFx({ type: "roll" });
    const stop = this.loop((now) => {
      this.frameTimes.push(now - last);
      last = now;
      // rAF timestamps can be a hair earlier than performance.now() at start: never go below frame 0.
      const f = Math.max(0, Math.min(result.frameCount - 1, ((now - started) / 1000) * result.fps * rate));
      const i = Math.floor(f),
        a = f - i,
        j = Math.min(result.frameCount - 1, i + 1);
      for (const t of result.tracks) {
        const fr = t.frames,
          o = i * 7,
          p = j * 7;
        q0.set(fr[o + 3], fr[o + 4], fr[o + 5], fr[o + 6]);
        q1.set(fr[p + 3], fr[p + 4], fr[p + 5], fr[p + 6]);
        q0.slerp(q1, a);
        this.apply(t.id, { x: fr[o] + (fr[p] - fr[o]) * a, y: fr[o + 1] + (fr[p + 1] - fr[o + 1]) * a, z: fr[o + 2] + (fr[p + 2] - fr[o + 2]) * a, quat: [q0.x, q0.y, q0.z, q0.w] });
      }
      if (fx && now - lastTrail >= 38) {
        lastTrail = now;
        for (const { id } of result.tracks) this.trailAt(id, now);
      }
      while (next < impacts.length && impacts[next].frame <= f) {
        const hit = impacts[next++];
        if (hit.kind === "floor") landStrength.set(hit.id, hit.strength); // the last floor hit before rest
        const m = this.meshes.get(hit.id);
        opts.onImpact?.({ strength: hit.strength, kind: hit.kind, x: m ? m.position.x / this.width : 0.5 });
        if (fx && hit.strength > 1.5 && now - lastBurst >= 110) {
          lastBurst = now;
          this.burstAt(hit.id, "impact");
        }
        // The board reacts where a die really hits the floor / rim, sized by the real impact speed
        // (each die at most every 90 ms; dice knocking each other do not touch the board).
        if (hit.strength > 1.6 && hit.kind !== "die" && now - (lastBus.get(hit.id) ?? 0) > 90) {
          lastBus.set(hit.id, now);
          const c = this.client(hit.id);
          if (c) emitFx({ type: "impact", x: c.x, y: c.y, strength: hit.strength, id: hit.id });
        }
      }
      // Rolling rumble: the fastest die that is on the floor right now.
      if (opts.onRoll && now - lastRoll > 110) {
        let level = 0;
        for (const t of result.tracks) {
          const fr = t.frames,
            o = i * 7,
            p = j * 7;
          if (fr[o + 1] < 0.62) level = Math.max(level, Math.hypot(fr[p] - fr[o], fr[p + 2] - fr[o + 2]) * result.fps);
        }
        if (level > 1.6) {
          lastRoll = now;
          opts.onRoll(Math.min(1, level / 9));
        }
      }
      // Synergy layers follow the dice paths across the board (~30 Hz, only dice near the floor).
      if (now - lastTrailBus > 32) {
        lastTrailBus = now;
        for (const t of result.tracks) {
          if (t.frames[i * 7 + 1] > 1.4) continue;
          const c = this.client(t.id);
          if (c) emitFx({ type: "trail", x: c.x, y: c.y, id: t.id });
        }
      }
      fx?.frame(now);
      opts.onFrame?.();
      if (f >= result.frameCount - 1) {
        if (fx) for (const { id } of result.tracks) this.burstAt(id, "land");
        for (const { id } of result.tracks) {
          const c = this.client(id);
          if (c) emitFx({ type: "land", x: c.x, y: c.y, strength: landStrength.get(id) ?? 6, id });
        }
        this.drainFx();
        this.adapt(this.frameTimes);
        opts.onDone();
        return false;
      }
      return true;
    });
    return () => { stop(); this.stopFx?.(); this.fx?.clear(); };
  }

  /**
   * Slide one die to `to` (from wherever it is drawn right now). A newer slide for the same die
   * replaces the older one, so quick hold → release → hold taps never fight over its position.
   * Only the yaw differs between poses used by the game, so the top face is unchanged.
   */
  moveTo(id: number, to: Pose, ms: number, onDone?: () => void): () => void {
    this.cancelMove(id);
    const from = this.pose(id) ?? to;
    const started = performance.now();
    const fx = this.ensureFx();
    let lastTrail = 0;
    const stop = this.loop((now) => {
      if (fx && now - lastTrail > 45) {
        lastTrail = now;
        this.trailAt(id, now, 0.5);
      }
      fx?.frame(now);
      const t = Math.max(0, Math.min(1, (now - started) / ms));
      this.apply(id, carryPose(from, to, t));
      if (t >= 1) {
        this.moves.delete(id);
        if (fx) this.drainFx();
        onDone?.();
        return false;
      }
      return true;
    });
    this.moves.set(id, stop);
    return () => {
      if (this.moves.get(id) === stop) this.moves.delete(id);
      stop();
    };
  }

  /**
   * Score celebration: the dice that make the combination spring toward the camera (rise, grow,
   * a small bob); the others stay down and recede slightly. Faces never change — only height,
   * scale and a few degrees of yaw. Ends by calling `onDone` (the caller clears the table).
   */
  celebrate(opts: CelebrateOptions): () => void {
    const lifted = new Set(opts.ids);
    const base = new Map<number, Pose>();
    for (const id of this.meshes.keys()) {
      this.cancelMove(id);
      const p = this.pose(id);
      if (p) base.set(id, { ...p, y: 0.5 });
    }
    const peak = opts.compact ? (opts.grand ? 2.0 : 1.5) : opts.grand ? 3.4 : 2.5;
    const grow = opts.compact ? 1.0 : opts.grand ? 1.22 : 1.14;
    // How much perspective magnifies things at the peak height (relative to the top-face plane).
    // (measured at the top face of the raised cube, the part that reaches furthest out).
    const persp = this.cameraDistance / (1 + this.cameraDistance - (peak + 0.5 * grow));
    const started = performance.now();
    let peaked = false;
    return this.loop((now) => {
      const t = Math.max(0, Math.min(1, (now - started) / opts.ms));
      // 0–0.2 spring up, 0.2–0.78 hold (with a gentle bob), 0.78–1 return
      const rise = t < 0.2 ? easeOutBack(t / 0.2) : t < 0.78 ? 1 : 1 - smooth((t - 0.78) / 0.22);
      const bob = t >= 0.2 && t < 0.78 ? Math.sin(((t - 0.2) / 0.58) * Math.PI * (opts.grand ? 4 : 2)) * 0.07 : 0;
      if (!peaked && t >= 0.12) {
        peaked = true;
        opts.onPeak?.();
      }
      for (const [id, p] of base) {
        if (lifted.has(id)) {
          const yaw = Math.sin(t * Math.PI * 2) * 0.1 * rise;
          // Dice near the edge drift inward while raised so perspective never pushes them out of view.
          // half-diagonal of the top face (the cube may be turned any way) must stay inside the view
          const maxX = this.width / 2 / persp - 0.85 * grow,
            maxZ = this.height / 2 / persp - 0.85 * grow;
          const cx = this.width / 2 + Math.min(Math.max(p.x - this.width / 2, -maxX), maxX),
            cz = this.height / 2 + Math.min(Math.max(p.z - this.height / 2, -maxZ), maxZ);
          this.apply(id, { x: p.x + (cx - p.x) * rise, y: p.y + (peak - 0.5) * rise + bob, z: p.z + (cz - p.z) * rise, quat: qMul(qAxisAngle([0, 1, 0], yaw), p.quat) }, 1 + (grow - 1) * rise);
        } else this.apply(id, p, 1 - 0.07 * rise);
      }
      if (t >= 1) {
        opts.onDone();
        return false;
      }
      return true;
    });
  }

  /** Quick fade of the whole canvas (used at the end of a score effect), then `then`. */
  fadeOut(ms: number, then: () => void): () => void {
    const started = performance.now();
    const stop = this.loop((now) => {
      const t = Math.max(0, Math.min(1, (now - started) / ms));
      this.canvas.style.opacity = String(1 - t);
      if (t >= 1) {
        then();
        this.canvas.style.opacity = "";
        return false;
      }
      return true;
    });
    return () => {
      stop();
      this.canvas.style.opacity = "";
    };
  }

  dispose() {
    this.disposed = true;
    this.moves.forEach((stop) => stop());
    this.moves.clear();
    if (this.tickRaf) cancelAnimationFrame(this.tickRaf);
    this.steps.clear();
    if (this.queued) cancelAnimationFrame(this.queued);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.geometry.dispose();
    this.blobGeometry.dispose();
    this.materials.forEach((m) => {
      m.map?.dispose();
      m.emissiveMap?.dispose();
      m.dispose();
    });
    if (this.animTimer) window.clearInterval(this.animTimer);
    this.observer?.disconnect();
    this.blobMaterials.forEach((m) => m.dispose());
    this.blob.dispose();
    this.fx?.dispose();
    this.canvas.remove();
  }
}
