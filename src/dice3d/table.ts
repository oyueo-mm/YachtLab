import * as THREE from "three";
import { MATERIAL_ORDER, canonicalOrientation, finalValue, qAxisAngle, qDot, qMul, qSlerp, simulateThrow, topFace, type Quat, type SimResult } from "./physics";
import { blobTexture, faceTexture, type Quality } from "./stage";

/**
 * Persistent 3D dice table: a roll tray and a hold shelf below it, drawn on one canvas.
 * Dice stay exactly where physics left them (no row alignment, no 2D swap). Rendering happens on
 * demand — the GPU is idle unless a die is moving.
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
  private floor: THREE.Mesh | null = null;
  private blob: THREE.CanvasTexture;
  private queued = 0;
  private animations = new Set<number>();
  private disposed = false;
  width = 1;
  height = 1;
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
    this.materials = MATERIAL_ORDER.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v, quality === "3d-high" ? 256 : 128), roughness: 0.42, metalness: 0 }));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 1.35));
    this.light = new THREE.DirectionalLight(0xffffff, 1.35);
    this.scene.add(this.light, this.light.target);
    if (quality === "3d-high") {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.light.castShadow = true;
      this.light.shadow.mapSize.set(1024, 1024);
      this.light.shadow.bias = -0.0015;
    }
    this.blob = blobTexture();
    host.appendChild(this.canvas);
  }

  private mesh(id: number) {
    let m = this.meshes.get(id);
    if (!m) {
      m = new THREE.Mesh(this.geometry, this.materials);
      m.castShadow = this.quality === "3d-high";
      this.scene.add(m);
      this.meshes.set(id, m);
      if (this.quality !== "3d-high") {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: this.blob, transparent: true, depthWrite: false }));
        b.rotation.x = -Math.PI / 2;
        this.scene.add(b);
        this.blobs.set(id, b);
      }
    }
    return m;
  }

  layout(widthPx: number, heightPx: number, size: number) {
    this.width = widthPx / size;
    this.height = heightPx / size;
    this.renderer.setSize(widthPx, heightPx, false);
    const distance = this.height / 2 / Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    this.camera.aspect = widthPx / heightPx;
    this.camera.position.set(this.width / 2, 1 + distance, this.height / 2);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.width / 2, 0, this.height / 2);
    this.camera.near = Math.max(0.1, distance - 8);
    this.camera.far = distance + 4;
    this.camera.updateProjectionMatrix();
    this.light.position.set(this.width / 2 - 3, 9, this.height / 2 - 5);
    this.light.target.position.set(this.width / 2, 0, this.height / 2);
    if (this.quality === "3d-high") {
      const cam = this.light.shadow.camera as THREE.OrthographicCamera;
      const r = Math.max(this.width, this.height) * 0.75;
      Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 30 });
      cam.updateProjectionMatrix();
      if (!this.floor) {
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.32 }));
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
      }
      this.floor.scale.set(this.width, this.height, 1);
      this.floor.position.set(this.width / 2, 0, this.height / 2);
    }
    this.warmUp();
    this.requestRender();
  }

  private warmed = false;
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

  /** Place dice statically; dice not listed are removed from view. */
  setPoses(poses: Map<number, Pose>) {
    for (const [id, m] of this.meshes) if (!poses.has(id)) this.setVisible(id, m, false);
    for (const [id, p] of poses) this.apply(id, p);
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

  private apply(id: number, p: Pose) {
    const m = this.mesh(id);
    this.setVisible(id, m, true);
    m.position.set(p.x, p.y, p.z);
    m.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
    const b = this.blobs.get(id);
    if (b) {
      const h = Math.max(0, p.y - 0.5);
      b.position.set(p.x + 0.08, 0.002, p.z + 0.1);
      b.scale.setScalar(1 + h * 0.35);
      (b.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.9 - h * 0.5);
    }
  }

  requestRender() {
    if (this.queued || this.disposed) return;
    this.queued = requestAnimationFrame(() => {
      this.queued = 0;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  }

  /** Play a pre-simulated throw for the dice in `result.tracks`; they stay at their final pose. */
  play(result: SimResult, opts: { rate?: number; onFrame?: () => void; onImpact?: (i: { strength: number; kind: "floor" | "wall" | "die"; x: number }) => void; onDone: () => void }): () => void {
    const rate = opts.rate ?? 1.15;
    const impacts = [...result.impacts].sort((a, b) => a.frame - b.frame);
    let next = 0;
    const started = performance.now();
    let last = started,
      raf = 0;
    this.frameTimes = [];
    const q0 = new THREE.Quaternion(),
      q1 = new THREE.Quaternion();
    const tick = (now: number) => {
      if (this.disposed) return;
      this.frameTimes.push(now - last);
      last = now;
      const f = Math.min(result.frameCount - 1, ((now - started) / 1000) * result.fps * rate);
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
      this.renderer.render(this.scene, this.camera);
      opts.onFrame?.();
      if (f >= result.frameCount - 1) {
        this.animations.delete(raf);
        opts.onDone();
        return;
      }
      raf = requestAnimationFrame(tick);
      this.animations.add(raf);
    };
    raf = requestAnimationFrame(tick);
    this.animations.add(raf);
    return () => {
      cancelAnimationFrame(raf);
      this.animations.delete(raf);
    };
  }

  /** Smoothly move one die (hold ↔ tray). Only yaw changes, so the top face is preserved. */
  moveTo(id: number, from: Pose, to: Pose, ms: number, onDone?: () => void): () => void {
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (this.disposed) return;
      const t = Math.min(1, (now - started) / ms),
        e = t * t * (3 - 2 * t),
        lift = Math.sin(Math.PI * t) * 0.35;
      this.apply(id, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e + lift, z: from.z + (to.z - from.z) * e, quat: qSlerp(from.quat, to.quat, e) });
      this.renderer.render(this.scene, this.camera);
      if (t >= 1) {
        this.animations.delete(raf);
        onDone?.();
        return;
      }
      raf = requestAnimationFrame(tick);
      this.animations.add(raf);
    };
    raf = requestAnimationFrame(tick);
    this.animations.add(raf);
    return () => {
      cancelAnimationFrame(raf);
      this.animations.delete(raf);
    };
  }

  dispose() {
    this.disposed = true;
    this.animations.forEach((id) => cancelAnimationFrame(id));
    if (this.queued) cancelAnimationFrame(this.queued);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.geometry.dispose();
    this.materials.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    this.blob.dispose();
    this.canvas.remove();
    void this.host;
  }
}
