/**
 * Economy v2 report tables + figures — `npx tsx scripts/economy/v2/report.ts`.
 * Reads the verified E0–E7 replay (optional path argument) and writes
 * docs/economy/v2/RESULTS-V2-GENERATED.md and docs/economy/v2/figures/*.svg. No simulation here.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOSTERS, POLICIES, SENSITIVITY, SINGLE } from "../../../src/economy/v2/candidates";

const DIR = fileURLToPath(new URL("../../../docs/economy/v2/", import.meta.url));
const replay = resolve(process.argv[2] ?? DIR + "codex/replay/");
const load = (f: string) => JSON.parse(readFileSync(resolve(replay, f), "utf8"));
type Med = { median: number | null; lo: number | null; hi: number | null; reached: number };
type St = { mean: number; se: number; p10: number; p50: number; p90: number };
type Cell = Record<string, any>;
const E: Record<string, Record<string, Cell>> = {};
for (const e of ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"]) E[e] = load(`${e}.json`).cells;
const meta = load("meta.json");
const pop = load("population.json").populations;

const md = (m: Med | undefined, unit = "") => (!m ? "–" : m.median === null ? `미도달(${Math.round(m.reached * 100)}%)` : `${fmt(m.median)}${unit}`);
const mdci = (m: Med) => (m.median === null ? md(m) : `${fmt(m.median)} [${m.lo ?? "–"}–${m.hi ?? "∞"}]`);
const fmt = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const pm = (s: St) => `${fmt(s.mean)} ±${fmt(1.96 * s.se)}`;
const cell = (e: string, cand: string, persona: string, user: "new" | "existing") => E[e][`${cand}|${persona}|${user}`];
const L: string[] = [];
const out = (...xs: string[]) => L.push(...xs);
const table = (head: string[], rows: (string | number)[][]) => {
  out(`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i === 0 ? "---" : "---:")).join("|")}|`);
  for (const r of rows) out(`| ${r.join(" | ")} |`);
  out("");
};

out(
  "# 경제 v2 연구 — 역사적 E0~E7 독립 재실행",
  "",
  `> E0~E7 개발 실험 정의의 재실행. 시드 ${meta.seeds?.join(", ") ?? "20261127, 20261128"}, 시작 ${meta.t0}, 작업 ${meta.jobs}개, 시뮬레이션 사용자 ${meta.players.toLocaleString("en-US")}명, Node ${meta.node}. 자료 [독립 재실행](codex/replay) 및 [최종 경제 연구](../ECONOMY-V2-RESEARCH.md).`,
  "> 모든 사용자 행동 수치는 **가정**(실측 아님). 값은 셀별 사용자 표본의 중앙값(대괄호: 이항 순서통계량 95% 구간) 또는 평균 ±1.96·SE. 기존 사용자 = 현행 경제로 60일 플레이 후 전환.",
  "",
);

/* E0 */
out("## E0. 4시간 플레이 하루(목요일, 기준선 M3i-W30@2) — 원인 분해", "");
const scen: Record<string, string> = { default: "기본 혼합", randomOnly: "빠른 대전만", len15: "경기 15분", aiHeavy: "서버 AI 위주", offlineHeavy: "오프라인·1인 위주", lowTraffic: "저트래픽(대기 길면 오프라인)", smallPool: "상대 3명 반복", noQuest: "퀘스트 관리 안 함", wr35: "승률 35%" };
const e0rows: (string | number)[][] = [];
for (const [id, label] of Object.entries(scen))
  for (const u of ["new", "existing"] as const) {
    const c = cell("E0", "BASE", `t240-${id}`, u);
    if (!c) continue;
    const h = c.h[1];
    const src = h.bySource;
    e0rows.push([`${label} · ${u === "new" ? "신규" : "기존"}`, fmt(h.matches.p50), fmt(h.paidMatches.p50), fmt(src.match ?? 0), fmt((src.quest ?? 0) + (src["quest-bonus"] ?? 0)), fmt(src.achievement ?? 0), fmt(src.welcome ?? 0), fmt(h.coinsEarned.p50), fmt(h.spent.item + h.spent.upgrade + h.spent.draw), fmt(h.coins.p50), fmt(h.affordableUnowned.p50), pct(h.obtainedBy.p)]);
  }
table(["상황", "경기(중앙)", "보상 경기", "경기 코인(평균)", "퀘스트(평균)", "업적", "가입", "획득 코인(중앙)", "사용(평균)", "잔액(중앙)", "지금 살 수 있는 미보유(중앙)", "새 상품 획득 비율"], e0rows);

