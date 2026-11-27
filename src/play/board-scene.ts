/**
 * Board scenes (A1, 2026-11-27): what every board does at Lv.2 and Lv.3, drawn procedurally on ONE
 * canvas inside the tray, under the dice (never over pips, buttons or the score sheet).
 *
 *  Lv.1  the board's own surface and material (CSS) — not drawn here.
 *  Lv.2  `ambient`: the environment keeps moving while nobody rolls (wind in the grass, swinging lamp,
 *        flowing lava, circuit pulses …). Each board has its own motion, not a recoloured one.
 *  Lv.3  Lv.2 + `hit`: a local reaction at the real collision point, sized by the real impact strength
 *        (dice-edges per second from the physics; 2.5D sends its planned hits). Many reactions change
 *        the Lv.2 environment itself (grass flattens and springs back, settled petals scatter, marble
 *        veins light up from the hit, stars are lensed by a gravity wave).
 *
 * Presentation only: reads the cosmetic event bus, never dice values, physics, scores or the AI.
 * Cost: soft lights are cached sprites (no gradient per frame), ~30 fps ambient / 60 fps only while a
 * reaction runs, paused off screen / hidden tab, scaled by the effect budget (0 = not mounted).
 */
export type HitKind = "impact" | "land";
export type Scene = {
  /** Called on (re)layout with the tray size in CSS px. */
  layout(w: number, h: number): void;
  /** Lv.2 environment, every ambient frame. `t` seconds since start, `dt` seconds since last frame. */
  ambient(g: CanvasRenderingContext2D, t: number, dt: number): void;
  /** Lv.3 reaction at (x, y); `s` = strength 0.25 … 1.3 (≈ impact speed / 14). */
  hit(x: number, y: number, s: number, kind: HitKind): void;
  /** Big moments (large straight / yacht / win): the scene answers across the board. */
  big?(kind: "straight" | "yacht" | "win"): void;
  roll?(): void;
  /** True while a Lv.3 reaction is still animating (the layer then draws at full rate). */
  busy(): boolean;
};
type Thing = { x: number; y: number; t0: number; life: number; s: number; k: string; seed: number; data?: number[][] };

/* ------------------------------------------------------------------ helpers ------------------------------------------------------------------ */

const sprites = new Map<string, HTMLCanvasElement>();
/** A cached 64 px radial glow of `color` (drawImage is far cheaper than a gradient fill per frame). */
export function glowSprite(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, color);
    r.addColorStop(0.45, color + "88".slice(0, color.length === 7 ? 2 : 0));
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  sprites.set(color, c);
  return c;
}
function soft(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, rx = r) {
  if (alpha <= 0.003 || r <= 0) return;
  g.globalAlpha = Math.min(1, alpha);
  g.drawImage(glowSprite(color), x - rx, y - r, rx * 2, r * 2);
}
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const now = () => performance.now();

/** Base with a list of timed things (reactions) and the board size. */
abstract class Base implements Scene {
  w = 1;
  h = 1;
  things: Thing[] = [];
  protected r = rng(97);
  constructor(protected budget: number) {}
  layout(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.build();
  }
  protected build() {}
  abstract ambient(g: CanvasRenderingContext2D, t: number, dt: number): void;
  hit(x: number, y: number, s: number, kind: HitKind) {
    this.react(x, y, s, kind);
  }
  protected abstract react(x: number, y: number, s: number, kind: HitKind): void;
  big(kind: "straight" | "yacht" | "win") {
    const n = kind === "straight" ? 3 : 5;
    for (let i = 0; i < n; i++) this.react(this.w * (0.15 + (0.7 * i) / (n - 1)), this.h * (0.4 + 0.22 * Math.sin(i * 2.1)), 1.2, "land");
  }
  protected add(k: string, x: number, y: number, life: number, s: number, data?: number[][]) {
    if (this.things.length > 48) this.things.shift();
    this.things.push({ k, x, y, t0: now(), life, s, seed: (this.r() * 1e9) | 0, data });
  }
  /** Draw the live things with `draw(thing, age, k01)`; drops finished ones. */
  protected each(fn: (t: Thing, age: number, k: number) => void) {
    const n = now();
    this.things = this.things.filter((t) => (n - t.t0) / 1000 < t.life);
    for (const t of this.things) {
      const age = (n - t.t0) / 1000;
      fn(t, age, age / t.life);
    }
  }
  busy() {
    return this.things.length > 0;
  }
}

/* --------------------------------------------------------- shared reactions ----------------------------------------------------------- */

function drawRipple(g: CanvasRenderingContext2D, t: Thing, age: number, color: string, rings: number, speed: number, width = 1.4, squash = 0.78) {
  g.strokeStyle = color;
  for (let i = 0; i < rings; i++) {
    const a = age - i * 0.14;
    if (a <= 0) continue;
    const r = 4 + a * speed * (0.6 + 0.5 * t.s);
    const fade = clamp(1 - a / (t.life - i * 0.14), 0, 1);
    g.globalAlpha = 0.65 * fade * fade * Math.min(1, t.s + 0.3);
    g.lineWidth = width * (1 - a / t.life) + 0.4;
    g.beginPath();
    g.ellipse(t.x, t.y, r, r * squash, 0, 0, Math.PI * 2);
    g.stroke();
  }
}
function jagged(r: () => number, x: number, y: number, a: number, len: number, steps: number, wobble: number) {
  const pts: number[] = [x, y];
  let px = x, py = y;
  for (let i = 1; i <= steps; i++) {
    a += (r() - 0.5) * wobble;
    px += (Math.cos(a) * len) / steps;
    py += (Math.sin(a) * len) / steps;
    pts.push(px, py);
  }
  return pts;
}
function strokePts(g: CanvasRenderingContext2D, pts: number[], upto = 1) {
  const n = Math.max(2, Math.floor((pts.length / 2) * upto));
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
  g.stroke();
}

/* ======================================================================================================================================= */
/* felts: lamp pools; Lv.3 dents the nap and disturbs the light                                                                             */
/* ======================================================================================================================================= */
type FeltStyle = "pendant" | "candle" | "bar" | "spots" | "blinds";
class Felt extends Base {
  private swing = 0.25;
  private kick = 0;
  private motes: number[][] = [];
  constructor(budget: number, private style: FeltStyle, private light: string, private dent: string) {
    super(budget);
  }
  protected build() {
    const r = rng(11);
    this.motes = Array.from({ length: Math.round(22 * this.budget) + 6 }, () => [r() * this.w, r() * this.h, r() * 6.28, 0.6 + r()]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    this.kick *= Math.exp(-dt * 1.4);
    const amp = this.swing + this.kick;
    let lx = w / 2, ly = h * 0.45;
    if (this.style === "pendant") {
      // a lamp on a cord: its light pool swings like a pendulum (strong hits make it swing harder)
      lx = w / 2 + Math.sin(t * 1.15) * w * 0.16 * amp * 2.2;
      ly = h * 0.42 + Math.cos(t * 2.3) * h * 0.02;
      soft(g, lx, ly, h * 0.6, this.light, 0.26, h * 0.75);
      soft(g, lx, ly, h * 0.25, "#ffffff", 0.08);
    } else if (this.style === "candle") {
      for (const [i, px] of [0.3, 0.72].entries()) {
        const f = 0.75 + 0.25 * Math.sin(t * 9 + i * 3) * Math.sin(t * 4.3 + i) + this.kick * Math.sin(t * 31 + i);
        soft(g, w * px, h * 0.38, h * (0.45 + 0.05 * f), this.light, 0.22 * f);
      }
    } else if (this.style === "bar") {
      // a long billiard bar light, breathing; a slow highlight runs along the cloth
      const breathe = 0.85 + 0.15 * Math.sin(t * 0.8);
      soft(g, w / 2, h * 0.45, h * 0.42, this.light, 0.22 * breathe, w * 0.55);
      const x = ((t * 0.08) % 1.4) * w - w * 0.2;
      soft(g, x, h * 0.45, h * 0.35, "#ffffff", 0.05, w * 0.12);
    } else if (this.style === "spots") {
      const cols = [this.light, "#ff9be0", "#9bd2ff"];
      for (let i = 0; i < 3; i++) {
        const x = w * (0.5 + 0.38 * Math.sin(t * (0.21 + i * 0.07) + i * 2.1) + this.kick * 0.1 * Math.sin(t * 7 + i));
        const y = h * (0.5 + 0.34 * Math.cos(t * (0.17 + i * 0.05) + i));
        soft(g, x, y, h * 0.38, cols[i], 0.2);
      }
    } else {
      // window blinds: slanted bars of sun drifting slowly; a passing cloud dims them
      const cloud = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.13));
      g.save();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = this.light;
      g.translate(w * 0.5, h * 0.5);
      g.rotate(-0.5);
      const off = ((t * 6) % 34) - 17;
      for (let i = -8; i <= 8; i++) {
        g.globalAlpha = 0.09 * cloud;
        g.fillRect(-w, i * 34 + off, w * 2, 15);
      }
      g.restore();
      lx = w * 0.4;
    }
    // dust motes drifting through the light (brighter inside the pool)
    g.fillStyle = "#ffffff";
    for (const m of this.motes) {
      m[0] += Math.cos(m[2] + t * 0.2) * 4 * dt + this.kick * Math.cos(m[2]) * 30 * dt;
      m[1] += Math.sin(m[2] + t * 0.15) * 3 * dt - 1.5 * dt;
      if (m[1] < -4) m[1] = this.h + 4;
      if (m[0] < -4) m[0] = this.w + 4;
      if (m[0] > this.w + 4) m[0] = -4;
      const inLight = Math.exp(-Math.pow((m[0] - lx) / (w * 0.35), 2));
      g.globalAlpha = (0.12 + 0.45 * inLight) * (0.6 + 0.4 * Math.sin(t * 2 + m[2]));
      g.fillRect(m[0], m[1], m[3] + 0.4, m[3] + 0.4);
    }
    // Lv.3 dents: a pressed mark in the nap that slowly recovers, with a lighter brushed rim
    this.each((d, age, k) => {
      if (d.k !== "dent") return;
      const rec = 1 - k;
      const r = (9 + 13 * d.s) * (1 + 0.15 * Math.min(1, age * 6));
      soft(g, d.x, d.y + 2, r, this.dent, 0.55 * rec * Math.min(1, d.s + 0.2), r * 1.15);
      g.strokeStyle = this.light;
      g.globalAlpha = 0.22 * rec * rec;
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(d.x, d.y + 2, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
      g.stroke();
    });
  }
  protected react(x: number, y: number, s: number, kind: HitKind) {
    this.add("dent", x, y, kind === "land" ? 2.4 : 1.2 + s, s);
    // the room answers: lamp swings, candles gutter, spots and motes are pushed
    this.kick = Math.min(1.2, this.kick + 0.12 * s);
    if (s > 0.6) for (const m of this.motes) if (Math.hypot(m[0] - x, m[1] - y) < 70) m[2] = Math.atan2(m[1] - y, m[0] - x);
  }
}

