import type { SynergyKind } from "../economy/live/collections";
import { FxCanvas } from "../dice3d/fx-canvas";
import { onFx, type FxEvent } from "../fx-bus";
import { playSfx } from "../sound";
import type { LandSound } from "../dice3d/dice-fx";

/**
 * Theme synergy (2026-11-27): a die and a board of the same collection equipped together. Drawn on its
 * own canvas inside the tray, under the dice (never over pips or buttons), from the same presentation
 * events as the boards (src/fx-bus.ts). Presentation only: dice values, physics, scores and the AI never
 * read anything here. Each theme has its own procedural behaviour, not one effect recoloured:
 *
 *  lightning  branching bolts that crawl from each hit across the board, then a fading scorch
 *  meadow     blades of grass that lean away from each hit and spring back
 *  bloom      a flower opens where each die stops, stays, then closes
 *  sakura     a petal gust on the throw; petals settle and stay around each die
 *  forest     a sprout grows at each landing while leaves drop from the canopy above
 *  abyss      bubble columns and a light ribbon that joins the resting dice
 *  lava       crack networks that glow white-hot and cool to dark rock
 *  frost      hexagonal frost dendrites that grow from each landing
 *  cosmos     star dust and a constellation linking the resting dice
 *  aurora     an aurora curtain that ripples across the board from each landing
 */
