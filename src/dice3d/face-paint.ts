/**
 * Dice face painting shared by the 3D table (face textures) and the item previews (H, 2026-11-25).
 * Pure canvas 2D drawing, deterministic per pattern (seeded), no images or fonts: every design is
 * generated here, so there is nothing with unclear copyright. Pips always keep a strong contrast with
 * the face (readability is checked in tests), whatever the pattern.
 */
import type { DiceLook } from "./dice-look";
export type { DiceAnim, DiceFinish, DiceLook, DicePattern } from "./dice-look";

export const PIPS: Record<number, number[][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

/** Small deterministic generator (the same face always looks the same). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function paintPattern(g: Ctx, look: DiceLook, value: number, k: number) {
  const p = look.pattern ?? "none";
  const accent = look.accent ?? look.edge;
  const r = rng(value * 7919 + p.length * 104729);
  const size = 100 * k;
  switch (p) {
    case "pastel": {
      const grad = g.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, look.face);
      grad.addColorStop(1, accent);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return;
    }
    case "marble": {
      g.strokeStyle = accent;
      g.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        g.globalAlpha = 0.18 + r() * 0.3;
        g.lineWidth = (0.6 + r() * 1.8) * k;
        g.beginPath();
        let x = r() * size,
          y = 0;
        g.moveTo(x, y);
        while (y < size) {
          x += (r() - 0.5) * 22 * k;
          y += (6 + r() * 10) * k;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    case "wood": {
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = accent;
        g.globalAlpha = 0.18 + r() * 0.22;
        g.lineWidth = (1 + r() * 3) * k;
        const y = (i / 14) * size + r() * 4 * k;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(size * 0.3, y + (r() - 0.5) * 8 * k, size * 0.7, y + (r() - 0.5) * 8 * k, size, y + (r() - 0.5) * 4 * k);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    case "stars": {
      const neb = g.createRadialGradient(size * 0.3, size * 0.3, 0, size * 0.3, size * 0.3, size * 0.8);
      neb.addColorStop(0, accent);
      neb.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.45;
      g.fillStyle = neb;
      g.fillRect(0, 0, size, size);
      g.globalAlpha = 1;
      g.fillStyle = "#ffffff";
      for (let i = 0; i < 40; i++) {
        g.globalAlpha = 0.3 + r() * 0.7;
        g.beginPath();
        g.arc(r() * size, r() * size, (0.3 + r() * 0.9) * k, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }
    case "aurora": {
      for (let i = 0; i < 3; i++) {
        const grad = g.createLinearGradient(0, 0, size, 0);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, i % 2 ? accent : look.glow ?? accent);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = 0.35;
        g.fillStyle = grad;
        g.beginPath();
        const y = (20 + i * 22) * k;
        g.moveTo(0, y);
        g.bezierCurveTo(size * 0.3, y - 14 * k, size * 0.6, y + 14 * k, size, y - 4 * k);
        g.lineTo(size, y + 12 * k);
        g.bezierCurveTo(size * 0.6, y + 24 * k, size * 0.3, y, 0, y + 14 * k);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }
    case "lava": {
      g.strokeStyle = accent;
      g.lineJoin = "round";
      for (let i = 0; i < 7; i++) {
        g.globalAlpha = 0.55 + r() * 0.4;
        g.lineWidth = (1 + r() * 2.2) * k;
        g.beginPath();
        let x = r() * size,
          y = r() * size;
        g.moveTo(x, y);
        for (let j = 0; j < 4; j++) {
          x += (r() - 0.5) * 30 * k;
          y += (r() - 0.5) * 30 * k;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    case "ice": {
      g.strokeStyle = accent;
      g.globalAlpha = 0.45;
      g.lineWidth = 0.8 * k;
      for (let i = 0; i < 5; i++) {
        const cx = r() * size,
          cy = r() * size,
          len = (6 + r() * 10) * k;
        for (let a = 0; a < 6; a++) {
          const t = (a / 6) * Math.PI * 2;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(t) * len, cy + Math.sin(t) * len);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      return;
    }
    case "holo": {
      const grad = g.createLinearGradient(0, 0, size, size);
      ["#ff9ad5", "#9ad0ff", "#a8ffcf", "#fff4a3", "#d2a8ff"].forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
      g.globalAlpha = 0.55;
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      g.globalAlpha = 1;
      return;
    }
    case "neon": {
      g.strokeStyle = accent;
      g.lineWidth = 3 * k;
      g.shadowColor = accent;
      g.shadowBlur = 8 * k;
      g.beginPath();
      g.roundRect(9 * k, 9 * k, 82 * k, 82 * k, 14 * k);
      g.stroke();
      g.shadowBlur = 0;
      return;
    }
    case "gem": {
      for (let i = 0; i < 8; i++) {
        g.globalAlpha = 0.08 + r() * 0.14;
        g.fillStyle = r() > 0.5 ? "#ffffff" : accent;
        g.beginPath();
        g.moveTo(50 * k, 50 * k);
        const a = (i / 8) * Math.PI * 2,
          b = ((i + 1) / 8) * Math.PI * 2;
        g.lineTo(50 * k + Math.cos(a) * 70 * k, 50 * k + Math.sin(a) * 70 * k);
        g.lineTo(50 * k + Math.cos(b) * 70 * k, 50 * k + Math.sin(b) * 70 * k);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }
    case "carbon": {
      g.globalAlpha = 0.18;
      g.fillStyle = accent;
      for (let y = 0; y < 100; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < 100; x += 6) g.fillRect(x * k, y * k, 3 * k, 3 * k);
      g.globalAlpha = 1;
      return;
    }
    case "brushed": {
      const grad = g.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, look.face);
      grad.addColorStop(0.5, accent);
      grad.addColorStop(1, look.face);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      g.strokeStyle = "#ffffff";
      for (let i = 0; i < 60; i++) {
        g.globalAlpha = 0.04 + r() * 0.08;
        g.lineWidth = 0.5 * k;
        const y = r() * size;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(size, y + (r() - 0.5) * 2 * k);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    case "dots": {
      g.fillStyle = accent;
      g.globalAlpha = 0.25;
      for (let y = 8; y < 100; y += 14) for (let x = (y / 14) % 2 ? 15 : 8; x < 100; x += 14) {
        g.beginPath();
        g.arc(x * k, y * k, 2 * k, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }
    case "lightning": {
      // a storm sky: soft cloud glow and two forked bolts (thin, so pips stay readable)
      const sky = g.createRadialGradient(size * 0.25, size * 0.15, 0, size * 0.25, size * 0.15, size);
      sky.addColorStop(0, "rgba(143,180,255,0.35)");
      sky.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sky;
      g.fillRect(0, 0, size, size);
      g.strokeStyle = accent;
      g.lineJoin = "miter";
      for (let i = 0; i < 2; i++) {
        let x = (0.2 + r() * 0.6) * size,
          y = 0;
        g.globalAlpha = 0.8;
        g.lineWidth = (1.4 - i * 0.4) * k;
        g.shadowColor = accent;
        g.shadowBlur = 4 * k;
        g.beginPath();
        g.moveTo(x, y);
        while (y < size) {
          x += (r() - 0.5) * 22 * k;
          y += (8 + r() * 10) * k;
          g.lineTo(x, y);
          if (r() < 0.25) {
            // a short fork
            g.moveTo(x, y);
            g.lineTo(x + (r() - 0.5) * 18 * k, y + 10 * k);
            g.moveTo(x, y);
          }
        }
        g.stroke();
      }
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      return;
    }
    case "grass": {
      // a lighter sky band and grass blades rising from the bottom edge
      const sky = g.createLinearGradient(0, 0, 0, size);
      sky.addColorStop(0, "rgba(255,255,255,0.35)");
      sky.addColorStop(0.55, "rgba(255,255,255,0)");
      g.fillStyle = sky;
      g.fillRect(0, 0, size, size);
      g.lineCap = "round";
      for (let i = 0; i < 34; i++) {
        const x = r() * size,
          h = (12 + r() * 26) * k,
          bend = (r() - 0.5) * 12 * k;
        g.strokeStyle = r() < 0.5 ? accent : look.edge;
        g.globalAlpha = 0.35 + r() * 0.35;
        g.lineWidth = (0.9 + r() * 1.3) * k;
        g.beginPath();
        g.moveTo(x, size);
        g.quadraticCurveTo(x + bend * 0.3, size - h * 0.6, x + bend, size - h);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    case "petals": {
      // scattered five-petal flowers in two colours with yellow centres
      const colours = [accent, look.edge, "#ffd36b"];
      for (let i = 0; i < 7; i++) {
        const cx = r() * size,
          cy = r() * size,
          pr = (3 + r() * 3.5) * k;
        g.globalAlpha = 0.55;
        g.fillStyle = colours[i % 2];
        for (let a = 0; a < 5; a++) {
          const t = (a / 5) * Math.PI * 2 + r();
          g.beginPath();
          g.ellipse(cx + Math.cos(t) * pr, cy + Math.sin(t) * pr, pr * 0.75, pr * 0.5, t, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 0.8;
        g.fillStyle = colours[2];
        g.beginPath();
        g.arc(cx, cy, pr * 0.45, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }
    case "sakura": {
      // a pink wash, a dark branch across one corner and notched cherry-blossom petals
      const wash = g.createLinearGradient(0, 0, size, size);
      wash.addColorStop(0, "rgba(255,255,255,0.5)");
      wash.addColorStop(1, "rgba(255,170,195,0.35)");
      g.fillStyle = wash;
      g.fillRect(0, 0, size, size);
      g.strokeStyle = accent;
      g.globalAlpha = 0.55;
      g.lineWidth = 2.2 * k;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(-2 * k, 18 * k);
      g.quadraticCurveTo(22 * k, 10 * k, 40 * k, 4 * k);
      g.moveTo(16 * k, 13 * k);
      g.lineTo(24 * k, 22 * k);
      g.stroke();
      const petal = (cx: number, cy: number, pr: number, rot: number) => {
        g.save();
        g.translate(cx, cy);
        g.rotate(rot);
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(-pr * 0.9, -pr * 0.4, -pr * 0.6, -pr * 1.3, -pr * 0.12, -pr * 1.2);
        g.lineTo(0, -pr * 0.95); // the notch at the tip of a cherry petal
        g.lineTo(pr * 0.12, -pr * 1.2);
        g.bezierCurveTo(pr * 0.6, -pr * 1.3, pr * 0.9, -pr * 0.4, 0, 0);
        g.fill();
        g.restore();
      };
      g.fillStyle = "#ff9fba";
      for (let i = 0; i < 9; i++) {
        g.globalAlpha = 0.4 + r() * 0.35;
        petal(r() * size, r() * size, (3.5 + r() * 3) * k, r() * Math.PI * 2);
      }
      g.globalAlpha = 1;
      return;
    }
    case "abyss": {
      // deep water: light shafts from above, faint caustic rings and bioluminescent dots
      const shaft = g.createLinearGradient(0, 0, 0, size);
      shaft.addColorStop(0, "rgba(63,224,208,0.22)");
      shaft.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = shaft;
      for (let i = 0; i < 3; i++) {
        const x = (0.15 + r() * 0.7) * size;
        g.beginPath();
        g.moveTo(x - 4 * k, 0);
        g.lineTo(x + 4 * k, 0);
        g.lineTo(x + 14 * k, size);
        g.lineTo(x - 2 * k, size);
        g.fill();
      }
      g.strokeStyle = accent;
      g.lineWidth = 0.7 * k;
      for (let i = 0; i < 4; i++) {
        g.globalAlpha = 0.18 + r() * 0.15;
        g.beginPath();
        g.ellipse(r() * size, r() * size, (8 + r() * 10) * k, (4 + r() * 5) * k, r() * Math.PI, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = accent;
      for (let i = 0; i < 16; i++) {
        g.globalAlpha = 0.3 + r() * 0.6;
        g.beginPath();
        g.arc(r() * size, r() * size, (0.5 + r() * 1.1) * k, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }
    default:
      return;
  }
}

/** Paint one die face (edge bevel, face, pattern, pips) onto a square canvas of `px` pixels. */
export function paintFace(g: Ctx, value: number, px: number, look: DiceLook) {
  const k = px / 100;
  g.clearRect(0, 0, px, px);
  g.fillStyle = look.edge; // edge tone, reads as a rounded bevel
  g.fillRect(0, 0, px, px);
  g.save();
  g.beginPath();
  g.roundRect(3 * k, 3 * k, 94 * k, 94 * k, 18 * k);
  g.clip();
  g.fillStyle = look.face;
  g.fillRect(0, 0, px, px);
  paintPattern(g, look, value, k);
  if (look.finish === "gloss" || look.finish === "glass" || look.finish === "metal") {
    // a soft highlight band (reads as a polished surface even without reflections)
    const hl = g.createLinearGradient(0, 0, px, px);
    hl.addColorStop(0, "rgba(255,255,255,0.28)");
    hl.addColorStop(0.35, "rgba(255,255,255,0)");
    g.fillStyle = hl;
    g.fillRect(0, 0, px, px);
  }
  g.restore();
  g.fillStyle = look.pip;
  if (look.glow) {
    g.shadowColor = look.glow;
    g.shadowBlur = 6 * k;
  }
  for (const [x, y] of PIPS[value]) {
    g.beginPath();
    g.arc(x * k, y * k, 7.4 * k, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowBlur = 0;
}

/** Relative luminance contrast between two #rrggbb colours (WCAG formula). */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const c = hex.replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Emission mask for Lv.2/Lv.3 glow (2026-11-26): black everywhere except the pips and, for neon dice,
 * the rim. Used as the material's emissiveMap so a glowing die lights up its pips / rim only — the body
 * keeps its own colour (before, the whole die was tinted by the glow colour).
 */
export function paintGlowMap(g: Ctx, value: number, px: number, look: DiceLook) {
  const k = px / 100;
  g.fillStyle = "#000";
  g.fillRect(0, 0, px, px);
  g.fillStyle = g.strokeStyle = "#fff";
  if (look.pattern === "neon") {
    g.lineWidth = 3 * k;
    g.beginPath();
    g.roundRect(9 * k, 9 * k, 82 * k, 82 * k, 14 * k);
    g.stroke();
  }
  for (const [x, y] of PIPS[value]) {
    g.beginPath();
    g.arc(x * k, y * k, 7.4 * k, 0, Math.PI * 2);
    g.fill();
  }
}
