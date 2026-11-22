import { useEffect, useMemo, useRef, useState } from "react";
import { planThrow, takeThrowDirection, type ThrowPlan } from "./dice-motion";
import { motionLevel, useSettings } from "./settings";
import { playSfx } from "./sound";
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
}) {
  const [visibleFace, setVisibleFace] = useState(value);
  const [animating, setAnimating] = useState(false);
  const motion = useRef<HTMLSpanElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (!animating) setVisibleFace(value); }, [value, animating]);
  // Animate a real roll event only. Holding, releasing and reordering never replay the roll.
  // The engine has already resolved `value`; the motion only decides *how* the die lands on it.
  useEffect(() => {
    if (!animate || !rolled || rollEvent === 0 || held || !plan) {
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
        className={`die-button ${held ? "held" : ""} ${rolled ? "rolled" : ""} ${animating ? "dice-animating" : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-label={`주사위 ${id + 1}, ${value}, ${held ? "고정됨" : "고정 안 됨"}`}
        aria-pressed={held}
        title="클릭: 고정 · 드래그 또는 Alt + 좌우 방향키: 순서 변경"
      >
        <span className="die-stage" aria-hidden={animating ? true : undefined}>
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
}: {
  state: Pick<Game, "dice" | "order" | "rolls">;
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
    const level = motionLevel(settings);
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
  // Sound is scheduled from the same plan, so impacts are heard when the dice visibly land.
  useEffect(() => {
    if (!animate || rollEvent === 0 || state.rolls === 0) return;
    const moving = state.dice.filter((d) => !d.held);
    if (!moving.length) return;
    if (!plans.size) {
      playSfx("impact", { intensity: 0.5 });
      return;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent]);
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
