import type { DiceMaterial } from "./sound-packs";
import { useSettings } from "./settings";
import type { DiceLook } from "./dice3d/face-paint";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { Game } from "./engine";
import { beginDiceMotion, isDiceBusy, takeThrowDirection } from "./dice-motion";
import { playSfx } from "./sound";
import { getScoreFx, useScoreFx } from "./score-fx";
import type { DiceTableModule } from "./dice3d-loader";
import type { PreparedThrow } from "./dice3d/physics";
import type { DebugRoll } from "./Dice";

type Pose = { x: number; y: number; z: number; quat: [number, number, number, number] };
type Table = InstanceType<DiceTableModule["DiceTable"]>;
/** Height of the hold shelf below the tray, in die edges. */
const HOLD_UNITS = 1.45;
/** Smallest tray depth (die edges) that still gives the physics room to roll. */
const MIN_TRAY = 4.3;
const MOVE_MS = 260;

type DebugWindow = Window & {
  __yachtlabDice?: { last: DebugRoll; history: DebugRoll[]; table?: () => unknown };
};
const record = (info: DebugRoll) => {
  const w = window as DebugWindow;
  w.__yachtlabDice ??= { last: info, history: [] };
  w.__yachtlabDice.last = info;
  w.__yachtlabDice.history.push(info);
  if (w.__yachtlabDice.history.length > 50) w.__yachtlabDice.history.shift();
};

/**
 * 3D dice that stay where they land.
 *  - Tray: dice are thrown with real rigid-body physics and keep their final position and rotation.
 *  - Hold shelf: tapping a die moves it to its own slot below the tray; tapping it there puts it back.
 *    Held dice are not thrown again. The engine's `held` flags are the single source of truth.
 *  - The roll button lives outside this component, so the 3D canvas never covers it.
 * Values always come from the engine; the throw is pre-simulated to land on them (see dice3d/physics.ts).
 */
