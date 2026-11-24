import { useEffect, useMemo, useState } from "react";
import { MODELS, scaleCoins } from "../economy/models";
import { PERSONAS, ABUSE_VARIANTS } from "../economy/personas";
import { buildCatalog, CURVE_PRESETS, DEFAULT_CATALOG, RARITY_LABEL, RARITIES, type PriceTable, type SlotConfig } from "../economy/pricing";
import { DEFAULT_WIN_RATE, SOURCES, SOURCE_LABEL, simulateCohort, type Source } from "../economy/simulate";
import { summary } from "../economy/rng";
import { REJECTED_QUESTS, RANKED_IDEAS } from "../economy/content";
import "./economy-lab.css";

/**
 * 경제 연구실: precomputed economy-study results (scripts/economy/run-experiments.ts) plus a small
 * in-browser re-run of the same simulator. Research only — no currency is granted anywhere.
 */
type Lab = typeof import("../economy/data/lab-summary.json");
type Tab = "overview" | "models" | "personas" | "quests" | "prices" | "abuse" | "sensitivity" | "run";
const TABS: [Tab, string][] = [
  ["overview", "요약·추천"],
  ["models", "모델 비교"],
  ["personas", "사용자 유형"],
  ["quests", "퀘스트·업적"],
  ["prices", "가격·강화"],
  ["abuse", "어뷰징·서버"],
  ["sensitivity", "민감도"],
  ["run", "직접 실행"],
];
const RECOMMENDED = "M3";
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toLocaleString("ko-KR", { maximumFractionDigits: d }));
const sci = (x: number) => (x === 0 ? "0" : x >= 0.001 ? pct(x, 2) : x.toExponential(2).replace("e", "×10^"));
const horizonLabel = (h: number) => (h < 365 ? `${h}일` : `${Math.round(h / 365)}년`);
const SHADES = ["#202020", "#d93636", "#6b6b6b", "#a92323", "#9a9a9a", "#e88a8a", "#444444", "#c4c4c4"];

function Bars({ rows, max, format = (v: number) => num(v), highlight }: { rows: { label: string; value: number }[]; max?: number; format?: (v: number) => string; highlight?: string }) {
  const m = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <div className="econ-bars">
      {rows.map((r) => (
        <div className="econ-bar" key={r.label}>
          <span>{r.label}</span>
          <div>
            <i style={{ width: `${Math.max(0, Math.min(100, (r.value / m) * 100))}%` }} className={r.label === highlight ? "hot" : ""} />
          </div>
          <b>{format(r.value)}</b>
        </div>
      ))}
    </div>
  );
}

