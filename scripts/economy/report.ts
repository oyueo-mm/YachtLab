/**
 * Builds docs/economy/RESULTS-GENERATED.md and docs/economy/figures/*.svg from docs/economy/results/*.json.
 * Usage: npx tsx scripts/economy/report.ts   (run after run-experiments.ts)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const R = (n: string) => JSON.parse(readFileSync(`docs/economy/results/${n}.json`, "utf8"));
const full = R("full-runs"), abuse = R("abuse"), sens = R("sensitivity"), pay = R("payment"), curves = R("upgrade-curves"), pop = R("population"), prices = R("prices"), quests = R("quests"), ach = R("achievements"), norm = R("normalization");
const lab = JSON.parse(readFileSync("src/economy/data/lab-summary.json", "utf8"));
const me = JSON.parse(readFileSync("src/economy/data/match-events.json", "utf8"));
const rare = JSON.parse(readFileSync("src/economy/data/rare-events.json", "utf8"));
const pmf = JSON.parse(readFileSync("src/economy/data/exact-score-pmf.json", "utf8"));
mkdirSync("docs/economy/figures", { recursive: true });

const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const sci = (x: number) => (x === 0 ? "0" : x >= 1e-3 ? pct(x, 2) : x.toExponential(2));
const table = (head: string[], rows: (string | number)[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const H = (h: number) => (h < 365 ? `${h}일` : `${Math.round(h / 365)}년`);
const personas: { id: string; label: string }[] = lab.personas;
const models: { id: string; label: string; counterfactual: boolean; factor: number; gemsPerDay: number }[] = lab.models;
const horizons: number[] = full.horizons;
const c = (m: string, p: string, h: number) => full.full[m][p].horizons[String(h)];
const RARITY = ["일반", "고급", "영웅", "전설", "신화"];

// ---------- SVG helpers (achromatic + red) ----------
const COLORS = ["#202020", "#d93636", "#6b6b6b", "#a92323", "#9a9a9a", "#e88a8a", "#444444", "#c4c4c4", "#7a1a1a", "#bbbbbb"];
function lineSvg(title: string, xs: number[], series: { name: string; ys: number[] }[], opts: { log?: boolean; xLabel?: (x: number) => string; yLabel?: (y: number) => string } = {}) {
  const W = 760, Ht = 360, L = 70, Rr = 180, T = 34, B = 34;
  const all = series.flatMap((s) => s.ys).filter((v) => Number.isFinite(v) && (!opts.log || v > 0));
  let lo = opts.log ? Math.min(...all) : Math.min(0, ...all), hi = Math.max(...all);
  if (hi === lo) hi = lo + 1;
  const f = (v: number) => (opts.log ? Math.log10(v) : v);
  const y = (v: number) => T + (Ht - T - B) * (1 - (f(v) - f(lo)) / (f(hi) - f(lo)));
  const x = (i: number) => L + ((W - L - Rr) * i) / Math.max(1, xs.length - 1);
  const ticks = opts.log ? Array.from({ length: Math.floor(Math.log10(hi)) - Math.ceil(Math.log10(lo)) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(lo)) + i)) : [lo, lo + (hi - lo) / 4, lo + (hi - lo) / 2, lo + (3 * (hi - lo)) / 4, hi];
  const yl = opts.yLabel ?? ((v: number) => num(v, 2));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" font-family="sans-serif" font-size="11"><rect width="100%" height="100%" fill="#fff"/><text x="${L}" y="20" font-size="14" font-weight="bold" fill="#202020">${title}</text>`];
  for (const t of ticks) parts.push(`<line x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e5e5"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" fill="#6b6b6b">${yl(t)}</text>`);
  xs.forEach((v, i) => parts.push(`<text x="${x(i)}" y="${Ht - 12}" text-anchor="middle" fill="#6b6b6b">${(opts.xLabel ?? String)(v)}</text>`));
  series.forEach((s, k) => {
    const pts = s.ys.map((v, i) => (Number.isFinite(v) && (!opts.log || v > 0) ? `${x(i)},${y(v)}` : "")).filter(Boolean).join(" ");
    parts.push(`<polyline fill="none" stroke="${COLORS[k % COLORS.length]}" stroke-width="2" ${k % 3 === 2 ? 'stroke-dasharray="5 3"' : ""} points="${pts}"/>`);
    parts.push(`<rect x="${W - Rr + 12}" y="${T + k * 18}" width="12" height="3" fill="${COLORS[k % COLORS.length]}"/><text x="${W - Rr + 30}" y="${T + k * 18 + 5}" fill="#202020">${s.name}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}
function barSvg(title: string, rows: { label: string; value: number; hot?: boolean }[], fmt: (v: number) => string) {
  const W = 760, rowH = 24, L = 230, T = 36, Ht = T + rows.length * rowH + 16;
  const m = Math.max(...rows.map((r) => r.value), 1e-9);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" font-family="sans-serif" font-size="11"><rect width="100%" height="100%" fill="#fff"/><text x="10" y="22" font-size="14" font-weight="bold" fill="#202020">${title}</text>`];
  rows.forEach((r, i) => {
    const w = ((W - L - 90) * r.value) / m;
    parts.push(`<text x="${L - 8}" y="${T + i * rowH + 13}" text-anchor="end" fill="#202020">${r.label}</text><rect x="${L}" y="${T + i * rowH + 3}" width="${Math.max(0, w)}" height="14" fill="${r.hot ? "#d93636" : "#6b6b6b"}"/><text x="${L + w + 6}" y="${T + i * rowH + 14}" fill="#202020">${fmt(r.value)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}
const fig = (name: string, svg: string) => { writeFileSync(`docs/economy/figures/${name}.svg`, svg); return `![${name}](./figures/${name}.svg)`; };

const real = personas.filter((p) => !p.id.startsWith("abuse"));
const hLast = horizons[horizons.length - 1];
const h1y = horizons.includes(365) ? 365 : hLast;
const out: string[] = [];
out.push(`# 경제 연구 결과 (자동 생성)\n\n> \`scripts/economy/report.ts\`가 \`docs/economy/results/*.json\`에서 생성. 손으로 고치지 말고 실험을 다시 실행하세요. 해석·추천은 [ECONOMY-RESEARCH.md](./ECONOMY-RESEARCH.md).\n\n- 실행: 시드 ${lab.generated.seed}, 사용자 유형당 ${lab.generated.usersPerPersona}명, 기간 ${horizons.map(H).join("·")}, 실행 시간 ${lab.generated.runtimeSeconds}초${lab.generated.quick ? " (**빠른 모드**)" : ""}.\n- 코인 단위: 모든 모델의 코인 지급을 정규화해 **일반 유저(로그인·무과금)의 1년 중앙 획득량 = ${prices.coinUnit}코인/일**. 보석은 정규화하지 않음. 보석 1개 ≈ ${num(prices.gemValue, 1)}코인(일반 유저 획득 시간 동등).\n- 모든 사용자 행동 수치는 **가정**(실제 사용자 데이터 없음).`);

out.push(`\n## 1. 실제 게임 데이터(숙련도 단계별 동형 대전)\n\n엔진 \`src/engine.ts\` + DP Expert 행동가치 소프트맥스 정책(온도 τ). 시드 ${me.seeds.base}~(경제 연구 개발용, 홀드아웃 아님). 단계당 ${num(me.seeds.mirrorGamesPerTier)}경기(=${num(me.seeds.mirrorGamesPerTier * 2)} 플레이어 기록), 교차 대전 쌍당 ${num(me.seeds.crossGamesPerPair)}경기(선후공 교대).\n`);
out.push(table(["단계", "τ", "평균(표준편차)", "p10/p50/p90", "상단 보너스", "요트", "라지", "200+", "250+", "270+", "0점 없음", "역전승(9R −30)"], me.tiers.map((t: { id: string; label: string; tau: number }) => {
  const m = me.mirror[t.id], e = m.events;
  return [t.label, t.tau, `${num(m.meanTotal, 1)} (${num(m.sdTotal, 1)})`, `${m.quantiles.p10}/${m.quantiles.p50}/${m.quantiles.p90}`, pct(e.upperBonus.p, 1), pct(e.yachtScored.p, 1), pct(e.largeScored.p, 1), pct(e.t200.p, 1), pct(e.t250.p, 2), pct(e.t270.p, 2), pct(e.noZero.p, 2), pct(e.comeback30.p, 2)];
})));
out.push(`\n교차 승리 점수율(행 기준, 무승부 0.5):\n`);
out.push(table(["", ...me.tiers.map((t: { label: string }) => t.label)], me.tiers.map((a: { id: string; label: string }) => [a.label, ...me.tiers.map((b: { id: string }) => (a.id === b.id ? "0.5" : num(me.cross[a.id][b.id].scoreRate, 3)))])));

out.push(`\n## 2. 희귀 사건: 정확 계산·중요도 표집\n\n- DP Expert 정확 점수 분포: 질량 ${num(pmf.check.mass, 12)}, 평균 ${num(pmf.check.mean, 9)} vs DP 테이블 ${num(pmf.check.dpTableValue, 9)} (오차 ${pmf.check.absError.toExponential(1)}), 계산 ${num(pmf.runtimeSeconds, 0)}초.\n`);
out.push(table(["총점 ≥", ...Object.keys(pmf.tailAtLeast)], [["P (정확)", ...Object.values(pmf.tailAtLeast).map((v) => sci(v as number))], ["기대 경기 수", ...Object.values(pmf.tailAtLeast).map((v) => num(1 / (v as number), 0))]]));
out.push(`\n- 동급 DP Expert 1:1: 무승부 ${pct(pmf.headToHead.draw, 3)}, 100점 이상 차 승리 ${pct(pmf.headToHead.winByAtLeast["100"], 2)}, 150점 이상 ${pct(pmf.headToHead.winByAtLeast["150"], 3)}.`);
const ex = rare.exact;
out.push(`- 첫 굴림 요트: 굴림당 ${sci(ex.firstRollYacht.perRoll)}, 경기당 ≥1 ${sci(ex.firstRollYacht.perGameAtLeast1)}, ≥2 ${sci(ex.firstRollYacht.perGameAtLeast2)}, ≥3 ${sci(ex.firstRollYacht.perGameAtLeast3)}.\n- 한 턴 최적 요트 ${sci(ex.turnYachtOptimal)}, 6 요트 ${sci(ex.turnSixesYachtOptimal)}, 라지 ${sci(ex.turnLargeOptimal)}.\n- 목표 최적(그 목표만 노리는 플레이어) 경기 확률: 323점 완벽 ${sci(ex.perfectGame323)}, 상단 105점 ${sci(ex.perfectUpper105)}, 0점 없는 경기 ${sci(ex.noZeroGameOptimal)}, 특수 족보 5종 모두 ${sci(ex.allSpecialsOptimal)}.`);
out.push(`\n중요도 표집(교차 엔트로피로 면 분포 조정) 검증 — 몬테카를로 ${num(rare.monteCarlo["250"].games)}경기와 정확값 비교:\n`);
out.push(table(["임계값", "정확", "MC", "IS 추정(±SE)", "판정"], Object.entries(rare.importanceSampling).map(([t, v]) => { const s = v as { p: number; se: number }; const e = pmf.tailAtLeast[t]; const ok = s.p > 0 && Math.abs(s.p - e) < 3 * s.se + 1e-12; return [t, sci(e), sci(rare.monteCarlo[t]?.p ?? NaN), `${sci(s.p)} ± ${sci(s.se)}`, s.p === 0 ? "실패(적중 0)" : ok ? "일치" : "불일치"]; })));
out.push(`\n> 면 분포만 기울이는 IS(6개 매개변수)는 고득점이 특정 족보 조합(요트·스트레이트)에 의존해 효율이 낮다: 290점에서 상대오차 ${pct((rare.importanceSampling["290"] as { relErr: number }).relErr)}(첫 시험인 표본 1,000~2,000개에서는 290점 이상 적중 0). 그래서 극희귀 점수 업적(300·310·323점)은 **정확 분포**로 판정하고 IS는 교차 검증용으로만 쓴다.\n${fig("exact-tail", lineSvg("DP Expert P(총점 ≥ x) — 정확 계산(로그)", Object.keys(pmf.tailAtLeast).map(Number), [{ name: "P(총점 ≥ x)", ys: Object.values(pmf.tailAtLeast) as number[] }], { log: true, yLabel: (v) => v.toExponential(0) }))}`);

out.push(`\n## 3. 퀘스트 후보 달성 확률(일반 유저 경기 수, 중급 기준)\n`);
out.push(table(["퀘스트", "주기", "난이도", "경기당 p(중급)", "기대 경기 수(입문/중급/전문가)", "기간 내 달성(입문/중급/전문가)"], quests.map((q: { label: string; period: string; difficulty: number; byTier: Record<string, { pPerMatch: number; expectedMatches: number; completionProb: number }> }) => [q.label, q.period, ["쉬움", "보통", "어려움"][q.difficulty], pct(q.byTier.intermediate.pPerMatch, 1), ["beginner", "intermediate", "expert"].map((t) => num(q.byTier[t].expectedMatches, 1)).join(" / "), ["beginner", "intermediate", "expert"].map((t) => pct(q.byTier[t].completionProb)).join(" / ")])));

out.push(`\n## 4. 업적 후보(기대 경기 수·난이도·보상)\n\n보상 보석 = 1.5·√(중급 기대 경기 수), 상한 100(상징 등급은 업적 전용 아이템 추가). 1년 달성률은 M3 시뮬레이션.\n`);
out.push(table(["업적", "분류", "경기당 p(중급)", "기대 경기 수(입문/중급/전문가)", "난이도", "보석", "1년 달성 라이트/일반/헤비/극단"], ach.map((a: { id: string; label: string; group: string; pPerMatch: Record<string, number | null>; expectedMatches: Record<string, number>; bandLabel: string; rewardGems: number; symbolic?: boolean }) => {
  const u = lab.achievements.find((x: { id: string }) => x.id === a.id).unlock1y;
  return [a.label, a.group, a.pPerMatch.intermediate === null ? "—" : sci(a.pPerMatch.intermediate), ["beginner", "intermediate", "expert"].map((t) => (a.expectedMatches[t] === null || !Number.isFinite(a.expectedMatches[t]) ? "∞" : a.expectedMatches[t] > 1e6 ? a.expectedMatches[t].toExponential(1) : num(a.expectedMatches[t]))).join(" / "), a.bandLabel, a.symbolic ? `${a.rewardGems}+특수` : a.rewardGems, ["light", "regular", "heavy", "extreme"].map((p) => pct(u[p])).join(" / ")];
})));

out.push(`\n## 5. 모델 정규화\n`);
out.push(table(["모델", "설명", "원래 일반 유저 코인/일", "정규화 배수", "일반 유저 보석/일"], norm.models.map((m: { id: string; label: string; summary: string }) => [m.label, m.summary, num(norm.normalization[m.id].rawMedianCoinsPerDay, 1), num(norm.normalization[m.id].factor, 3), num(norm.normalization[m.id].medianGemsPerDay, 2)])));

out.push(`\n## 6. 모델 × 사용자 유형 (${H(h1y)}, 로그인 사용자)\n`);
for (const metric of [
  { key: "coinsPerDay", label: "코인/일 중앙값 (p10~p90, 최소)", f: (s: { median: number; p10: number; p90: number; min: number }) => `${num(s.median)} (${num(s.p10)}~${num(s.p90)}, ${num(s.min)})` },
  { key: "gemsPerDay", label: "보석/일 중앙값", f: (s: { median: number }) => num(s.median, 2) },
]) {
  out.push(`\n**${metric.label}**\n`);
  out.push(table(["유형", ...models.map((m) => m.id)], real.map((p) => [p.label, ...models.map((m) => metric.f(c(m.id, p.id, h1y)[metric.key]))])));
}
out.push(`\n**신화 첫 획득 비율 / 최대 강화(Lv.3) 아이템 보유 비율**\n`);
out.push(table(["유형", ...models.map((m) => m.id)], real.map((p) => [p.label, ...models.map((m) => `${pct(c(m.id, p.id, h1y).mythicReach)} / ${pct(c(m.id, p.id, h1y).maxUpgradeReach)}`)])));
out.push(fig("coins-per-day-models", barSvg(`일반 유저·헤비·극단 코인/일 중앙값 (${H(h1y)})`, models.flatMap((m) => ["light", "regular", "heavy", "extreme"].map((p) => ({ label: `${m.id} ${personas.find((x) => x.id === p)!.label}`, value: c(m.id, p, h1y).coinsPerDay.median, hot: m.id === "M3" }))), (v) => num(v))));

out.push(`\n## 7. 추천 모델 M3 — 기간별 상세\n`);
for (const p of real) {
  out.push(`\n**${p.label}**\n`);
  out.push(table(["기간", "코인/일(중앙·p10·p90·최소)", "주간", "월간", "보석/월", "잔액 코인(중앙·p90·최대)", "보석 잔액", "등급 첫 획득 비율(일반→신화)", "중앙 일수(일반→신화)", "최대 강화", "신화 최대 강화", "잔액 지니"], horizons.map((h) => {
    const x = c("M3", p.id, h);
    return [H(h), `${num(x.coinsPerDay.median)} · ${num(x.coinsPerDay.p10)} · ${num(x.coinsPerDay.p90)} · ${num(x.coinsPerDay.min)}`, num(x.coinsPerDay.median * 7), num(x.coinsPerDay.median * 30), num(x.gemsPerDay.median * 30, 1), `${num(x.balanceCoins.median)} · ${num(x.balanceCoins.p90)} · ${num(x.balanceCoins.max)}`, num(x.balanceGems.median), x.rarityReach.map((v: number) => pct(v)).join("/"), x.rarityDaysMedian.map((v: number) => num(v)).join("/"), pct(x.maxUpgradeReach), pct(x.mythicMaxReach), num(x.giniBalance, 2)];
  })));
}
out.push(fig("mythic-reach-m3", lineSvg("M3: 신화 첫 획득 비율(무과금 포함 유형별)", horizons, real.map((p) => ({ name: p.label, ys: horizons.map((h) => c("M3", p.id, h).mythicReach) })), { xLabel: H, yLabel: (v) => pct(v) })));

out.push(`\n## 8. 수급처 비중(일반 유저, 전체 기간 누적)\n`);
const SRC = ["match", "quest_daily", "quest_weekly", "quest_monthly", "achievement", "event", "new_user", "purchase"];
out.push(table(["모델", ...SRC.map((s) => lab.sourceLabels[s] + " 코인"), "업적 보석", "주간 보석", "일일 보석", "이벤트 보석"], models.map((m) => { const s = full.full[m.id].regular.sources; return [m.id, ...SRC.map((k) => pct(s.coins[k])), pct(s.gems.achievement), pct(s.gems.quest_weekly), pct(s.gems.quest_daily), pct(s.gems.event)]; })));

out.push(`\n## 9. 어뷰징(30일, 헤비 유저 중앙값 대비 코인 배수)\n`);
out.push(table(["모델", ...abuse[0].variants.map((v: { label: string; hoursPerDay: number }) => `${v.label} (${num(v.hoursPerDay, 0)}h/일)`), "극단 헤비/헤비", "다중 계정 신규 보상(이전 불가)"], abuse.map((a: { model: string; variants: { ratioVsHeavy: number; gemRatioVsHeavy: number }[]; extremeCoins30d: number; heavyCoins30d: number; multi: { coinsPerAccount: number; gemsPerAccount: number } }) => [a.model, ...a.variants.map((v) => `${num(v.ratioVsHeavy, 2)}× (보석 ${num(v.gemRatioVsHeavy, 2)}×)`), num(a.extremeCoins30d / a.heavyCoins30d, 2), `${num(a.multi.coinsPerAccount)}코인+${a.multi.gemsPerAccount}보석/계정`])));
out.push(fig("abuse", barSvg("서버 AI 봇(하루 300경기) 30일 코인 ÷ 헤비 유저", abuse.map((a: { model: string; variants: { ratioVsHeavy: number }[] }) => ({ label: models.find((m) => m.id === a.model)!.label, value: a.variants[0].ratioVsHeavy, hot: a.model === "M3" })), (v) => `${num(v, 2)}×`)));

out.push(`\n## 10. 강화 곡선 비교\n\n단계별 비용(가격 × 기준 비율 0.5 × 곡선 배수), 신화 기준 Lv1→2 / Lv2→3 (확장 시 Lv3→4 / Lv4→5):\n`);
out.push(table(["곡선", ...RARITY.map((r) => `${r} Lv1→2 / 2→3`), "신화 Lv3→4 / 4→5(확장)"], curves.curveTable.map((t: { label: string; costs: number[][]; extendedTo5: number[][] }) => [t.label, ...t.costs.map((x) => x.map((v) => num(v)).join(" / ")), t.extendedTo5[4].slice(2).map((v) => num(v)).join(" / ")])));
out.push(`\n1년 시뮬레이션(M3, 무과금·로그인):\n`);
out.push(table(["곡선", "기준 비율", "신화 Lv1→2 / 2→3", "일반: 최대 강화 보유", "헤비: 신화 최대 강화", "극단: 신화 최대 강화", "헤비 지출 중 강화", "일반: 신화 획득"], curves.curveRuns.map((r: { curve: string; baseFraction: number; costsMythic: number[]; regular: { maxUpgradeReach1y: number; mythicReach1y: number }; heavy: { mythicMaxReach1y: number; upgradeShareOfSpend: number }; extreme: { mythicMaxReach1y: number } }) => [r.curve, r.baseFraction, r.costsMythic.map((v) => num(v)).join(" / "), pct(r.regular.maxUpgradeReach1y), pct(r.heavy.mythicMaxReach1y), pct(r.extreme.mythicMaxReach1y), pct(r.heavy.upgradeShareOfSpend), pct(r.regular.mythicReach1y)])));

out.push(`\n## 11. 민감도 분석(M3, 무과금)\n`);
out.push(table(["가정", "값", "일반 6개월 신화", "일반 1년 신화", "헤비 6개월 신화", "라이트 1년 신화", "비정기 1년 신화", "일반 코인/일", "일반 보석/일", "일반 1년 잔액"], sens.map((s: Record<string, number | string>) => [s.param, s.value, pct(s.regMythic6m as number), pct(s.regMythic1y as number), pct(s.heavyMythic6m as number), pct(s.lightMythic1y as number), pct(s.casualMythic1y as number), num(s.regCoinsPerDay as number), num(s.regGemsPerDay as number, 2), num(s.regBalance1y as number)])));

out.push(`\n## 12. 결제의 영향(M3, 1년)\n`);
out.push(table(["유형", "보유 아이템 중앙(결제)", "같은 행동 무과금", "첫 신화 일(결제/무과금)", "보석 중 결제 비중"], pay.map((p: { persona: string; paidOwned1y: { median: number }; f2pOwned1y: { median: number }; paidMythicDay: number; f2pMythicDay: number; paidGemShare: number }) => [personas.find((x) => x.id === p.persona)!.label, num(p.paidOwned1y.median), num(p.f2pOwned1y.median), `${num(p.paidMythicDay)} / ${p.f2pMythicDay > 365 ? "미달" : num(p.f2pMythicDay)}`, pct(p.paidGemShare)])));

out.push(`\n## 13. 가격 역산(M3 기준 일반 유저 소득)\n`);
out.push(table(["등급", "목표 일수(코인/보석)", "코인 가격(범위)", "보석 가격(범위)", "일수: 비정기/라이트/일반/헤비/극단(코인)", "일수(보석) 일반/헤비"], prices.priceRanges.map((p: { label: string; targetDaysCoin: number; targetDaysGem: number; coin: { low: number; mid: number; high: number }; gem: { low: number; mid: number; high: number }; daysByPersona: Record<string, { coinDays: number; gemDays: number }> }) => [p.label, `${p.targetDaysCoin} / ${p.targetDaysGem}`, `${num(p.coin.mid)} (${num(p.coin.low)}~${num(p.coin.high)})`, `${num(p.gem.mid)} (${num(p.gem.low)}~${num(p.gem.high)})`, ["occasional", "light", "regular", "heavy", "extreme"].map((k) => num(p.daysByPersona[k].coinDays)).join(" / "), `${num(p.daysByPersona.regular.gemDays)} / ${num(p.daysByPersona.heavy.gemDays)}`])));
out.push(`\n- 슬롯(영구): ${prices.slots.costs.map((x: number, i: number) => `${i + 1}번째 ${num(x)}코인 또는 ${num(prices.slots.gemCosts[i])}보석`).join(", ")} (이모티콘 4→8, 채팅 6→10 각각 같은 가격표).\n- 상징적 초고가: ${num(prices.symbolic.coinPrice)}코인 — 극단 ${num(prices.symbolic.daysFor.extreme)}일, 헤비 ${num(prices.symbolic.daysFor.heavy)}일, 일반 ${num(prices.symbolic.daysFor.regular)}일.\n- 강화(기하급수, 0.5): ${prices.upgradeRec.costs.map((u: { rarity: string; l1to2: number; l2to3: number }) => `${u.rarity} ${num(u.l1to2)}/${num(u.l2to3)}`).join(", ")}.`);

out.push(`\n## 14. 모집단·Cloudflare(하루 신규 사용자, 정상 상태 = 마지막 90일 평균)\n`);
out.push(table(["신규/일", "DAU", "플레이어-경기/일", "서버 검증 플레이어-경기/일", "행 쓰기/일", "(경제 제외)", "(AI 방 방식)", "행 쓰기 사용률(70% 몫)", "DO 요청 사용률", "Worker 요청 사용률", "Paid 추정 $/월(미확인 단가)"], pop.scale.map((s: Record<string, number>) => [s.arrivals, num(s.dau), num(s.matchesPerDay), num(s.serverMatchesPerDay), num(s.rowWritesPerDay), num(s.rowWritesNoEconomy), num(s.rowWritesRoomAI), pct(s.rowUtil, 1), pct(s.doUtil, 1), pct(s.workerUtil, 1), num(s.paidUsdPerMonth, 2)])));
const P = pop.population.M3;
out.push(`\n- M3 모집단(신규 30/일, ${H(P.days)}): 정상 상태 DAU ${num(P.steadyState.dau)}, 코인 발행 ${num(P.steadyState.coinsIssuedPerDay)}/일 vs 소비 ${num(P.steadyState.coinsSpentPerDay)}/일, 보석 발행 ${num(P.steadyState.gemsIssuedPerDay, 1)}/일 vs 소비 ${num(P.steadyState.gemsSpentPerDay, 1)}/일, 잔액 지니 ${num(P.balanceGini, 2)}.`);
out.push(`- 재직 기간별 구매력(보유 아이템 가치 + 코인) 중앙값: 0~30일 ${num(P.newVsVeteran.tenure0_30.median)}, 30~180일 ${num(P.newVsVeteran.tenure30_180.median)}, 180~365일 ${num(P.newVsVeteran.tenure180_365.median)}, 365일+ ${num(P.newVsVeteran.tenure365p.median)}.`);
out.push(fig("outstanding-m3", lineSvg(`M3 모집단 누적 잔액(신규 30/일)`, P.outstandingCoins.map((_: number, i: number) => i), [{ name: "코인 잔액 합", ys: P.outstandingCoins }, { name: "보석 잔액×보석가치", ys: P.outstandingGems.map((g: number) => g * prices.gemValue) }], { xLabel: (w) => (w % 26 === 0 ? `${w}주` : ""), yLabel: (v) => num(v) })));
out.push(`\n모델별(신규 30/일, 1년):\n`);
out.push(table(["모델", "코인 발행/일", "코인 소비/일", "보석 발행/일", "보석 소비/일", "행 쓰기/일", "잔액 지니"], pop.population.byModel.map((p: { model: string; steadyState: Record<string, number>; balanceGini: number }) => [p.model, num(p.steadyState.coinsIssuedPerDay), num(p.steadyState.coinsSpentPerDay), num(p.steadyState.gemsIssuedPerDay, 1), num(p.steadyState.gemsSpentPerDay, 1), num(p.steadyState.rowWritesPerDay), num(p.balanceGini, 2)])));

writeFileSync("docs/economy/RESULTS-GENERATED.md", out.join("\n") + "\n");
console.log("wrote docs/economy/RESULTS-GENERATED.md");

// ---------- CSV export (model × persona × horizon) ----------
const csv = ["model,persona,horizon_days,coins_per_day_median,coins_per_day_p10,coins_per_day_p90,coins_per_day_min,gems_per_day_median,balance_coins_median,balance_coins_p90,balance_gems_median,reach_common,reach_advanced,reach_hero,reach_legendary,reach_mythic,max_upgrade_reach,mythic_max_reach,gini_balance"];
for (const m of models) for (const p of personas) for (const h of horizons) {
  const x = c(m.id, p.id, h);
  csv.push([m.id, p.id, h, x.coinsPerDay.median, x.coinsPerDay.p10, x.coinsPerDay.p90, x.coinsPerDay.min, x.gemsPerDay.median, x.balanceCoins.median, x.balanceCoins.p90, x.balanceGems.median, ...x.rarityReach, x.maxUpgradeReach, x.mythicMaxReach, x.giniBalance].join(","));
}
writeFileSync("docs/economy/results/model-persona-horizon.csv", csv.join("\n") + "\n");
console.log("wrote docs/economy/results/model-persona-horizon.csv", csv.length - 1, "rows");
