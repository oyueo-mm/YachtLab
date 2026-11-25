import { useId, type PointerEvent } from "react";
import type { Assessment } from "./model";
import { winLoss } from "./quality";

export const metrics = {
  win: { label: "승리점수율", unit: "%", value: (row: Assessment) => row.actual.winCredit === undefined ? undefined : row.actual.winCredit * 100 },
  score: { label: "기대 최종점수", unit: "점", value: (row: Assessment) => row.actual.expected },
  loss: { label: "행동별 가치 손실", unit: "점", value: (row: Assessment) => row.loss },
  winLoss: { label: "행동별 승리 가능성 손실", unit: "%p", value: winLoss },
  winLuck: { label: "승리점수율 기준 주사위 운", unit: "%p", value: (row: Assessment) => row.winLuck === undefined ? undefined : 100 * row.winLuck },
  luck: { label: "주사위 운", unit: "점", value: (row: Assessment) => row.luck },
};
export type Metric = keyof typeof metrics;

export function ReviewChart({ rows, rounds, metric, selected, change }: {
  rows: Assessment[]; rounds: number[]; metric: Metric; selected: number; change: (index: number) => void;
}) {
  const id = useId();
  const { label, unit, value } = metrics[metric];
  const points = rows.flatMap((row) => {
    const score = value(row);
    return score === undefined ? [] : [{ index: row.index, score, round: rounds[row.index] }];
  });
  if (!points.length) return <p className="review-no-data">{label} 데이터가 없어요.</p>;

  const current = points.find(({ index }) => index === selected);
  const min = metric === "win" ? 0 : Math.floor(Math.min(...points.map(({ score }) => score)));
  const max = metric === "win" ? 100 : Math.max(min + 1, Math.ceil(Math.max(...points.map(({ score }) => score))));
  const x = (index: number) => 40 + (index / Math.max(points.length - 1, 1)) * 345;
  const y = (score: number) => 112 - ((score - min) / (max - min)) * 94;

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = ((event.clientX - box.left) * 400 / box.width - 40) / 345;
    const index = Math.min(points.length - 1, Math.max(0, Math.round(fraction * (points.length - 1))));
    change(points[index].index);
  }

  return <div className="review-chart" role="group" aria-label={label + " 그래프"}>
    <output>{current ? `${current.round}라운드 · ${current.score.toFixed(2)}${unit}` : "선택한 행동의 데이터 없음"}</output>
    <svg viewBox="0 0 400 142" aria-labelledby={id} role="img" onPointerUp={pick}>
      <title id={id}>{label} 그래프. 타임라인에서도 행동을 선택할 수 있어요.</title>
      {[max, (min + max) / 2, min].map((tick) => <g key={tick}>
        <line className="review-gridline" x1="40" x2="385" y1={y(tick)} y2={y(tick)} />
        <text x="35" y={y(tick) + 3} textAnchor="end">{tick}{unit}</text>
      </g>)}
      <polyline className="review-line" points={points.map(({ score }, i) => `${x(i)},${y(score)}`).join(" ")} />
      {points.map(({ index, score, round }, i) => <g key={index}>
        <circle className={selected === index ? "chosen" : undefined} cx={x(i)} cy={y(score)} r={selected === index ? 5 : 2.5}>
          <title>{round}라운드 · {score.toFixed(2)}{unit}</title>
        </circle>
        {(i === 0 || i === points.length - 1) && <text x={x(i)} y="134" textAnchor="middle">{round}R</text>}
      </g>)}
    </svg>
    {metric === "loss" && rows.some((row) => (winLoss(row) ?? 0) > 0) && <small>승리 가능성 손실은 행동 상세에서 볼 수 있어요.</small>}
  </div>;
}
