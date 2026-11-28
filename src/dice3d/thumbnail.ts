import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { diceMaterialSpec, liteSpec } from "./dice-material";
import { buildDieMaterials } from "./die-materials";
import { studioScene } from "./studio-env";
import { CLASSIC_DICE, type DiceColors } from "./stage";

/**
 * Static 3D dice thumbnails (FX-1, for UI-2's shop cards). One die at a ¾ view (faces 5 · 3 · 1 visible),
 * rendered once with the match's materials and cached as a data URL per look and size. Cost model:
 *  - one shared WebGL context, created on the first request and released (forceContextLoss) 8 s after the
 *    last one — a shop page never keeps an extra context alive while the player is in a match;
 *  - requests run one at a time; each render ≈ face painting (6 × 256²) + one draw;
 *  - results are memoised in memory (and in sessionStorage up to ~1.5 MB) so scrolling does not repaint.
 * Callers should keep the existing 2D canvas thumbnail (`paintFace`) as the instant placeholder and as the
 * fallback when WebGL is unavailable (this function then resolves to null).
 */
const cache = new Map<string, string>();
const SESSION_KEY = "yachtlab.dice-thumbs.v1";
let renderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
let releaseTimer = 0;
let chain: Promise<unknown> = Promise.resolve();

function loadSession() {
  if (cache.size) return;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) cache.set(k, v);
  } catch {
    /* private mode */
  }
}
function saveSession() {
  try {
    let total = 0;
    const out: Record<string, string> = {};
    for (const [k, v] of [...cache].reverse()) {
      total += v.length;
      if (total > 1_500_000) break;
      out[k] = v;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(out));
  } catch {
    /* quota / private mode */
  }
}
function release() {
  env?.dispose();
  env = null;
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
}

/** Data URL of a 3D thumbnail of `look` (null without WebGL). `px` is the bitmap size (e.g. 2 × CSS size). */
export function diceThumbnail(look: DiceColors | null | undefined, px = 128, opts: { physical?: boolean } = {}): Promise<string | null> {
  const l = look ?? CLASSIC_DICE;
  const physical = opts.physical ?? true;
  const key = `${px}|${physical ? 1 : 0}|${JSON.stringify(l)}`;
  loadSession();
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = chain.then(() => render(l, px, physical, key));
  chain = job.catch(() => null);
  return job;
}

function render(look: DiceColors, px: number, physical: boolean, key: string): string | null {
  window.clearTimeout(releaseTimer);
  try {
    if (!renderer) {
      const canvas = document.createElement("canvas");
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
    }
    renderer.setSize(px, px, false);
    const raw = diceMaterialSpec(look, look.fx);
    const usePhysical = physical && (raw.clearcoat > 0 || raw.iridescence > 0 || raw.sheen > 0);
    const s = physical ? raw : liteSpec(raw);
    const r = renderer;
    const built = buildDieMaterials(look, s, {
      physical: usePhysical,
      anisotropy: Math.min(8, r.capabilities.getMaxAnisotropy?.() ?? 4),
      env: () => {
        if (!env) {
          const pmrem = new THREE.PMREMGenerator(r);
          const studio = studioScene();
          env = pmrem.fromScene(studio.scene, 0.03).texture;
          studio.dispose();
          pmrem.dispose();
        }
        return env;
      },
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa8a8a8, 1.45));
    const key1 = new THREE.DirectionalLight(0xffffff, 0.95);
    key1.position.set(-2.5, 6, 3);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.32);
    rim.position.set(3, 4, -4);
    scene.add(key1, rim);
    const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.085);
    const mesh = new THREE.Mesh(geometry, built.materials);
    // MATERIAL_ORDER puts 5 on +y; turn so 3 and 1 show on the two lit sides (presentation only)
    mesh.rotation.set(0.62, -0.72, 0.18);
    scene.add(mesh);
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
    camera.position.set(0, 0.9, 3.9);
    camera.lookAt(0, 0, 0);
    r.render(scene, camera);
    const url = r.domElement.toDataURL("image/webp", 0.9);
    geometry.dispose();
    built.materials.forEach((m) => m.dispose());
    built.textures.forEach((t) => t.dispose());
    cache.set(key, url);
    saveSession();
    return url;
  } catch {
    return null;
  } finally {
    releaseTimer = window.setTimeout(release, 8000);
  }
}
