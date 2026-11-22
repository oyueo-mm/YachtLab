import { LoaderCircle } from "lucide-react";
import { names, type Category } from "../engine";
import { type Decision } from "../ai";

/** Small UI helpers shared by the game and lab screens (moved verbatim from App.tsx). */
export const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function saveFile(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function NumberField({
  label,
  value,
  set,
  min = 0,
  max = 4294967295,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) =>
          set(
            Math.max(
              min,
              Math.min(max, Math.floor(Number(e.target.value) || 0)),
            ),
          )
        }
      />
    </label>
  );
}
export function Thinking() {
  return (
    <span className="thinking">
      <LoaderCircle size={15} className="spin" /> AI가 계산하고 있습니다
    </span>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="error">
      {message}
    </p>
  ) : null;
}
export function DecisionView({ decision: d }: { decision: Decision }) {
  const probability = d.note.includes("정책 확률"),
    fullGame = d.note.startsWith("전체 게임 DP"),
    format = (value: number) =>
      probability ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
  return (
    <div className="decision-view">
      <strong>
        {d.type === "score"
          ? `${names[d.category]} 기록`
          : `${d.ids.length}개 고정, ${5 - d.ids.length}개 다시 굴리기`}
      </strong>
      <p>{d.note}</p>
      {d.candidates.length > 0 && (
        <>
          <div className="value-label">
            {fullGame
              ? "전체 게임 기대 최종점수"
              : probability
                ? "정책 확률"
                : d.note.includes("기댓점수") || d.note.includes("현재 얻는")
                  ? "점수 / 기댓점수"
                  : "근사 효용"}{" "}
            <b>{format(d.value)}</b>
          </div>
          <div className="candidates">
            {d.candidates.slice(0, 5).map((c, i) => (
              <div key={i}>
                <span>{names[c.label as Category] ?? c.label}</span>
                <strong>{format(c.value)}</strong>
                {fullGame && (
                  <small className="candidate-gap">
                    최선 대비 −{Math.max(0, d.value - c.value).toFixed(2)}
                  </small>
                )}
                {c.visits !== undefined && <small>{c.visits}회 방문</small>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
