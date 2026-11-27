import { useEffect, useRef } from "react";
import { FxCanvas } from "../dice3d/fx-canvas";
import { boardFx, type BoardFxProfile, type BoardReaction } from "../board-fx";
import { onFx, type FxEvent } from "../fx-bus";
import { fxBudget, useSettings } from "../settings";
import { playSfx } from "../sound";
import { rectCache } from "./rect-cache";
import { attachToTray } from "./tray-attach";
import { createScene, strengthOf, type Scene } from "./board-scene";
import { fxTierParams, onFxTier } from "../fx-quality";

/**
 * Living board layer (A1, 2026-11-27). ONE canvas inside the tray surface, under the dice canvas and
 * the dice buttons, so it can never hide a pip: the board's scene (src/play/board-scene.ts — Lv.2
 * environment, Lv.3 reactions at the real collision point and strength) plus the shared particles of
 * the big moments (BOARD_FX grand / win / hold) drawn into the same context.
 *
 * Cost control: ~30 fps while only the environment moves (25 fps on reduced budgets), full rate only
 * while a reaction runs; stopped (no rAF) when the tab is hidden or the board is off screen; canvas
 * resolution ≤ 1.25 × CSS px (soft, low-contrast art does not need device pixels); not mounted at all
 * for reduced motion (budget 0) or Lv.1.
 */
export default function BoardFxLayer({ itemId, level, host, sound = true }: { itemId?: string | null; level: number; host: React.RefObject<HTMLElement | null>; sound?: boolean }) {
  const settings = useSettings();
  const profile = level >= 2 ? boardFx(itemId) : null;
  const budget = profile ? fxBudget(settings) : 0;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    const section = host.current;
    if (!profile || !itemId || budget <= 0 || !section) return;
    section.dataset.boardFx = `lv${Math.min(3, level)}`;
    const detach = attachToTray(section, (tray) => new BoardLayer(tray, itemId, profile, level, budget, () => soundRef.current));
    return () => {
      detach();
      delete section.dataset.boardFx;
    };
  }, [itemId, level, budget, host, profile]);
  return null;
}

/** Two frames: the dice table draws the start of a throw before any decorative layer redraws. */
export const ROLL_PRIORITY_MS = 40;

/** Diagnostics for tests / the perf probe: frames drawn by board layers. */
const stats = { frames: 0, layers: 0 };
if (typeof window !== "undefined") (window as unknown as { __yachtlabBoardFx?: typeof stats }).__yachtlabBoardFx = stats;

export class BoardLayer {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private fx: FxCanvas;
  private scene: Scene | null;
  private raf = 0;
  private last = 0;
  private start = performance.now();
  private visible = true;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private off: () => void;
  private w = 1;
  private h = 1;
  private ratio = 1;
  private onVis = () => this.wake();
  private rect: ReturnType<typeof rectCache>;

