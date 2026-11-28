import { useId, type KeyboardEvent, type PointerEvent } from "react";
import type { RoundBar, SeriesPoint } from "./view-model";
import { signed } from "./view-model";

const W = 400, H = 150, LEFT = 38, RIGHT = 392, TOP = 12, BOTTOM = 126;

export type Series = { key: string; label: string; tone: "me" | "opp" | "neutral"; points: SeriesPoint[] };

/** Line chart over the action order. `x` is the step index so every series shares one axis. */
export function ProgressChart({ label, unit, series, steps, rounds, selected, change, domain, midline }: {
  label: string; unit: string; series: Series[]; steps: number; rounds: { round: number; index: number }[];
  selected: number; change: (index: number) => void; domain?: [number, number]; midline?: number;
}) {
  const id = useId();
  const all = series.flatMap(({ points }) => points);
  if (!all.length) return <p className="review-no-data">{label} 값이 없어요.</p>;
  const lo = domain?.[0] ?? Math.floor(Math.min(...all.map(({ value }) => value)) / 10) * 10;
  const hi = domain?.[1] ?? Math.max(lo + 10, Math.ceil(Math.max(...all.map(({ value }) => value)) / 10) * 10);
  const x = (step: number) => LEFT + (step / Math.max(steps - 1, 1)) * (RIGHT - LEFT);
  const y = (value: number) => BOTTOM - ((value - lo) / (hi - lo)) * (BOTTOM - TOP);
  const ordered = [...all].sort((a, b) => a.x - b.x);

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) * W / box.width - LEFT) / (RIGHT - LEFT) * Math.max(steps - 1, 1);
    const nearest = ordered.reduce((best, point) => Math.abs(point.x - at) < Math.abs(best.x - at) ? point : best);
    change(nearest.index);
  }
  const current = series.map((line) => ({ line, point: [...line.points].reverse().find(({ x: px }) => px <= selected) }));
  const marked = all.some(({ exactness }) => exactness);
  const kinds = new Set(all.map(({ exactness }) => exactness));
  const tag = (p?: SeriesPoint) => p?.exactness === "exact" ? " 정확" : p?.exactness === "estimate" ? " 추정" : "";
  const labelled = rounds.filter((_, i) => rounds.length <= 12 || i % 2 === 0);

  return <div className="review-chart" role="group" aria-label={label + " 그래프"}>
    <output>
      <b>{rounds.filter(({ index }) => index <= selected).pop()?.round ?? rounds[0]?.round}라운드</b>{" "}
      {current.map(({ line, point }) => <span key={line.key} className={"review-legend tone-" + line.tone}>
        <i aria-hidden="true" />{line.label} {point ? `${point.value.toFixed(unit === "점" ? 1 : 2)}${unit}` : "—"}
        {point?.exactness && <b className={"review-flag " + point.exactness}>{point.exactness === "exact" ? "정확 종반" : "모델 추정"}</b>}
      </span>)}
      {marked && <span className="review-exactness-key" aria-label="점 모양 설명">
        {kinds.has("estimate") && <span><svg viewBox="0 0 22 10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" className="estimate" /><circle cx="11" cy="5" r="3" className="estimate" /></svg>모델 추정</span>}
        {kinds.has("exact") && <span><svg viewBox="0 0 22 10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" className="exact" /><rect x="8" y="2" width="6" height="6" className="exact" /></svg>정확 종반</span>}
      </span>}
    </output>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} onPointerUp={pick}>
      <title id={id}>{label} 그래프. 점을 누르면 해당 행동으로 이동해요.</title>
      {[hi, (lo + hi) / 2, lo].map((tick) => <g key={tick}>
        <line className="review-gridline" x1={LEFT} x2={RIGHT} y1={y(tick)} y2={y(tick)} />
        <text x={LEFT - 4} y={y(tick) + 3} textAnchor="end">{Math.round(tick)}</text>
      </g>)}
      {midline !== undefined && <line className="review-midline" x1={LEFT} x2={RIGHT} y1={y(midline)} y2={y(midline)} />}
      {labelled.map(({ round, index }) => <g key={round}>
        <line className="review-roundline" x1={x(index)} x2={x(index)} y1={TOP} y2={BOTTOM} />
        <text x={x(index)} y={H - 10} textAnchor="middle">{round}</text>
      </g>)}
      <line className="review-cursor" x1={x(selected)} x2={x(selected)} y1={TOP - 4} y2={BOTTOM} />
      {series.map((line) => <g key={line.key} className={"review-series tone-" + line.tone}>
        {line.points.slice(1).map((p, i) => {
          const from = line.points[i];
          // A segment is solid only when both ends are exact values.
          const kind = from.exactness === "estimate" || p.exactness === "estimate" ? "estimate" : "exact";
          return <line key={p.index} className={"review-seg-" + kind} x1={x(from.x)} y1={y(from.value)} x2={x(p.x)} y2={y(p.value)} />;
        })}
        {line.points.map((p) => {
          const chosen = p.index === selected;
          const className = [chosen ? "chosen" : "", p.exactness ?? ""].join(" ").trim() || undefined;
          const title = <title>{p.round}라운드 · {p.value.toFixed(2)}{unit}{tag(p)}</title>;
          if (p.exactness === "exact") {
            const r = chosen ? 4.5 : 2.6;
            return <rect key={p.index} x={x(p.x) - r} y={y(p.value) - r} width={r * 2} height={r * 2} className={className}>{title}</rect>;
          }
          return <circle key={p.index} cx={x(p.x)} cy={y(p.value)} r={chosen ? 4.5 : p.exactness ? 2.4 : 2} className={className}>{title}</circle>;
        })}
      </g>)}
      <text className="review-axis" x={RIGHT} y={H - 1} textAnchor="end">라운드</text>
    </svg>
  </div>;
}