/* E1 main */
const ALL = [...SINGLE, ...POLICIES];
out("## E1. 후보별 핵심 지표 (90일, 하루 플레이 시간별 사용자 200명)", "");
out("### E1-a. 첫 구매 경험과 기존 사용자의 다음 상품", "");
table(
  ["후보", "그룹", "신규 15분: 첫 상품(분)", "신규 30분: 7일 보유", "기존 30분: 다음 상품(플레이 분)", "기존 60분: 다음 상품(분)", "기존 240분: 다음 상품(분)", "기존 60분: 7일 내 새 상품"],
  ALL.map((c) => [
    `${c.id} ${c.label}`, c.group,
    md(cell("E1", c.id, "t15", "new").firstObtainMin),
    fmt(cell("E1", c.id, "t30", "new").h[7].owned.p50),
    mdci(cell("E1", c.id, "t30", "existing").firstObtainMin),
    mdci(cell("E1", c.id, "t60", "existing").firstObtainMin),
    mdci(cell("E1", c.id, "t240", "existing").firstObtainMin),
    pct(cell("E1", c.id, "t60", "existing").h[7].obtainedBy.p),
  ]),
);
out("### E1-b. 등급별 첫 획득 일수(신규, 하루 60분) · Lv.3 · 장기 가치", "");
table(
  ["후보", "고급(일)", "영웅", "전설", "신화", "첫 Lv.3(일)", "Lv.3 90일 내", "기존 480분 90일 보유 가치(코인)", "기존 240분 90일 발행(코인)", "발행 대비 BASE", "기존 480분 상한 도달 일 비율"],
  ALL.map((c) => {
    const n60 = cell("E1", c.id, "t60", "new");
    const b = cell("E1", "BASE", "t240", "existing").h[90].coinsEarned.mean;
    const x = cell("E1", c.id, "t240", "existing").h[90];
    return [
      c.id, md(n60.firstTierDay.rare), md(n60.firstTierDay.epic), md(n60.firstTierDay.legendary), md(n60.firstTierDay.mythic), md(n60.firstLv3Day), pct(n60.h[90].lv3By.p),
      fmt(cell("E1", c.id, "t480", "existing").h[90].ownedValue.p50), fmt(x.coinsEarned.mean), `${((x.coinsEarned.mean / b - 1) * 100).toFixed(0)}%`, pct(cell("E1", c.id, "t480", "existing").h[90].cappedDayShare),
    ];
  }),
);
out("### E1-c. 기준선(BASE) 플레이 시간 × 기간 — 획득·잔액·보유", "");
const rows: (string | number)[][] = [];
for (const m of [15, 30, 60, 120, 240, 480])
  for (const u of ["new", "existing"] as const)
    for (const h of [1, 7, 30, 90]) {
      const c = cell("E1", "BASE", `t${m}`, u).h[h];
      rows.push([`${m}분·${u === "new" ? "신규" : "기존"}·${h}일`, fmt(c.matches.p50), fmt(c.coinsEarned.p50), fmt(c.coinsPerHour.p50), `${fmt(c.coins.p10)} / ${fmt(c.coins.p50)} / ${fmt(c.coins.p90)}`, fmt(c.gems.p50), fmt(c.owned.p50), fmt(c.lv3.mean), fmt(c.collectionsComplete.mean), fmt(c.synergyReady.mean), pct(c.everCapped.p)]);
    }
table(["사용자·기간", "경기", "획득 코인", "코인/시간", "코인 잔액 p10/p50/p90", "보석 잔액", "보유 수", "Lv.3 수(평균)", "완성 컬렉션", "시너지 가능", "상한(30경기) 경험"], rows);

out("### E1-d. 발행 출처와 소각(기존 사용자 90일 평균, 코인)", "");
const srcRows: (string | number)[][] = [];
for (const c of [{ id: "BASE" }, ...POLICIES])
  for (const m of [30, 240]) {
    const h = cell("E1", c.id, `t${m}`, "existing").h[90];
    const s = h.bySource;
    srcRows.push([`${c.id} ${m}분`, fmt(s.match ?? 0), fmt((s.quest ?? 0) + (s["quest-bonus"] ?? 0)), fmt(s.achievement ?? 0), fmt((s.streak ?? 0) + (s.collection ?? 0)), fmt(s["draw-duplicate"] ?? 0), fmt(h.spent.item), fmt(h.spent.upgrade), fmt(h.spent.draw), pct((h.spent.item + h.spent.upgrade + h.spent.draw) / Math.max(1, h.coinsEarned.mean))]);
  }
table(["후보·사용자", "경기", "퀘스트", "업적", "연승·컬렉션", "뽑기 중복", "상품 소각", "강화 소각", "뽑기 소각", "소각/발행"], srcRows);

