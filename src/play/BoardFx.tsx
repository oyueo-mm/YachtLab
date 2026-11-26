import { useEffect, useRef } from "react";
import { FxCanvas } from "../dice3d/fx-canvas";
import { boardFx, type Ambient, type BoardFxProfile, type BoardReaction } from "../board-fx";
import { onFx, type FxEvent } from "../fx-bus";
import { fxBudget, useSettings } from "../settings";
import { playSfx } from "../sound";

/**
 * Living board layer (Lv.2 ambient, Lv.3 reactions). A canvas inside the tray surface, under the dice
 * canvas and the dice buttons, so it can never hide a pip. ~30 fps while visible, stopped when the
 * tab is hidden, the board is off screen, the effect budget is 0 or the board is Lv.1.
 */
export function BoardFx({ itemId, level, host, sound = true }: { itemId?: string | null; level: number; host: React.RefObject<HTMLElement | null>; sound?: boolean }) {
  const settings = useSettings();
  const profile = level >= 2 ? boardFx(itemId) : null;
  const budget = profile ? fxBudget(settings) : 0;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    const section = host.current;
    if (!profile || budget <= 0 || !section) return;
    let layer: BoardLayer | null = null;
    let tries = 0;
    // The tray element appears once the dice renderer has mounted (3D table or 2.5D row).
    const attach = () => {
      const tray = section.querySelector<HTMLElement>(".dice-tray-area, .dice-row");
      if (!tray) {
        if (tries++ < 40) timer = window.setTimeout(attach, 150);
        return;
      }
      layer = new BoardLayer(tray, profile, level, budget, () => soundRef.current);
    };
    let timer = window.setTimeout(attach, 0);
    return () => {
      window.clearTimeout(timer);
      layer?.dispose();
    };
  }, [itemId, level, budget, host, profile]);
  return null;
}

class BoardLayer {
  private fx: FxCanvas;
  private raf = 0;
  private last = 0;
  private start = performance.now();
  private visible = true;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private off: () => void;
  private w = 1;
  private h = 1;
  private spawnAcc = 0;
  private ambient: HTMLCanvasElement;
  private ag: CanvasRenderingContext2D | null;