/* ======================================================================================================================================= */
/* water (navy moonlight, ocean shallows, deep sea)                                                                                         */
/* ======================================================================================================================================= */
class Navy extends Base {
  private glints: number[][] = [];
  protected build() {
    const r = rng(5);
    this.glints = Array.from({ length: Math.round(34 * this.budget) + 10 }, () => [r(), r(), r() * 6.28]);
  }
  ambient(g: CanvasRenderingContext2D, t: number) {
    const { w, h } = this;
    soft(g, w * 0.62, -h * 0.1, h * 0.5, "#cfe0ff", 0.12, w * 0.3);
    // moon glitter path: short horizontal glints sparkling on a column of water
    g.fillStyle = "#e6efff";
    const ripples = this.things.filter((x) => x.k === "ripple");
    for (const [u, v, p] of this.glints) {
      const y = v * h, spread = 0.12 + 0.5 * v;
      const x = w * 0.62 + (u - 0.5) * w * spread + Math.sin(t * 0.7 + p) * 6;
      let k = Math.pow(Math.max(0, Math.sin(t * 2.2 + p * 3)), 8);
      for (const r of ripples) {
        const age = (now() - r.t0) / 1000, d = Math.hypot(x - r.x, (y - r.y) / 0.78);
        k += Math.max(0, 1 - Math.abs(d - (4 + age * 70 * (0.6 + 0.5 * r.s))) / 10) * (1 - age / r.life);
      }
      if (k < 0.04) continue;
      g.globalAlpha = Math.min(0.85, 0.7 * k);
      g.fillRect(x - 3 - 3 * k, y, 6 + 6 * k, 1.2);
    }
    g.strokeStyle = "#a6c7ff";
    g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      g.globalAlpha = 0.05;
      g.beginPath();
      const y0 = h * (0.2 + i * 0.22);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x / 55 + t * 0.6 + i) * 4);
      g.stroke();
    }
    this.each((r, age) => drawRipple(g, r, age, "#bcd4ff", 1 + Math.round(r.s * 2), 70));
  }
  protected react(x: number, y: number, s: number) {
    this.add("ripple", x, y, 1.4 + s * 0.5, s);
  }
}

class Ocean extends Base {
  private drops: number[][] = [];
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    // caustic web: two drifting interference grids drawn as bright wavy lines
    g.save();
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = "#8de5f4";
    g.lineWidth = 1.2;
    const local = this.things.filter((x) => x.k === "splash");
    for (let i = 0; i < 7; i++) {
      g.globalAlpha = 0.07;
      g.beginPath();
      const y0 = ((i + 0.5) / 7) * h;
      for (let x = 0; x <= w; x += 10) {
        let y = y0 + Math.sin(x / 34 + t * 1.1 + i * 1.7) * 7 + Math.sin(x / 13 - t * 1.7 + i) * 2.5;
        for (const r of local) {
          const age = (now() - r.t0) / 1000, d = Math.hypot(x - r.x, y - r.y), front = age * 90;
          y += Math.sin((d - front) / 6) * 6 * r.s * Math.exp(-Math.abs(d - front) / 20) * (1 - age / r.life);
        }
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.globalAlpha = 0.05;
      g.beginPath();
      const x0 = ((i + 0.5) / 6) * w;
      for (let y = 0; y <= h; y += 10) g.lineTo(x0 + Math.sin(y / 30 - t * 0.9 + i * 2.3) * 9, y);
      g.stroke();
    }
    g.restore();
    // splashes: double ripple, foam ring and droplets falling back
    this.each((r, age) => {
      if (r.k !== "splash") return;
      drawRipple(g, r, age, "#c9f6ff", 2 + Math.round(r.s), 80);
      soft(g, r.x, r.y, 10 + 14 * r.s, "#ffffff", 0.25 * (1 - age / 0.4));
    });
    g.fillStyle = "#e6fbff";
    this.drops = this.drops.filter((d) => (d[4] += dt) < d[5]);
    for (const d of this.drops) {
      d[3] += 260 * dt;
      d[0] += d[2] * dt;
      d[1] += d[3] * dt;
      g.globalAlpha = 0.8 * (1 - d[4] / d[5]);
      g.fillRect(d[0], d[1], 1.6, 1.6);
    }
  }
  protected react(x: number, y: number, s: number) {
    this.add("splash", x, y, 1.1 + 0.4 * s, s);
    const n = Math.round(4 + 6 * s * this.budget);
    for (let i = 0; i < n; i++) {
      const a = this.r() * 6.28, v = 30 + 60 * s * this.r();
      this.drops.push([x, y, Math.cos(a) * v, -60 - 80 * s * this.r(), 0, 0.35 + 0.2 * this.r()]);
    }
  }
  busy() {
    return super.busy() || this.drops.length > 0;
  }
}

