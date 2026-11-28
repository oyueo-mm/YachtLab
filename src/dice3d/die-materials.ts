import * as THREE from "three";
import { MATERIAL_ORDER } from "./physics";
import type { DiceMaterialSpec } from "./dice-material";
import { alphaTexture, bumpTexture, faceTexture, glowTexture, selfGlowTexture, surfaceTexture, type DiceColors } from "./stage";

/** Emission level of glowing pips (they are masked, so this never tints the whole die). */
export const GLOW_BASE = 0.55;

/**
 * The six face materials of one die look (FX-1). Shared by the 3D table and the static thumbnail renderer,
 * so a shop thumbnail is the same material as the die in a match. The caller owns (and disposes) the
 * returned materials and textures; `env` is only called when the material reflects its surroundings.
 */
export function buildDieMaterials(look: DiceColors, s: DiceMaterialSpec, opts: { physical: boolean; anisotropy: number; env: () => THREE.Texture; flat?: boolean }) {
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T) => (textures.push(t), t);
  const env = s.env > 0 ? opts.env() : null;
  const glowColor = look.glow ?? (s.selfGlow > 0 ? look.accent ?? look.edge : null);
  const glowBase = look.glow ? GLOW_BASE + (s.selfGlow ? 0.25 : 0) : s.selfGlow;
  const materials = MATERIAL_ORDER.map((v) => {
    const m = opts.physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
    const map = keep(faceTexture(v, 256, look));
    map.anisotropy = opts.anisotropy;
    m.map = map;
    if (!opts.flat) {
      m.bumpMap = keep(bumpTexture(v, 256, look, s));
      m.bumpScale = 1.4;
    }
    if (opts.flat) {
      // Tier 2 (weakest devices): the pre-FX-1 shading cost — scalar roughness / metalness, plain opacity,
      // no extra maps. Shape (rounded edges) and colours stay; reflections are off (caller passes env 0).
      m.roughness = Math.max(0.3, s.roughness);
      m.metalness = Math.min(0.55, s.metalness);
      if (s.opacity < 1) {
        m.transparent = true;
        m.opacity = Math.max(0.86, s.opacity);
      }
    } else {
      const surface = keep(surfaceTexture(v, 128, look, s));
      m.roughnessMap = surface;
      m.metalnessMap = surface;
      m.roughness = 1;
      m.metalness = 1;
      if (s.opacity < 1) {
        m.transparent = true;
        m.alphaMap = keep(alphaTexture(v, 128, s));
      }
    }
    if (env) {
      m.envMap = env;
      m.envMapIntensity = s.env;
    }
    if (m instanceof THREE.MeshPhysicalMaterial) {
      m.clearcoat = s.clearcoat;
      m.clearcoatRoughness = s.clearcoatRoughness;
      if (s.iridescence) {
        m.iridescence = s.iridescence;
        m.iridescenceIOR = 1.3;
        m.iridescenceThicknessRange = [120, 420];
      }
      if (s.sheen) {
        m.sheen = s.sheen;
        m.sheenRoughness = 0.55;
        m.sheenColor.set(s.sheenColor ?? "#ffffff");
      }
      if (s.class === "gem") m.ior = 1.77;
    }
    if (glowColor) {
      // Glow lights the pips / rim (and a material's own glowing pattern) through an emission mask.
      m.emissiveMap = keep(s.selfGlow > 0 ? selfGlowTexture(v, 128, look, !!look.glow) : glowTexture(v, 128, look));
      m.emissive.set(glowColor);
      m.emissiveIntensity = glowBase;
    }
    return m as THREE.MeshStandardMaterial;
  });
  return { materials, textures, glowBase };
}
