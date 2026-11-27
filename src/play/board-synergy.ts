import type { SynergyKind } from "../economy/live/collections";
import { FxCanvas } from "../dice3d/fx-canvas";
import { onFx, type FxEvent } from "../fx-bus";
import { playSfx } from "../sound";
import { rectCache } from "./rect-cache";
import type { LandSound } from "../dice3d/dice-fx";
import { glowSprite, rng } from "./board-scene";

/**
 * Theme synergy (A1 rework, 2026-11-27): a die and a board of the same collection equipped together.
 *
 * Separated from the board's own effects on purpose:
 *  - the BOARD (Lv.2 / Lv.3, board-scene.ts) reacts *locally*: its environment, and the spot and
 *    strength of each hit;
 *  - the SYNERGY reacts to the *dice and the board together*: the path each die travels is written
 *    onto the board in the theme's material (a live wire, a molten track, a line of blossoms …),
 *    and when the dice come to rest they are joined to each other (chain lightning, a lava river,
 *    a constellation …). Large straight / yacht / win make every link flare.
 *
 * One canvas inside the tray, under the dice (never over pips or buttons). Presentation only: reads
 * the cosmetic event bus (`trail` / `land` / `roll` / big moments), never values, physics or the AI.
 */
type Pt = { x: number; y: number; t: number };
type Mark = { x: number; y: number; t: number; a: number; seed: number };
const SOUND: Record<SynergyKind, LandSound> = { lightning: "zap", meadow: "whoosh", bloom: "chime", sakura: "chime", forest: "thud", abyss: "glass", lava: "fire", frost: "ice", cosmos: "cosmic", aurora: "cosmic" };
/** How long the written path stays on the board (s) and how far apart its marks are (px). */
const PATH_LIFE: Record<SynergyKind, number> = { lightning: 0.7, meadow: 2.6, bloom: 3.2, sakura: 1.6, forest: 3.4, abyss: 2.2, lava: 3.6, frost: 3.6, cosmos: 1.4, aurora: 1.8 };
const MARK_STEP: Record<SynergyKind, number> = { lightning: 0, meadow: 9, bloom: 22, sakura: 16, forest: 20, abyss: 14, lava: 0, frost: 18, cosmos: 10, aurora: 0 };
const LINK_LIFE = 3.6;
const COLOR: Record<SynergyKind, string> = { lightning: "#a9c6ff", meadow: "#b7e07c", bloom: "#ff8fb0", sakura: "#ffc4d6", forest: "#8cc152", abyss: "#5ff5e4", lava: "#ff7a2a", frost: "#dff6ff", cosmos: "#d9c8ff", aurora: "#7dffcb" };

export class SynergyLayer {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private fx: FxCanvas;
  private paths = new Map<number, Pt[]>();
  private marks: Mark[] = [];
  private rest: { x: number; y: number; at: number; id: number }[] = [];
  private flare = 0;
  private raf = 0;
  private w = 1;
  private h = 1;
  private ratio = 1;
  private ro: ResizeObserver;
  private off: () => void;
  private lastSound = 0;
  private visible = true;
  private io: IntersectionObserver | null = null;
  private r = rng(5);
  private onVis = () => this.wake();
  private rect: ReturnType<typeof rectCache>;