class DeepSea extends Base {
  private plankton: number[][] = [];
  private snow: number[][] = [];
  private bubbles: number[][] = [];
  protected build() {
    const r = rng(23);
    this.plankton = Array.from({ length: Math.round(70 * this.budget) + 20 }, () => [r() * this.w, r() * this.h, r() * 6.28, 0]);
    this.snow = Array.from({ length: Math.round(20 * this.budget) + 6 }, () => [r() * this.w, r() * this.h, 0.5 + r()]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    // god rays from the surface, slowly swaying
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const x = w * (0.12 + i * 0.26) + Math.sin(t * 0.25 + i * 1.3) * 24;
      g.globalAlpha = 0.05 + 0.035 * Math.sin(t * 0.6 + i * 2);
      g.fillStyle = "#74e7dc";
      g.beginPath();
      g.moveTo(x - 10, 0);
      g.lineTo(x + 12, 0);
      g.lineTo(x + 50, h);
      g.lineTo(x - 6, h);
      g.fill();
    }
    g.restore();
    // marine snow drifting down
    g.fillStyle = "#d8fff9";
    for (const s of this.snow) {
      s[1] += 6 * s[2] * dt;
      s[0] += Math.sin(t + s[2] * 9) * 3 * dt;
      if (s[1] > h + 2) (s[1] = -2), (s[0] = this.r() * w);
      g.globalAlpha = 0.25;
      g.fillRect(s[0], s[1], s[2], s[2]);
    }
    // plankton: dim, flash blue-green when disturbed by a hit (Lv.3), then fade out again
    for (const p of this.plankton) {
      p[3] = Math.max(0, p[3] - dt * 0.6);
      p[0] += Math.cos(p[2] + t * 0.3) * 2 * dt;
      p[1] += Math.sin(p[2] + t * 0.2) * 2 * dt;
      const glow = 0.08 + p[3];
      if (glow > 0.12) soft(g, p[0], p[1], 3 + 7 * p[3], "#5ff5e4", glow * 0.9);
      else {
        g.globalAlpha = glow;
        g.fillStyle = "#5ff5e4";
        g.fillRect(p[0], p[1], 1.2, 1.2);
      }
    }
    // bubble columns
    g.strokeStyle = "#bff3ff";
    g.lineWidth = 1;
    this.bubbles = this.bubbles.filter((b) => (b[1] -= b[2] * dt) > -8);
    for (const b of this.bubbles) {
      b[0] += Math.sin(t * 6 + b[3]) * 10 * dt;
      g.globalAlpha = 0.6;
      g.beginPath();
      g.arc(b[0], b[1], b[4], 0, 6.28);
      g.stroke();
    }
    if (this.r() < 0.02 * this.budget) this.bubbles.push([this.r() * w, h + 4, 20 + 10 * this.r(), this.r() * 6, 1 + this.r() * 1.5]);
    this.each((r, age) => r.k === "pulse" && drawRipple(g, r, age, "#5ff5e4", 1, 55, 1, 0.8));
  }
  protected react(x: number, y: number, s: number) {
    // bioluminescence: plankton within reach light up, nearer and harder = brighter
    const reach = 40 + 70 * s;
    for (const p of this.plankton) {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < reach) p[3] = Math.min(0.9, p[3] + (1 - d / reach) * 0.9 * s);
    }
    this.add("pulse", x, y, 1, s);
    const n = Math.round(3 + 5 * s * this.budget);
    for (let i = 0; i < n; i++) this.bubbles.push([x + (this.r() - 0.5) * 14, y, 30 + 30 * this.r(), this.r() * 6, 1 + this.r() * 2]);
  }
  busy() {
    return super.busy() || this.bubbles.length > 0 || this.plankton.some((p) => p[3] > 0.02);
  }
}

/* ======================================================================================================================================= */
/* wood, leather, marble, gold                                                                                                              */
/* ======================================================================================================================================= */
class Wood extends Base {
  private motes: number[][] = [];
  private embers: number[][] = [];
  private gutter = 0;
  constructor(budget: number, private walnut: boolean) {
    super(budget);
  }
  protected build() {
    const r = rng(31);
    this.motes = Array.from({ length: Math.round(22 * this.budget) + 6 }, () => [r(), r(), r() * 6.28, 0.5 + r()]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    this.gutter *= Math.exp(-dt * 2);
    if (this.walnut) {
      // a candle off the board: warm pool that flickers (gutters on hard hits) and rare embers
      const f = (0.82 + 0.18 * Math.sin(t * 8.3) * Math.sin(t * 3.1)) * (1 - 0.5 * this.gutter * (0.5 + 0.5 * Math.sin(t * 40)));
      soft(g, w * 0.78, h * 0.25, h * 0.75, "#ffb870", 0.24 * f, w * 0.5);
      if (this.r() < 0.03 * this.budget) this.embers.push([w * (0.6 + 0.35 * this.r()), h + 2, 0, 1.8 + this.r()]);
      this.embers = this.embers.filter((e) => (e[2] += dt) < e[3]);
      for (const e of this.embers) {
        e[1] -= 22 * dt;
        e[0] += Math.sin(t * 3 + e[3] * 7) * 8 * dt;
        soft(g, e[0], e[1], 3, "#ffb870", 0.7 * (1 - e[2] / e[3]));
      }
    } else {
      // a slanted sunbeam with dust motes floating inside it; the beam slowly wanders
      const bx = w * (0.38 + 0.08 * Math.sin(t * 0.09));
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.07;
      g.fillStyle = "#ffd9a0";
      g.beginPath();
      g.moveTo(bx - 40, 0);
      g.lineTo(bx + 30, 0);
      g.lineTo(bx + 130, h);
      g.lineTo(bx + 40, h);
      g.fill();
      g.restore();
      g.fillStyle = "#fff0d2";
      for (const m of this.motes) {
        m[0] += Math.cos(m[2] + t * 0.3) * 0.004 * dt * 60 * 0.1 + this.gutter * Math.cos(m[2]) * 0.01;
        m[1] += (Math.sin(m[2] + t * 0.25) * 0.0008 - 0.0004) * 60 * dt;
        if (m[1] < 0) m[1] = 1;
        if (m[0] < 0 || m[0] > 1) m[0] = this.r();
        const x = m[0] * w, y = m[1] * h;
        const beamX = bx - 5 + (y / h) * 85;
        const inBeam = Math.exp(-Math.pow((x - beamX) / 45, 2));
        g.globalAlpha = 0.08 + 0.6 * inBeam;
        g.fillRect(x, y, m[3], m[3]);
      }
    }
    // Lv.3: the knock travels through the grain — elliptical growth-ring waves along the wood
    this.each((d, age, k) => {
      g.strokeStyle = this.walnut ? "#ffcc8a" : "#ffe2b8";
      for (let i = 0; i < 3; i++) {
        const r = 6 + (age * 70 + i * 9) * (0.6 + 0.5 * d.s);
        g.globalAlpha = 0.3 * (1 - k) * (1 - i * 0.25) * Math.min(1, d.s + 0.2);
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(d.x, d.y, r * 1.7, r * 0.45, 0, 0, Math.PI * 2);
        g.stroke();
      }
      soft(g, d.x, d.y + 3, 10 + 8 * d.s, "#000000", 0.35 * (1 - k));
    });
  }
  protected react(x: number, y: number, s: number) {
    this.add("knock", x, y, 0.9 + 0.3 * s, s);
    this.gutter = Math.min(1, this.gutter + 0.25 * s);
  }
}

class Leather extends Base {
  constructor(budget: number, private tint: string) {
    super(budget);
  }
  ambient(g: CanvasRenderingContext2D, t: number) {
    const { w, h } = this;
    const y = h * (0.5 + 0.42 * Math.sin(t * 0.3));
    soft(g, w / 2, y, 34, this.tint, 0.1, w * 0.7);
    // a glint travelling along the stitched border
    const per = 2 * (w + h) - 32, p = ((t * 70) % per + per) % per;
    const pt = (q: number) => (q < w - 16 ? [8 + q, 8] : q < w + h - 32 ? [w - 8, 8 + q - (w - 16)] : q < 2 * w + h - 48 ? [w - 8 - (q - (w + h - 32)), h - 8] : [8, h - 8 - (q - (2 * w + h - 48))]);
    for (let i = 0; i < 6; i++) {
      const [x, yy] = pt((p - i * 6 + per) % per);
      soft(g, x, yy, 5 - i * 0.5, this.tint, 0.5 * (1 - i / 6));
    }
    this.each((d, age, k) => {
      // pressed leather: a dark dent, and the stitches near the hit light up
      soft(g, d.x, d.y + 2, 12 + 10 * d.s, "#000000", 0.5 * (1 - k), 16 + 12 * d.s);
      g.strokeStyle = this.tint;
      g.setLineDash([4, 4]);
      g.lineWidth = 1.2;
      const edges: [number, number, number, number][] = [[8, 8, w - 8, 8], [w - 8, 8, w - 8, h - 8], [w - 8, h - 8, 8, h - 8], [8, h - 8, 8, 8]];
      for (const [x0, y0, x1, y1] of edges) {
        const cx = clamp(d.x, Math.min(x0, x1), Math.max(x0, x1)), cy = clamp(d.y, Math.min(y0, y1), Math.max(y0, y1));
        const dist = Math.hypot(d.x - cx, d.y - cy);
        const a = (1 - k) * clamp(1 - dist / (80 + 60 * d.s), 0, 1);
        if (a < 0.05) continue;
        const reach = (age * 260 + 30) * d.s;
        g.globalAlpha = 0.8 * a;
        g.beginPath();
        if (y0 === y1) (g.moveTo(clamp(cx - reach, 8, w - 8), y0), g.lineTo(clamp(cx + reach, 8, w - 8), y0));
        else (g.moveTo(x0, clamp(cy - reach, 8, h - 8)), g.lineTo(x0, clamp(cy + reach, 8, h - 8)));
        g.stroke();
      }
      g.setLineDash([]);
    });
  }
  protected react(x: number, y: number, s: number) {
    this.add("press", x, y, 1 + 0.4 * s, s);
  }
}

/** Marble: a vein network; light glides along it (Lv.2) and floods out from a hit along the veins (Lv.3). */
class Marble extends Base {
  private veins: number[][] = [];
  private glow: number[] = [];
  protected build() {
    const r = rng(41);
    this.veins = [];
    for (let i = 0; i < 7; i++) this.veins.push(jagged(r, r() * this.w, r() * this.h, r() * 6.28, 90 + r() * (this.w * 0.6), 14, 0.9));
    this.glow = this.veins.map(() => 0);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineJoin = "round";
    this.veins.forEach((pts, i) => {
      this.glow[i] = Math.max(0, this.glow[i] - dt * 0.8);
      g.strokeStyle = "#e6defb";
      g.lineWidth = 1;
      g.globalAlpha = 0.06 + this.glow[i] * 0.5;
      strokePts(g, pts);
      // a bead of light gliding along each vein
      const n = pts.length / 2, p = ((t * 0.12 + i * 0.37) % 1) * (n - 1), j = Math.floor(p), f = p - j;
      const x = pts[j * 2] + (pts[j * 2 + 2] - pts[j * 2]) * f, y = pts[j * 2 + 1] + (pts[j * 2 + 3] - pts[j * 2 + 1]) * f;
      soft(g, x, y, 10, "#efe8ff", 0.25);
    });
    // Lv.3: from the hit, light runs outward along nearby veins
    this.each((d, age, k) => {
      this.veins.forEach((pts, i) => {
        let best = 1e9, bi = 0;
        for (let j = 0; j < pts.length / 2; j++) {
          const dd = Math.hypot(pts[j * 2] - d.x, pts[j * 2 + 1] - d.y);
          if (dd < best) (best = dd), (bi = j);
        }
        if (best > 60 + 50 * d.s) return;
        const reach = age * 9 * (0.6 + d.s);
        g.strokeStyle = "#ffffff";
        g.lineWidth = 1.6;
        g.globalAlpha = 0.7 * (1 - k) * (1 - best / (60 + 50 * d.s));
        g.beginPath();
        const a = Math.max(0, Math.floor(bi - reach)), b = Math.min(pts.length / 2 - 1, Math.ceil(bi + reach));
        g.moveTo(pts[a * 2], pts[a * 2 + 1]);
        for (let j = a + 1; j <= b; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]);
        g.stroke();
        this.glow[i] = Math.max(this.glow[i], 0.3 * (1 - k));
      });
      soft(g, d.x, d.y, 14 + 10 * d.s, "#e6defb", 0.3 * (1 - k));
    });
    g.restore();
  }
  protected react(x: number, y: number, s: number) {
    this.add("vein", x, y, 1.3, s);
  }
}

