import * as THREE from "three";
import { MATERIAL_ORDER, finalValue, simulateThrow, type SimInput, type SimResult } from "./physics";

/**
 * three.js renderer for pre-simulated dice throws. Loaded lazily (separate chunk) only when the
 * 3D quality is in use, so it never delays the first paint of the lobby or the game.
 * The canvas is an overlay inside the dice tray with `pointer-events: none`; the real, accessible
 * dice buttons stay in the DOM underneath and are shown again as soon as the throw ends.
 */
export { simulateThrow, finalValue };
export type { SimInput, SimResult };

const PIPS: Record<number, number[][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

export function faceTexture(value: number, px: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const g = canvas.getContext("2d")!;
  const k = px / 100;
  g.fillStyle = "#d4d4d4"; // edge tone, reads as a rounded bevel
  g.fillRect(0, 0, px, px);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.roundRect(3 * k, 3 * k, 94 * k, 94 * k, 18 * k);
  g.fill();
  g.fillStyle = "#202020";
  for (const [x, y] of PIPS[value]) {
    g.beginPath();
    g.arc(x * k, y * k, 7.4 * k, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function blobTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export type Quality = "3d-high" | "3d";
export type PlayOptions = {
  result: SimResult;
  /** Called when a die hits something, at the frame it happens on screen. */
  onImpact?: (impact: { strength: number; kind: "floor" | "wall" | "die"; x: number }) => void;
  onDone: () => void;
  /** Playback speed (1 = real time of the simulation). */
  rate?: number;
};

export class DiceStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private materials: THREE.MeshStandardMaterial[];
  private meshes: THREE.Mesh[] = [];
  private blobs: THREE.Mesh[] = [];
  private light: THREE.DirectionalLight;
  private floor: THREE.Mesh | null = null;
  private frame = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  /** Frame-time samples (ms) of the most recent throw, for the dice lab. */
  frameTimes: number[] = [];

  constructor(private host: HTMLElement, readonly quality: Quality) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "dice3d-canvas";
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
    const blob = blobTexture();
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.materials);
      mesh.castShadow = quality === "3d-high";
      mesh.visible = false;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      if (quality !== "3d-high") {
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
        shadow.rotation.x = -Math.PI / 2;
        shadow.visible = false;
        this.scene.add(shadow);
        this.blobs.push(shadow);
      }
    }
    host.appendChild(this.canvas);
  }

  /** Match the tray: world units are die edges, so 1 unit == `dieSize` CSS pixels on the top-face plane. */
  layout(widthPx: number, heightPx: number, dieSize: number) {
    this.width = widthPx / dieSize;
    this.height = heightPx / dieSize;
    this.renderer.setSize(widthPx, heightPx, false);
    const fov = this.camera.fov;
    const distance = this.height / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
    this.camera.aspect = widthPx / heightPx;
    this.camera.position.set(this.width / 2, 1 + distance, this.height / 2);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.width / 2, 0, this.height / 2);
    this.camera.near = Math.max(0.1, distance - 6);
    this.camera.far = distance + 4;
    this.camera.updateProjectionMatrix();
    this.light.position.set(this.width / 2 - 3, 9, this.height / 2 - 5);
    this.light.target.position.set(this.width / 2, 0, this.height / 2);
    if (this.quality === "3d-high") {
      const cam = this.light.shadow.camera as THREE.OrthographicCamera;
      const r = Math.max(this.width, this.height) * 0.75;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = 30;
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
  }

  /** Play a pre-simulated throw. Returns a cancel function (stops rendering and pending impacts). */
  play({ result, onImpact, onDone, rate = 1.15 }: PlayOptions): () => void {
    this.stop();
    const tracks = result.tracks;
    this.meshes.forEach((m, i) => (m.visible = i < tracks.length));
    this.blobs.forEach((b, i) => (b.visible = i < tracks.length));
    this.canvas.style.visibility = "visible";
    const impacts = [...result.impacts].sort((a, b) => a.frame - b.frame);
    let nextImpact = 0;
    const started = performance.now();
    let last = started;
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
      tracks.forEach((t, k) => {
        const mesh = this.meshes[k],
          o = i * 7,
          p = j * 7,
          fr = t.frames;
        mesh.position.set(fr[o] + (fr[p] - fr[o]) * a, fr[o + 1] + (fr[p + 1] - fr[o + 1]) * a, fr[o + 2] + (fr[p + 2] - fr[o + 2]) * a);
        q0.set(fr[o + 3], fr[o + 4], fr[o + 5], fr[o + 6]);
        q1.set(fr[p + 3], fr[p + 4], fr[p + 5], fr[p + 6]);
        mesh.quaternion.slerpQuaternions(q0, q1, a);
        const blob = this.blobs[k];
        if (blob) {
          const h = Math.max(0, mesh.position.y - 0.5);
          blob.position.set(mesh.position.x + 0.08, 0.002, mesh.position.z + 0.1);
          blob.scale.setScalar(1 + h * 0.35);
          (blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.9 - h * 0.5);
        }
      });
      while (nextImpact < impacts.length && impacts[nextImpact].frame <= f) {
        const hit = impacts[nextImpact++];
        const t = tracks.findIndex((tr) => tr.id === hit.id);
        onImpact?.({ strength: hit.strength, kind: hit.kind, x: t >= 0 ? this.meshes[t].position.x / this.width : 0.5 });
      }
      this.renderer.render(this.scene, this.camera);
      if (f >= result.frameCount - 1) {
        this.frame = 0;
        onDone();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
    return () => this.stop();
  }

  /** Hide the overlay (the DOM dice take over) and cancel any running throw. */
  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas.style.visibility = "hidden";
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.renderer.dispose();
    this.geometry.dispose();
    this.materials.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    this.canvas.remove();
    void this.host;
  }
}