  constructor(private tray: HTMLElement, private kind: SynergyKind, private power: number, budget: number, private sound: () => boolean) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "board-fx-canvas board-synergy-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.dataset.synergy = kind;
    this.g = this.canvas.getContext("2d");
    tray.prepend(this.canvas);
    this.rect = rectCache(tray);
    this.fx = new FxCanvas(null);
    this.fx.budget = budget;
    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(tray);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((en) => {
        this.visible = en.some((x) => x.isIntersecting);
        this.wake();
      });
      this.io.observe(tray);
    }
    document.addEventListener("visibilitychange", this.onVis);
    this.off = onFx((e) => this.on(e));
  }

  private layout() {
    this.rect?.reset();
    const r = this.tray.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.ratio = Math.min(1.25, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.ratio);
    this.canvas.height = Math.round(this.h * this.ratio);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.fx.layout(this.w, this.h);
  }

  private local(e: FxEvent) {
    const r = this.rect.get();
    if (e.x === undefined || e.y === undefined) return null;
    const x = e.x - r.left, y = e.y - r.top;
    return x >= -10 && y >= -10 && x <= this.w + 10 && y <= this.h + 10 ? { x, y } : null;
  }

  private on(e: FxEvent) {
    if (!this.visible || document.hidden || this.fx.budget <= 0) return;
    const now = performance.now();
    if (e.type === "roll") {
      this.holdUntil = now + 40; // the dice's first frames first (see BoardFxLayer ROLL_PRIORITY_MS)
      this.rest = [];
      this.paths.clear();
      if (this.kind === "sakura") this.fx.emit({ shape: "petal", colors: ["#ffc4d6", "#ffe3ea"], n: 6 * this.power, speed: [120, 200], life: [0.8, 1.2], size: [2.5, 4], spin: 6, drag: 0.6 }, -8, this.h * 0.6);
      return this.wake();
    }
    if (e.type === "straight" || e.type === "yacht" || e.type === "win") {
      this.flare = 1;
      for (const p of this.rest) this.restBurst(p.x, p.y, true);
      return this.wake();
    }
    const p = this.local(e);
    if (!p) return;
    const id = e.id ?? -1;
    if (e.type === "trail") {
      this.extend(id, p.x, p.y, now);
      return this.wake();
    }
    if (e.type !== "land") return;
    // 2.5D sends no path: write a short one from the player's edge to where the die stops.
    if (!this.paths.has(id)) for (let k = 0; k <= 6; k++) this.extend(id, p.x + (1 - k / 6) * 18 * Math.sin(id), this.h + 6 - (k / 6) * (this.h + 6 - p.y), now - (6 - k) * 30);
    this.rest = this.rest.filter((q) => q.id !== id || id < 0);
    this.rest.push({ x: p.x, y: p.y, at: now, id });
    if (this.rest.length > 5) this.rest.shift();
    this.restBurst(p.x, p.y, false);
    if (this.sound() && now - this.lastSound > 700) {
      this.lastSound = now;
      playSfx("boardFx", { land: SOUND[this.kind], intensity: 0.45 });
    }
    this.wake();
  }

  /** Add a point to a die's path and drop theme marks along the travelled distance. */
  private extend(id: number, x: number, y: number, t: number) {
    let path = this.paths.get(id);
    if (!path) this.paths.set(id, (path = []));
    const last = path[path.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 2) return;
    path.push({ x, y, t });
    if (path.length > 90) path.shift();
    const step = MARK_STEP[this.kind];
    if (!step || !last) return;
    const d = Math.hypot(x - last.x, y - last.y);
    const n = Math.floor((d + (this.carry.get(id) ?? 0)) / step);
    this.carry.set(id, (d + (this.carry.get(id) ?? 0)) % step);
    const a = Math.atan2(y - last.y, x - last.x);
    for (let i = 1; i <= Math.min(4, n); i++) {
      if (this.marks.length > 160) this.marks.shift();
      const f = i / Math.max(1, n);
      this.marks.push({ x: last.x + (x - last.x) * f, y: last.y + (y - last.y) * f, t, a, seed: (this.r() * 1e6) | 0 });
    }
    if (this.kind === "sakura") this.fx.emit({ shape: "petal", colors: ["#ffc4d6", "#ff9fba", "#ffffff"], n: 0.8 * this.power, speed: [20, 50], life: [0.6, 1], size: [2, 3.5], spin: 7, drag: 0.5 }, x, y);
    if (this.kind === "cosmos") this.fx.emit({ shape: "star", colors: ["#ffffff", "#c6a3ff"], n: 0.5 * this.power, speed: [5, 20], life: [0.5, 0.9], size: [1.5, 2.5], glow: true }, x, y);
    if (this.kind === "abyss") this.fx.emit({ shape: "bubble", colors: ["#bff3ff"], n: 0.35 * this.power, speed: [5, 15], gravity: -60, life: [0.8, 1.2], size: [1.2, 2.6] }, x, y);
  }
  private carry = new Map<number, number>();

  private restBurst(x: number, y: number, big: boolean) {
    const n = (big ? 10 : 4) * this.power;
    const spec = {
      lightning: { shape: "spark" as const, colors: ["#ffffff", "#a9c6ff"], speed: [80, 200] as [number, number], glow: true, life: [0.2, 0.4] as [number, number] },
      meadow: { shape: "leaf" as const, colors: ["#8cc152", "#b7e07c"], speed: [30, 70] as [number, number], life: [0.6, 1] as [number, number], spin: 6, gravity: 60 },
      bloom: { shape: "petal" as const, colors: ["#ff8fb0", "#ffd36b"], speed: [30, 80] as [number, number], life: [0.6, 1] as [number, number], spin: 5 },
      sakura: { shape: "petal" as const, colors: ["#ffc4d6", "#ffffff"], speed: [30, 80] as [number, number], life: [0.7, 1.1] as [number, number], spin: 6, drag: 0.5 },
      forest: { shape: "leaf" as const, colors: ["#6fae6a", "#d0b15a"], speed: [20, 60] as [number, number], life: [0.8, 1.2] as [number, number], spin: 4, gravity: 40 },
      abyss: { shape: "bubble" as const, colors: ["#bff3ff", "#ffffff"], speed: [10, 30] as [number, number], gravity: -90, life: [0.9, 1.3] as [number, number] },
      lava: { shape: "ember" as const, colors: ["#ffd08a", "#ff9a3c"], speed: [40, 100] as [number, number], gravity: 160, glow: true, life: [0.4, 0.7] as [number, number] },
      frost: { shape: "crystal" as const, colors: ["#dafbff", "#ffffff"], speed: [20, 60] as [number, number], glow: true, life: [0.5, 0.9] as [number, number] },
      cosmos: { shape: "star" as const, colors: ["#ffffff", "#c6a3ff", "#fddea6"], speed: [20, 60] as [number, number], glow: true, life: [0.7, 1.1] as [number, number] },
      aurora: { shape: "glow" as const, colors: ["#7dffcb", "#9d8cff"], speed: [20, 50] as [number, number], glow: true, hue: true, gravity: -30, life: [0.8, 1.2] as [number, number] },
    }[this.kind];
    this.fx.emit({ size: [2, 4], ...spec, n }, x, y);
  }

  private running() {
    return this.visible && !document.hidden && !this.disposed;
  }
  private wake() {
    if (!this.raf && this.running()) this.raf = requestAnimationFrame(this.tick);
  }
  private busy(now: number) {
    const life = PATH_LIFE[this.kind] * 1000;
    return this.fx.busy || this.flare > 0 || this.rest.some((p) => now - p.at < LINK_LIFE * 1000) || this.marks.some((m) => now - m.t < life) || [...this.paths.values()].some((p) => p.length && now - p[p.length - 1].t < life);
  }

  private last = 0;
  private holdUntil = 0;
  private tick = (now: number) => {
    this.raf = 0;
    if (!this.running()) return;
    if (now < this.holdUntil) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const g = this.g;
    if (!g) return;
    g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (!this.busy(now)) {
      // nothing to draw: the canvas stays cleared and the loop stops until the next event
      this.paths.clear();
      this.marks = [];
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.flare = Math.max(0, this.flare - dt * 0.6);
    const life = PATH_LIFE[this.kind] * 1000;
    this.marks = this.marks.filter((m) => now - m.t < life);
    g.save();
    for (const pts of this.paths.values()) {
      while (pts.length && now - pts[0].t > life) pts.shift();
      if (pts.length > 1) this.drawPath(g, pts, now, life);
    }
    for (const m of this.marks) this.drawMark(g, m, (now - m.t) / life, now);
    const rest = this.rest.filter((p) => now - p.at < LINK_LIFE * 1000).sort((a, b) => a.x - b.x);
    if (rest.length > 1) this.drawLinks(g, rest, now);
    g.restore();
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    this.fx.drawInto(g, now);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  };

  /** The path itself, written in the theme's material (newest part brightest). */
  private drawPath(g: CanvasRenderingContext2D, pts: Pt[], now: number, life: number) {
    const k = this.kind;
    g.lineCap = "round";
    g.lineJoin = "round";
    const seg = (fn: (a: Pt, b: Pt, f: number) => void) => {
      for (let i = 1; i < pts.length; i++) fn(pts[i - 1], pts[i], 1 - (now - pts[i].t) / life);
    };
    if (k === "lightning") {
      // a live wire: the path jitters every frame and flickers
      g.globalCompositeOperation = "lighter";
      for (const [lw, color, alpha] of [[4, "#6f8fff", 0.25], [1.4, "#e6eeff", 0.9]] as const) {
        g.strokeStyle = color;
        g.lineWidth = lw;
        g.beginPath();
        pts.forEach((p, i) => {
          const f = 1 - (now - p.t) / life;
          const jx = (Math.random() - 0.5) * 6 * f, jy = (Math.random() - 0.5) * 6 * f;
          if (i) g.lineTo(p.x + jx, p.y + jy);
          else g.moveTo(p.x, p.y);
        });
        g.globalAlpha = alpha * (0.6 + 0.4 * Math.random());
        g.stroke();
      }
      return;
    }
    // Segments are bucketed into 4 age bands and stroked once per band (was one stroke per segment).
    const banded = (style: (f: number) => void) => {
      const bands: (Path2D | null)[] = [null, null, null, null];
      for (let i = 1; i < pts.length; i++) {
        const f = 1 - (now - pts[i].t) / life;
        if (f <= 0) continue;
        const b = Math.min(3, Math.floor(f * 4));
        const path = (bands[b] ??= new Path2D());
        path.moveTo(pts[i - 1].x, pts[i - 1].y);
        path.lineTo(pts[i].x, pts[i].y);
      }
      bands.forEach((path, b) => {
        if (!path) return;
        style((b + 0.5) / 4);
        g.stroke(path);
      });
    };
    if (k === "lava") {
      // a molten track that cools from white-hot to dark rock behind the die
      banded((f) => {
        g.globalCompositeOperation = f > 0.35 ? "lighter" : "source-over";
        g.strokeStyle = f > 0.8 ? "#fff0c8" : f > 0.55 ? "#ffb067" : f > 0.35 ? "#ff6a1a" : "#3a1d14";
        g.lineWidth = 2 + 3 * f;
        g.globalAlpha = f > 0.35 ? 0.85 : 0.5 * (f / 0.35) + 0.1;
      });
      return;
    }
    if (k === "frost") {
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "#dff6ff";
      g.lineWidth = 2.2;
      banded((f) => (g.globalAlpha = 0.5 * f));
      return;
    }
    if (k === "aurora") {
      g.globalCompositeOperation = "lighter";
      banded((f) => {
        // hue by the band's age (the path keeps its colour gradient, in 4 steps)
        g.strokeStyle = `hsl(${(140 + ((now - (1 - f) * life) / 8) % 120) | 0} 90% 65%)`;
        g.lineWidth = 6 * f + 1;
        g.globalAlpha = 0.28 * f;
      });
      return;
    }
    if (k === "cosmos" || k === "abyss") {
      // comet tail / glowing wake
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = COLOR[k];
      banded((f) => {
        g.lineWidth = 3.5 * f + 0.5;
        g.globalAlpha = 0.5 * f * f;
      });
      return;
    }
    if (k === "forest") {
      // a vine growing along the path
      g.strokeStyle = "#5f9a36";
      g.lineWidth = 1.6;
      seg((a, b, f) => {
        g.globalAlpha = 0.75 * Math.min(1, f * 3);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.quadraticCurveTo((a.x + b.x) / 2 + Math.sin(b.t / 90) * 4, (a.y + b.y) / 2 + Math.cos(b.t / 90) * 4, b.x, b.y);
        g.stroke();
      });
      return;
    }
    if (k === "meadow") {
      // a wind lane: a pale band where the grass was combed by the die
      g.strokeStyle = "#e4f5b8";
      g.lineWidth = 9;
      banded((f) => (g.globalAlpha = 0.12 * f));
      return;
    }
    // bloom / sakura: a faint coloured wake under the marks
    g.strokeStyle = COLOR[k];
    g.lineWidth = 2;
    banded((f) => (g.globalAlpha = 0.25 * f));
  }

  private drawMark(g: CanvasRenderingContext2D, m: Mark, k: number, now: number) {
    const fade = Math.min(1, (1 - k) * 2.5);
    const grow = Math.min(1, (now - m.t) / 350);
    g.globalCompositeOperation = "source-over";
    switch (this.kind) {
      case "meadow": {
        // combed blades along the lane, leaning the way the die went
        g.strokeStyle = "#cfe8a6";
        g.lineWidth = 1.2;
        g.globalAlpha = 0.6 * fade;
        for (const s of [-1, 1]) {
          const ox = Math.cos(m.a + Math.PI / 2) * 5 * s, oy = Math.sin(m.a + Math.PI / 2) * 5 * s;
          g.beginPath();
          g.moveTo(m.x + ox, m.y + oy);
          g.lineTo(m.x + ox + Math.cos(m.a) * 8, m.y + oy + Math.sin(m.a) * 8);
          g.stroke();
        }
        break;
      }
      case "bloom":
      case "sakura": {
        const s = (this.kind === "bloom" ? 5 : 3.5) * grow * this.power;
        const colors = this.kind === "bloom" ? [["#ff8fb0", "#ffd0e0"], ["#ffd36b", "#fff2b8"], ["#c9a0ff", "#ecdcff"]][m.seed % 3] : ["#ffc4d6", "#ffe3ea"];
        g.save();
        g.translate(m.x, m.y);
        g.rotate(m.seed);
        g.globalAlpha = 0.85 * fade;
        for (let i = 0; i < 5; i++) {
          g.rotate((Math.PI * 2) / 5);
          g.fillStyle = colors[i % 2];
          g.beginPath();
          g.ellipse(0, -s * 0.6, s * 0.35, s * 0.6, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        break;
      }
      case "forest": {
        g.fillStyle = m.seed % 2 ? "#a9dd67" : "#6fae6a";
        g.globalAlpha = 0.85 * fade;
        g.save();
        g.translate(m.x, m.y);
        g.rotate(m.a + (m.seed % 2 ? 0.9 : -0.9));
        g.beginPath();
        g.ellipse(4 * grow, 0, 4 * grow, 1.8 * grow, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        break;
      }
      case "frost": {
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = "#ffffff";
        g.lineWidth = 1;
        g.globalAlpha = 0.7 * fade;
        for (let i = 0; i < 3; i++) {
          const a = m.a + Math.PI / 2 + (i * Math.PI) / 3;
          const r = 5 * grow;
          g.beginPath();
          g.moveTo(m.x - Math.cos(a) * r, m.y - Math.sin(a) * r);
          g.lineTo(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r);
          g.stroke();
        }
        break;
      }
      case "abyss":
      case "cosmos":
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.6 * fade;
        g.drawImage(glowSprite(COLOR[this.kind]), m.x - 4, m.y - 4, 8, 8);
        break;
    }
  }

  /** The resting dice joined to each other in the theme's way. */
  private drawLinks(g: CanvasRenderingContext2D, pts: { x: number; y: number; at: number }[], now: number) {
    const youngest = Math.max(...pts.map((p) => p.at));
    const fade = Math.min(1, (LINK_LIFE * 1000 - (now - youngest)) / 1200) * (1 + this.flare);
    const grow = Math.min(1, (now - youngest) / 450);
    const k = this.kind;
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const bx = a.x + (b.x - a.x) * grow, by = a.y + (b.y - a.y) * grow;
      const mx = (a.x + bx) / 2, my = (a.y + by) / 2;
      switch (k) {
        case "lightning": {
          // chain lightning hopping from die to die
          for (const [lw, color, al] of [[4, "#6f8fff", 0.3], [1.3, "#ffffff", 0.95]] as const) {
            g.strokeStyle = color;
            g.lineWidth = lw;
            g.globalAlpha = al * Math.min(1, fade) * (0.5 + 0.5 * Math.random());
            g.beginPath();
            g.moveTo(a.x, a.y);
            for (let s = 1; s <= 6; s++) {
              const t = s / 6;
              g.lineTo(a.x + (bx - a.x) * t + (s < 6 ? (Math.random() - 0.5) * 14 : 0), a.y + (by - a.y) * t + (s < 6 ? (Math.random() - 0.5) * 14 : 0));
            }
            g.stroke();
          }
          break;
        }
        case "lava":
          g.strokeStyle = "#ff6a1a";
          g.lineWidth = 5;
          g.globalAlpha = 0.25 * Math.min(1, fade);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.quadraticCurveTo(mx + Math.sin(now / 400 + i) * 8, my + 12, bx, by);
          g.stroke();
          g.strokeStyle = "#ffd08a";
          g.lineWidth = 1.6;
          g.setLineDash([5, 9]);
          g.lineDashOffset = -now / 40;
          g.globalAlpha = 0.8 * Math.min(1, fade);
          g.stroke();
          g.setLineDash([]);
          break;
        case "cosmos":
          g.strokeStyle = "#d9c8ff";
          g.lineWidth = 0.9;
          g.setLineDash([3, 4]);
          g.globalAlpha = 0.6 * Math.min(1, fade);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(bx, by);
          g.stroke();
          g.setLineDash([]);
          break;
        case "abyss":
        case "aurora":
          g.strokeStyle = k === "abyss" ? "#5ff5e4" : `hsl(${(150 + now / 30) % 360} 85% 65%)`;
          g.lineWidth = 2;
          g.globalAlpha = 0.45 * Math.min(1, fade);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.quadraticCurveTo(mx, my + (k === "aurora" ? -26 : Math.sin(now / 240 + i) * 14), bx, by);
          g.stroke();
          break;
        case "frost":
          g.strokeStyle = "#dff6ff";
          g.lineWidth = 1.2;
          g.globalAlpha = 0.65 * Math.min(1, fade);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(bx, by);
          g.stroke();
          for (let s = 1; s < 6; s++) {
            const t = s / 6, x = a.x + (bx - a.x) * t, y = a.y + (by - a.y) * t, n = Math.atan2(by - a.y, bx - a.x) + Math.PI / 2;
            g.beginPath();
            g.moveTo(x - Math.cos(n) * 4, y - Math.sin(n) * 4);
            g.lineTo(x + Math.cos(n) * 4, y + Math.sin(n) * 4);
            g.stroke();
          }
          break;
        default: {
          // meadow / bloom / sakura / forest: a garland or root between the dice
          g.globalCompositeOperation = "source-over";
          g.strokeStyle = k === "forest" ? "#6b4a2a" : k === "meadow" ? "#8cc152" : "#b56a7a";
          g.lineWidth = 1.4;
          g.globalAlpha = 0.6 * Math.min(1, fade);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.quadraticCurveTo(mx, my + 10, bx, by);
          g.stroke();
          g.fillStyle = k === "forest" ? "#a9dd67" : k === "meadow" ? "#ffffff" : COLOR[k];
          for (let s = 1; s < 5; s++) {
            const t = s / 5, x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * bx, y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * (my + 10) + t * t * by;
            g.beginPath();
            g.arc(x, y, 2.2, 0, Math.PI * 2);
            g.fill();
          }
          g.globalCompositeOperation = "lighter";
        }
      }
    }
  }

  private disposed = false;
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.off();
    document.removeEventListener("visibilitychange", this.onVis);
    this.ro.disconnect();
    this.rect.dispose();
    this.io?.disconnect();
    this.fx.dispose();
    this.canvas.remove();
  }
}