  constructor(private tray: HTMLElement, private p: BoardFxProfile, private level: number, budget: number, private soundOn: () => boolean) {
    this.ambient = document.createElement("canvas");
    this.ambient.className = "board-fx-canvas board-fx-ambient";
    this.ambient.setAttribute("aria-hidden", "true");
    this.ag = this.ambient.getContext("2d");
    tray.prepend(this.ambient);
    this.fx = new FxCanvas(tray, "board-fx-canvas");
    tray.prepend(this.fx.canvas);
    this.fx.budget = budget;
    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(tray);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((en) => (this.visible = en.some((x) => x.isIntersecting)));
      this.io.observe(tray);
    }
    this.off = level >= 3 ? onFx((e) => this.react(e)) : () => {};
    this.raf = requestAnimationFrame(this.tick);
  }

  private layout() {
    const r = this.tray.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.fx.layout(this.w, this.h);
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    this.ambient.width = Math.round(this.w * ratio);
    this.ambient.height = Math.round(this.h * ratio);
    this.ambient.style.width = this.w + "px";
    this.ambient.style.height = this.h + "px";
    this.ag?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private local(e: FxEvent) {
    const r = this.tray.getBoundingClientRect();
    if (e.x === undefined || e.y === undefined) return { x: this.w / 2, y: this.h / 2 };
    return { x: e.x - r.left, y: e.y - r.top };
  }

  private play(reaction: BoardReaction | undefined, x: number, y: number) {
    if (!reaction) return;
    reaction.burst?.forEach((b) => this.fx.emit(b, x, y));
    reaction.ring?.forEach((r) => this.fx.ring(r, x, y));
    reaction.lines?.forEach((l) => this.fx.line(l, x, y));
    if (reaction.sound && this.soundOn()) playSfx("boardFx", { land: reaction.sound, intensity: 0.6 });
  }

  private react(e: FxEvent) {
    if (!this.visible || document.hidden) return;
    const { x, y } = this.local(e);
    const inside = x >= -10 && y >= -10 && x <= this.w + 10 && y <= this.h + 10;
    switch (e.type) {
      case "roll": return this.play(this.p.react.roll, this.w / 2, this.h * 0.9);
      case "land":
      case "impact": {
        if (!inside) return;
        const r = this.p.react.land;
        // a quiet board: sound once per throw at most (impacts are silent)
        return this.play(e.type === "impact" || !r ? (r ? { ...r, sound: undefined } : undefined) : { ...r, sound: this.landSounded() ? undefined : r.sound }, x, y);
      }
      case "hold": return this.play(this.p.react.hold, this.w / 2, this.h - 8);
      case "release": return;
      case "straight":
      case "yacht": return this.play(this.p.react.grand, this.w / 2, this.h / 2);
      case "win": {
        const react = this.p.react.win;
        this.play(react, this.w / 2, this.h / 2);
        setTimeout(() => this.play({ ...react, sound: undefined }, this.w * 0.25, this.h * 0.4), 250);
        setTimeout(() => this.play({ ...react, sound: undefined }, this.w * 0.75, this.h * 0.4), 450);
      }
    }
  }
  private lastLandSound = 0;
  private landSounded() {
    const now = performance.now();
    if (now - this.lastLandSound < 600) return true;
    this.lastLandSound = now;
    return false;
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.visible || document.hidden) return;
    if (now - this.last < 32) return; // ~30 fps
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.03;
    this.last = now;
    const t = (now - this.start) / 1000;
    if (this.ag) drawAmbient(this.ag, this.p.ambient, this.p.ambientColor, this.w, this.h, t, this.fx.budget);
    const d = this.p.drift;
    if (d) {
      this.spawnAcc += d.perSecond * dt * this.fx.budget;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const x = Math.random() * this.w;
        const y = d.from === "top" ? -4 : d.from === "bottom" ? this.h + 4 : Math.random() * this.h;
        this.fx.emit({ ...d.spec, n: 1 }, x, y, 1 / Math.max(0.01, this.fx.budget));
      }
    }
    this.fx.frame(now);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.off();
    this.io?.disconnect();
    this.ro?.disconnect();
    this.fx.dispose();
    this.ambient.remove();
  }
}