class Gold extends Base {
  ambient(g: CanvasRenderingContext2D, t: number) {
    const { w, h } = this;
    // a reflection band sweeps across; glints pop where it passes
    const p = (t % 6) / 6, x = -w * 0.3 + p * w * 1.6;
    g.save();
    g.globalCompositeOperation = "lighter";
    soft(g, x, h / 2, h * 0.8, "#ffe0a1", 0.12, 50);
    for (let i = 0; i < 12; i++) {
      const gx = ((i * 0.618) % 1) * w, gy = ((i * 0.377 + 0.1) % 1) * h;
      const k = Math.exp(-Math.pow((gx - x) / 40, 2)) + 0.4 * Math.pow(Math.max(0, Math.sin(t * 1.7 + i * 2.2)), 16);
      if (k > 0.05) star(g, gx, gy, 2 + 4 * k, "#fff4c2", 0.8 * k);
    }
    // Lv.3: the surface wobbles like liquid metal — bright and dark rings alternate outwards
    this.each((d, age, k) => {
      for (let i = 0; i < 3; i++) {
        const r = 5 + (age - i * 0.1) * 90 * (0.6 + 0.5 * d.s);
        if (r < 5) continue;
        g.strokeStyle = i % 2 ? "#7a5a10" : "#fff0b3";
        g.globalCompositeOperation = i % 2 ? "source-over" : "lighter";
        g.globalAlpha = 0.5 * (1 - k) * Math.min(1, d.s + 0.3);
        g.lineWidth = 2.2 - i * 0.5;
        g.beginPath();
        g.ellipse(d.x, d.y, r, r * 0.8, 0, 0, Math.PI * 2);
        g.stroke();
      }
      if (age < 0.25) star(g, d.x, d.y, 6 + 10 * d.s, "#ffffff", 1 - age * 4);
    });
    g.restore();
  }
  protected react(x: number, y: number, s: number) {
    this.add("gold", x, y, 0.9 + 0.3 * s, s);
  }
}
function star(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, a: number) {
  g.globalAlpha = clamp(a, 0, 1);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s);
  g.quadraticCurveTo(x, y, x - s, y);
  g.quadraticCurveTo(x, y, x, y - s);
  g.fill();
}

/* ======================================================================================================================================= */
/* desert, ice, christmas                                                                                                                   */
/* ======================================================================================================================================= */
class Desert extends Base {
  private grains: number[][] = [];
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    const craters = this.things.filter((x) => x.k === "crater");
    g.strokeStyle = "#ffcd78";
    g.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      g.globalAlpha = 0.1;
      g.beginPath();
      const y0 = ((i + 0.5) / 9) * h;
      for (let x = 0; x <= w; x += 10) {
        let y = y0 + Math.sin(x / 46 - t * 0.35 + i * 0.8) * 6;
        for (const c of craters) {
          const age = (now() - c.t0) / 1000, d = Math.hypot(x - c.x, y - c.y), R = 14 + 22 * c.s;
          if (d < R * 1.6) y += ((y - c.y) / (d + 1)) * (R * 1.6 - d) * 0.35 * Math.min(1, age * 6) * (1 - age / c.life);
        }
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // wind streaks of sand
    g.fillStyle = "#ffe2a8";
    for (let i = 0; i < 5; i++) {
      const x = ((t * (90 + i * 20) + i * 170) % (w + 120)) - 60, y = h * ((i * 0.23 + 0.1) % 1);
      g.globalAlpha = 0.12;
      g.fillRect(x, y, 40 + i * 6, 1);
    }
    // heat haze band
    soft(g, w / 2, h * 0.15 + Math.sin(t * 0.5) * 4, 20, "#fff0c2", 0.06, w * 0.6);
    this.each((c, age, k) => {
      if (c.k !== "crater") return;
      const R = (14 + 22 * c.s) * Math.min(1, age * 6);
      soft(g, c.x, c.y + 2, R, "#4a2e10", 0.35 * (1 - k), R * 1.2);
      g.strokeStyle = "#ffe0a8";
      g.globalAlpha = 0.45 * (1 - k);
      g.beginPath();
      g.ellipse(c.x, c.y, R * 1.15, R * 0.85, 0, 0, Math.PI * 2);
      g.stroke();
    });
    g.fillStyle = "#e8b86a";
    this.grains = this.grains.filter((p) => (p[4] += dt) < p[5]);
    for (const p of this.grains) {
      p[3] += 300 * dt;
      p[0] += p[2] * dt;
      p[1] += p[3] * dt;
      g.globalAlpha = 0.9 * (1 - p[4] / p[5]);
      g.fillRect(p[0], p[1], 1.5, 1.5);
    }
  }
  protected react(x: number, y: number, s: number) {
    this.add("crater", x, y, 2.4, s);
    const n = Math.round((6 + 14 * s) * this.budget);
    for (let i = 0; i < n; i++) {
      const a = this.r() * 6.28, v = 30 + 90 * s * this.r();
      this.grains.push([x, y, Math.cos(a) * v, -80 - 120 * s * this.r(), 0, 0.3 + 0.3 * this.r()]);
    }
  }
  busy() {
    return super.busy() || this.grains.length > 0;
  }
}

