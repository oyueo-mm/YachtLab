import { useEffect, useState } from "react";

/** 경제 연구실 › 추가 검증 (scripts/economy/run-followup.ts results). Research only — no currency is granted. */
type F = typeof import("../economy/data/lab-followup.json");
const pct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${Math.round(x * 100)}%`);
const num = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toLocaleString("ko-KR", { maximumFractionDigits: d }));
const P: Record<string, string> = { occasional: "비정기", light: "라이트", regular: "일반", heavy: "헤비", extreme: "극단 헤비", saver: "저축형" };
const RAR = ["일반", "고급", "영웅", "전설", "신화"];

function Table({ head, rows, testId }: { head: string[]; rows: (string | number)[][]; testId?: string }) {
  return (
    <table className="econ-table" data-testid={testId}>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

export default function EconomyFollowup() {
  const [f, setF] = useState<F | null>(null);
  useEffect(() => void import("../economy/data/lab-followup.json").then((m) => setF(m.default as F)), []);
  if (!f) return <p className="econ-muted" role="status">추가 검증 결과를 불러오는 중…</p>;
  const H5 = f.generated.quick ? 730 : 1825;
  const d = (x: number) => (x > H5 ? "미달" : `${num(x)}일`);
  const I = f.integer;
  const ratios = f.F12.ratios as unknown as Record<string, { mythicDay: number; maxDay: number; maxReach3y: number; maxReach5y: number }>[];
  return (
    <div className="econ-stack" data-testid="econ-followup">
      <p className="econ-muted">정수 운영안 {I.model.id}: {I.model.summary} 기준 일반 유저 {num(I.refCoinsPerDay)}코인·{num(I.refGemsPerDay, 2)}보석/일. 코호트당 {f.generated.users}명, 시드 {f.generated.seeds.join("·")}{f.generated.quick ? " (빠른 모드)" : ""}. 사용자 행동은 가정이에요.</p>
      <h2>정수안 가격과 무과금 신화 획득</h2>
      <Table head={["등급", ...RAR]} rows={[["코인", ...I.prices.coin.map((x) => num(x))], ["보석", ...I.prices.gem.map((x) => num(x))]]} />
      <Table testId="econ-fu-integer" head={["유형", "코인/일", "보석/일", "신화 1년", "신화 3년", "신화 최대 강화(최장 기간)"]} rows={f.F1.rows.map((r) => [P[r.persona], num(r.coinsPerDay1y.median), num(r.gemsPerDay1y.median, 2), pct(r.mythic1y), pct(r.mythic3y), pct(r.mythicMax5y)])} />
      <h2>접속일당 경기 수</h2>
      <Table head={["경기/접속일", "코인/접속일", "코인/경기", "코인/시간", "일일 퀘스트 완료", "신화 1년"]} rows={f.F2.map((r) => [r.matchesPerActiveDay, num(r.coinsPerActiveDay), num(r.coinsPerMatch, 1), num(r.coinsPerHour7min), pct(r.dailyQuestAllShare), pct(r.mythic1y)])} />
      <h2>경기 시간(하루 플레이 시간 고정)</h2>
      <Table head={["분/경기", "유형", "코인/일", "코인/시간", "신화 1년"]} rows={f.F3.map((r) => [r.minutes, P[r.persona], num(r.coinsPerDay), num(r.coinsPerHour), pct(r.mythic1y)])} />
      <h2>연차별 반복 vs 일회성</h2>
      <Table head={["유형", "연차", "반복 코인", "일회성 코인", "반복 보석", "일회성 보석"]} rows={Object.entries(f.F4).flatMap(([pid, ys]) => (ys as { year: number; recurringCoins: number; oneTimeCoins: number; recurringGems: number; oneTimeGems: number }[]).map((y) => [P[pid], `${y.year}년차`, num(y.recurringCoins), num(y.oneTimeCoins), num(y.recurringGems), num(y.oneTimeGems)]))} />
      <h2>신규·지속·이탈</h2>
      <Table head={["구분", "사용자", "코인/생존일", "미사용 코인", "신화 보유"]} rows={Object.entries(f.F6).map(([k, v]) => [{ new: "신규", continuing: "지속", churned: "이탈" }[k as "new"], num(v.users), num(v.coinsPerDay.median), num(v.unspentCoins.median), pct(v.mythicShare)])} />
      <h2>독립 시드 안정성</h2>
      <Table head={["지표", "평균", "표준편차", "최소~최대"]} rows={Object.entries(f.F7.stats).map(([k, s]) => [k, num(s.mean, 3), num(s.sd, 3), `${num(s.min, 3)}~${num(s.max, 3)}`])} />
      <h2>승리 보너스 비율</h2>
      <Table head={["승리 보너스", "일반 코인/일", "강자÷약자", "서버 AI 봇÷헤비"]} rows={f.F8.map((r) => [`+${r.win} (${Math.round(r.winPct * 100)}%)`, num(r.regular.coinsPerDay), num(r.strongOverWeak, 3), num(r.botAIRatio, 2)])} />
      <h2>게스트 소급 후보</h2>
      <Table head={["후보", "14일 후 연결: 소급 코인", "60일 후 연결", "게스트 봇 60일"]} rows={f.F10.map((r) => [`${r.id} ${r.label}`, num(r.login14.carryCoins), num(r.login60.carryCoins), num(r.farmer60.carryCoins)])} />
      <h2>강화 비율 — 목표 저축형(신화 1개) vs 일반 구매형</h2>
      <Table testId="econ-fu-ratios" head={["비율", "신화 총비용", "목표형 일반: 신화·최대", "목표형 헤비: 신화·최대", "일반 구매형 일반: 최대 5년"]} rows={ratios.map((r) => [r.ratio as unknown as string, num(r.totalMythicCoins as unknown as number), `${d(r.focus_regular.mythicDay)} · ${d(r.focus_regular.maxDay)}`, `${d(r.focus_heavy.mythicDay)} · ${d(r.focus_heavy.maxDay)}`, pct(r.buyer_regular.maxReach5y)])} />
      <h2>상징적 초고가</h2>
      <Table head={["가격", ...Object.keys(f.F13[0].yearsF2P).map((p) => `${P[p]} 무과금`), "고액 결제"]} rows={f.F13.map((r) => [num(r.price), ...Object.values(r.yearsF2P).map((y) => `${num(y as number, 1)}년`), `${num(r.yearsBigPayerPurchaseOnly, 1)}년`])} />
      <h2>Cloudflare 무료 플랜 — 실측 기반 하루 PvP 경기 상한(무료 몫 70%)</h2>
      <Table head={["저장 설계", "경기당 쓰기", "경제 0", "경제 2/플레이어", "경제 3/플레이어"]} rows={f.F14.designs.map((dz) => [`${dz.id} ${dz.label}`, num(dz.writes, 1), ...[0, 2, 3].map((e) => num(f.F14.capacity.find((c) => c.design === dz.id && c.econWritesPerPlayerMatch === e && c.quotaShare === 0.7)?.pvpMatchesPerDay))])} />
    </div>
  );
}
