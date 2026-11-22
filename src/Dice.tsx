import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { beginDiceMotion, planThrow, takeThrowDirection, type ThrowPlan } from "./dice-motion";
import { diceRenderer, getSettings, motionLevel, useSettings, type DiceRenderer } from "./settings";
import { playSfx } from "./sound";

/* ---------------------------------------------------------------------------------------------
 * 3D dice (three.js + cannon-es) live in a separate lazily loaded chunk. Until it is loaded, or
 * when WebGL / the simulation cannot produce a clean landing, a roll uses the 2.5D motion.
 * ------------------------------------------------------------------------------------------- */
type Dice3D = typeof import("./dice3d/stage");
let dice3d: Dice3D | null = null;
let loading: Promise<Dice3D | null> | null = null;
export function preloadDice3D() {
  loading ??= import("./dice3d/stage")
    .then((m) => (dice3d = m))
    .catch(() => null);
  return loading;
}
const stages = new WeakMap<HTMLElement, InstanceType<Dice3D["DiceStage"]>>();
type RollMode = { token: number; mode: "3d" | "2.5d" | "none" };
export type DebugRoll = { mode: RollMode["mode"]; token: number; targets: Record<number, number>; finals?: Record<number, number>; frames?: number; attempts?: number; corrected?: number; ok?: boolean; frameMs?: { avg: number; p95: number; max: number }; endedAt?: number };
const debug = (info: DebugRoll) => {
  (window as unknown as { __yachtlabDice?: { last: DebugRoll; history: DebugRoll[] } }).__yachtlabDice ??= { last: info, history: [] };
  const box = (window as unknown as { __yachtlabDice: { last: DebugRoll; history: DebugRoll[] } }).__yachtlabDice;
  box.last = info;
  box.history.push(info);
  if (box.history.length > 50) box.history.shift();
};
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LockKeyhole } from "lucide-react";
import type { Game } from "./engine";
const pips: Record<number, number[][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 25],
    [72, 25],
    [28, 50],
    [72, 50],
    [28, 75],
    [72, 75],
  ],
};
export function DieIcon({
  value = 1,
  className = "",
  ...props
}: { value?: number; className?: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`die-icon ${className}`}
      role="img"
      aria-label={`주사위 ${value}`}
      {...props}
    >
      <rect
        x="2"
        y="2"
        width="96"
        height="96"
        rx="20"
        fill="white"
        stroke="currentColor"
        strokeWidth="2"
      />
      {pips[value].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="7" fill="currentColor" />
      ))}
    </svg>
  );
}
function SortableDie({
  id,
  value,
  held,
  disabled,
  toggle,
  rolled,
  rollEvent,
  animate,
  move,
  plan,
  sound,
  hidden,
  modeRef,
}: {
  id: number;
  value: number;
  held: boolean;
  disabled: boolean;
  toggle: () => void;
  rolled: boolean;
  rollEvent: number;
  animate: boolean;
  move: (offset: number) => void;
  plan: ThrowPlan | null;
  sound: boolean;
  /** The die is currently flying in the 3D overlay; its DOM face is hidden until it lands. */
  hidden: boolean;
  modeRef: MutableRefObject<RollMode>;
}) {
  const [visibleFace, setVisibleFace] = useState(value);
  const [animating, setAnimating] = useState(false);
  const motion = useRef<HTMLSpanElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (!animating) setVisibleFace(value); }, [value, animating]);
  // Animate a real roll event only. Holding, releasing and reordering never replay the roll.
  // The engine has already resolved `value`; the motion only decides *how* the die lands on it.
  useEffect(() => {
    const otherMode = modeRef.current.token === rollEvent && modeRef.current.mode !== "2.5d";
    if (!animate || !rolled || rollEvent === 0 || held || !plan || otherMode) {
      setVisibleFace(value);
      setAnimating(false);
      return;
    }
    setAnimating(true);
    setVisibleFace(plan.tumbleFaces[0]?.face ?? value);
    const timers = [
      ...plan.tumbleFaces.map(({ at, face }) => window.setTimeout(() => setVisibleFace(face), at)),
      window.setTimeout(() => setVisibleFace(value), plan.revealAt),
      window.setTimeout(() => {
        setVisibleFace(value);
        setAnimating(false);
      }, plan.endAt + 20),
    ];
    const options: KeyframeAnimationOptions = { duration: plan.duration, delay: plan.delay, fill: "backwards" };
    const animations = [motion.current?.animate?.(plan.keyframes, options), shadow.current?.animate?.(plan.shadow, options)];
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      animations.forEach((a) => a?.cancel());
    };
    // The rollEvent token is emitted with the already resolved dice values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent]);
  // Hold/release click for human and AI alike; a new turn (rolled=false) resets silently.
  const previousHeld = useRef(held);
  useEffect(() => {
    if (previousHeld.current !== held && rolled && sound) playSfx(held ? "hold" : "release");
    previousHeld.current = held;
  }, [held, rolled, sound]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 3 : undefined,
      }}
      className={`die-wrap ${isDragging ? "dragging" : ""}`}
      data-die-id={id}
    >
      <button
        {...attributes}
        {...listeners}
        onKeyDown={(event) => {
          if (
            event.altKey &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          } else listeners?.onKeyDown?.(event);
        }}
        className={`die-button ${held ? "held" : ""} ${rolled ? "rolled" : ""} ${animating || hidden ? "dice-animating" : ""} ${hidden ? "die-in-3d" : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-label={`주사위 ${id + 1}, ${value}, ${held ? "고정됨" : "고정 안 됨"}`}
        aria-pressed={held}
        title="클릭: 고정 · 드래그 또는 Alt + 좌우 방향키: 순서 변경"
      >
        <span className="die-stage" aria-hidden={animating || hidden ? true : undefined}>
          <span ref={shadow} className="die-shadow" aria-hidden="true" />
          <span ref={motion} className="die-motion">
            <DieIcon value={visibleFace} aria-hidden={animating ? true : undefined} />
          </span>
        </span>
      </button>
      <span className={`hold-label ${held ? "visible" : ""}`}>
        <LockKeyhole size={11} />
        고정
      </span>
    </div>
  );
}
export function Dice({
  state,
  interactive = false,
  animate = false,
  rollEvent = 0,
  onToggle,
  onOrder,
  forceRenderer,
}: {
  state: Pick<Game, "dice" | "order" | "rolls">;
  /** Dice lab only: compare renderers regardless of the saved setting. */
  forceRenderer?: DiceRenderer;
  interactive?: boolean;
  animate?: boolean;
  rollEvent?: number;
  onToggle?: (id: number) => void;
  onOrder?: (ids: number[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [active, setActive] = useState(false);
  const settings = useSettings();
  // One choreography per roll token: each moving die gets its own path; held dice stay put.
  const plans = useMemo(() => {
    const result = new Map<number, ThrowPlan>();
    if (!animate || rollEvent === 0 || state.rolls === 0) return result;
    const level = forceRenderer === "2.5d" ? "full" : motionLevel(settings);
    const direction = takeThrowDirection(rollEvent);
    state.order.forEach((id, slot) => {
      const die = state.dice.find((d) => d.id === id)!;
      if (die.held) return;
      const plan = planThrow(rollEvent, id, slot, direction, level, die.value);
      if (plan) result.set(id, plan);
    });
    return result;
    // Plans are fixed per roll token; later hold/reorder must not re-plan the throw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent]);
  const rowRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<RollMode>({ token: 0, mode: "none" });
  const hostRef = useRef<HTMLElement | null>(null);
  const [inFlight, setInFlight] = useState<Set<number> | null>(null);
  const renderer = forceRenderer ?? diceRenderer(settings);
  // Warm up the 3D chunk when idle, so the first throw can already be 3D without delaying first paint.
  useEffect(() => {
    if (!animate || !renderer.startsWith("3d") || dice3d) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void preloadDice3D(), { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => void preloadDice3D(), 800);
    return () => window.clearTimeout(t);
  }, [animate, renderer]);
  // Free the WebGL context when the tray goes away.
  useEffect(
    () => () => {
      const host = hostRef.current;
      const stage = host && stages.get(host);
      if (host && stage) {
        stage.dispose();
        stages.delete(host);
      }
    },
    [],
  );
  // Pick the renderer for this roll and start it. Layout effect: a 3D throw hides the flying DOM
  // faces before the browser paints, so a die is never visible in two places.
  useLayoutEffect(() => {
    if (!animate || rollEvent === 0 || state.rolls === 0) return;
    const moving = state.dice.filter((d) => !d.held);
    if (!moving.length) return;
    const targets = Object.fromEntries(moving.map((d) => [d.id, d.value]));
    const chosen = forceRenderer ?? diceRenderer(getSettings());
    const cleanups: (() => void)[] = [];
    let mode: RollMode["mode"] = chosen === "none" ? "none" : chosen === "2.5d" ? "2.5d" : "3d";
    if (mode === "3d") {
      const started = start3D(chosen as "3d" | "3d-high", targets, cleanups);
      if (!started) mode = "2.5d";
    }
    modeRef.current = { token: rollEvent, mode };
    if (mode === "none") {
      playSfx("impact", { intensity: 0.5 });
      debug({ mode, token: rollEvent, targets, endedAt: performance.now() });
    }
    if (mode === "2.5d" && plans.size) {
      // Sound is scheduled from the same plan, so impacts are heard when the dice visibly land.
      playSfx("throw");
      const hits: { at: number; intensity: number; pan: number }[] = [];
      plans.forEach((plan, id) => {
        const pan = (state.order.indexOf(id) - 2) * 0.25;
        plan.impacts.forEach((hit) => hits.push({ ...hit, pan }));
      });
      hits.sort((a, b) => a.at - b.at);
      let last = -Infinity;
      for (const hit of hits) {
        if (hit.at - last < 28) continue; // merge near-simultaneous clacks
        last = hit.at;
        playSfx("impact", { delay: hit.at / 1000, intensity: hit.intensity, pan: hit.pan });
      }
      const end = Math.max(...[...plans.values()].map((p) => p.endAt));
      playSfx("settle", { delay: end / 1000, intensity: 0.4 });
      const done = beginDiceMotion(end + 400);
      const timer = window.setTimeout(() => {
        done();
        debug({ mode, token: rollEvent, targets, endedAt: performance.now() });
      }, end + 30);
      cleanups.push(() => {
        window.clearTimeout(timer);
        done();
      });
    }
    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent]);

  /** Measure the tray and the row slots, pre-simulate, and play the 3D throw. False → use 2.5D. */
  function start3D(quality: "3d" | "3d-high", targets: Record<number, number>, cleanups: (() => void)[]): boolean {
    const row = rowRef.current;
    const host = row?.closest<HTMLElement>(".throw-tray");
    if (!dice3d || !row || !host) return false;
    hostRef.current = host;
    let stage = stages.get(host);
    try {
      if (!stage || stage.quality !== quality) {
        stage?.dispose();
        stage = new dice3d.DiceStage(host, quality);
        stages.set(host, stage);
      }
    } catch {
      return false; // WebGL context could not be created
    }
    const hostRect = host.getBoundingClientRect();
    const slots = new Map<number, DOMRect>();
    row.querySelectorAll<HTMLElement>("[data-die-id]").forEach((el) => {
      const face = el.querySelector<HTMLElement>(".die-motion");
      if (face) slots.set(Number(el.dataset.dieId), face.getBoundingClientRect());
    });
    const size = slots.values().next().value?.width ?? 0;
    if (size < 16 || hostRect.width < size * 4 || hostRect.height < size * 3) return false;
    const input = {
      width: hostRect.width / size,
      height: hostRect.height / size,
      direction: takeThrowDirection(rollEvent),
      seed: (Math.imul(rollEvent, 2654435761) ^ crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0,
      dice: state.dice.map((d) => {
        const r = slots.get(d.id)!;
        return { id: d.id, value: d.value, held: d.held, x: (r.left + r.width / 2 - hostRect.left) / size, z: (r.top + r.height / 2 - hostRect.top) / size };
      }),
    };
    const result = dice3d.simulateThrow(input);
    if (!result.ok) return false;
    stage.layout(hostRect.width, hostRect.height, size);
    setInFlight(new Set(Object.keys(targets).map(Number)));
    const rate = 1.15;
    const done = beginDiceMotion(((result.frameCount / result.fps) * 1000) / rate + 1500);
    playSfx("throw");
    // Physics impacts drive the sound: louder for harder hits, rate-limited so five dice never get noisy.
    let lastHit = -Infinity,
      hitCount = 0;
    const cancel = stage.play({
      result,
      rate,
      onImpact: ({ strength, kind, x }) => {
        const now = performance.now();
        if (hitCount >= 14 || (now - lastHit < 45 && strength < 5)) return;
        lastHit = now;
        hitCount++;
        const intensity = Math.min(1, 0.12 + strength / 7) * (kind === "die" ? 0.75 : kind === "wall" ? 0.6 : 1);
        playSfx("impact", { intensity, pan: (x - 0.5) * 1.2 });
      },
      onDone: () => {
        playSfx("settle", { intensity: 0.35 });
        const times = [...stage!.frameTimes].slice(1).sort((a, b) => a - b);
        setInFlight(null);
        // Swap back to the DOM dice on the next frame, after they have been painted.
        requestAnimationFrame(() => requestAnimationFrame(() => stage!.stop()));
        done();
        debug({
          mode: "3d",
          token: rollEvent,
          targets,
          finals: Object.fromEntries(result.tracks.map((t) => [t.id, dice3d!.finalValue(t, result.frameCount)])),
          frames: result.frameCount,
          attempts: result.attempts,
          corrected: result.corrected,
          ok: result.ok,
          frameMs: times.length ? { avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)] ?? 0, max: times.at(-1) ?? 0 } : undefined,
          endedAt: performance.now(),
        });
      },
    });
    cleanups.push(() => {
      cancel();
      setInFlight(null);
      done();
    });
    return true;
  }
  const end = ({ active, over }: DragEndEvent) => {
    setActive(false);
    if (over && active.id !== over.id)
      onOrder?.(
        arrayMove(
          state.order,
          state.order.indexOf(Number(active.id)),
          state.order.indexOf(Number(over.id)),
        ),
      );
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => setActive(true)}
      onDragCancel={() => setActive(false)}
      onDragEnd={end}
    >
      <SortableContext
        items={state.order}
        strategy={horizontalListSortingStrategy}
      >
        <div
          ref={rowRef}
          className={`dice-row ${active ? "sorting" : ""}`}
          key={state.rolls === 0 ? "ready" : "rolling"}
        >
          {state.order.map((id) => {
            const die = state.dice.find((d) => d.id === id)!;
            return (
              <SortableDie
                key={id}
                {...die}
                disabled={!interactive || !state.rolls}
                toggle={() => onToggle?.(id)}
                rolled={state.rolls > 0}
                animate={animate}
                rollEvent={rollEvent}
                plan={plans.get(id) ?? null}
                sound={animate}
                hidden={!!inFlight?.has(id)}
                modeRef={modeRef}
                move={(offset) => {
                  const index = state.order.indexOf(id),
                    target = index + offset;
                  if (target >= 0 && target < 5)
                    onOrder?.(arrayMove(state.order, index, target));
                }}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