export function PhysicalDice({
  module: mod,
  quality,
  state,
  holdOrder = [],
  adaptive = false,
  interactive,
  focusDie,
  rollEvent,
  onToggle,
  onOrder,
  onShiftHold,
  onFailure,
  colors = null,
  material = "plastic",
  soundEnabled = true,
}: {
  material?: DiceMaterial;
  soundEnabled?: boolean;
  /** Dice theme (online: the current turn's player). */
  colors?: DiceLook | null;
  module: DiceTableModule;
  quality: "3d" | "3d-high";
  state: Pick<Game, "dice" | "order" | "rolls">;
  /** Held dice in selection order: shelf slot i holds holdOrder[i] (first selected = leftmost). */
  holdOrder?: readonly number[];
  /** Alt + arrow on a held die (absent when the order is decided elsewhere, e.g. online). */
  onShiftHold?: (id: number, step: -1 | 1) => void;
  /** "자동" quality: lower the canvas resolution after repeatedly slow throws. */
  adaptive?: boolean;
  interactive: boolean;
  focusDie?: number;
  rollEvent: number;
  onToggle?: (id: number) => void;
  onOrder?: (ids: number[]) => void;
  onFailure: () => void;
}) {
  const sound = soundEnabled ? playSfx : () => {};
  const root = useRef<HTMLDivElement>(null);
  const table = useRef<Table | null>(null);
  const tray = useRef(new Map<number, Pose>());
  const parked = useRef(new Map<number, Pose>());
  const [dims, setDims] = useState<{ w: number; h: number; size: number; W: number; trayH: number } | null>(null);
  const [flying, setFlying] = useState<ReadonlySet<number>>(new Set());
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const handledRoll = useRef(rollEvent);
  const prevHeld = useRef(new Map(state.dice.map((d) => [d.id, d.held])));
  const prevOrder = useRef(holdOrder.join());
  const stateRef = useRef(state);
  stateRef.current = state;
  const holdRef = useRef(holdOrder);
  holdRef.current = holdOrder;
  const hitEls = useRef(new Map<number, HTMLElement>());
  const dimsRef = useRef<typeof dims>(null);
  dimsRef.current = dims;
  const handledFx = useRef(0);
  const activeFx = useRef<{ key: number; abort: () => void } | null>(null);
  const fxNow = useScoreFx();

  // Size: dice scale with the board; the tray is at least ~4.7 die edges deep for clean physics.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (w < 120 || h < 160) return;
      const size = Math.floor(Math.max(34, Math.min(112, w / 6.2, h / (MIN_TRAY + HOLD_UNITS))));
      setDims({ w, h, size, W: w / size, trayH: h / size - HOLD_UNITS });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { reducedEffects } = useSettings();
  useEffect(() => {
    table.current?.setColors(colors && reducedEffects ? { ...colors, anim: undefined, trail: undefined, landing: undefined } : colors);
  }, [JSON.stringify(colors), reducedEffects, dims]);

  useEffect(
    () => () => {
      table.current?.dispose();
      table.current = null;
    },
    [],
  );

  /** Shelf slot i (0 = leftmost). */
  const slotAt = (i: number) => {
    if (!dims) return { x: 0, z: 0 };
    const gap = Math.min(1.3, (dims.W - 0.4) / 5);
    return { x: dims.W / 2 + (i - 2) * gap, z: dims.trayH + HOLD_UNITS / 2 };
  };
  /** A held die sits in the slot of its selection order. */
  const holdSlot = (id: number) => slotAt(Math.max(0, holdRef.current.indexOf(id)));
  const holdPose = (id: number, near?: Pose["quat"]): Pose => {
    const value = stateRef.current.dice.find((d) => d.id === id)!.value;
    const s = holdSlot(id);
    return { x: s.x, y: 0.5, z: s.z, quat: mod.uprightNear(value, near ?? mod.canonicalOrientation(value)) as Pose["quat"] };
  };
  /** Nearest floor spot near (x, z) that does not touch another resting die. */
  const freeSpot = (x: number, z: number, skip: number): { x: number; z: number } => {
    if (!dims) return { x, z };
    const others = [...tray.current.entries()].filter(([id]) => id !== skip).map(([, p]) => p);
    const ok = (px: number, pz: number) => px >= 0.65 && px <= dims.W - 0.65 && pz >= 0.65 && pz <= dims.trayH - 0.65 && others.every((o) => Math.hypot(o.x - px, o.z - pz) >= 1.15);
    if (ok(x, z)) return { x, z };
    for (let r = 0.4; r < 6; r += 0.3)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a * Math.PI) / 8) * r,
          pz = z + Math.sin((a * Math.PI) / 8) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    return { x: Math.min(Math.max(x, 0.65), dims.W - 0.65), z: Math.min(Math.max(z, 0.65), dims.trayH - 0.65) };
  };
  const poses = () => {
    const map = new Map<number, Pose>();
    if (stateRef.current.rolls === 0) return map;
    for (const d of stateRef.current.dice) {
      const p = d.held ? holdPose(d.id, table.current?.pose(d.id)?.quat) : tray.current.get(d.id);
      if (p) map.set(d.id, p);
    }
    return map;
  };

  // Create / lay out the WebGL table.
  useLayoutEffect(() => {
    if (!dims || !root.current) return;
    if (!table.current) {
      try {
        table.current = new mod.DiceTable(root.current.querySelector<HTMLElement>(".dice-table-stage")!, quality, { adaptive });
      } catch {
        onFailure();
        return;
      }
      // Mounted mid-turn (lab / lobby): lay the current dice down neatly in the tray.
      if (state.rolls > 0)
        state.dice.forEach((d, i) => {
          if (d.held) return;
          const gap = Math.min(1.35, (dims.W - 1) / 5);
          tray.current.set(d.id, { x: dims.W / 2 + (state.order.indexOf(d.id) - 2) * gap, y: 0.5, z: dims.trayH / 2 + (i % 2 ? 0.25 : -0.25), quat: mod.uprightNear(d.value, mod.canonicalOrientation(d.value)) as Pose["quat"] });
        });
    }
    // Hit targets follow what is drawn (also while a die slides), not just where it is going.
    table.current.onPose = (id, p) => {
      const el = hitEls.current.get(id),
        d = dimsRef.current;
      if (el && d) {
        el.style.left = `${p.x * d.size - d.size / 2}px`;
        el.style.top = `${p.z * d.size - d.size / 2}px`;
      }
    };
    table.current.layout(dims.w, dims.h, dims.size);
    for (const [id, p] of tray.current) {
      const fixed = { ...p, ...freeSpot(Math.min(p.x, dims.W - 0.65), Math.min(p.z, dims.trayH - 0.65), id) };
      tray.current.set(id, fixed);
    }
    table.current.setPoses(poses());
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, quality]);

  // A new turn clears the tray — after the score effect, when the move was a scoring one.
  useEffect(() => {
    if (state.rolls !== 0) return;
    const t = table.current;
    const clearAll = () => {
      tray.current.clear();
      parked.current.clear();
      table.current?.setPoses(new Map());
      prevHeld.current = new Map(stateRef.current.dice.map((d) => [d.id, d.held]));
      refresh();
    };
    const fx = getScoreFx();
    const fresh = !!fx && fx.key !== handledFx.current && performance.now() - fx.at < 400 && fx.ids.length > 0 && !!t && fx.ids.every((id) => !!t.pose(id));
    if (!t || !fx || !fresh) {
      clearAll();
      return;
    }
    // Score effect: the dice that make the combination spring toward the camera. The roll button and
    // dice stay locked until it ends (the engine has already scored the move).
    handledFx.current = fx.key;
    const done = beginDiceMotion(fx.ms + 900);
    let fade = () => {};
    let stopped = false;
    const stop = t.celebrate({
      ids: fx.ids,
      ms: fx.ms,
      grand: fx.grand,
      compact: window.matchMedia("(max-width: 760px)").matches,
      onPeak: () => sound(fx.category === "large" ? "grand" : "combo", { pan: 0 }),
      onDone: () => {
        fade = t.fadeOut(170, () => {
          clearAll();
          activeFx.current = null;
          done();
        });
      },
    });
    const abort = () => {
      if (stopped) return;
      stopped = true;
      stop();
      fade();
      clearAll();
      activeFx.current = null;
      done();
    };
    activeFx.current = { key: fx.key, abort };
    return abort;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rolls]);

  // The effect is cancelled when the score event is cleared (rematch, leaving the game).
  useEffect(() => {
    if (activeFx.current && fxNow?.key !== activeFx.current.key) activeFx.current.abort();
  }, [fxNow]);

  /** Physics input for throwing every die that is not held, from where it is drawn now. */
  const throwInput = (direction: -1 | 1, seed: number) => {
    const t = table.current,
      d = dimsRef.current;
    if (!t || !d) return null;
    const moving = stateRef.current.dice.filter((x) => !x.held);
    const starts: Record<number, { x: number; z: number; quat: Pose["quat"] }> = {};
    for (const die of moving) {
      // Where the die is drawn right now (a slide that has not finished yet still counts).
      const p = t.pose(die.id) ?? tray.current.get(die.id);
      if (p) starts[die.id] = { x: p.x, z: p.z, quat: p.quat };
    }
    return {
      width: d.W,
      height: d.trayH,
      direction,
      seed,
      landing: "free" as const,
      maxAttempts: 14,
      starts,
      dice: moving.map((die) => ({ id: die.id, value: die.value, held: false, x: starts[die.id]?.x ?? d.W / 2, z: starts[die.id]?.z ?? d.trayH / 2 })),
    };
  };
  // While the dice are at rest, run the physics of the next throw in idle time; the roll then only
  // applies the values the engine/server decided (no simulation delay between the tap and the throw).
  const prepared = useRef<PreparedThrow | null>(null);
  const lastHeldKey = useRef("");
  const heldKey = state.dice.map((d) => (d.held ? 1 : 0)).join("");
  useEffect(() => {
    if (!dims || flying.size || state.rolls >= 3 || state.dice.every((d) => d.held)) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => {
      // Never during an animation (score effect, slides): a long task there would drop frames.
      if (isDiceBusy() || (table.current?.animating ?? false)) {
        idle = 0;
        timer = window.setTimeout(schedule, 400);
        return;
      }
      const input = throwInput((rollEvent + 1) % 2 ? 1 : -1, crypto.getRandomValues(new Uint32Array(1))[0]);
      if (!input || !input.dice.length) return;
      if (prepared.current?.key === mod.throwKey(input)) return;
      prepared.current = mod.prepareThrow(input);
    };
    let idle = 0;
    // Idle time (at most ~250 ms later), once hold/release slides have finished (final starting poses).
    // Right after a throw lands nothing is sliding, so preparation starts almost at once: a quick
    // re-roll without holding anything no longer has to simulate on the tap.
    const schedule = () => {
      if (w.requestIdleCallback) idle = w.requestIdleCallback(run, { timeout: 250 });
      else run();
    };
    const sliding = table.current?.animating ?? false;
    let timer = window.setTimeout(schedule, sliding || heldKey !== lastHeldKey.current ? MOVE_MS + 60 : 40);
    lastHeldKey.current = heldKey;
    return () => {
      window.clearTimeout(timer);
      if (idle) w.cancelIdleCallback?.(idle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, flying.size, state.rolls, heldKey, rollEvent, holdOrder.join()]);

  // Throw: only the dice that are not held, starting from where they lie (or from the tray edge).
  useLayoutEffect(() => {
    if (rollEvent === handledRoll.current) return;
    handledRoll.current = rollEvent;
    const t = table.current;
    if (!t || !dims || state.rolls === 0) return;
    const moving = state.dice.filter((d) => !d.held);
    prevHeld.current = new Map(state.dice.map((d) => [d.id, d.held]));
    if (!moving.length) return;
    const input = throwInput(takeThrowDirection(rollEvent), (Math.imul(rollEvent, 2654435761) ^ crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0);
    if (!input) return;
    const targets = Object.fromEntries(moving.map((d) => [d.id, d.value]));
    const effectStart = performance.now();
    // Physics prepared while the dice were at rest is reused when nothing relevant changed since.
    const ready = prepared.current;
    prepared.current = null;
    const result = mod.simulateThrow(input, ready);
    for (const d of moving) tray.current.delete(d.id);
    setFlying(new Set(moving.map((d) => d.id)));
    const rate = 1.25;
    const done = beginDiceMotion(((result.frameCount / result.fps) * 1000) / rate + 2000);
    sound("throw", { material });
    let lastHit = -Infinity,
      hits = 0,
      firstFrameAt = 0;
    const cancel = t.play(result, {
      rate,
      onFrame: () => {
        if (!firstFrameAt) firstFrameAt = performance.now();
      },
      onRoll: (level) => sound("roll", { material, intensity: level, pan: 0 }),
      onImpact: ({ strength, kind, x }) => {
        // Sound follows the rendered collision: louder and heavier for harder hits, dice knock drier.
        const now = performance.now();
        if (hits >= 16 || (now - lastHit < 40 && strength < 6)) return;
        lastHit = now;
        hits++;
        const intensity = Math.min(1, 0.1 + strength / 9) * (kind === "wall" ? 0.65 : 1);
        sound(kind === "die" ? "clack" : "impact", { material, intensity, pan: (x - 0.5) * 1.2 });
      },
      onDone: () => {
        const last = (result.frameCount - 1) * 7;
        const pending: (() => void)[] = [];
        for (const tr of result.tracks) {
          const f = tr.frames;
          const pose: Pose = { x: f[last], y: 0.5, z: f[last + 2], quat: [f[last + 3], f[last + 4], f[last + 5], f[last + 6]] };
          if (f[last + 1] > 0.62) {
            // Rare: a die came to rest on another one. Slide it down to free floor (top face unchanged).
            const spot = freeSpot(pose.x, pose.z, tr.id);
            const to = { ...pose, ...spot };
            tray.current.set(tr.id, to);
            pending.push(() => t.moveTo(tr.id, to, MOVE_MS)); // slides from where it is drawn now
          } else tray.current.set(tr.id, pose);
        }
        pending.forEach((run) => run());
        sound("settle", { material, intensity: 0.35 });
        setFlying(new Set());
        refresh();
        done();
        const times = [...t.frameTimes].slice(1).sort((a, b) => a - b);
        record({
          mode: "3d",
          token: rollEvent,
          targets,
          finals: Object.fromEntries(result.tracks.map((tr) => [tr.id, mod.finalValue(tr, result.frameCount)])),
          frames: result.frameCount,
          simMs: result.stats.simMs,
          startedAfterMs: firstFrameAt - effectStart,
          effectStartAt: effectStart,
          firstFrameAt,
          attempts: result.attempts,
          corrected: result.corrected,
          prepared: !!ready && ready.key === mod.throwKey(input),
          pixelRatio: t.pixelRatio,
          ok: result.ok,
          frameMs: times.length ? { avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)] ?? 0, max: times.at(-1) ?? 0 } : undefined,
          endedAt: performance.now(),
        });
      },
    });
    return () => {
      cancel();
      done();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent]);

  // Hold / release: the die travels between the tray and its shelf slot (yaw only, top face kept).
  useEffect(() => {
    const t = table.current;
    if (!t || !dims || state.rolls === 0 || flying.size) return;
    const cancels: (() => void)[] = [];
    for (const d of state.dice) {
      const was = prevHeld.current.get(d.id) ?? false;
      if (was === d.held) continue;
      const current = t.pose(d.id);
      if (d.held) {
        const from = tray.current.get(d.id) ?? parked.current.get(d.id) ?? current;
        if (from) parked.current.set(d.id, from);
        tray.current.delete(d.id);
        const to = holdPose(d.id, from?.quat);
        cancels.push(t.moveTo(d.id, to, MOVE_MS));
        sound("hold");
      } else {
        const back = parked.current.get(d.id);
        const spot = freeSpot(back?.x ?? dims.W / 2, back?.z ?? dims.trayH / 2, d.id);
        const to: Pose = { x: spot.x, y: 0.5, z: spot.z, quat: back?.quat ?? holdPose(d.id).quat };
        tray.current.set(d.id, to);
        cancels.push(t.moveTo(d.id, to, MOVE_MS));
        sound("release");
      }
    }
    prevHeld.current = new Map(state.dice.map((d) => [d.id, d.held]));
    refresh();
    // A newer slide for the same die replaces the older one (see DiceTable.moveTo); nothing to cancel here.
    void cancels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.dice.map((d) => (d.held ? 1 : 0)).join(""), flying.size]);

  // A change in the selection order (a die released, Alt + arrow, an online update) slides the
  // remaining held dice to their new shelf slots.
  useEffect(() => {
    const key = holdOrder.join();
    if (key === prevOrder.current) return;
    prevOrder.current = key;
    const t = table.current;
    if (!t || state.rolls === 0) return;
    const cancels: (() => void)[] = [];
    for (const d of state.dice) {
      if (!d.held) continue;
      const from = t.pose(d.id);
      if (from) cancels.push(t.moveTo(d.id, holdPose(d.id, from.quat), MOVE_MS));
    }
    refresh();
    void cancels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdOrder.join()]);

  // Test / diagnostics hook: what is actually drawn right now.
  useEffect(() => {
    const w = window as DebugWindow;
    w.__yachtlabDice ??= { last: { mode: "none", token: 0, targets: {} }, history: [] };
    w.__yachtlabDice.table = () =>
      stateRef.current.dice.map((d) => {
        const p = table.current?.pose(d.id);
        return p ? { id: d.id, value: d.value, held: d.held, x: p.x, y: p.y, z: p.z, top: mod.topFace(p.quat).value, zone: p.z > (dims?.trayH ?? 0) ? "hold" : "tray" } : { id: d.id, value: d.value, held: d.held, hidden: true };
      });
  });

  const visible = state.rolls > 0 && dims;
  const targets = visible
    ? state.dice.flatMap((d) => {
        const p = d.held ? holdPose(d.id) : tray.current.get(d.id);
        return p ? [{ id: d.id, d, cx: p.x * dims.size, cy: p.z * dims.size }] : [];
      })
    : [];
  const busy = flying.size > 0;
  /** The die whose centre is nearest to a point (px within the table), if within reach. */
  const nearest = (clientX: number, clientY: number, reach: number) => {
    if (!root.current || !dims) return null;
    const box = root.current.getBoundingClientRect();
    const px = clientX - box.left,
      py = clientY - box.top;
    let best: number | null = null,
      dist = reach;
    for (const t of targets) {
      // Use where the die is drawn right now (it may still be sliding), not only where it is headed.
      const live = table.current?.pose(t.id);
      const cx = live ? live.x * dims.size : t.cx,
        cy = live ? live.z * dims.size : t.cy;
      const dd = Math.hypot(cx - px, cy - py);
      if (dd < dist) {
        dist = dd;
        best = t.id;
      }
    }
    return best;
  };
  /** Pick the die whose centre is nearest to the pointer, so overlapping dice stay selectable. */
  const pick = (event: MouseEvent<HTMLButtonElement>, id: number) => {
    event.stopPropagation();
    if (!interactive || busy) return;
    if (focusDie !== undefined && id !== focusDie) return;
    if (focusDie !== undefined || event.detail === 0 || !dims) return onToggle?.(id); // keyboard activation
    onToggle?.(nearest(event.clientX, event.clientY, Infinity) ?? id);
  };
  /** Taps in the small gaps around a die still reach it. */
  const pickGap = (event: MouseEvent<HTMLDivElement>) => {
    if (!interactive || busy || !dims) return;
    const id = nearest(event.clientX, event.clientY, dims.size * 0.75);
    if (id !== null && (focusDie === undefined || id === focusDie)) onToggle?.(id);
  };
  const keys = (event: KeyboardEvent<HTMLButtonElement>, id: number) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    // A held die moves along the shelf; a die in the tray changes the row order (2.5D view, keyboard users).
    if (holdRef.current.includes(id)) return onShiftHold?.(id, step);
    const index = state.order.indexOf(id),
      target = index + (event.key === "ArrowLeft" ? -1 : 1);
    if (target >= 0 && target < 5) onOrder?.(arrayMove(state.order, index, target));
  };
  return (
    <div ref={root} className="physical-dice" data-ready={!!dims} data-hold-order={holdOrder.join(",")} onClick={pickGap}>
      <div className="dice-tray-area" style={dims ? { height: dims.trayH * dims.size } : undefined} />
      <div className="dice-hold-area" style={dims ? { height: HOLD_UNITS * dims.size } : undefined} aria-label="고정한 주사위 자리">
        {dims &&
          [0, 1, 2, 3, 4].map((i) => {
            const s = slotAt(i);
            return <span key={i} className="hold-slot" style={{ left: s.x * dims.size - dims.size / 2, top: (s.z - dims.trayH) * dims.size - dims.size / 2, width: dims.size, height: dims.size }} />;
          })}
      </div>
      <div className="dice-table-stage" />
      {dims &&
        state.order.map((id) => {
          const d = state.dice.find((x) => x.id === id)!;
          const t = targets.find((x) => x.id === id);
          const moving = flying.has(id);
          return (
            <button
              key={id}
              ref={(el) => {
                if (el) hitEls.current.set(id, el);
                else hitEls.current.delete(id);
              }}
              type="button"
              className={`die-button die-hit ${d.held ? "held" : ""} ${moving ? "dice-animating" : ""}`}
              data-die-id={id}
              data-zone={d.held ? "hold" : "tray"}
              style={t ? { left: t.cx - dims.size / 2, top: t.cy - dims.size / 2, width: dims.size, height: dims.size } : { display: "none" }}
              disabled={!interactive || busy || !state.rolls || (focusDie !== undefined && id !== focusDie)}
              aria-pressed={d.held}
              aria-label={`주사위 ${id + 1}, ${d.value}, ${d.held ? "고정됨" : "고정 안 됨"}`}
              title="클릭: 고정/해제 (고정한 순서대로 아래 칸에 놓여요)"
              onClick={(e) => pick(e, id)}
              onKeyDown={(e) => keys(e, id)}
            />
          );
        })}
    </div>
  );
}
