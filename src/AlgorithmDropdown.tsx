import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { algorithms, type Algorithm } from "./ai";
export const difficulty: Record<string, { label: string; color: string }> = {
  Random: { label: "매우 쉬움", color: "#287649" },
  PPO: { label: "쉬움", color: "#527826" },
  MCTS: { label: "보통", color: "#8e660b" },
  Greedy: { label: "약간 어려움", color: "#a9560e" },
  Expectimax: { label: "어려움", color: "#b84326" },
  "DP Expert": { label: "매우 어려움", color: "#bd2525" },
};
export default function AlgorithmDropdown({
  value,
  set,
  label,
  disabled = false,
}: {
  value: Algorithm;
  set: (v: Algorithm) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId(),
    button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [position, setPosition] = useState({
      left: 0,
      top: 0,
      width: 260,
      maxHeight: 360,
    });
  const close = () => setOpen(false);
  const choose = (a: Algorithm) => {
    set(a);
    close();
    button.current?.focus();
  };
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect(),
        width = Math.min(Math.max(r.width, 270), innerWidth - 24),
        height = Math.min(360, innerHeight - 32),
        below = innerHeight - r.bottom - 12,
        above = r.top - 12,
        up = below < Math.min(height, 220) && above > below;
      const maxHeight = Math.max(80, Math.min(height, up ? above : below));
      setPosition({
        left: Math.min(Math.max(12, r.left), innerWidth - width - 12),
        top: up ? r.top - maxHeight - 6 : r.bottom + 6,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !button.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const info = difficulty[value] ?? { label: "평가 중", color: "#666" };
  return (
    <div className="field algorithm-field">
      <span>{label}</span>
      <button
        ref={button}
        type="button"
        className="algorithm-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          setActive(algorithms.indexOf(value));
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
            return;
          }
          if (e.key === "Tab") {
            close();
            return;
          }
          if (
            ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
              e.key,
            )
          ) {
            e.preventDefault();
            if (!open) {
              setActive(algorithms.indexOf(value));
              setOpen(true);
              return;
            }
            if (e.key === "Enter" || e.key === " ") choose(algorithms[active]);
            else
              setActive((i) =>
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? algorithms.length - 1
                    : (i +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        algorithms.length) %
                      algorithms.length,
              );
          }
        }}
      >
        <strong>{value}</strong>
        <small style={{ color: info.color }}>{info.label}</small>
        <ChevronDown size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-list`}
            role="listbox"
            aria-label={`${label} 목록`}
            className="algorithm-menu"
            style={position}
          >
            <p>벤치마크 평균 점수 기준</p>
            {algorithms.map((a, i) => {
              const d = difficulty[a] ?? { label: "평가 중", color: "#666" };
              return (
                <div
                  key={a}
                  id={`${id}-${i}`}
                  role="option"
                  aria-label={a}
                  aria-selected={a === value}
                  data-index={i}
                  className={i === active ? "focused" : ""}
                  onPointerMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(a)}
                >
                  <span>{a}</span>
                  <small style={{ color: d.color }}>{d.label}</small>
                  {a === value && <Check size={15} />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
