import { useState } from "react";
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
  rollNumber,
  move,
}: {
  id: number;
  value: number;
  held: boolean;
  disabled: boolean;
  toggle: () => void;
  rolled: boolean;
  rollNumber: number;
  move: (offset: number) => void;
}) {
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
        className={`die-button ${held ? "held" : ""} ${rolled ? "rolled" : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-label={`주사위 ${id + 1}, ${value}, ${held ? "고정됨" : "고정 안 됨"}`}
        aria-pressed={held}
        title="클릭: 고정 · 드래그 또는 Alt + 좌우 방향키: 순서 변경"
      >
        <DieIcon
          key={rollNumber}
          value={value}
          className={rolled ? "roll-face" : ""}
        />
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
  onToggle,
  onOrder,
}: {
  state: Game;
  interactive?: boolean;
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
                rolled={state.rolls > 0 && !die.held}
                rollNumber={state.rolls}
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
