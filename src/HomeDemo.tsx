import { useEffect, useState } from "react";
import { Check, LockKeyhole } from "lucide-react";
import records from "./demo-records.json";
import { DieIcon } from "./Dice";
import { CategoryIcon } from "./Scoreboard";
import { names, type Category, type Game } from "./engine";

// These immutable records were produced by scripts/generate-demo.mjs using
// the unchanged engine. Home playback never runs AI or consumes game RNG.
type DemoRecord = {
  seed: number;
  category: Category;
  points: number;
  frames: { state: Game; action: { type: string } | null; actor: 0 | 1 }[];
};
const clips = records as DemoRecord[];
type Cursor = { clip: number; frame: number; rolling: boolean };
export default function HomeDemo() {
  const [cursor, setCursor] = useState<Cursor>({
    clip: 0,
    frame: 0,
    rolling: false,
  });
  const [paused, setPaused] = useState(
    () =>
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPaused(document.hidden || media.matches);
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    if (paused) return;
    const clip = clips[cursor.clip],
      next = clip.frames[cursor.frame + 1];
    const delay = cursor.rolling
      ? 360
      : cursor.frame === clip.frames.length - 1
        ? 2200
        : cursor.frame === 0
          ? 700
          : clip.frames[cursor.frame].action?.type === "hold"
            ? 1050
            : 1200;
    const timer = window.setTimeout(
      () =>
        setCursor((current) => {
          if (current.rolling)
            return { ...current, frame: current.frame + 1, rolling: false };
          if (!next)
            return {
              clip: (current.clip + 1) % clips.length,
              frame: 0,
              rolling: false,
            };
          if (next.action?.type === "roll")
            return { ...current, rolling: true };
          return { ...current, frame: current.frame + 1 };
        }),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [cursor, paused]);
  const clip = clips[cursor.clip];
  // Reduced motion presents a finished real turn, with no timers or transitions.
  const frameIndex =
    paused && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? clip.frames.length - 1
      : cursor.frame;
  const frame = clip.frames[frameIndex],
    scored = frame.action?.type === "score";
  const state = scored ? clip.frames[frameIndex - 1].state : frame.state;
  return (
    <div
      className="home-demo"
      role="img"
      aria-label="주사위를 굴리고 고정한 뒤 점수를 기록하는 자동 플레이 시연"
      aria-live="off"
      data-clip={cursor.clip}
      data-frame={frameIndex}
      data-phase={
        scored
          ? "score"
          : cursor.rolling
            ? "rolling"
            : (frame.action?.type ?? "ready")
      }
      data-paused={paused}
    >
      <div className="demo-tray">
        <div className="demo-rolls" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <i key={n} className={state.rolls >= n ? "complete" : ""} />
          ))}
        </div>
        <div className={`demo-dice ${frameIndex === 0 ? "entering" : ""}`}>
          {state.dice.map((d) => (
            <div
              key={d.id}
              className={`demo-die ${d.held ? "is-held" : ""} ${cursor.rolling && !d.held ? "is-rolling" : ""}`}
              data-id={d.id}
              data-value={d.value}
              data-held={d.held}
            >
              <DieIcon value={d.value} />
              <LockKeyhole className="demo-lock" size={13} aria-hidden="true" />
            </div>
          ))}
        </div>
        <div
          className={`demo-scorecard ${scored ? "recorded" : ""}`}
          aria-hidden="true"
        >
          <div className="receipt-lines">
            <i />
            <i />
            <i />
          </div>
          <div className="receipt-entry">
            <CategoryIcon category={clip.category} />
            <span>{names[clip.category]}</span>
            <strong>{scored ? clip.points : "—"}</strong>
            <Check className="receipt-check" size={16} />
          </div>
        </div>
      </div>
    </div>
  );
}