function drawAmbient(g: CanvasRenderingContext2D, kind: Ambient, color: string, w: number, h: number, t: number, budget: number) {
  g.clearRect(0, 0, w, h);
  g.globalCompositeOperation = "lighter";
  const a = 0.6 + 0.4 * budget;
  switch (kind) {
    case "caustics": {
      for (let i = 0; i < 9; i++) {
        const x = w * (0.5 + 0.45 * Math.sin(t * 0.23 + i * 1.7));
        const y = h * (0.5 + 0.42 * Math.cos(t * 0.19 + i * 2.3));
        const r = 40 + 25 * Math.sin(t * 0.5 + i);
        blob(g, x, y, r, color, 0.1 * a);
      }
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.globalAlpha = 0.07 * a;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 12) g.lineTo(x, ((i + 0.5) / 6) * h + Math.sin(x / 40 + t * 0.9 + i) * 6);
        g.stroke();
      }
      break;
    }
    case "rays": {
      for (let i = 0; i < 4; i++) {
        const x = w * (0.15 + i * 0.24) + Math.sin(t * 0.3 + i) * 20;
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = (0.09 + 0.05 * Math.sin(t * 0.7 + i * 2)) * a;
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x - 14, 0);
        g.lineTo(x + 14, 0);
        g.lineTo(x + 60, h);
        g.lineTo(x - 10, h);
        g.fill();
      }
      break;
    }
    case "grid": {
      const step = 22;
      g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const horizontal = i % 2 === 0;
        const lanes = Math.floor((horizontal ? h : w) / step);
        const lane = ((Math.floor(t / 2.2 + i * 7.3) * 7 + i * 3) % Math.max(1, lanes)) * step;
        const pos = ((t * 120 + i * 200) % ((horizontal ? w : h) + 120)) - 60;
        g.strokeStyle = i % 2 ? "#57dcff" : color;
        g.globalAlpha = 0.5 * a;
        g.shadowColor = g.strokeStyle;
        g.shadowBlur = 6;
        g.beginPath();
        if (horizontal) {
          g.moveTo(pos - 50, lane);
          g.lineTo(pos, lane);
        } else {
          g.moveTo(lane, pos - 50);
          g.lineTo(lane, pos);
        }
        g.stroke();
      }
      g.shadowBlur = 0;
      break;
    }
    case "aurora": {
      for (let i = 0; i < 3; i++) {
        const hue = (150 + i * 50 + t * 8) % 360;
        g.globalAlpha = 0.11 * a;
        g.fillStyle = `hsl(${hue} 80% 60%)`;
        g.beginPath();
        const y0 = h * (0.15 + i * 0.12);
        g.moveTo(0, y0);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x / 70 + t * 0.6 + i) * 18 + Math.sin(x / 23 + t) * 4);
        for (let x = w; x >= 0; x -= 16) g.lineTo(x, y0 + 40 + Math.sin(x / 60 + t * 0.5 + i) * 20);
        g.fill();
      }
      break;
    }
    case "sweep": {
      const period = 7;
      const p = (t % period) / period;
      const x = -w * 0.3 + p * w * 1.6;
      const grad = g.createLinearGradient(x - 60, 0, x + 60, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.16 * a;
      g.fillStyle = grad;
      g.save();
      g.translate(x, h / 2);
      g.transform(1, 0, -0.5, 1, 0, 0);
      g.translate(-x, -h / 2);
      g.fillRect(x - 60, 0, 120, h);
      g.restore();
      break;
    }
    case "twinkle": {
      blob(g, w * (0.65 + 0.1 * Math.sin(t * 0.1)), h * 0.35, Math.max(w, h) * 0.45, color, (0.06 + 0.02 * Math.sin(t * 0.4)) * a);
      for (let i = 0; i < 14; i++) {
        const x = ((i * 97.3) % 1) * w || (i * 53) % w;
        const y = ((i * 61) % 100) / 100 * h;
        const k = Math.max(0, Math.sin(t * (1 + (i % 4) * 0.4) + i * 1.3));
        g.globalAlpha = 0.5 * k * a;
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.arc((i * 131) % w, y, 0.6 + k, 0, Math.PI * 2);
        g.fill();
        void x;
      }
      break;
    }
    case "lamp": {
      const flicker = 0.9 + 0.1 * Math.sin(t * 3.1) * Math.sin(t * 1.7);
      blob(g, w * (0.45 + 0.1 * Math.sin(t * 0.15)), h * 0.35, Math.max(w, h) * 0.5, color, 0.07 * flicker * a);
      break;
    }
    case "dunes": {
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      for (let i = 0; i < 7; i++) {
        g.globalAlpha = 0.08 * a;
        g.beginPath();
        const y0 = ((i + 0.5) / 7) * h;
        for (let x = 0; x <= w; x += 10) g.lineTo(x, y0 + Math.sin(x / 50 - t * 0.4 + i * 0.8) * 7);
        g.stroke();
      }
      break;
    }
    case "frost": {
      for (let i = 0; i < 18; i++) {
        const x = (i * 157) % Math.max(1, w), y = (i * 89) % Math.max(1, h);
        const k = Math.pow(Math.max(0, Math.sin(t * 0.8 + i * 2.1)), 6);
        if (k < 0.05) continue;
        g.globalAlpha = 0.7 * k * a;
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - 4 * k - 1, y);
        g.lineTo(x + 4 * k + 1, y);
        g.moveTo(x, y - 4 * k - 1);
        g.lineTo(x, y + 4 * k + 1);
        g.stroke();
      }
      break;
    }
    case "sheen": {
      const y = h * (0.5 + 0.45 * Math.sin(t * 0.25));
      const grad = g.createLinearGradient(0, y - 40, 0, y + 40);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.08 * a;
      g.fillStyle = grad;
      g.fillRect(0, y - 40, w, 80);
      break;
    }
    default:
      break;
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = alpha;
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