  constructor(private tray: HTMLElement, itemId: string, private p: BoardFxProfile, private level: number, private budget: number, private soundOn: () => boolean) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "board-fx-canvas board-fx-ambient";
    this.canvas.dataset.level = String(level);
    this.canvas.setAttribute("aria-hidden", "true");
    this.g = this.canvas.getContext("2d");
    tray.prepend(this.canvas);
    this.rect = rectCache(tray);
    this.fx = new FxCanvas(null);
    this.fx.budget = budget;
    this.scene = createScene(itemId, budget);
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
    const offFx = onFx((e) => this.react(e));
    // adaptive quality: resolution, particles and halos follow the tier (changes come at a throw start)
    const offTier = onFxTier(() => this.applyTier(true));
    this.off = () => (offFx(), offTier());
    this.applyTier(false);
    stats.layers++;
    this.wake();
  }

  private applyTier(relayout: boolean) {
    const q = fxTierParams();
    this.fx.budget = this.budget * q.particles;
    this.fx.glow = q.glow;
    if (this.scene) this.scene.quality = q;
    if (relayout) this.layout();
  }

  private layout() {
    this.rect?.reset();
    const r = this.tray.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.ratio = Math.min(fxTierParams().canvas, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.ratio);
    this.canvas.height = Math.round(this.h * this.ratio);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.fx.layout(this.w, this.h);
    this.scene?.layout(this.w, this.h);
  }

  private local(e: FxEvent) {
    const r = this.rect.get();
    if (e.x === undefined || e.y === undefined) return { x: this.w / 2, y: this.h / 2 };
    return { x: e.x - r.left, y: e.y - r.top };
  }

  private play(reaction: BoardReaction | undefined, x: number, y: number, withSound = true) {
    if (!reaction) return;
    reaction.burst?.forEach((b) => this.fx.emit(b, x, y));
    reaction.ring?.forEach((r) => this.fx.ring(r, x, y));
    reaction.lines?.forEach((l) => this.fx.line(l, x, y));
    if (withSound && reaction.sound && this.soundOn()) playSfx("boardFx", { land: reaction.sound, intensity: 0.6 });
  }

  /** Decorative drawing pauses this long when a throw starts, so the dice's first frames come first. */
  private holdUntil = 0;
  private react(e: FxEvent) {
    if (e.type === "roll") this.holdUntil = performance.now() + ROLL_PRIORITY_MS;
    // Lv.2 only listens to nothing but its own clock; trails are for the synergy layer.
    if (this.level < 3 || e.type === "trail" || !this.visible || document.hidden) return;
    const { x, y } = this.local(e);
    const inside = x >= -10 && y >= -10 && x <= this.w + 10 && y <= this.h + 10;
    switch (e.type) {
      case "roll":
        this.scene?.roll?.();
        break;
      case "impact":
        if (inside) this.scene?.hit(x, y, strengthOf(e.strength), "impact");
        break;
      case "land": {
        if (!inside) return;
        this.scene?.hit(x, y, Math.max(0.55, strengthOf(e.strength)), "land");
        // a quiet board: its accent sound once per throw at most
        const s = this.p.react.land?.sound;
        if (s && this.soundOn() && !this.landSounded()) playSfx("boardFx", { land: s, intensity: 0.6 });
        break;
      }
      case "hold":
        this.play(this.p.react.hold, this.w / 2, this.h - 8);
        break;
      case "release":
        break;
      case "straight":
      case "yacht":
        this.scene?.big?.(e.type);
        this.play(this.p.react.grand, this.w / 2, this.h / 2);
        break;
      case "win": {
        this.scene?.big?.("win");
        const react = this.p.react.win;
        this.play(react, this.w / 2, this.h / 2);
        setTimeout(() => this.play(react, this.w * 0.25, this.h * 0.4, false), 250);
        setTimeout(() => this.play(react, this.w * 0.75, this.h * 0.4, false), 450);
      }
    }
    this.wake();
  }
  private lastLandSound = 0;
  private landSounded() {
    const now = performance.now();
    if (now - this.lastLandSound < 600) return true;
    this.lastLandSound = now;
    return false;
  }

  private running() {
    return this.visible && !document.hidden && !this.disposed;
  }
  /** (Re)start the frame loop if it is stopped and the board can be seen. */
  private wake() {
    if (!this.raf && this.running()) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.running()) return; // stays stopped until visible again (no idle rAF)
    this.raf = requestAnimationFrame(this.tick);
    if (now < this.holdUntil) return;
    const busy = ((this.scene?.busy() ?? false) && !this.scene?.calmReactions) || this.fx.busy;
    const q = fxTierParams();
    const interval = busy ? q.reactMs : Math.max(q.envMs, this.budget < 0.75 ? 39 : 0);
    if (now - this.last < interval) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.03;
    this.last = now;
    const g = this.g;
    if (!g) return;
    stats.frames++;
    g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = "source-over";
    if (this.scene) {
      this.scene.clock = performance.now();
      this.scene.ambient(g, (now - this.start) / 1000, dt);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    if (this.fx.busy) this.fx.drawInto(g, now);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  };

  private disposed = false;
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.off();
    document.removeEventListener("visibilitychange", this.onVis);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.rect.dispose();
    this.fx.dispose();
    this.canvas.remove();
    stats.layers--;
  }
}