type Thing = { kind: string; x: number; y: number; t0: number; life: number; seed: number; data?: number[][] };
const SOUND: Record<SynergyKind, LandSound> = { lightning: "zap", meadow: "whoosh", bloom: "chime", sakura: "chime", forest: "thud", abyss: "glass", lava: "fire", frost: "ice", cosmos: "cosmic", aurora: "cosmic" };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class SynergyLayer {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private fx: FxCanvas;
  private things: Thing[] = [];
  private landed: { x: number; y: number; at: number }[] = [];
  private raf = 0;
  private w = 1;
  private h = 1;
  private ro: ResizeObserver;
  private off: () => void;
  private lastSound = 0;
  private visible = true;
  private io: IntersectionObserver | null = null;
  /** Grass blade anchors (meadow), fixed per layout. */
  private blades: { x: number; y: number; h: number; lean: number }[] = [];

  constructor(private tray: HTMLElement, private kind: SynergyKind, private power: number, budget: number, private sound: () => boolean) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "board-fx-canvas board-synergy-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.dataset.synergy = kind;
    this.g = this.canvas.getContext("2d");
    tray.prepend(this.canvas);
    this.fx = new FxCanvas(tray, "board-fx-canvas board-synergy-particles");
    tray.prepend(this.fx.canvas);
    this.fx.budget = budget;
    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(tray);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((en) => (this.visible = en.some((x) => x.isIntersecting)));
      this.io.observe(tray);
    }
    this.off = onFx((e) => this.on(e));
    this.raf = requestAnimationFrame(this.tick);
  }

  private layout() {
    const r = this.tray.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * ratio);
    this.canvas.height = Math.round(this.h * ratio);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.g?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.fx.layout(this.w, this.h);
    if (this.kind === "meadow") {
      const r2 = rng(7);
      const n = Math.round((this.w * this.h) / 900 * (0.5 + 0.5 * this.fx.budget));
      this.blades = Array.from({ length: Math.min(260, n) }, () => ({ x: r2() * this.w, y: 8 + r2() * (this.h - 8), h: 6 + r2() * 9, lean: (r2() - 0.5) * 0.4 }));
    }
  }

  private local(e: FxEvent) {
    const r = this.tray.getBoundingClientRect();
    if (e.x === undefined || e.y === undefined) return null;
    const x = e.x - r.left, y = e.y - r.top;
    return x >= -10 && y >= -10 && x <= this.w + 10 && y <= this.h + 10 ? { x, y } : null;
  }

  private add(kind: string, x: number, y: number, life: number, data?: number[][]) {
    if (this.things.length > 60) this.things.shift();
    this.things.push({ kind, x, y, t0: performance.now(), life, seed: (Math.random() * 1e9) | 0, data });
  }

  private on(e: FxEvent) {
    if (!this.visible || document.hidden || this.fx.budget <= 0) return;
    const p = this.local(e);
    const k = this.kind;
    const P = this.power;
    if (e.type === "roll") {
      this.landed = [];
      if (k === "sakura") for (let i = 0; i < 2; i++) this.fx.emit({ shape: "petal", colors: ["#ffc4d6", "#ffe3ea", "#ff9fba"], n: 8 * P, speed: [120, 220], life: [0.9, 1.4], size: [2.5, 4.5], spin: 6, drag: 0.6, gravity: 20 }, -10, this.h * (0.3 + i * 0.35));
      if (k === "meadow") this.add("gust", 0, this.h / 2, 1.2);
      return;
    }
    if (e.type === "straight" || e.type === "yacht" || e.type === "win") {
      // the theme answers the big moments too, across the whole board
      const n = e.type === "straight" ? 3 : 5;
      for (let i = 0; i < n; i++) this.burstAt(this.w * (0.15 + (0.7 * i) / Math.max(1, n - 1)), this.h * (0.35 + 0.3 * Math.sin(i * 2.1)), true);
      return;
    }
    if (!p || (e.type !== "impact" && e.type !== "land")) return;
    if (e.type === "impact") {
      // collisions: only the themes that react to motion
      if (k === "lightning" && (e.strength ?? 0.5) > 0.35) this.bolts(p.x, p.y, 2);
      if (k === "meadow") this.add("push", p.x, p.y, 1.4);
      return;
    }
    this.landed.push({ x: p.x, y: p.y, at: performance.now() });
    if (this.landed.length > 5) this.landed.shift();
    this.burstAt(p.x, p.y, false);
    if (this.sound()) {
      const now = performance.now();
      if (now - this.lastSound > 700) {
        this.lastSound = now;
        playSfx("boardFx", { land: SOUND[k], intensity: 0.45 });
      }
    }
  }

  private burstAt(x: number, y: number, big: boolean) {
    const P = this.power * (big ? 1.4 : 1);
    switch (this.kind) {
      case "lightning":
        this.bolts(x, y, big ? 5 : 3);
        this.add("scorch", x, y, 1.6);
        break;
      case "meadow":
        this.add("push", x, y, 1.6);
        this.fx.emit({ shape: "leaf", colors: ["#8cc152", "#b7e07c"], n: 3 * P, speed: [30, 70], spin: 6, gravity: 80, life: [0.5, 0.8], size: [2.5, 4] }, x, y);
        break;
      case "bloom":
        this.add("flower", x, y, big ? 3 : 4.5, [[(Math.random() * 3) | 0]]);
        break;
      case "sakura": {
        const r = rng((x * 31 + y * 17) | 0);
        const pts = Array.from({ length: Math.round(7 * P) }, () => [x + (r() - 0.5) * 46, y + (r() - 0.5) * 30, r() * Math.PI * 2, 2.5 + r() * 2.5]);
        this.add("petals", x, y, 6, pts);
        this.fx.emit({ shape: "petal", colors: ["#ffc4d6", "#ffffff"], n: 5 * P, speed: [30, 70], spin: 6, drag: 0.5, life: [0.7, 1], size: [2.5, 4] }, x, y);
        break;
      }
      case "forest":
        this.add("sprout", x, y, 4);
        this.fx.emit({ shape: "leaf", colors: ["#6fae6a", "#a9dd67", "#d0b15a"], n: 3 * P, speed: [6, 18], spin: 4, gravity: 40, life: [1.2, 1.8], size: [3, 4.5] }, x + (Math.random() - 0.5) * 30, 0);
        break;
      case "abyss":
        this.fx.emit({ shape: "bubble", colors: ["#bff3ff", "#9ffff4", "#ffffff"], n: 7 * P, speed: [10, 30], gravity: -110, life: [0.9, 1.4], size: [1.5, 4] }, x, y);
        this.add("ribbon", x, y, 2.6);
        break;
      case "lava":
        this.add("crack", x, y, big ? 3.5 : 3, this.crackPaths(x, y, big ? 9 : 6, big ? 80 : 46));
        this.fx.emit({ shape: "ember", colors: ["#ffd08a", "#ff9a3c"], n: 4 * P, speed: [40, 90], gravity: 160, glow: true, life: [0.4, 0.7], size: [1.5, 3] }, x, y);
        break;
      case "frost":
        this.add("frost", x, y, 3.4, this.dendrite(x, y, big ? 70 : 48));
        break;
      case "cosmos":
        this.fx.emit({ shape: "star", colors: ["#ffffff", "#c6a3ff", "#fddea6"], n: 6 * P, speed: [20, 60], glow: true, life: [0.7, 1.1], size: [2, 3.5] }, x, y);
        this.add("constellation", x, y, 3);
        break;
      case "aurora":
        this.add("curtain", x, y, 1.8);
        break;
    }
  }

  private bolts(x: number, y: number, n: number) {
    const r = rng(((x * 13 + y * 7) | 0) + this.things.length);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const len = 50 + r() * 90;
      const path: number[][] = [[x, y]];
      let px = x, py = y;
      const steps = 7;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        px = x + Math.cos(a) * len * t + (r() - 0.5) * 16;
        py = y + Math.sin(a) * len * t + (r() - 0.5) * 16;
        path.push([px, py]);
      }
      this.add("bolt", x, y, 0.55, path);
    }
  }

  private crackPaths(x: number, y: number, n: number, reach: number) {
    const r = rng((x * 3 + y * 11) | 0);
    const paths: number[][] = [];
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2 + r() * 0.5, px = x, py = y;
      const pts = [px, py];
      const len = reach * (0.5 + r() * 0.6);
      for (let d = 0; d < len; d += 7) {
        a += (r() - 0.5) * 0.7;
        px += Math.cos(a) * 7;
        py += Math.sin(a) * 7;
        pts.push(px, py);
      }
      paths.push(pts);
    }
    return paths;
  }

  private dendrite(x: number, y: number, reach: number) {
    const paths: number[][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ex = x + Math.cos(a) * reach, ey = y + Math.sin(a) * reach;
      paths.push([x, y, ex, ey]);
      for (let b = 1; b <= 3; b++) {
        const t = b / 4, bx = x + Math.cos(a) * reach * t, by = y + Math.sin(a) * reach * t, bl = reach * (0.32 - t * 0.06);
        for (const s of [-1, 1]) paths.push([bx, by, bx + Math.cos(a + s * Math.PI / 3) * bl, by + Math.sin(a + s * Math.PI / 3) * bl]);
      }
    }
    return paths;
  }

  private last = 0;
  private drawn = false;
  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.visible || document.hidden) return;
    this.fx.frame(now);
    // the theme layer itself redraws at ~30 fps, and not at all while there is nothing to draw
    if (now - this.last < 32) return;
    this.last = now;
    const g = this.g;
    if (!g) return;
    this.things = this.things.filter((t) => (now - t.t0) / 1000 < t.life);
    const idle = !this.things.length && this.kind !== "meadow" && !((this.kind === "abyss" || this.kind === "cosmos") && this.landed.some((p) => now - p.at < 3200));
    if (idle) {
      if (this.drawn) g.clearRect(0, 0, this.w, this.h);
      this.drawn = false;
      return;
    }
    this.drawn = true;
    g.clearRect(0, 0, this.w, this.h);
    if (this.kind === "meadow") this.drawMeadow(g, now);
    for (const t of this.things) this.draw(g, t, (now - t.t0) / 1000, now);
    if ((this.kind === "abyss" || this.kind === "cosmos") && this.landed.length > 1) this.drawLinks(g, now);
  };

  private draw(g: CanvasRenderingContext2D, t: Thing, age: number, now: number) {
    const k = age / t.life;
    const fade = Math.min(1, (1 - k) * 2.2);
    g.save();
    switch (t.kind) {
      case "bolt": {
        const pts = t.data!;
        const shown = Math.min(pts.length, 1 + Math.floor((age / 0.16) * (pts.length - 1)));
        g.globalCompositeOperation = "lighter";
        g.lineJoin = "miter";
        for (const [width, color, alpha] of [[5, "#6f8fff", 0.25], [1.6, "#e6eeff", 0.95]] as const) {
          g.strokeStyle = color;
          g.lineWidth = width;
          g.globalAlpha = alpha * fade * (0.7 + 0.3 * Math.sin(now / 18));
          g.beginPath();
          pts.slice(0, shown).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
        }
        break;
      }
      case "scorch": {
        const grad = g.createRadialGradient(t.x, t.y, 0, t.x, t.y, 26);
        grad.addColorStop(0, `rgba(169,198,255,${0.35 * fade})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(t.x - 26, t.y - 26, 52, 52);
        break;
      }
      case "flower": {
        const open = Math.min(1, age / 0.55);
        const ease = 1 - Math.pow(1 - open, 3) * (1 - 2.2 * open * (1 - open));
        const close = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
        const s = 12 * this.power * ease * close;
        const palette = [["#ff8fb0", "#ffd0e0"], ["#ffd36b", "#fff2b8"], ["#c9a0ff", "#ecdcff"]][t.data![0][0]];
        g.translate(t.x, t.y);
        g.rotate(age * 0.15 + t.seed);
        for (let i = 0; i < 6; i++) {
          g.rotate(Math.PI / 3);
          g.fillStyle = palette[i % 2];
          g.globalAlpha = 0.85 * close;
          g.beginPath();
          g.ellipse(0, -s * 0.62, s * 0.36, s * 0.62, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = "#ffcf3f";
        g.beginPath();
        g.arc(0, 0, s * 0.28, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "petals": {
        g.fillStyle = "#ffc4d6";
        for (const [x, y, rot, size] of t.data!) {
          const land = Math.min(1, age / 0.5);
          g.globalAlpha = 0.85 * fade * land;
          g.save();
          g.translate(x, y - (1 - land) * 20);
          g.rotate(rot + (1 - land) * 3);
          g.beginPath();
          g.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
        break;
      }
      case "sprout": {
        const grow = Math.min(1, age / 0.7);
        const h = 14 * this.power * grow;
        g.strokeStyle = "#7fbf5a";
        g.lineWidth = 1.8;
        g.globalAlpha = 0.9 * fade;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(t.x, t.y + 6);
        g.quadraticCurveTo(t.x - 2, t.y + 6 - h * 0.5, t.x, t.y + 6 - h);
        g.stroke();
        g.fillStyle = "#a9dd67";
        for (const s of [-1, 1]) {
          g.beginPath();
          g.ellipse(t.x + s * 4 * grow, t.y + 6 - h * 0.8, 4.5 * grow, 2.2 * grow, s * 0.6, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case "ribbon":
        break; // drawn by drawLinks
      case "crack": {
        // white-hot → orange → cooled rock (a wide faint stroke reads as glow; no canvas shadow blur)
        const heat = Math.max(0, 1 - k * 1.25);
        const color = heat > 0.66 ? "#fff0c8" : heat > 0.33 ? "#ffb067" : heat > 0 ? "#ff6a1a" : "#3a1d14";
        const reveal = Math.min(1, age / 0.35);
        const path = new Path2D();
        for (const pts of t.data!) {
          const n = Math.max(2, Math.floor((pts.length / 2) * reveal));
          for (let i = 0; i < n; i++) i ? path.lineTo(pts[i * 2], pts[i * 2 + 1]) : path.moveTo(pts[0], pts[1]);
        }
        if (heat > 0) {
          g.globalCompositeOperation = "lighter";
          g.strokeStyle = "#ff6a1a";
          g.lineWidth = 5 * heat + 1;
          g.globalAlpha = 0.25 * heat;
          g.stroke(path);
        }
        g.strokeStyle = color;
        g.lineWidth = 1.2 + heat * 1.6;
        g.globalAlpha = heat > 0 ? 0.9 : 0.5 * fade;
        g.stroke(path);
        break;
      }
      case "frost": {
        const grow = Math.min(1, age / 0.8);
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = "#dff6ff";
        g.lineWidth = 1;
        g.globalAlpha = 0.75 * fade;
        for (const [x0, y0, x1, y1] of t.data!) {
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x0 + (x1 - x0) * grow, y0 + (y1 - y0) * grow);
          g.stroke();
        }
        const grad = g.createRadialGradient(t.x, t.y, 0, t.x, t.y, 40 * grow + 1);
        grad.addColorStop(0, `rgba(200,240,255,${0.18 * fade})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(t.x - 44, t.y - 44, 88, 88);
        break;
      }
      case "constellation":
        break; // drawn by drawLinks
      case "curtain": {
        g.globalCompositeOperation = "lighter";
        const x = t.x + (k - 0.2) * this.w * 0.9 * (t.seed % 2 ? 1 : -1);
        for (let i = 0; i < 3; i++) {
          const hue = (150 + i * 45 + age * 60) % 360;
          const grad = g.createLinearGradient(0, 0, 0, this.h);
          grad.addColorStop(0, `hsla(${hue},90%,65%,${0.32 * fade})`);
          grad.addColorStop(1, "hsla(0,0%,0%,0)");
          g.fillStyle = grad;
          g.beginPath();
          const cx = x + i * 16;
          for (let y = 0; y <= this.h; y += 8) g.lineTo(cx + Math.sin(y / 22 + age * 6 + i) * 10, y);
          for (let y = this.h; y >= 0; y -= 8) g.lineTo(cx + 22 + Math.sin(y / 26 + age * 5 + i) * 10, y);
          g.fill();
        }
        break;
      }
      case "push":
      case "gust":
        break; // read by drawMeadow
    }
    g.restore();
  }

  /** Grass leans away from recent hits (and with the throw gust), then springs back. */
  private drawMeadow(g: CanvasRenderingContext2D, now: number) {
    const forces = this.things.filter((t) => t.kind === "push" || t.kind === "gust");
    g.save();
    g.lineCap = "round";
    g.strokeStyle = "#b7e07c";
    g.lineWidth = 1.3;
    g.globalAlpha = 0.55;
    g.beginPath();
    for (const b of this.blades) {
      let lean = b.lean + Math.sin(now / 900 + b.x / 60) * 0.12;
      for (const f of forces) {
        const age = (now - f.t0) / 1000;
        const decay = Math.exp(-age * 2.6) * Math.cos(age * 7) ;
        if (f.kind === "gust") lean += 0.9 * Math.exp(-Math.pow((b.x / this.w - age / f.life) * 4, 2)) * Math.exp(-age);
        else {
          const dx = b.x - f.x, dy = b.y - f.y, d = Math.hypot(dx, dy);
          if (d < 90) lean += Math.sign(dx || 1) * (1 - d / 90) * 1.3 * decay;
        }
      }
      g.moveTo(b.x, b.y);
      g.quadraticCurveTo(b.x + lean * b.h * 0.4, b.y - b.h * 0.6, b.x + lean * b.h, b.y - b.h * Math.cos(Math.min(1.2, Math.abs(lean))));
    }
    g.stroke();
    g.restore();
  }

  /** Abyss: a light ribbon through the resting dice. Cosmos: a constellation. */
  private drawLinks(g: CanvasRenderingContext2D, now: number) {
    const pts = this.landed.filter((p) => now - p.at < 3200);
    if (pts.length < 2) return;
    const fade = Math.min(1, (3200 - (now - pts[pts.length - 1].at)) / 1200);
    g.save();
    g.globalCompositeOperation = "lighter";
    if (this.kind === "abyss") {
      g.strokeStyle = "#5ff5e4";
      g.lineWidth = 2;
      g.globalAlpha = 0.45 * fade;
      g.beginPath();
      pts.forEach((p, i) => {
        const y = p.y + Math.sin(now / 300 + i) * 3;
        if (!i) g.moveTo(p.x, y);
        else {
          const q = pts[i - 1];
          g.quadraticCurveTo((p.x + q.x) / 2, (p.y + q.y) / 2 + Math.sin(now / 240 + i) * 14, p.x, y);
        }
      });
      g.stroke();
    } else {
      g.strokeStyle = "#d9c8ff";
      g.lineWidth = 0.9;
      g.setLineDash([3, 4]);
      g.globalAlpha = 0.6 * fade;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#ffffff";
      for (const p of pts) {
        g.globalAlpha = (0.7 + 0.3 * Math.sin(now / 200 + p.x)) * fade;
        g.beginPath();
        g.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.off();
    this.ro.disconnect();
    this.io?.disconnect();
    this.fx.dispose();
    this.canvas.remove();
  }
}
