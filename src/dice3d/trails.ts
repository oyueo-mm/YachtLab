import type { DiceTrail } from "./dice-look";

const colors: Record<DiceTrail, string[]> = {
  lava: ["#ffcf45", "#ff6a29", "#dc3725"], ice: ["#f7ffff", "#b2e8ff", "#81cced"],
  electric: ["#ebfffd", "#90f7ff", "#b99eff"], stars: ["#f5f0ff", "#c6a9ff", "#fddea6"],
  gold: ["#fff2a7", "#ffcf43", "#c09226"], ghost: ["#ced9fa", "#adb5dd", "#f3f5ff"],
  crystal: ["#d8f1ff", "#f2d3ff", "#8de8ed"], leaves: ["#a9dd67", "#74b866", "#def3b1"],
  rainbow: ["#ff776b", "#ffd271", "#6ce3b9", "#a5bfff", "#f29edb"],
};
type Point = { x: number; y: number };
type Particle = Point & { dx: number; dy: number; age: number; lifetime: number; size: number; color: string; angle: number; kind: DiceTrail };

export class DiceTrails {
  private canvas = document.createElement("canvas");
  private context = this.canvas.getContext("2d");
  private particles: Particle[] = [];
  private colorIndex = 0;
  private last = 0;

  constructor(host: HTMLElement) {
    this.canvas.className = "dice-trail-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);
  }

  layout(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  emit(kind: DiceTrail, { x, y }: Point, burst = false) {
    const count = burst ? 6 : 1;
    const palette = colors[kind];
    for (let p = 0; p < count && this.particles.length < 48; p++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (burst ? 34 : 12) + Math.random() * (burst ? 40 : 16);
      this.particles.push({ x, y, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, age: 0,
        lifetime: burst ? 0.38 : 0.25, size: 3 + Math.random() * (burst ? 5 : 3), color: palette[this.colorIndex++ % palette.length], angle, kind });
    }
  }

  frame(now: number) {
    const ctx = this.context;
    if (!ctx) return false;
    if (document.hidden) { this.clear(); return false; }
    const elapsed = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles = this.particles.filter((p) => (p.age += elapsed) < p.lifetime);
    for (const p of this.particles) {
      const t = p.age / p.lifetime;
      ctx.save();
      ctx.translate(p.x + p.dx * p.age, p.y + p.dy * p.age);
      ctx.rotate(p.angle + t * 0.6);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.lineWidth = 1.4;
      ctx.fillStyle = ctx.strokeStyle = p.color;
      const s = p.size;
      ctx.beginPath();
      switch (p.kind) {
        case "lava":
          ctx.ellipse(0, -t * 10, s * 0.5, s * (1.3 - t), 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "ice":
        case "stars": {
          const axes = p.kind === "ice" ? 3 : 2;
          for (let i = 0; i < axes; i++) {
            const angle = i * Math.PI / axes;
            ctx.moveTo(-Math.cos(angle) * s, -Math.sin(angle) * s);
            ctx.lineTo(Math.cos(angle) * s, Math.sin(angle) * s);
          }
          ctx.stroke();
          break;
        }
        case "electric":
          ctx.moveTo(-s, -s);
          ctx.lineTo(1, -1);
          ctx.lineTo(-1, 1);
          ctx.lineTo(s, s);
          ctx.stroke();
          break;
        case "gold":
          ctx.fillRect(-s * 0.45, -s * 0.65, s * 0.9, s * 1.3);
          break;
        case "ghost":
          ctx.globalAlpha *= 0.35;
          ctx.ellipse(0, 0, s * (1 + t), s * (0.7 + t), 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "leaves":
          ctx.ellipse(0, 0, s * 0.55, s * 1.3, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "rainbow":
          ctx.arc(0, 0, s + t * 4, 0, Math.PI);
          ctx.stroke();
          break;
        case "crystal":
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.66, 0);
          ctx.lineTo(0, s);
          ctx.lineTo(-s * 0.66, 0);
          ctx.fill();
      }
      ctx.restore();
    }
    return this.particles.length > 0;
  }

  clear() {
    this.particles = [];
    this.last = 0;
    this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose() {
    this.clear();
    this.canvas.remove();
  }
}