class Ice extends Base {
  private ferns: number[][][] = [];
  protected build() {
    const r = rng(53);
    // frost ferns rooted on the edges
    this.ferns = Array.from({ length: 8 }, (_, i) => {
      const side = i % 4, u = r();
      const [x, y, a] = side === 0 ? [u * this.w, 0, Math.PI / 2] : side === 1 ? [this.w, u * this.h, Math.PI] : side === 2 ? [u * this.w, this.h, -Math.PI / 2] : [0, u * this.h, 0];
      const trunk = jagged(r, x, y, a + (r() - 0.5) * 0.6, 40 + r() * 50, 6, 0.3);
      const branches: number[][] = [trunk];
      for (let j = 1; j < 6; j++) for (const sgn of [-1, 1]) branches.push(jagged(r, trunk[j * 2], trunk[j * 2 + 1], a + sgn * 0.9, 14 - j, 2, 0.2));
      return branches;
    });
  }
  ambient(g: CanvasRenderingContext2D, t: number) {
    const { w, h } = this;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = "#dafbff";
    g.lineWidth = 1;
    // ferns breathe: they creep in and recede
    this.ferns.forEach((f, i) => {
      const grow = 0.55 + 0.45 * Math.sin(t * 0.35 + i * 1.7);
      g.globalAlpha = 0.22;
      f.forEach((pts, j) => strokePts(g, pts, j === 0 ? grow : clamp((grow - j * 0.07) * 1.4, 0, 1)));
    });
    // cold mist sliding over the ice
    for (let i = 0; i < 3; i++) soft(g, ((t * 12 + i * w * 0.4) % (w + 160)) - 80, h * (0.3 + i * 0.25), 40, "#e6f9ff", 0.07, 90);
    this.each((d, age, k) => {
      if (d.k === "crack") {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 1;
        g.globalAlpha = 0.7 * (1 - k * k);
        for (const pts of d.data!) strokePts(g, pts, Math.min(1, age * 8));
      } else {
        const grow = Math.min(1, age / 0.7);
        g.strokeStyle = "#dff6ff";
        g.globalAlpha = 0.75 * (1 - k);
        for (const [x0, y0, x1, y1] of d.data!) {
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x0 + (x1 - x0) * grow, y0 + (y1 - y0) * grow);
          g.stroke();
        }
        soft(g, d.x, d.y, 30 * grow + 4, "#c8f0ff", 0.2 * (1 - k));
      }
    });
    g.restore();
  }
  protected react(x: number, y: number, s: number, kind: HitKind) {
    if (kind === "land") this.add("crystal", x, y, 3, s, dendrite(x, y, 26 + 22 * s));
    // only real hits crack the ice (soft bumps do not); at most 6 live crack stars
    if (kind === "impact" && s > 0.45) {
      const r = rng((x * 7 + y * 3) | 0);
      const n = 2 + Math.round(2 * s);
      if (this.things.filter((t) => t.k === "crack").length >= 6) this.things.splice(this.things.findIndex((t) => t.k === "crack"), 1);
      this.add("crack", x, y, 1.6 + s, s, Array.from({ length: n }, (_, i) => jagged(r, x, y, (i / n) * 6.28 + r(), 14 + 36 * s, 6, 0.8)));
    }
  }
}
function dendrite(x: number, y: number, reach: number) {
  const out: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    out.push([x, y, x + Math.cos(a) * reach, y + Math.sin(a) * reach]);
    for (let b = 1; b <= 3; b++) {
      const t = b / 4, bx = x + Math.cos(a) * reach * t, by = y + Math.sin(a) * reach * t, bl = reach * (0.32 - t * 0.06);
      for (const s of [-1, 1]) out.push([bx, by, bx + Math.cos(a + (s * Math.PI) / 3) * bl, by + Math.sin(a + (s * Math.PI) / 3) * bl]);
    }
  }
  return out;
}

class Christmas extends Base {
  private flakes: number[][] = [];
  private mounds: number[][] = [];
  private blink = 0;
  protected build() {
    const r = rng(61);
    this.flakes = Array.from({ length: Math.round(40 * this.budget) + 10 }, () => [r() * this.w, r() * this.h, 0.4 + r() * 0.8, r() * 6]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w } = this;
    this.blink = Math.max(0, this.blink - dt);
    // fairy lights along the top edge, chasing (a hard hit makes them all flash)
    const cols = ["#ffe6a0", "#e05a74", "#7fd3a0", "#9fc7ff"];
    for (let i = 0; i < 14; i++) {
      const x = ((i + 0.5) / 14) * w, y = 6 + Math.sin(i * 0.9) * 2;
      const on = this.blink > 0 ? 1 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.4 - i * 0.7));
      soft(g, x, y, 9, cols[i % 4], 0.9 * on);
    }
    // snow in two depths
    g.fillStyle = "#ffffff";
    for (const f of this.flakes) {
      f[1] += 14 * f[2] * dt;
      f[0] += Math.sin(t * 0.8 + f[3]) * 6 * f[2] * dt;
      if (f[1] > this.h + 3) (f[1] = -3), (f[0] = this.r() * w);
      g.globalAlpha = 0.35 + 0.4 * f[2];
      g.beginPath();
      g.arc(f[0], f[1], 0.8 + 1.4 * f[2], 0, 6.28);
      g.fill();
    }
    // Lv.3: snow thrown up, and a small heap left where a die lands (melts slowly)
    this.mounds = this.mounds.filter((m) => (m[3] += dt) < m[4]);
    for (const m of this.mounds) soft(g, m[0], m[1] + 6, m[2], "#ffffff", 0.45 * (1 - m[3] / m[4]), m[2] * 1.5);
    this.each((d, age, k) => {
      g.fillStyle = "#ffffff";
      for (const [vx, vy] of d.data!) {
        g.globalAlpha = 0.9 * (1 - k);
        g.beginPath();
        g.arc(d.x + vx * age, d.y + vy * age + 120 * age * age, 1.4, 0, 6.28);
        g.fill();
      }
    });
  }
  protected react(x: number, y: number, s: number, kind: HitKind) {
    const n = Math.round((5 + 10 * s) * this.budget);
    this.add("puff", x, y, 0.7, s, Array.from({ length: n }, () => [(this.r() - 0.5) * 120 * s, -30 - 80 * s * this.r()]));
    if (kind === "land") this.mounds.push([x, y, 8 + 4 * s, 0, 6]);
    if (s > 0.8) this.blink = 0.25;
  }
  busy() {
    return super.busy() || this.mounds.length > 0;
  }
}

/* ======================================================================================================================================= */
/* space, neon, aurora                                                                                                                      */
/* ======================================================================================================================================= */
class Space extends Base {
  private stars: number[][] = [];
  private meteor = { at: 4, x: 0, y: 0 };
  protected build() {
    const r = rng(71);
    this.stars = Array.from({ length: Math.round(80 * this.budget) + 30 }, () => [r() * this.w, r() * this.h, r() * 6.28, 0.4 + r() * 1.1]);
  }
  ambient(g: CanvasRenderingContext2D, t: number) {
    const { w, h } = this;
    // nebula drifting
    soft(g, w * (0.3 + 0.08 * Math.sin(t * 0.05)), h * 0.4, h * 0.55, "#7d5cff", 0.08, w * 0.35);
    soft(g, w * (0.75 + 0.06 * Math.cos(t * 0.04)), h * 0.65, h * 0.45, "#ff7ad9", 0.05, w * 0.25);
    // stars, lensed outward by gravity waves (Lv.3)
    const waves = this.things.filter((x) => x.k === "wave");
    g.fillStyle = "#ffffff";
    for (const s of this.stars) {
      let x = s[0], y = s[1];
      for (const wv of waves) {
        const age = (now() - wv.t0) / 1000, dx = x - wv.x, dy = y - wv.y, d = Math.hypot(dx, dy) + 0.01, front = age * 140;
        const push = 10 * wv.s * Math.exp(-Math.pow((d - front) / 14, 2)) * (1 - age / wv.life);
        x += (dx / d) * push;
        y += (dy / d) * push;
      }
      const tw = 0.4 + 0.6 * Math.max(0, Math.sin(t * (0.8 + s[3]) + s[2]));
      g.globalAlpha = 0.25 + 0.6 * tw * (s[3] / 1.5);
      g.fillRect(x, y, s[3], s[3]);
    }
    // a shooting star now and then
    if (t > this.meteor.at) {
      this.meteor = { at: t + 5 + this.r() * 6, x: this.r() * w, y: this.r() * h * 0.4 };
    }
    const m = 1 - (this.meteor.at - t) / 1.2;
    if (m > 0 && m < 1) {
      const x = this.meteor.x + m * 160, y = this.meteor.y + m * 60;
      g.strokeStyle = "#ffffff";
      g.globalAlpha = 0.7 * (1 - m);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 40, y - 15);
      g.stroke();
    }
    this.each((d, age) => d.k === "wave" && drawRipple(g, d, age, "#c6a3ff", 1, 140, 1.2, 1));
  }
  protected react(x: number, y: number, s: number) {
    this.add("wave", x, y, 1.2, s);
  }
}

