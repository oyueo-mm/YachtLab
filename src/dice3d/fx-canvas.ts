import type { Emitter, FxShape, Lines, Ring, Streak } from "./dice-fx";

/**
 * 2D effect layer drawn over a game surface (dice table, board, emote bubble). Pooled particles (no
 * allocation per frame once warm), shockwave rings, crack / lightning / ray lines and light streaks.
 * The canvas has `pointer-events: none` and never covers anything interactive. A budget (0..1) scales
 * particle counts; 0 draws nothing. Stops drawing when the tab is hidden.
 */
type P = {
  on: boolean; shape: FxShape; x: number; y: number; vx: number; vy: number; age: number; life: number;
  size: number; color: string; angle: number; spin: number; gravity: number; drag: number; glow: boolean;
  hue: boolean; grow: number; alpha: number;
};
type R = Ring & { x: number; y: number; age: number };
type L = Lines & { x: number; y: number; age: number; paths: number[][] };
type S = { pts: { x: number; y: number; t: number }[]; spec: Streak };

const MAX = 160;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class FxCanvas {
  readonly canvas = document.createElement("canvas");
  private g = this.canvas.getContext("2d");
  private pool: P[] = [];
  private rings: R[] = [];
  private lines: L[] = [];
  private streaks = new Map<number, S>();
  private last = 0;
  private w = 1;
  private h = 1;
  private ratio = 1;
  budget = 1;

  constructor(host: HTMLElement, className = "dice-trail-canvas") {
    this.canvas.className = className;
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);
  }

  layout(width: number, height: number) {
    this.w = width;
    this.h = height;
    this.ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(width * this.ratio));
    this.canvas.height = Math.max(1, Math.round(height * this.ratio));
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
  }

  private slot(): P | null {
    for (const p of this.pool) if (!p.on) return p;
    if (this.pool.length >= MAX) return null;
    const p = { on: false } as P;
    this.pool.push(p);
    return p;
  }

  /** Emit `spec` at (x, y) in CSS px. `scale` multiplies the count (e.g. 0.4 for a sliding die). */
  emit(spec: Emitter, x: number, y: number, scale = 1) {
    if (this.budget <= 0) return;
    const count = spec.n * scale * this.budget;
    // fractional counts emit with that probability
    let whole = Math.floor(count);
    if (Math.random() < count - whole) whole++;
    for (let i = 0; i < whole; i++) {
      const p = this.slot();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const s = rnd(spec.speed[0], spec.speed[1]);
      p.on = true;
      p.shape = spec.shape;
      p.x = x + rnd(-3, 3);
      p.y = y + rnd(-3, 3);
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.age = 0;
      p.life = rnd(spec.life[0], spec.life[1]);
      p.size = rnd(spec.size[0], spec.size[1]);
      p.color = spec.colors[Math.floor(Math.random() * spec.colors.length)];
      p.angle = Math.random() * Math.PI * 2;
      p.spin = (spec.spin ?? 0) * (Math.random() < 0.5 ? -1 : 1);
      p.gravity = spec.gravity ?? 0;
      p.drag = spec.drag ?? 0.15;
      p.glow = !!spec.glow;
      p.hue = !!spec.hue;
      p.grow = spec.grow ?? 1;
      p.alpha = spec.alpha ?? 0.9;
    }
  }

  ring(spec: Ring, x: number, y: number) {
    if (this.budget <= 0 || this.rings.length > 24) return;
    this.rings.push({ ...spec, x, y, age: -(spec.delay ?? 0) });
  }

  line(spec: Lines, x: number, y: number) {
    if (this.budget <= 0 || this.lines.length > 16) return;
    const paths: number[][] = [];
    const n = Math.max(1, Math.round(spec.n * Math.max(0.5, this.budget)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.4, 0.4);
      const len = spec.length * rnd(0.7, 1.2);
      const pts = [x, y];
      const segs = spec.kind === "ray" ? 1 : spec.kind === "arc" ? 5 : 4;
      let cx = x, cy = y;
      for (let k = 1; k <= segs; k++) {
        const t = k / segs;
        const jitter = spec.kind === "arc" ? 7 : spec.kind === "crack" ? 4 : 0;
        const tx = x + Math.cos(a) * len * t, ty = y + Math.sin(a) * len * t * 0.8;
        cx = tx + rnd(-jitter, jitter);
        cy = ty + rnd(-jitter, jitter);
        pts.push(cx, cy);
      }
      paths.push(pts);
    }
    this.lines.push({ ...spec, x, y, age: 0, paths });
  }

  /** Add a point to the light streak of die `id`. */
  streak(id: number, spec: Streak, x: number, y: number, now: number) {
    if (this.budget <= 0) return;
    let s = this.streaks.get(id);
    if (!s) this.streaks.set(id, (s = { pts: [], spec }));
    s.spec = spec;
    s.pts.push({ x, y, t: now });
    if (s.pts.length > 24) s.pts.shift();
  }

  get busy() {
    return this.pool.some((p) => p.on) || this.rings.length > 0 || this.lines.length > 0 || [...this.streaks.values()].some((s) => s.pts.length > 0);
  }

  /** Draw one frame; returns true while anything is still visible. */
  frame(now: number) {
    const g = this.g;
    if (!g) return false;
    if (typeof document !== "undefined" && document.hidden) {
      this.clear();
      return false;
    }
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    // streaks
    for (const s of this.streaks.values()) {
      const life = s.spec.life * 1000;
      while (s.pts.length && now - s.pts[0].t > life) s.pts.shift();
      if (s.pts.length < 2) continue;
      g.globalCompositeOperation = s.spec.glow ? "lighter" : "source-over";
      g.lineCap = "round";
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1], b = s.pts[i];
        const k = 1 - (now - b.t) / life;
        if (k <= 0) continue;
        g.globalAlpha = k * 0.8;
        g.lineWidth = s.spec.width * (0.35 + 0.65 * k);
        g.strokeStyle = s.spec.hue ? `hsl(${(now / 6 + i * 14) % 360} 90% 70%)` : s.spec.colors[i % s.spec.colors.length];
        if (s.spec.glow) {
          g.shadowColor = g.strokeStyle as string;
          g.shadowBlur = 8;
        }
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
      g.shadowBlur = 0;
    }
    // rings
    this.rings = this.rings.filter((r) => (r.age += dt) < r.life);
    for (const r of this.rings) {
      if (r.age < 0) continue;
      const t = r.age / r.life;
      const rad = 6 + r.radius * (1 - Math.pow(1 - t, 2.2));
      g.globalCompositeOperation = r.glow ? "lighter" : "source-over";
      g.globalAlpha = (1 - t) * 0.9;
      g.lineWidth = r.width * (1 - t * 0.6);
      g.strokeStyle = r.color;
      g.setLineDash(r.dashed ? [4, 5] : []);
      g.beginPath();
      if (r.square) g.rect(r.x - rad, r.y - rad * 0.8, rad * 2, rad * 1.6);
      else g.ellipse(r.x, r.y, rad, rad * 0.8, 0, 0, Math.PI * 2);
      if (r.fill) {
        g.fillStyle = r.fill;
        g.fill();
      }
      g.stroke();
    }
    g.setLineDash([]);
    // lines
    this.lines = this.lines.filter((l) => (l.age += dt) < l.life);
    for (const l of this.lines) {
      const t = l.age / l.life;
      g.globalCompositeOperation = l.glow ? "lighter" : "source-over";
      g.globalAlpha = l.kind === "arc" ? (Math.random() < 0.8 ? 1 - t : 0.2) : 1 - t * t;
      g.strokeStyle = l.color;
      g.lineWidth = l.width ?? 1.5;
      g.lineJoin = "round";
      if (l.glow) {
        g.shadowColor = l.color;
        g.shadowBlur = 6;
      }
      for (const pts of l.paths) {
        const grow = l.kind === "crack" ? Math.min(1, t * 4) : 1;
        const n = Math.max(2, Math.round((pts.length / 2) * grow));
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 1; i < n; i++) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
        g.stroke();
      }
      g.shadowBlur = 0;
    }
    // particles
    let alive = false;
    for (const p of this.pool) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.on = false;
        continue;
      }
      alive = true;
      const keep = Math.pow(1 - Math.min(0.95, p.drag), dt);
      p.vx *= keep;
      p.vy = p.vy * keep + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      const t = p.age / p.life;
      const s = p.size * (1 + (p.grow - 1) * t);
      g.globalCompositeOperation = p.glow ? "lighter" : "source-over";
      g.globalAlpha = p.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      const color = p.hue ? `hsl(${(now / 5 + p.x) % 360} 90% 72%)` : p.color;
      g.fillStyle = g.strokeStyle = color;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.shape === "spark" ? Math.atan2(p.vy, p.vx) : p.angle);
      shape(g, p.shape, s, p, t);
      g.restore();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return alive || this.rings.length > 0 || this.lines.length > 0 || [...this.streaks.values()].some((s) => s.pts.length > 1);
  }

  clear() {
    for (const p of this.pool) p.on = false;
    this.rings = [];
    this.lines = [];
    this.streaks.clear();
    this.last = 0;
    if (this.g) {
      this.g.setTransform(1, 0, 0, 1, 0, 0);
      this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  dispose() {
    this.clear();
    this.pool = [];
    this.canvas.remove();
  }
}

function shape(g: CanvasRenderingContext2D, kind: FxShape, s: number, p: { vx: number; vy: number }, t: number) {
  g.beginPath();
  switch (kind) {
    case "dot":
      g.arc(0, 0, s * 0.5, 0, Math.PI * 2);
      g.fill();
      return;
    case "glow": {
      const r = g.createRadialGradient(0, 0, 0, 0, 0, s);
      r.addColorStop(0, g.fillStyle as string);
      r.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = r;
      g.arc(0, 0, s, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case "spark": {
      const len = Math.min(16, Math.hypot(p.vx, p.vy) * 0.05 + s);
      g.lineWidth = 1.3;
      g.moveTo(0, 0);
      g.lineTo(-len, 0);
      g.stroke();
      return;
    }
    case "ember":
      g.arc(0, 0, s * 0.45, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha *= 0.35;
      g.beginPath();
      g.arc(0, 0, s, 0, Math.PI * 2);
      g.fill();
      return;
    case "flame":
      g.moveTo(0, -s * 1.3);
      g.quadraticCurveTo(s * 0.8, 0, 0, s * 0.6);
      g.quadraticCurveTo(-s * 0.8, 0, 0, -s * 1.3);
      g.fill();
      return;
    case "smoke":
    case "cloud":
      g.arc(0, 0, s, 0, Math.PI * 2);
      if (kind === "cloud") {
        g.arc(s * 0.8, s * 0.2, s * 0.7, 0, Math.PI * 2);
        g.arc(-s * 0.8, s * 0.25, s * 0.6, 0, Math.PI * 2);
      }
      g.fill();
      return;
    case "crystal":
    case "shard":
      g.moveTo(0, -s);
      g.lineTo(s * (kind === "shard" ? 0.45 : 0.6), 0);
      g.lineTo(0, s * (kind === "shard" ? 0.6 : 1));
      g.lineTo(-s * 0.6, 0);
      g.closePath();
      g.fill();
      return;
    case "prism":
      g.moveTo(0, -s);
      g.lineTo(s * 0.87, s * 0.5);
      g.lineTo(-s * 0.87, s * 0.5);
      g.closePath();
      g.fill();
      return;
    case "snow":
      g.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        g.moveTo(-Math.cos(a) * s, -Math.sin(a) * s);
        g.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      }
      g.stroke();
      return;
    case "star": {
      const k = 0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * 3));
      g.moveTo(0, -s * k * 1.4);
      g.quadraticCurveTo(0, 0, s * k * 1.4, 0);
      g.quadraticCurveTo(0, 0, 0, s * k * 1.4);
      g.quadraticCurveTo(0, 0, -s * k * 1.4, 0);
      g.quadraticCurveTo(0, 0, 0, -s * k * 1.4);
      g.fill();
      return;
    }
    case "petal":
      g.ellipse(0, 0, s * 0.5, s, 0, 0, Math.PI * 2);
      g.fill();
      return;
    case "leaf":
      g.moveTo(0, -s * 1.2);
      g.quadraticCurveTo(s * 0.9, 0, 0, s * 1.2);
      g.quadraticCurveTo(-s * 0.9, 0, 0, -s * 1.2);
      g.fill();
      return;
    case "heart":
      g.moveTo(0, s * 0.8);
      g.bezierCurveTo(-s * 1.3, -s * 0.2, -s * 0.5, -s * 1.1, 0, -s * 0.4);
      g.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.3, -s * 0.2, 0, s * 0.8);
      g.fill();
      return;
    case "bubble":
      g.lineWidth = 1;
      g.arc(0, 0, s, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha *= 0.6;
      g.beginPath();
      g.arc(-s * 0.35, -s * 0.35, s * 0.25, 0, Math.PI * 2);
      g.fill();
      return;
    case "flake":
      g.scale(Math.cos(t * 14), 1);
      g.fillRect(-s * 0.5, -s * 0.7, s, s * 1.4);
      return;
    case "chip":
      g.fillRect(-s * 0.6, -s * 0.35, s * 1.2, s * 0.7);
      return;
    case "flower":
      for (let i = 0; i < 5; i++) {
        g.save();
        g.rotate((i / 5) * Math.PI * 2);
        g.beginPath();
        g.ellipse(0, -s * 0.55, s * 0.32, s * 0.55, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.fillStyle = "#fff3b0";
      g.beginPath();
      g.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      g.fill();
      return;
    case "glitch":
      g.fillRect(-s * 0.7, -s * 0.18, s * 1.4, s * 0.36);
      g.fillRect(-s * 0.3, s * 0.3, s * 0.8, s * 0.16);
      return;
    case "drop":
      g.arc(0, 0, s * 0.55, 0, Math.PI * 2);
      g.fill();
      return;
    case "note":
      g.font = `${Math.round(s * 2.4)}px sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("♪", 0, 0);
      return;
  }
}
