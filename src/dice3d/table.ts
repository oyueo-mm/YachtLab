import * as THREE from "three";
import { MATERIAL_ORDER, canonicalOrientation, finalValue, qAxisAngle, qDot, qMul, qSlerp, simulateThrow, topFace, type Quat, type SimResult } from "./physics";
import { blobTexture, faceTexture, type Quality } from "./stage";

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
export { simulateThrow, finalValue, canonicalOrientation, topFace };
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
  /** One running animation per die: a new one for the same die replaces the old one. */
  private moves = new Map<number, () => void>();
  private loops = new Set<number>();
  private disposed = false;
  private warmed = false;
  width = 1;
  height = 1;
  private cameraDistance = 16;
  /** Called whenever a die is drawn at a new place (DOM hit targets follow it). */
  onPose: ((id: number, pose: Pose) => void) | null = null;
  /** Frame-time samples (ms) of the most recent roll. */
  frameTimes: number[] = [];

  constructor(private host: HTMLElement, readonly quality: Quality) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "dice-table-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: quality === "3d-high", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "3d-high" ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    // Matte dice: high roughness, no metalness, no environment reflections.
    this.materials = MATERIAL_ORDER.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v, quality === "3d-high" ? 256 : 128), roughness: 0.62, metalness: 0 }));
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

  layout(widthPx: number, heightPx: number, size: number) {
    this.width = widthPx / size;
    this.height = heightPx / size;
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
    this.warmUp();
    this.requestRender();
  }

  /** Compile shaders once with dice outside the view, so the first throw does not stall. */
  private warmUp() {
    if (this.warmed) return;
    this.warmed = true;
    const ids = [0, 1, 2, 3, 4];
    const hidden = ids.filter((id) => !this.meshes.get(id)?.visible);
    for (const id of ids) {
      const m = this.mesh(id);
      if (hidden.includes(id)) {
        m.visible = true;
        m.position.set(this.width / 2, -40, this.height / 2);
      }
    }
    try {
      this.renderer.compile(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
    } catch {
      // compile is an optimization only
    }
    for (const id of hidden) this.setVisible(id, this.meshes.get(id)!, false);
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

  private loop(step: (now: number) => boolean) {
    let raf = 0;
    const tick = (now: number) => {
      this.loops.delete(raf);
      if (this.disposed) return;
      const more = step(now);
      this.renderer.render(this.scene, this.camera);
      if (more) {
        raf = requestAnimationFrame(tick);
        this.loops.add(raf);
      }
    };
    raf = requestAnimationFrame(tick);
    this.loops.add(raf);
    return () => {
      cancelAnimationFrame(raf);
      this.loops.delete(raf);
    };
  }

  /** Play a pre-simulated throw for the dice in `result.tracks`; they stay at their final pose. */
  play(result: SimResult, opts: { rate?: number; onFrame?: () => void; onRoll?: (level: number) => void; onImpact?: (i: { strength: number; kind: "floor" | "wall" | "die"; x: number }) => void; onDone: () => void }): () => void {
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
    return this.loop((now) => {
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
      while (next < impacts.length && impacts[next].frame <= f) {
        const hit = impacts[next++];
        const m = this.meshes.get(hit.id);
        opts.onImpact?.({ strength: hit.strength, kind: hit.kind, x: m ? m.position.x / this.width : 0.5 });
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
      opts.onFrame?.();
      if (f >= result.frameCount - 1) {
        opts.onDone();
        return false;
      }
      return true;
    });
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
    const stop = this.loop((now) => {
      const t = Math.max(0, Math.min(1, (now - started) / ms)),
        e = smooth(t),
        lift = Math.sin(Math.PI * t) * 0.35;
      this.apply(id, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e + lift, z: from.z + (to.z - from.z) * e, quat: qSlerp(from.quat, to.quat, e) });
      if (t >= 1) {
        this.moves.delete(id);
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
    this.loops.forEach((id) => cancelAnimationFrame(id));
    this.loops.clear();
    if (this.queued) cancelAnimationFrame(this.queued);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.geometry.dispose();
    this.blobGeometry.dispose();
    this.materials.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    this.blobMaterials.forEach((m) => m.dispose());
    this.blob.dispose();
    this.canvas.remove();
    void this.host;
  }
}
