import type { SoloStats } from "../solo/records";

const fmt = (v: number | null, digits = 1) => (v === null ? "—" : v.toFixed(digits));

/** Recent scores as a single line (one series, no legend; every point has a hover title). */
export function Trend({ points, best }: { points: SoloStats["recent"]; best: number | null }) {
  if (points.length < 2) return <p className="solo-empty">두 판 이상 플레이하면 최근 점수 흐름이 보여요.</p>;
  const w = 300, h = 96, pad = 8;
  const scores = points.map((p) => p.score);
  const lo = Math.min(...scores) - 10, hi = Math.max(...scores) + 10;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);
  return (
    <svg className="solo-trend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`최근 ${points.length}판 점수 흐름, 마지막 ${scores.at(-1)}점`}>
      {best !== null && best >= lo && best <= hi && <line className="solo-trend-best" x1={pad} x2={w - pad} y1={y(best)} y2={y(best)} />}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} />
      {points.map((p, i) => (
        <g key={i} className="solo-trend-dot">
          <circle cx={x(i)} cy={y(p.score)} r={10} className="hit" />
          <circle cx={x(i)} cy={y(p.score)} r={4} />
          <title>{new Date(p.at).toLocaleDateString("ko-KR")} · {p.score}점</title>
        </g>
      ))}
    </svg>
  );
}

export function Distribution({ rows }: { rows: SoloStats["distribution"] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ol className="solo-dist" aria-label="점수 분포">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}점: ${r.count}판`}>
          <span className="solo-dist-label">{r.label}</span>
          <span className="solo-dist-bar"><i style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <span className="solo-dist-count">{r.count}</span>
        </li>
      ))}
    </ol>
  );
}

/** Personal 1인 플레이 records: real numbers from stored games only (empty states say so). */
export function SoloStatsPanel({ stats, compact = false, syncNote }: { stats: SoloStats; compact?: boolean; syncNote?: string }) {
  return (
    <section className={"panel solo-stats" + (compact ? " compact" : "")} aria-label="1인 플레이 개인 기록">
      <h2>1인 플레이 기록</h2>
      {stats.plays === 0 ? (
        <p className="solo-empty">아직 완료한 1인 플레이가 없어요. 첫 판을 끝내면 최고 점수와 평균이 기록돼요.</p>
      ) : (
        <>
          <dl className="solo-kpis">
            <div><dt>최고</dt><dd>{stats.best}<small>점</small></dd></div>
            <div><dt>평균</dt><dd>{fmt(stats.average)}<small>점</small></dd></div>
            <div><dt>플레이</dt><dd>{stats.plays}<small>판</small></dd></div>
            {!compact && <div><dt>최근 10판 평균</dt><dd>{fmt(stats.recentAverage)}<small>{stats.recentAverage === null ? "" : "점"}</small></dd></div>}
            {!compact && <div><dt>요트 달성</dt><dd>{stats.yachts}<small>판</small></dd></div>}
            {!compact && <div><dt>상단 보너스</dt><dd>{stats.bonusRate === null ? "—" : Math.round(stats.bonusRate * 100)}<small>%</small></dd></div>}
          </dl>
          <h3>최근 점수</h3>
          <Trend points={stats.recent} best={stats.best} />
          {!compact && <>
            <h3>점수 분포</h3>
            <Distribution rows={stats.distribution} />
          </>}
        </>
      )}
      {syncNote && <p className="solo-sync-note">{syncNote}</p>}
      <p className="solo-trust">이 기기에서 기록한 개인 기록이에요. 공식 랭킹·보상에는 쓰지 않아요.</p>
    </section>
  );
}