/* E2 interaction */
out("## E2. 상호작용 — 경기 보상 배율 × 상품 가격", "");
for (const [persona, user, metric, title] of [
  ["t60", "existing", "first", "기존 60분: 다음 상품까지 플레이 분(중앙)"],
  ["t240", "existing", "value", "기존 240분: 90일 보유 가치(코인, 중앙)"],
  ["t60", "new", "legend", "신규 60분: 첫 전설(일, 중앙)"],
] as const) {
  out(`**${title}**`, "");
  table(["경기 배율 \\ 가격", "100%", "85%", "70%", "50%"], [1, 1.5, 2, 2.5, 3].map((m) => [`×${m}`, ...[1, 0.85, 0.7, 0.5].map((p) => {
    const c = cell("E2", `X-M${m * 10}-P${p * 100}`, persona, user);
    return metric === "first" ? md(c.firstObtainMin) : metric === "value" ? fmt(c.h[90].ownedValue.p50) : md(c.firstTierDay.legendary);
  })]));
}

/* E3 boosters */
out("## E3. 부스터 후보 (기존 사용자, 90일)", "");
for (const base of ["BASE", "V2-BAL"]) {
  out(`**바탕: ${base}**`, "");
  table(
    ["부스터", "15분: 추가/일", "60분: 추가/일", "240분: 추가/일", "480분: 추가/일", "시간 낭비(15분)", "시간 낭비(60분)", "60분: 다음 상품(분)", "240분 발행 대비 미도입"],
    BOOSTERS.map((b) => {
      const id = `${base}+${b.id}`;
      const per = (m: number) => cell("E3", id, `t${m}`, "existing").h[90];
      const none = cell("E3", `${base}+none`, "t240", "existing").h[90].coinsEarned.mean;
      return [b.label, ...[15, 60, 240, 480].map((m) => fmt(per(m).boostCoins.mean / 90)), pct(per(15).boosterWasteShare), pct(per(60).boosterWasteShare), md(cell("E3", id, "t60", "existing").firstObtainMin), `${((per(240).coinsEarned.mean / none - 1) * 100).toFixed(1)}%`];
    }),
  );
}

/* E4 sensitivity */
out("## E4. 민감도 (가정 변화에 따른 결과 범위)", "");
for (const m of [60, 240]) {
  out(`**하루 ${m}분 · 기존 사용자: 다음 상품까지 플레이 분 / 30일 획득 코인(중앙)**`, "");
  table(["가정", "BASE", ...POLICIES.map((p) => p.id)], SENSITIVITY.map((s) => [s.label, ...["BASE", ...POLICIES.map((p) => p.id)].map((id) => {
    const c = cell("E4", id, `t${m}-${s.id}`, "existing");
    return `${md(c.firstObtainMin)} / ${fmt(c.h[30].coinsEarned.p50)}`;
  })]));
}
out("**신규 사용자 하루 60분: 첫 영웅 / 첫 전설 / 첫 Lv.3 (일, 중앙)**", "");
table(["가정", "BASE", ...POLICIES.map((p) => p.id)], SENSITIVITY.map((s) => [s.label, ...["BASE", ...POLICIES.map((p) => p.id)].map((id) => {
  const c = cell("E4", id, `t60-${s.id}`, "new");
  return `${md(c.firstTierDay.epic)} / ${md(c.firstTierDay.legendary)} / ${md(c.firstLv3Day)}`;
})]));

/* E5 abuse */
out("## E5. 악용 유인 (24시간 봇·친구 담합, 30일, 30명)", "");
const abuseRows: (string | number)[][] = [];
for (const [k, c] of Object.entries(E.E5)) abuseRows.push([`${c.candidate} · ${c.persona}`, fmt(c.h[30].matches.mean / 30), fmt(c.h[30].coinsEarned.mean / 30), fmt(c.maxCoinsDay.p90), pct(c.h[30].cappedDayShare)]);
table(["후보 · 봇", "경기/일", "코인/일(평균)", "하루 최대(p90)", "상한 도달 일"], abuseRows);

/* E6 population */
out("## E6. 집중도 (가정 모집단 2,000명, 90일 획득 코인)", "");
table(["후보 · 사용자", "Gini", "상위 10% 몫", "하위 50% 몫", "p90/p10", "평균 90일 획득"], Object.entries(pop).map(([k, v]: [string, any]) => [k, v.gini, pct(v.top10Share), pct(v.bottom50Share), v.p90p10, fmt(v.meanEarned90)]));