function LineChart({ xs, series, log = false, yFormat = (v: number) => num(v), height = 200, xFormat = (v: number) => String(v), label }: { xs: number[]; series: { name: string; ys: number[]; hot?: boolean }[]; log?: boolean; yFormat?: (v: number) => string; height?: number; xFormat?: (v: number) => string; label: string }) {
  const W = 560, H = height, L = 56, R = 10, T = 10, B = 26;
  const all = series.flatMap((s) => s.ys).filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (!all.length) return <p className="econ-muted">데이터 없음</p>;
  let lo = log ? Math.min(...all) : Math.min(0, ...all), hi = Math.max(...all);
  if (hi === lo) hi = lo + 1;
  const f = (v: number) => (log ? Math.log10(v) : v);
  const y = (v: number) => T + (H - T - B) * (1 - (f(v) - f(lo)) / (f(hi) - f(lo)));
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, xs.length - 1);
  const ticks = log ? Array.from({ length: Math.floor(Math.log10(hi)) - Math.ceil(Math.log10(lo)) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(lo)) + i)).filter((_, i, a) => a.length < 8 || i % 2 === 0) : [lo, (lo + hi) / 2, hi];
  return (
    <figure className="econ-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end">{yFormat(t)}</text>
          </g>
        ))}
        {xs.map((v, i) => (xs.length <= 12 || i % Math.ceil(xs.length / 10) === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{xFormat(v)}</text> : null))}
        {series.map((s, k) => (
          <polyline key={s.name} fill="none" strokeWidth={s.hot ? 2.6 : 1.6} stroke={s.hot ? "#d93636" : SHADES[(k * 2) % SHADES.length === 1 ? 0 : (k * 2) % SHADES.length]} strokeDasharray={k % 3 === 1 && !s.hot ? "5 3" : k % 3 === 2 && !s.hot ? "2 3" : undefined} points={s.ys.map((v, i) => (Number.isFinite(v) && (!log || v > 0) ? `${x(i)},${y(v)}` : "")).filter(Boolean).join(" ")} />
        ))}
      </svg>
      <figcaption>
        {series.map((s, k) => (
          <span key={s.name} className={s.hot ? "hot" : ""}>
            <i style={{ background: s.hot ? "#d93636" : SHADES[(k * 2) % SHADES.length === 1 ? 0 : (k * 2) % SHADES.length] }} />
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export default function EconomyLab() {
  const [lab, setLab] = useState<Lab | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  useEffect(() => {
    import("../economy/data/lab-summary.json").then((m) => setLab(m.default as Lab), (e) => setError(String(e)));
  }, []);
  return (
    <section className="econ-lab" aria-labelledby="econ-title">
      <div className="lab-hub-heading">
        <h1 id="econ-title">경제 연구실</h1>
        <p>코인·보석 경제 후보 모델을 실제 게임 데이터 기반 시뮬레이션으로 비교해요. 연구용이며 실제 재화·결제는 없어요.</p>
      </div>
      <div className="econ-tabs" role="tablist" aria-label="경제 연구 항목">
        {TABS.map(([id, text]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {text}
          </button>
        ))}
      </div>
      {error && <p className="econ-muted">결과를 불러오지 못했어요: {error}</p>}
      {!lab && !error && <p className="econ-muted" role="status">결과를 불러오는 중…</p>}
      {lab && (
        <div role="tabpanel" data-testid="econ-panel">
          {tab === "overview" && <Overview lab={lab} />}
          {tab === "models" && <Models lab={lab} />}
          {tab === "personas" && <Personas lab={lab} />}
          {tab === "quests" && <Quests lab={lab} />}
          {tab === "prices" && <Prices lab={lab} />}
          {tab === "abuse" && <Abuse lab={lab} />}
          {tab === "sensitivity" && <Sensitivity lab={lab} />}
          {tab === "run" && <RunSim lab={lab} />}
        </div>
      )}
    </section>
  );
}

type Grid = Record<string, Record<string, { sources: { coins: Record<string, number>; gems: Record<string, number> }; h: Record<string, Record<string, unknown>> }>>;
const cell = (lab: Lab, model: string, persona: string, h: number) => (lab.grid as unknown as Grid)[model]?.[persona]?.h[String(h)] as
  | { coinsPerDay: { median: number; p10: number; p90: number; min: number; mean: number }; gemsPerDay: { median: number; p10: number; p90: number; mean: number }; balanceCoins: { median: number; p90: number; max: number }; balanceGems: { median: number }; rarityReach: number[]; rarityDaysMedian: number[]; maxUpgradeReach: number; mythicMaxReach: number; giniBalance: number }
  | undefined;

function Overview({ lab }: { lab: Lab }) {
  const H = lab.generated.horizons.includes(365) ? 365 : lab.generated.horizons[lab.generated.horizons.length - 1];
  const reg = cell(lab, RECOMMENDED, "regular", H), heavy = cell(lab, RECOMMENDED, "heavy", 180) ?? cell(lab, RECOMMENDED, "heavy", H);
  const bot = lab.abuse.find((a) => a.model === RECOMMENDED)?.variants;
  const pop = lab.population.M3.steadyState;
  return (
    <div className="econ-grid">
      <article className="econ-card wide">
        <h2>추천: M3 혼합·소프트캡</h2>
        <p>경기 완료·승리 보상 + 일일/주간 퀘스트 + 일회성 업적 보석. 하루 10번째 보상 경기 이후 경기 코인은 25%로 줄고(차단 아님), 친구 대전은 승리 보상이 없으며 하루 10경기까지만 보상해요. 공식 재화는 서버 검증 기록에만 지급하고 로컬 AI·로컬 2인·게스트 기록에는 지급하지 않아요.</p>
        <dl className="econ-kpis">
          <div><dt>일반 유저 코인/일(중앙값)</dt><dd>{num(reg?.coinsPerDay.median)}</dd></div>
          <div><dt>일반 유저 보석/일(중앙값)</dt><dd>{num(reg?.gemsPerDay.median, 2)}</dd></div>
          <div><dt>일반 유저 1년 내 신화 획득(무과금)</dt><dd>{pct(reg?.rarityReach[4])}</dd></div>
          <div><dt>헤비 유저 6개월 내 신화 획득(무과금)</dt><dd>{pct(heavy?.rarityReach[4])}</dd></div>
          <div><dt>서버 AI 봇 / 헤비 유저 30일 코인</dt><dd>{bot ? `${num(bot[0]?.ratioVsHeavy, 2)}배` : "—"}</dd></div>
          <div><dt>로컬 기록 위조 / 헤비 유저 30일 코인</dt><dd>{bot ? `${num(bot.find((b) => b.id === "abuse_forge_local")?.ratioVsHeavy, 2)}배` : "—"}</dd></div>
          <div><dt>행 쓰기 사용률(신규 30명/일, 현재 방 구조)</dt><dd>{pct(pop.rowUtil, 1)}</dd></div>
          <div><dt>Workers Paid 추정(일부 단가 미확인)</dt><dd>${num(pop.paidUsdPerMonth, 2)}/월</dd></div>
        </dl>
        <p className="econ-muted">코인 단위는 추상 단위로, 일반 유저(로그인·무과금)의 1년 중앙 획득량이 하루 {lab.coinUnit}코인이 되도록 모든 모델을 정규화했어요. 보석 1개 ≈ {num(lab.gemValue, 0)}코인(획득 시간 동등). 시드 {lab.generated.seed}, 유형당 {lab.generated.usersPerPersona}명, 실행 {lab.generated.runtimeSeconds}초{lab.generated.quick ? " (빠른 모드)" : ""}.</p>
      </article>
      <article className="econ-card">
        <h2>권장 가격(코인 기준, 범위)</h2>
        <table className="econ-table">
          <thead><tr><th>등급</th><th>코인</th><th>보석</th><th>목표(일반 유저)</th></tr></thead>
          <tbody>
            <tr><td>기본</td><td colSpan={3}>무료 기본 지급</td></tr>
            {lab.priceRanges.map((p) => (
              <tr key={p.rarity}><td>{p.label}</td><td>{num(p.coin.low)}~{num(p.coin.high)}</td><td>{num(p.gem.low)}~{num(p.gem.high)}</td><td>{p.targetDaysCoin}일 / {p.targetDaysGem}일</td></tr>
            ))}
            <tr><td>특수</td><td colSpan={3}>업적 전용 — 구매 불가</td></tr>
          </tbody>
        </table>
      </article>
      <article className="econ-card">
        <h2>등급별 첫 획득까지(일반 유저, 무과금, 중앙값)</h2>
        <Bars rows={RARITIES.map((r, k) => ({ label: RARITY_LABEL[r], value: reg?.rarityDaysMedian[k] ?? NaN }))} format={(v) => (Number.isFinite(v) ? `${num(v)}일` : "미달")} />
      </article>
    </div>
  );
}

function Models({ lab }: { lab: Lab }) {
  const [h, setH] = useState<number>(lab.generated.horizons.includes(365) ? 365 : lab.generated.horizons[0]);
  const [persona, setPersona] = useState("heavy");
  const models = lab.models;
  return (
    <div className="econ-stack">
      <div className="econ-controls">
        <label>기간 <select value={h} onChange={(e) => setH(Number(e.target.value))}>{lab.generated.horizons.map((x) => <option key={x} value={x}>{horizonLabel(x)}</option>)}</select></label>
        <label>사용자 유형 <select value={persona} onChange={(e) => setPersona(e.target.value)}>{lab.personas.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      </div>
      <table className="econ-table" data-testid="econ-model-table">
        <thead><tr><th>모델</th><th>코인/일 중앙(p10~p90)</th><th>보석/일</th><th>잔액 중앙</th><th>신화 획득</th><th>최대 강화</th><th>잔액 지니</th></tr></thead>
        <tbody>
          {models.map((m) => {
            const c = cell(lab, m.id, persona, h);
            return (
              <tr key={m.id} className={m.id === RECOMMENDED ? "hot" : m.counterfactual ? "muted" : ""}>
                <td>{m.label}</td>
                <td>{num(c?.coinsPerDay.median)} ({num(c?.coinsPerDay.p10)}~{num(c?.coinsPerDay.p90)})</td>
                <td>{num(c?.gemsPerDay.median, 2)}</td>
                <td>{num(c?.balanceCoins.median)}</td>
                <td>{pct(c?.rarityReach[4])}</td>
                <td>{pct(c?.maxUpgradeReach)}</td>
                <td>{num(c?.giniBalance, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="econ-grid">
        <article className="econ-card">
          <h2>헤비 ÷ 라이트 코인 격차({horizonLabel(h)})</h2>
          <Bars rows={models.map((m) => ({ label: m.label, value: (cell(lab, m.id, "heavy", h)?.coinsPerDay.median ?? 0) / Math.max(1e-9, cell(lab, m.id, "light", h)?.coinsPerDay.median ?? 1) }))} format={(v) => `${v.toFixed(1)}배`} highlight={models.find((m) => m.id === RECOMMENDED)?.label} />
        </article>
        <article className="econ-card">
          <h2>코인 수급처 비중(일반 유저)</h2>
          {models.filter((m) => !m.counterfactual).map((m) => {
            const s = (lab.grid as unknown as Grid)[m.id].regular.sources.coins;
            return (
              <div key={m.id} className="econ-stacked" aria-label={`${m.label} 수급처`}>
                <span>{m.id}</span>
                <div>{SOURCES.map((src, k) => (s[src] > 0.005 ? <i key={src} title={`${SOURCE_LABEL[src]} ${pct(s[src])}`} style={{ width: pct(s[src], 1), background: SHADES[k % SHADES.length] }} /> : null))}</div>
              </div>
            );
          })}
          <p className="econ-legend">{SOURCES.slice(0, 7).map((src, k) => <span key={src}><i style={{ background: SHADES[k % SHADES.length] }} />{SOURCE_LABEL[src]}</span>)}</p>
        </article>
      </div>
      <ul className="econ-notes">{models.map((m) => <li key={m.id}><b>{m.label}</b> — {m.summary}</li>)}</ul>
    </div>
  );
}

function Personas({ lab }: { lab: Lab }) {
  const [model, setModel] = useState(RECOMMENDED);
  const hs = lab.generated.horizons;
  const ps = lab.personas.filter((p) => p.abuse === "none");
  return (
    <div className="econ-stack">
      <div className="econ-controls">
        <label>모델 <select value={model} onChange={(e) => setModel(e.target.value)}>{lab.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      </div>
      <LineChart label="기간별 신화 획득 비율" xs={hs} xFormat={horizonLabel} yFormat={(v) => pct(v)} series={ps.map((p) => ({ name: p.label, ys: hs.map((h) => cell(lab, model, p.id, h)?.rarityReach[4] ?? NaN), hot: p.id === "regular" }))} />
      <table className="econ-table">
        <thead><tr><th>유형</th><th>일/주/월 코인(중앙)</th><th>최악(최소)/일</th><th>보석/월</th><th>1년 잔액 중앙·p90</th><th>신화</th><th>최대 강화</th></tr></thead>
        <tbody>
          {lab.personas.map((p) => {
            const c = cell(lab, model, p.id, hs.includes(365) ? 365 : hs[hs.length - 1]);
            const d = c?.coinsPerDay.median ?? NaN;
            return (
              <tr key={p.id} className={p.abuse !== "none" ? "muted" : ""}>
                <td>{p.label}</td>
                <td>{num(d)} / {num(d * 7)} / {num(d * 30)}</td>
                <td>{num(c?.coinsPerDay.min)}</td>
                <td>{num((c?.gemsPerDay.median ?? NaN) * 30, 1)}</td>
                <td>{num(c?.balanceCoins.median)} · {num(c?.balanceCoins.p90)}</td>
                <td>{pct(c?.rarityReach[4])}</td>
                <td>{pct(c?.maxUpgradeReach)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="econ-muted">모든 사용자 유형 수치(접속 빈도·경기 수·승률·소비 성향·결제 전환)는 실제 데이터가 없는 가정이에요. 민감도 탭에서 주요 가정을 바꾼 결과를 볼 수 있어요.</p>
    </div>
  );
}

function Quests({ lab }: { lab: Lab }) {
  const [tier, setTier] = useState("intermediate");
  const groups: Record<string, string> = { cumulative: "누적", skill: "실력", luck: "행운", special: "특수(극희귀)", collection: "수집·장기" };
  const r = lab.rare;
  const tailX = [150, 180, 200, 220, 250, 270, 280, 290, 300, 310, 320, 323];
  return (
    <div className="econ-stack">
      <div className="econ-controls">
        <label>실력 단계 <select value={tier} onChange={(e) => setTier(e.target.value)}>{lab.tiers.map((t) => <option key={t.id} value={t.id}>{t.label} (평균 {num(t.mean, 1)}점)</option>)}</select></label>
      </div>
      <h2>퀘스트 후보 — 달성 확률(일반 유저의 하루/주/월 경기 수 기준)</h2>
      <table className="econ-table">
        <thead><tr><th>퀘스트</th><th>주기·난이도</th><th>경기당 확률</th><th>기대 경기 수</th><th>기간 내 달성 확률</th></tr></thead>
        <tbody>
          {lab.quests.map((q) => {
            const t = (q.byTier as Record<string, { pPerMatch: number; expectedMatches: number; completionProb: number }>)[tier];
            return <tr key={q.id}><td>{q.label}</td><td>{({ daily: "일일", weekly: "주간", monthly: "월간" } as Record<string, string>)[q.period]} · {["쉬움", "보통", "어려움"][q.difficulty]}</td><td>{pct(t.pPerMatch, 1)}</td><td>{num(t.expectedMatches, 1)}</td><td>{pct(t.completionProb)}</td></tr>;
          })}
        </tbody>
      </table>
      <h2>업적 후보</h2>
      <table className="econ-table">
        <thead><tr><th>업적</th><th>분류</th><th>경기당 확률</th><th>기대 경기 수</th><th>난이도</th><th>보석(제안)</th><th>1년 달성(일반/헤비)</th></tr></thead>
        <tbody>
          {lab.achievements.map((a) => {
            const E = (a.expectedMatches as Record<string, number>)[tier];
            const p = (a.pPerMatch as Record<string, number | null>)[tier];
            return (
              <tr key={a.id} className={a.symbolic ? "hot" : ""}>
                <td>{a.label}{a.note ? <small> — {a.note}</small> : null}</td>
                <td>{groups[a.group]}</td>
                <td>{p === null ? "—" : sci(p)}</td>
                <td>{E === null || !Number.isFinite(E) ? "∞(관측 불가)" : E > 1e6 ? E.toExponential(1) : num(E)}</td>
                <td>{a.bandLabel}</td>
                <td>{a.symbolic ? `${a.rewardGems} + 특수 아이템` : a.rewardGems}</td>
                <td>{pct(a.unlock1y.regular)} / {pct(a.unlock1y.heavy)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="econ-grid">
        <article className="econ-card">
          <h2>DP Expert 최종 점수 꼬리 확률(정확 계산)</h2>
          <LineChart label="점수 이상일 확률 로그 그래프" log xs={tailX} yFormat={(v) => v.toExponential(0)} series={[{ name: "P(총점 ≥ x)", ys: tailX.map((x) => (r.exactTail as Record<string, number>)[String(x)]), hot: true }]} />
          <p className="econ-muted">마르코프 연쇄 역방향 전파로 계산한 정확 분포. 평균 {num(r.exactCheck.mean, 6)} = DP 테이블 {num(r.exactCheck.dpTableValue, 6)} (오차 {r.exactCheck.absError.toExponential(1)}).</p>
        </article>
        <article className="econ-card">
          <h2>희귀 사건 정확값</h2>
          <table className="econ-table compact">
            <tbody>
              <tr><td>첫 굴림 요트(굴림당)</td><td>{sci(r.exact.firstRollYacht.perRoll)}</td></tr>
              <tr><td>한 경기 첫 굴림 요트 ≥1 / ≥2 / ≥3</td><td>{sci(r.exact.firstRollYacht.perGameAtLeast1)} / {sci(r.exact.firstRollYacht.perGameAtLeast2)} / {sci(r.exact.firstRollYacht.perGameAtLeast3)}</td></tr>
              <tr><td>한 턴 요트(최적)</td><td>{sci(r.exact.turnYachtOptimal)}</td></tr>
              <tr><td>323점 완벽 경기(목표 최적 / DP Expert)</td><td>{sci(r.exact.perfectGame323)} / {sci((r.exactTail as Record<string, number>)["323"])}</td></tr>
              <tr><td>상단 105점 완벽(목표 최적)</td><td>{sci(r.exact.perfectUpper105)}</td></tr>
              <tr><td>0점 칸 없는 경기(목표 최적)</td><td>{sci(r.exact.noZeroGameOptimal)}</td></tr>
              <tr><td>DP Expert 대 DP Expert 무승부</td><td>{sci(r.headToHead.draw)}</td></tr>
              <tr><td>100점 이상 차이 승리(DP Expert 동급)</td><td>{sci((r.headToHead.winByAtLeast as Record<string, number>)["100"])}</td></tr>
            </tbody>
          </table>
        </article>
      </div>
      <article className="econ-card">
        <h2>제외한 퀘스트 유형</h2>
        <ul className="econ-notes">{REJECTED_QUESTS.map((q) => <li key={q.label}><b>{q.label}</b> — {q.reason}</li>)}</ul>
        <h2>향후 랭크 업적(분석만)</h2>
        <ul className="econ-notes">{RANKED_IDEAS.map((q) => <li key={q.label}><b>{q.label}</b> — {q.condition} · {q.difficulty} · {q.reward}</li>)}</ul>
      </article>
    </div>
  );
}

function Prices({ lab }: { lab: Lab }) {
  const ct = lab.curves.curveTable;
  return (
    <div className="econ-stack">
      <table className="econ-table">
        <thead><tr><th>등급</th><th>코인 가격(범위)</th><th>보석 가격(범위)</th><th>일반 유저 일수(코인/보석)</th><th>헤비 일수</th><th>라이트 일수</th></tr></thead>
        <tbody>
          {lab.priceRanges.map((p) => {
            const d = p.daysByPersona as Record<string, { coinDays: number; gemDays: number }>;
            return <tr key={p.rarity}><td>{p.label}</td><td>{num(p.coin.mid)} ({num(p.coin.low)}~{num(p.coin.high)})</td><td>{num(p.gem.mid)} ({num(p.gem.low)}~{num(p.gem.high)})</td><td>{num(d.regular.coinDays)} / {num(d.regular.gemDays)}</td><td>{num(d.heavy.coinDays)} / {num(d.heavy.gemDays)}</td><td>{num(d.light.coinDays)} / {num(d.light.gemDays)}</td></tr>;
          })}
        </tbody>
      </table>
      <div className="econ-grid">
        <article className="econ-card">
          <h2>슬롯 확장(영구)</h2>
          <table className="econ-table compact">
            <thead><tr><th>추가 슬롯</th><th>이모티콘(4→8)</th><th>채팅(6→10)</th></tr></thead>
            <tbody>{lab.slots.costs.map((c, i) => <tr key={i}><td>{i + 1}번째</td><td>{num(c)} 코인 또는 {num(lab.slots.gemCosts[i])} 보석</td><td>{lab.slots.chatBase + i + 1}번째 칸 · 같은 가격</td></tr>)}</tbody>
          </table>
        </article>
        <article className="econ-card">
          <h2>상징적 초고가 아이템</h2>
          <p><b>{num(lab.symbolic.coinPrice)}</b> 코인 — 극단적 헤비 {num(lab.symbolic.daysFor.extreme)}일, 헤비 {num(lab.symbolic.daysFor.heavy)}일, 일반 {num(lab.symbolic.daysFor.regular)}일.</p>
          <p className="econ-muted">{lab.symbolic.note}</p>
        </article>
      </div>
      <h2>강화 비용 곡선 비교 (기준 = 아이템 가격 × 0.5)</h2>
      <LineChart label="신화 아이템 단계별 강화 비용" xs={[1, 2, 3, 4]} xFormat={(v) => `Lv${v}→${v + 1}`} log yFormat={(v) => num(v)} series={ct.map((c) => ({ name: c.label, ys: c.extendedTo5[4], hot: c.curve === "exponential" }))} />
      <table className="econ-table">
        <thead><tr><th>곡선</th><th>기준 비율</th><th>신화 Lv1→2 / Lv2→3</th><th>일반 유저 1년 최대 강화</th><th>헤비 1년 신화 최대 강화</th><th>헤비 지출 중 강화 비중</th></tr></thead>
        <tbody>
          {lab.curves.curveRuns.map((c, i) => {
            const reg = c.regular as { maxUpgradeReach1y: number }, hv = c.heavy as { mythicMaxReach1y: number; upgradeShareOfSpend: number };
            return <tr key={i} className={c.curve === "exponential" && c.baseFraction === 0.5 ? "hot" : ""}><td>{ct.find((x) => x.curve === c.curve)?.label}</td><td>{c.baseFraction}</td><td>{(c.costsMythic as number[]).map((x) => num(x)).join(" / ")}</td><td>{pct(reg.maxUpgradeReach1y)}</td><td>{pct(hv.mythicMaxReach1y)}</td><td>{pct(hv.upgradeShareOfSpend)}</td></tr>;
          })}
        </tbody>
      </table>
      <p className="econ-muted">현재 최대 Lv.3(강화 2단계)만 가정. 그래프의 Lv3→4, Lv4→5는 향후 확장 시 곡선 모양 비교용이에요. 강화는 순수 외형이며 승패에 영향이 없어야 해요(Pay to Win 금지).</p>
    </div>
  );
}

function Abuse({ lab }: { lab: Lab }) {
  const pop = lab.population;
  const weeks = pop.M3.weekly.dau.map((_, i) => i);
  return (
    <div className="econ-stack">
      <h2>어뷰징 초과 획득(30일, 헤비 유저 중앙값 대비 배수)</h2>
      <table className="econ-table">
        <thead><tr><th>모델</th>{lab.abuse[0].variants.map((v) => <th key={v.id}>{v.label}</th>)}</tr></thead>
        <tbody>{lab.abuse.map((a) => <tr key={a.model} className={a.model === RECOMMENDED ? "hot" : a.model === "M0" ? "muted" : ""}><td>{lab.models.find((m) => m.id === a.model)?.label}</td>{a.variants.map((v) => <td key={v.id}>{num(v.ratioVsHeavy, 2)}배 <small>({num(v.hoursPerDay, 0)}시간/일)</small></td>)}</tr>)}</tbody>
      </table>
      <p className="econ-muted">다중 계정: 신규 보상은 계정에 묶이고 선물·거래·교환이 없어 다른 계정으로 옮길 수 없어요(가치 이전 불가). 로컬 기록 위조는 서버 검증이 아니므로 M0(반례) 외에는 0이에요.</p>
      <div className="econ-grid">
        <article className="econ-card">
          <h2>모집단(하루 신규 30명, M3) — DAU와 경기</h2>
          <LineChart label="주별 DAU와 서버 경기" xs={weeks} xFormat={(w) => `${w}주`} series={[{ name: "DAU", ys: pop.M3.weekly.dau, hot: true }, { name: "서버 검증 플레이어-경기/일", ys: pop.M3.weekly.serverMatches }]} />
        </article>
        <article className="econ-card">
          <h2>누적 미사용 잔액(전체 서비스)</h2>
          <LineChart label="주별 누적 잔액" xs={pop.M3.outstandingCoins.map((_, i) => i)} xFormat={(w) => `${w}주`} series={[{ name: "코인 잔액 합계", ys: pop.M3.outstandingCoins, hot: true }, { name: "보석 잔액 × 보석가치", ys: pop.M3.outstandingGems.map((g) => g * lab.gemValue) }]} />
        </article>
      </div>
      <h2>Cloudflare 무료 플랜(행 쓰기 10만/일, 공유 계정 70% 가정)</h2>
      <table className="econ-table">
        <thead><tr><th>하루 신규 사용자</th><th>DAU(정상 상태)</th><th>플레이어-경기/일</th><th>행 쓰기/일</th><th>경제 없이</th><th>AI 대전을 방 방식으로</th><th>행 쓰기 사용률</th><th>Paid 추정/월</th></tr></thead>
        <tbody>{pop.scale.map((s) => <tr key={s.arrivals} className={s.rowUtil > 1 ? "hot" : ""}><td>{s.arrivals}</td><td>{num(s.dau)}</td><td>{num(s.matchesPerDay)}</td><td>{num(s.rowWritesPerDay)}</td><td>{num(s.rowWritesNoEconomy)}</td><td>{num(s.rowWritesRoomAI)}</td><td>{pct(s.rowUtil, 1)}</td><td>${num(s.paidUsdPerMonth, 2)}</td></tr>)}</tbody>
      </table>
      <p className="econ-muted">쓰기 수는 설계 추정치(온라인 방 경기당 약 120, 경제 처리 보상 경기당 3, 구매 3). 서버 AI 대전은 서명 기록 방식(종료 시 1회 기록) 기준이고, 방 방식이면 AI 경기도 약 120회가 필요해요. Paid 가격은 이 세션에서 공식 확인하지 않은 값이에요.</p>
    </div>
  );
}

function Sensitivity({ lab }: { lab: Lab }) {
  return (
    <div className="econ-stack">
      <table className="econ-table" data-testid="econ-sensitivity">
        <thead><tr><th>가정</th><th>값</th><th>일반 6개월 신화</th><th>일반 1년 신화</th><th>헤비 6개월 신화</th><th>라이트 1년 신화</th><th>비정기 1년 신화</th><th>일반 코인/일</th><th>일반 보석/일</th></tr></thead>
        <tbody>{lab.sensitivity.map((s, i) => <tr key={i} className={i === 0 ? "hot" : ""}><td>{s.param}</td><td>{s.value}</td><td>{pct(s.regMythic6m)}</td><td>{pct(s.regMythic1y)}</td><td>{pct(s.heavyMythic6m)}</td><td>{pct(s.lightMythic1y)}</td><td>{pct(s.casualMythic1y)}</td><td>{num(s.regCoinsPerDay)}</td><td>{num(s.regGemsPerDay, 2)}</td></tr>)}</tbody>
      </table>
      <h2>결제의 영향(1년)</h2>
      <table className="econ-table">
        <thead><tr><th>유형</th><th>보유 아이템(결제)</th><th>같은 사람 무과금</th><th>첫 신화(결제/무과금)</th><th>보석 중 결제 비중</th></tr></thead>
        <tbody>{lab.payment.map((p) => <tr key={p.persona}><td>{lab.personas.find((x) => x.id === p.persona)?.label}</td><td>{num(p.paidOwned1y.median)}</td><td>{num(p.f2pOwned1y.median)}</td><td>{num(p.paidMythicDay)}일 / {p.f2pMythicDay > 365 ? "1년 내 미달" : `${num(p.f2pMythicDay)}일`}</td><td>{pct(p.paidGemShare)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function RunSim({ lab }: { lab: Lab }) {
  const [model, setModel] = useState(RECOMMENDED);
  const [persona, setPersona] = useState("regular");
  const [days, setDays] = useState(180);
  const [mult, setMult] = useState(1);
  const [softCap, setSoftCap] = useState(10);
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<null | { coins: ReturnType<typeof summary>; gems: ReturnType<typeof summary>; mythic: number; legendary: number; sources: Record<Source, number>; ms: number }>(null);
  const prices: PriceTable = lab.prices as PriceTable;
  const catalog = useMemo(() => buildCatalog(DEFAULT_CATALOG, prices, 400, lab.generated.seed), [prices, lab.generated.seed]);
  const run = () => {
    const base = MODELS.find((m) => m.id === model)!;
    const factor = lab.models.find((m) => m.id === model)!.factor * mult;
    const p = [...PERSONAS, ...ABUSE_VARIANTS].find((x) => x.id === persona)!;
    const t = performance.now();
    const us = simulateCohort({
      model: { ...scaleCoins(base, factor), softCapMatches: base.softCapMatches >= 1e9 ? base.softCapMatches : softCap },
      catalog, upgrade: CURVE_PRESETS[1], slots: lab.slots as SlotConfig, gemValueInCoins: lab.gemValue, winRate: DEFAULT_WIN_RATE,
      achievementGems: Object.fromEntries(lab.achievements.map((a) => [a.id, a.rewardGems])), spending: true, forceF2P: true, forceLoggedIn: true,
    }, p, 60, days, seed);
    const free = (u: (typeof us)[number], k: "coinsBySource" | "gemsBySource") => SOURCES.reduce((a, s) => a + (s === "purchase" ? 0 : u[k][s]), 0);
    const total = us.reduce((a, u) => a + free(u, "coinsBySource"), 0) || 1;
    setResult({
      coins: summary(us.map((u) => free(u, "coinsBySource") / days)), gems: summary(us.map((u) => free(u, "gemsBySource") / days)),
      mythic: us.filter((u) => u.firstRarityDay[4] >= 0).length / us.length, legendary: us.filter((u) => u.firstRarityDay[3] >= 0).length / us.length,
      sources: Object.fromEntries(SOURCES.map((s) => [s, us.reduce((a, u) => a + u.coinsBySource[s], 0) / total])) as Record<Source, number>, ms: performance.now() - t,
    });
  };
  return (
    <div className="econ-stack">
      <div className="econ-controls">
        <label>모델 <select value={model} onChange={(e) => setModel(e.target.value)}>{lab.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label>유형 <select value={persona} onChange={(e) => setPersona(e.target.value)}>{lab.personas.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>기간(일) <input type="number" min={7} max={365} value={days} onChange={(e) => setDays(Math.max(7, Math.min(365, Number(e.target.value) || 7)))} /></label>
        <label>코인 지급 배수 <input type="number" step={0.1} min={0.1} max={5} value={mult} onChange={(e) => setMult(Math.max(0.1, Math.min(5, Number(e.target.value) || 1)))} /></label>
        <label>소프트캡 경기 수 <input type="number" min={1} max={100} value={softCap} onChange={(e) => setSoftCap(Math.max(1, Math.min(100, Number(e.target.value) || 10)))} /></label>
        <label>시드 <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
        <button type="button" className="primary" onClick={run}>시뮬레이션 실행</button>
      </div>
      <p className="econ-muted">무과금·로그인 사용자 60명, 같은 시뮬레이터(src/economy/simulate.ts)를 브라우저에서 실행해요. 가격은 연구 결과의 기준 가격표를 써요.</p>
      {result && (
        <div className="econ-grid" data-testid="econ-run-result">
          <article className="econ-card">
            <h2>결과 ({num(result.ms)} ms)</h2>
            <dl className="econ-kpis">
              <div><dt>코인/일 중앙(p10~p90)</dt><dd>{num(result.coins.median)} ({num(result.coins.p10)}~{num(result.coins.p90)})</dd></div>
              <div><dt>보석/일 중앙</dt><dd>{num(result.gems.median, 2)}</dd></div>
              <div><dt>전설 획득</dt><dd>{pct(result.legendary)}</dd></div>
              <div><dt>신화 획득</dt><dd>{pct(result.mythic)}</dd></div>
            </dl>
          </article>
          <article className="econ-card">
            <h2>코인 수급처</h2>
            <Bars rows={SOURCES.filter((s) => result.sources[s] > 0).map((s) => ({ label: SOURCE_LABEL[s], value: result.sources[s] }))} max={1} format={(v) => pct(v)} />
          </article>
        </div>
      )}
    </div>
  );
}