/** Per-round decision loss (drawn downward) next to signed dice luck. Two separate quantities. */
export function LossLuckChart({ label, unit, bars, selectedRound, change }: {
  label: string; unit: string; bars: RoundBar[]; selectedRound: number; change: (index: number) => void;
}) {
  const id = useId();
  if (!bars.some(({ loss, luck }) => loss !== null || luck !== null)) return <p className="review-no-data">{label} 값이 없어요.</p>;
  const span = Math.max(0.5, ...bars.map(({ loss, luck }) => Math.max(loss ?? 0, Math.abs(luck ?? 0))));
  const zero = (TOP + BOTTOM) / 2;
  const scale = (value: number) => (value / span) * (BOTTOM - TOP) / 2;
  const slot = (RIGHT - LEFT) / bars.length;
  const bar = Math.min(12, slot * 0.34);
  const keyboard = (event: KeyboardEvent<SVGGElement>, index: number | null) => {
    if ((event.key === "Enter" || event.key === " ") && index !== null) { event.preventDefault(); change(index); }
  };
  return <div className="review-chart review-bars" role="group" aria-label={label + " 그래프"}>
    <output>
      <span className="review-legend luck-plus"><i aria-hidden="true" />행운</span>
      <span className="review-legend luck-minus"><i aria-hidden="true" />불운</span>
      <span className="review-legend loss"><i aria-hidden="true" />판단 손실</span>
    </output>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id}>
      <title id={id}>{label}. 라운드마다 주사위 운(위·아래)과 판단 손실(아래)을 따로 표시해요. 단위 {unit}.</title>
      <text x={LEFT - 4} y={TOP + 3} textAnchor="end">+{span.toFixed(1)}</text>
      <text x={LEFT - 4} y={zero + 3} textAnchor="end">0</text>
      <text x={LEFT - 4} y={BOTTOM + 3} textAnchor="end">−{span.toFixed(1)}</text>
      <line className="review-gridline" x1={LEFT} x2={RIGHT} y1={zero} y2={zero} />
      {bars.map(({ round, loss, luck, index }, i) => {
        const cx = LEFT + slot * (i + 0.5);
        const luckHeight = luck === null ? 0 : scale(luck);
        return <g key={round} className={"review-bar" + (round === selectedRound ? " chosen" : "")}
          tabIndex={index === null ? undefined : 0} role={index === null ? undefined : "button"}
          aria-label={`${round}라운드 · 운 ${luck === null ? "미평가" : signed(luck) + unit} · 판단 손실 ${loss === null ? "미평가" : loss.toFixed(2) + unit}`}
          onClick={() => index !== null && change(index)} onKeyDown={(event) => keyboard(event, index)}>
          <rect className="review-bar-hit" x={cx - slot / 2} y={TOP} width={slot} height={BOTTOM - TOP} />
          {luck !== null && <rect className={luck >= 0 ? "luck-plus" : "luck-minus"} x={cx - bar - 1} width={bar}
            y={luck >= 0 ? zero - luckHeight : zero} height={Math.max(Math.abs(luckHeight), luck === 0 ? 0 : 0.8)} />}
          {loss !== null && <rect className="loss" x={cx + 1} width={bar} y={zero} height={Math.max(scale(loss), loss === 0 ? 0 : 0.8)} />}
          <text x={cx} y={H - 10} textAnchor="middle">{round}</text>
        </g>;
      })}
      <text className="review-axis" x={RIGHT} y={H - 1} textAnchor="end">라운드</text>
    </svg>
  </div>;
}