class Neon extends Base {
  private traces: number[][] = [];
  private nodes: number[][] = [];
  protected build() {
    const r = rng(83), step = 22;
    this.traces = [];
    for (let i = 0; i < 9; i++) {
      let x = Math.round((r() * this.w) / step) * step, y = Math.round((r() * this.h) / step) * step;
      const pts = [x, y];
      for (let j = 0; j < 6; j++) {
        if (j % 2) x += (r() < 0.5 ? -1 : 1) * step * (1 + Math.floor(r() * 3));
        else y += (r() < 0.5 ? -1 : 1) * step * (1 + Math.floor(r() * 2));
        pts.push(x, y);
      }
      this.traces.push(pts);
    }
    this.nodes = this.traces.flatMap((p) => [[p[0], p[1], 0], [p[p.length - 2], p[p.length - 1], 0]]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineWidth = 1;
    this.traces.forEach((pts, i) => {
      g.strokeStyle = i % 2 ? "#57dcff" : "#ff70d4";
      g.globalAlpha = 0.12;
      strokePts(g, pts);
      // a pulse running along the trace
      const len = pts.length / 2 - 1, p = ((t * 0.35 + i * 0.29) % 1) * len, j = Math.floor(p), f = p - j;
      const x = pts[j * 2] + (pts[j * 2 + 2] - pts[j * 2]) * f, y = pts[j * 2 + 1] + (pts[j * 2 + 3] - pts[j * 2 + 1]) * f;
      soft(g, x, y, 7, i % 2 ? "#57dcff" : "#ff70d4", 0.8);
    });
    for (const n of this.nodes) {
      n[2] = Math.max(0, n[2] - dt * 1.5);
      soft(g, n[0], n[1], 4 + 8 * n[2], "#ffc4f0", 0.25 + 0.7 * n[2]);
    }
    // Lv.3: an electromagnetic square wave from the hit; nodes it passes flash
    this.each((d, age, k) => {
      for (let i = 0; i < 2; i++) {
        const r = 6 + (age - i * 0.12) * 150 * (0.6 + 0.5 * d.s);
        if (r < 6) continue;
        g.strokeStyle = i ? "#57dcff" : "#ff70d4";
        g.globalAlpha = 0.7 * (1 - k) * Math.min(1, d.s + 0.3);
        g.lineWidth = 1.5;
        g.strokeRect(d.x - r, d.y - r * 0.8, r * 2, r * 1.6);
        for (const n of this.nodes) if (Math.abs(Math.max(Math.abs(n[0] - d.x), Math.abs(n[1] - d.y) / 0.8) - r) < 6) n[2] = Math.max(n[2], d.s);
      }
    });
    g.restore();
  }
  protected react(x: number, y: number, s: number) {
    this.add("em", x, y, 0.9, s);
  }
}

class Aurora extends Base {
  ambient(g: CanvasRenderingContext2D, t: number) {
    const { w, h } = this;
    const bends = this.things;
    g.save();
    g.globalCompositeOperation = "lighter";
    // curtains made of vertical rays whose brightness travels sideways; hits bend them toward the hit
    for (let c = 0; c < 3; c++) {
      const hue = 150 + c * 45 + Math.sin(t * 0.1 + c) * 20;
      g.fillStyle = `hsl(${hue} 85% 62%)`;
      for (let x = 0; x < w; x += 7) {
        let bx = x;
        for (const b of bends) {
          const age = (now() - b.t0) / 1000, d = x - b.x;
          bx -= d * 0.25 * b.s * Math.exp(-Math.abs(d) / 60) * Math.sin(Math.min(1, age * 3) * Math.PI) * (1 - age / b.life);
        }
        const top = h * (0.08 + c * 0.1) + Math.sin(x / 60 + t * 0.5 + c) * 14;
        const k = 0.5 + 0.5 * Math.sin(x / 30 - t * (0.9 + c * 0.3) + c * 2);
        g.globalAlpha = 0.035 + 0.06 * k;
        g.fillRect(bx, top, 4, 40 + 26 * k);
      }
    }
    // Lv.3: a spectral ring (light split into colours) around the hit
    this.each((d, age, k) => {
      for (let i = 0; i < 4; i++) {
        const r = 6 + age * 80 * (0.6 + 0.5 * d.s) + i * 3;
        g.strokeStyle = `hsl(${120 + i * 50} 90% 65%)`;
        g.globalAlpha = 0.45 * (1 - k);
        g.lineWidth = 1.4;
        g.beginPath();
        g.ellipse(d.x, d.y, r, r * 0.8, 0, 0, Math.PI * 2);
        g.stroke();
      }
    });
    g.restore();
  }
  protected react(x: number, y: number, s: number) {
    this.add("bend", x, y, 1.4, s);
  }
}

/* ======================================================================================================================================= */
/* the nature & element collection: storm, meadow, flower field, sakura, forest, volcano                                                  */
/* ======================================================================================================================================= */
class Storm extends Base {
  private rain: number[][] = [];
  private flash = 0;
  private next = 3;
  protected build() {
    const r = rng(91);
    this.rain = Array.from({ length: Math.round(40 * this.budget) + 10 }, () => [r() * this.w, r() * this.h, 0.6 + r() * 0.6]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    // clouds rolling, sheet lightning now and then (double flash)
    if (t > this.next) {
      this.next = t + 4 + this.r() * 5;
      this.flash = 1;
    }
    const cyc = this.next - t;
    const second = cyc > 0 && this.flash < 0.05 && this.r() < 0.02 ? 0.6 : 0;
    this.flash = Math.max(second, this.flash - dt * 6);
    for (let i = 0; i < 4; i++) soft(g, ((t * 8 + i * w * 0.33) % (w + 200)) - 100, h * 0.08, 50, "#30364d", 0.5, 120);
    soft(g, w * 0.4, 0, h * 0.7, "#a9c6ff", 0.04 + 0.3 * this.flash, w * 0.6);
    g.strokeStyle = "#b9cdf5";
    g.lineWidth = 1;
    g.globalAlpha = 0.35;
    g.beginPath();
    for (const d of this.rain) {
      d[1] += 380 * d[2] * dt;
      d[0] -= 60 * d[2] * dt;
      if (d[1] > h) (d[1] = -10), (d[0] = this.r() * (w + 60));
      g.moveTo(d[0], d[1]);
      g.lineTo(d[0] + 3, d[1] - 10 * d[2]);
    }
    g.stroke();
    // Lv.3: discharge from the hit — branching bolts (count and reach follow the impact) and a scorch
    this.each((b, age, k) => {
      if (b.k === "scorch") return soft(g, b.x, b.y, 18 + 12 * b.s, "#a9c6ff", 0.35 * (1 - k));
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const [lw, color, a] of [[5, "#6f8fff", 0.25], [1.5, "#e6eeff", 0.95]] as const) {
        g.strokeStyle = color;
        g.lineWidth = lw;
        g.globalAlpha = a * (1 - k) * (0.7 + 0.3 * Math.sin(age * 120));
        strokePts(g, b.data![0], Math.min(1, age / 0.12));
      }
      g.restore();
    });
  }
  protected react(x: number, y: number, s: number) {
    const r = rng(((x * 13 + y * 7) | 0) + this.things.length);
    const n = 1 + Math.round(3 * s);
    for (let i = 0; i < n; i++) this.add("bolt", x, y, 0.45, s, [jagged(r, x, y, r() * 6.28, 30 + 90 * s * (0.6 + r() * 0.6), 7, 1.1)]);
    this.add("scorch", x, y, 1.4, s);
    if (s > 0.9) this.flash = Math.max(this.flash, 0.6);
  }
}

class Meadow extends Base {
  private blades: number[][] = [];
  private seeds: number[][] = [];
  protected build() {
    const r = rng(7);
    const n = Math.min(320, Math.round(((this.w * this.h) / 700) * (0.5 + 0.5 * this.budget)));
    this.blades = Array.from({ length: n }, () => [r() * this.w, 8 + r() * (this.h - 8), 8 + r() * 10, (r() - 0.5) * 0.4, r() < 0.3 ? 1 : 0]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w } = this;
    const pushes = this.things;
    g.lineCap = "round";
    g.lineWidth = 1.6;
    // grass over the whole board; a gust wave visibly travels across it every few seconds
    for (const pass of [0, 1]) {
      g.strokeStyle = pass ? "#cfe8a6" : "#8cc152";
      g.globalAlpha = 0.62;
      g.beginPath();
      for (const b of this.blades) {
        if (b[4] !== pass) continue;
        const gx = ((t * 70) % (w * 2.2)) - w * 0.6;
        let lean = b[3] + Math.sin(t * 1.4 + b[0] / 45) * 0.15 + 0.7 * Math.exp(-Math.pow((b[0] - gx) / 60, 2));
        for (const f of pushes) {
          const age = (now() - f.t0) / 1000, dx = b[0] - f.x, dy = b[1] - f.y, d = Math.hypot(dx, dy), R = 50 + 60 * f.s;
          // flattened outward, then springs back with a damped wobble
          if (d < R) lean += Math.sign(dx || 1) * (1 - d / R) * 1.4 * f.s * Math.exp(-age * 2.2) * Math.cos(age * 6);
        }
        lean = clamp(lean, -1.3, 1.3);
        g.moveTo(b[0], b[1]);
        g.quadraticCurveTo(b[0] + lean * b[2] * 0.4, b[1] - b[2] * 0.6, b[0] + lean * b[2], b[1] - b[2] * Math.cos(lean));
      }
      g.stroke();
    }
    // dandelion fluff
    g.fillStyle = "#ffffff";
    if (this.r() < 0.05 * this.budget) this.seeds.push([this.r() * w, this.h + 2, 0, 5]);
    this.seeds = this.seeds.filter((s) => (s[2] += dt) < s[3]);
    for (const s of this.seeds) {
      s[0] += (18 + Math.sin(t + s[3]) * 8) * dt;
      s[1] -= 10 * dt;
      g.globalAlpha = 0.6 * (1 - s[2] / s[3]);
      g.fillRect(s[0], s[1], 1.6, 1.6);
    }
    this.things = this.things.filter((f) => (now() - f.t0) / 1000 < f.life);
  }
  protected react(x: number, y: number, s: number) {
    this.add("push", x, y, 1.6, s);
    if (s > 0.5) for (let i = 0; i < 3; i++) this.seeds.push([x, y, 0, 2 + this.r() * 2]);
  }
  busy() {
    return this.things.length > 0;
  }
}

class Flowers extends Base {
  private heads: number[][] = [];
  protected build() {
    const r = rng(19);
    this.heads = Array.from({ length: Math.round(12 * this.budget) + 6 }, () => [r() * this.w, 10 + r() * (this.h - 10), (r() * 3) | 0, r() * 6, 0]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const palette = [["#ff8fb0", "#ffd0e0"], ["#ffd36b", "#fff2b8"], ["#c9a0ff", "#ecdcff"]];
    for (const f of this.heads) {
      f[4] = Math.max(0, f[4] - dt * 1.2);
      const sway = Math.sin(t * 1.3 + f[3]) * 2.5 + f[4] * Math.sin(t * 22 + f[3]) * 4;
      g.strokeStyle = "#6faa52";
      g.globalAlpha = 0.5;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(f[0], f[1] + 14);
      g.quadraticCurveTo(f[0], f[1] + 6, f[0] + sway, f[1]);
      g.stroke();
      flower(g, f[0] + sway, f[1], 7, palette[f[2]], 0.75, t * 0.2 + f[3]);
      // pollen drifting off the flowers (more when shaken)
      if (this.r() < (0.004 + f[4] * 0.2) * this.budget) this.add("pollen", f[0] + sway, f[1], 2.5, 0.5);
    }
    this.each((d, age, k) => {
      if (d.k === "pollen") {
        soft(g, d.x + age * 12 + Math.sin(age * 3 + d.seed) * 5, d.y - age * 10, 2.5, "#fff3a0", 0.7 * (1 - k));
        return;
      }
      // Lv.3: a big bloom opens where a die stops (overshoot), stays, then closes
      const open = Math.min(1, age / 0.5), ease = 1 - Math.pow(1 - open, 3) * (1 - 2.2 * open * (1 - open));
      const close = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      flower(g, d.x, d.y, (10 + 6 * d.s) * ease * close, palette[d.seed % 3], 0.85 * close, age * 0.15 + d.seed);
    });
  }
  protected react(x: number, y: number, s: number, kind: HitKind) {
    if (kind === "land") this.add("bloom", x, y, 4, s);
    for (const f of this.heads) if (Math.hypot(f[0] - x, f[1] - y) < 50 + 50 * s) f[4] = Math.min(1, f[4] + s);
  }
  busy() {
    return super.busy() || this.heads.some((f) => f[4] > 0.02);
  }
}
function flower(g: CanvasRenderingContext2D, x: number, y: number, s: number, colors: string[], alpha: number, rot: number) {
  if (s < 0.5) return;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.globalAlpha = alpha;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.fillStyle = colors[i % 2];
    g.beginPath();
    g.ellipse(0, -s * 0.62, s * 0.36, s * 0.62, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#ffcf3f";
  g.beginPath();
  g.arc(0, 0, s * 0.28, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Sakura: petals fall (Lv.2) and stay on the floor; a hit blows the settled petals outward (Lv.3). */
class Sakura extends Base {
  private falling: number[][] = [];
  private floor: number[][] = [];
  protected build() {
    // the board already has some petals lying on it when it appears
    const r = rng(43);
    this.floor = Array.from({ length: Math.round(26 * this.budget) + 8 }, () => [r() * this.w, r() * this.h, 0, 0, r() * 6, 1]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    // branch shadow swaying in the top corner
    g.strokeStyle = "#3a1d2a";
    g.lineWidth = 3;
    g.globalAlpha = 0.18;
    g.beginPath();
    const sw = Math.sin(t * 0.6) * 4;
    g.moveTo(w + 4, -4);
    g.quadraticCurveTo(w * 0.8, h * 0.12 + sw, w * 0.6 + sw, h * 0.1);
    g.stroke();
    if (this.r() < 0.1 * this.budget + 0.02) this.falling.push([this.r() * w, -6, this.r() * 6, 0.6 + this.r() * 0.6]);
    g.fillStyle = "#ffc4d6";
    this.falling = this.falling.filter((p) => {
      p[1] += 22 * p[3] * dt;
      p[0] += (Math.sin(t * 1.5 + p[2]) * 18 + 10) * dt;
      p[2] += dt * 2;
      petal(g, p[0], p[1], 3 * p[3], p[2], 0.85);
      if (p[1] > h * (0.25 + 0.7 * ((p[2] * 13) % 1)) && this.floor.length < 90) {
        this.floor.push([p[0], p[1], 0, 0, p[2], 0]);
        return false;
      }
      return p[1] < h + 6;
    });
    // petals resting on the floor; blown petals slide, spin and come to rest again
    for (const p of this.floor) {
      p[5] += dt;
      p[0] += p[2] * dt;
      p[1] += p[3] * dt;
      const keep = Math.exp(-dt * 3.2);
      p[2] *= keep;
      p[3] *= keep;
      p[4] += Math.hypot(p[2], p[3]) * 0.03 * dt;
      petal(g, p[0], p[1], 2.6, p[4], 0.7 * Math.min(1, p[5] * 3) * (this.floor.length > 70 ? 0.8 : 1));
    }
    this.floor = this.floor.filter((p) => p[0] > -10 && p[0] < w + 10 && p[1] > -10 && p[1] < h + 10 && p[5] < 40);
    this.each((d, age, k) => soft(g, d.x, d.y, 10 + 30 * age * d.s, "#ffe3ea", 0.25 * (1 - k)));
  }
  protected react(x: number, y: number, s: number) {
    for (const p of this.floor) {
      const dx = p[0] - x, dy = p[1] - y, d = Math.hypot(dx, dy) + 0.1, R = 50 + 70 * s;
      if (d > R) continue;
      const v = (1 - d / R) * 240 * s;
      p[2] += (dx / d) * v;
      p[3] += (dy / d) * v * 0.8;
    }
    // a few fresh petals knocked loose
    for (let i = 0; i < Math.round(2 + 3 * s); i++) this.floor.push([x, y, (this.r() - 0.5) * 160 * s, (this.r() - 0.5) * 120 * s, this.r() * 6, 0]);
    this.add("puff", x, y, 0.5, s);
  }
  busy() {
    return super.busy() || this.floor.some((p) => Math.abs(p[2]) + Math.abs(p[3]) > 2);
  }
}
function petal(g: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, a: number) {
  g.globalAlpha = a;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  g.ellipse(0, 0, s, s * 0.6, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

class Forest extends Base {
  private flies: number[][] = [];
  protected build() {
    const r = rng(29);
    this.flies = Array.from({ length: Math.round(12 * this.budget) + 5 }, () => [r() * this.w, r() * this.h, r() * 6.28, 0, 0]);
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    // dappled sunlight through moving leaves
    for (let i = 0; i < 9; i++) {
      const x = w * (((i * 0.37) % 1) + 0.05 * Math.sin(t * 0.35 + i * 1.9)), y = h * (((i * 0.61) % 1) + 0.05 * Math.cos(t * 0.3 + i));
      soft(g, x, y, 20 + 8 * Math.sin(t * 0.8 + i), "#d9f5a8", 0.14 + 0.07 * Math.sin(t * 1.1 + i * 2));
    }
    // fireflies wander and blink; a hit startles them away (they come back)
    for (const f of this.flies) {
      f[2] += (Math.sin(t * 0.7 + f[0] * 0.01) * 0.8) * dt;
      f[3] *= Math.exp(-dt * 1.5);
      f[4] *= Math.exp(-dt * 1.5);
      f[0] += (Math.cos(f[2]) * 12 + f[3]) * dt;
      f[1] += (Math.sin(f[2]) * 9 + f[4]) * dt;
      if (f[0] < 0 || f[0] > w) f[2] = Math.PI - f[2];
      if (f[1] < 0 || f[1] > h) f[2] = -f[2];
      f[0] = clamp(f[0], 0, w);
      f[1] = clamp(f[1], 0, h);
      const blink = Math.pow(Math.max(0, Math.sin(t * 1.6 + f[2] * 3)), 3);
      soft(g, f[0], f[1], 7 + 6 * blink, "#eaff9e", 0.3 + 0.7 * blink);
    }
    // Lv.3: a sprout grows where a die lands; a ring of light spreads through the undergrowth
    this.each((d, age, k) => {
      if (d.k === "light") return drawRipple(g, d, age, "#eaff9e", 1, 70, 1.2);
      const grow = Math.min(1, age / 0.7), hh = (10 + 8 * d.s) * grow, fade = Math.min(1, (1 - k) * 3);
      g.strokeStyle = "#7fbf5a";
      g.lineWidth = 1.8;
      g.globalAlpha = 0.9 * fade;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(d.x, d.y + 8);
      g.quadraticCurveTo(d.x - 2, d.y + 8 - hh * 0.5, d.x, d.y + 8 - hh);
      g.stroke();
      g.fillStyle = "#a9dd67";
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(d.x + s * 4 * grow, d.y + 8 - hh * 0.8, 4.5 * grow, 2.2 * grow, s * 0.6, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
  protected react(x: number, y: number, s: number, kind: HitKind) {
    if (kind === "land") this.add("sprout", x, y, 4, s);
    this.add("light", x, y, 1, s);
    for (const f of this.flies) {
      const dx = f[0] - x, dy = f[1] - y, d = Math.hypot(dx, dy) + 0.1;
      if (d < 90) (f[3] += (dx / d) * 120 * s), (f[4] += (dy / d) * 120 * s);
    }
  }
}

class Volcano extends Base {
  private veins: number[][] = [];
  private sparks: number[][] = [];
  protected build() {
    const r = rng(37);
    this.veins = Array.from({ length: 6 }, () => jagged(r, r() * this.w, r() * this.h, r() * 6.28, 80 + r() * 90, 10, 0.9));
  }
  ambient(g: CanvasRenderingContext2D, t: number, dt: number) {
    const { w, h } = this;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineJoin = "round";
    // lava flowing in the cracks: a moving dash pattern over a dim glow, breathing
    this.veins.forEach((pts, i) => {
      g.strokeStyle = "#ff6a1a";
      g.globalAlpha = 0.12 + 0.06 * Math.sin(t * 0.9 + i);
      g.lineWidth = 4;
      strokePts(g, pts);
      g.strokeStyle = "#ffb067";
      g.globalAlpha = 0.45;
      g.lineWidth = 1.4;
      g.setLineDash([6, 14]);
      g.lineDashOffset = -t * 18 - i * 7;
      strokePts(g, pts);
      g.setLineDash([]);
    });
    soft(g, w / 2, h * 1.05, h * 0.5, "#ff6a1a", 0.08 + 0.04 * Math.sin(t * 0.6), w * 0.6);
    if (this.r() < 0.06 * this.budget) this.sparks.push([this.r() * w, h + 2, (this.r() - 0.5) * 20, -30 - 20 * this.r(), 0, 2]);
    this.sparks = this.sparks.filter((p) => (p[4] += dt) < p[5]);
    for (const p of this.sparks) {
      p[3] += (p[5] < 1 ? 220 : -4) * dt;
      p[0] += p[2] * dt;
      p[1] += p[3] * dt;
      soft(g, p[0], p[1], 3, "#ffb067", 0.9 * (1 - p[4] / p[5]));
    }
    // Lv.3: crack networks that glow white-hot and cool to dark rock
    this.each((d, age, k) => {
      const heat = Math.max(0, 1 - k * 1.25);
      const color = heat > 0.75 ? "#ffe2a8" : heat > 0.4 ? "#ffb067" : heat > 0 ? "#ff6a1a" : "#3a1d14";
      const reveal = Math.min(1, age / 0.3);
      if (heat > 0) {
        g.strokeStyle = "#ff6a1a";
        g.lineWidth = 5 * heat + 1;
        g.globalAlpha = 0.25 * heat;
        for (const pts of d.data!) strokePts(g, pts, reveal);
      }
      g.globalCompositeOperation = heat > 0 ? "lighter" : "source-over";
      g.strokeStyle = color;
      g.lineWidth = 1.2 + heat * 1.6;
      g.globalAlpha = heat > 0 ? 0.9 : 0.5 * (1 - k) * 4;
      for (const pts of d.data!) strokePts(g, pts, reveal);
      g.globalCompositeOperation = "lighter";
    });
    g.restore();
  }
  protected react(x: number, y: number, s: number) {
    const r = rng((x * 3 + y * 11) | 0);
    // a weak bump only throws sparks; real hits crack the crust (at most 5 live crack networks)
    if (s > 0.4) {
      const n = 3 + Math.round(2 * s);
      if (this.things.length >= 5) this.things.shift();
      this.add("crack", x, y, 2.4, s, Array.from({ length: n }, (_, i) => jagged(r, x, y, (i / n) * 6.28 + r() * 0.5, 12 + 30 * s, 6, 0.7)));
    }
    for (let i = 0; i < Math.round((4 + 8 * s) * this.budget); i++) {
      const a = this.r() * 6.28, v = 40 + 80 * s * this.r();
      this.sparks.push([x, y, Math.cos(a) * v, -60 - 100 * s * this.r(), 0, 0.5 + 0.3 * this.r()]);
    }
  }
  busy() {
    return super.busy() || this.sparks.length > 8;
  }
}

/* ------------------------------------------------------------------ registry ------------------------------------------------------------------ */

const FACTORY: Record<string, (budget: number) => Scene> = {
  "board.felt": (b) => new Felt(b, "pendant", "#b7f0cf", "#06150d"),
  "board.felt_red": (b) => new Felt(b, "candle", "#ffc4b5", "#1a0606"),
  "board.felt_blue": (b) => new Felt(b, "bar", "#bcd2ff", "#060b1a"),
  "board.felt_purple": (b) => new Felt(b, "spots", "#e2c6ff", "#0f0617"),
  "board.felt_sand": (b) => new Felt(b, "blinds", "#ffe9c2", "#1f170b"),
  "board.navy": (b) => new Navy(b),
  "board.christmas": (b) => new Christmas(b),
  "board.wood_oak": (b) => new Wood(b, false),
  "board.wood_walnut": (b) => new Wood(b, true),
  "board.leather_brown": (b) => new Leather(b, "#f3d1a8"),
  "board.leather_black": (b) => new Leather(b, "#d8dde6"),
  "board.marble": (b) => new Marble(b),
  "board.ocean": (b) => new Ocean(b),
  "board.desert": (b) => new Desert(b),
  "board.ice": (b) => new Ice(b),
  "board.space": (b) => new Space(b),
  "board.neon": (b) => new Neon(b),
  "board.aurora": (b) => new Aurora(b),
  "board.gold_table": (b) => new Gold(b),
  "board.deep_sea": (b) => new DeepSea(b),
  "board.storm": (b) => new Storm(b),
  "board.meadow": (b) => new Meadow(b),
  "board.flower_field": (b) => new Flowers(b),
  "board.sakura": (b) => new Sakura(b),
  "board.forest": (b) => new Forest(b),
  "board.volcano": (b) => new Volcano(b),
};
export const SCENE_IDS = Object.keys(FACTORY);
export const createScene = (boardId: string, budget: number): Scene | null => FACTORY[boardId]?.(budget) ?? null;
/** Impact speed (dice-edges / s) → reaction strength. */
export const strengthOf = (impact?: number) => clamp((impact ?? 7) / 14, 0.25, 1.3);