/* E7 seed stability */
out("## E7. 독립 시드 블록 재현 (시드 +1)", "");
const stab: (string | number)[][] = [];
for (const [k, c] of Object.entries(E.E7)) {
  const a = E.E1[k];
  stab.push([k, `${md(a.firstObtainMin)} → ${md(c.firstObtainMin)}`, `${pm(a.h[90].coinsEarned)} → ${pm(c.h[90].coinsEarned)}`, `${fmt(a.h[90].owned.p50)} → ${fmt(c.h[90].owned.p50)}`]);
}
table(["셀", "첫/다음 상품(분)", "90일 획득(평균±95%)", "90일 보유(중앙)"], stab);

out("## 카탈로그 및 독립 정책 평가", "",
  "[Rev.1·Rev.2 가격·강화·뽑기 확률](codex/catalog-and-draw.json) · [상한](codex/capacity.json) · [홀드아웃](codex/H1/summary.json).", "");
writeFileSync(DIR + "RESULTS-V2-GENERATED.md", L.join("\n"));

/* ------------------------------------------------------------------ figures ------------------------------------------------------------------ */
mkdirSync(DIR + "figures", { recursive: true });
const css = `<style>
.viz{--s:#ffffff;--t1:#191919;--t2:#666666;--g:#e5e5e5;--a:#257de0;--b:#f47230;--n:#9c9c9c;font:12px system-ui,-apple-system,sans-serif}
@media (prefers-color-scheme:dark){.viz{--s:#191919;--t1:#efefef;--t2:#9c9c9c;--g:#333333;--a:#338ced;--b:#e76624;--n:#666666}}
.bg{fill:var(--s)}.t1{fill:var(--t1)}.t2{fill:var(--t2)}.grid{stroke:var(--g)}.dot{fill:var(--n)}.front{fill:var(--a)}.pol{fill:var(--b)}.fl{stroke:var(--a);fill:none;stroke-width:2}
</style>`;
// Coin sources: horizontal stacked bars for BASE existing 30 days by play time (two-tone: match vs other faucets in neutral steps)
const SRC = [["match", "경기", "var(--a)"], ["quest", "퀘스트", "var(--b)"], ["achievement", "업적", "#00b894"], ["other", "기타", "var(--n)"]] as const;
const bars = [15, 30, 60, 120, 240, 480].map((m) => {
  const s = cell("E1", "BASE", `t${m}`, "existing").h[30].bySource;
  const v = { match: s.match ?? 0, quest: (s.quest ?? 0) + (s["quest-bonus"] ?? 0), achievement: s.achievement ?? 0, other: (s["draw-duplicate"] ?? 0) };
  return { m, v, tot: Object.values(v).reduce((a, b) => a + b, 0) };
});
const W2 = 760, H2 = 320, l2 = 90, r2 = 80;
const max = Math.max(...bars.map((b) => b.tot));
const bw = (v: number) => (v / max) * (W2 - l2 - r2);
const svg2 = [
  `<svg xmlns="http://www.w3.org/2000/svg" class="viz" viewBox="0 0 ${W2} ${H2}" role="img" aria-label="현행 경제 기존 사용자 30일 코인 출처">${css}`,
  `<rect class="bg" width="${W2}" height="${H2}"/>`,
  `<text class="t1" x="${l2}" y="20" font-weight="600">현행(M3i-W30@2) 기존 사용자 30일 코인 출처 — 하루 플레이 시간별</text>`,
  ...SRC.map(([, lab, col], i) => `<rect x="${l2 + i * 110}" y="32" width="12" height="12" rx="2" fill="${col}"/><text class="t2" x="${l2 + i * 110 + 18}" y="42">${lab}</text>`),
  ...bars.flatMap((b, i) => {
    const y = 64 + i * 40;
    let x = l2;
    const segs = SRC.map(([k, lab, col]) => {
      const w = bw(b.v[k]);
      const r = `<rect x="${x}" y="${y}" width="${Math.max(0, w - 2)}" height="24" fill="${col}"><title>${b.m}분 ${lab}: ${fmt(b.v[k])}코인</title></rect>`;
      x += w;
      return r;
    });
    return [`<text class="t2" x="${l2 - 8}" y="${y + 16}" text-anchor="end">${b.m >= 60 ? b.m / 60 + "시간" : b.m + "분"}/일</text>`, ...segs, `<text class="t1" x="${x + 6}" y="${y + 16}">${fmt(b.tot)}</text>`];
  }),
  `</svg>`,
].join("\n");
writeFileSync(DIR + "figures/sources-base.svg", svg2);
console.log("wrote RESULTS-V2-GENERATED.md and figures/");
