import { SITE } from "./seo-lib.mjs";

const site = SITE;
const repo = "https://github.com/oyueo-mm/YachtLab";
const revision = "222db725ba298d5fe6a708a8783f22c0571f0d07";
const file = (path) => `${repo}/blob/${revision}/${path}`;
const directory = (path) => `${repo}/tree/${revision}/${path}`;
const run = (id) => `${repo}/actions/runs/${id}`;
const context = (name) => file(`docs/context/${name}.md`);
const v7Data = "training/results/v7";

const source = {
  dp: file("training/dp/README.md"),
  results: context("RESULTS"),
  v5: context("V5-APEX-RESEARCH"),
  v5Final: file("training/results/v5/confirm-9501/FINAL.md"),
  v6: context("V6-APEX-RESEARCH"),
  v7: context("V7-APEX-RESEARCH"),
  v7Confirm: file(`${v7Data}/confirm/summary.md`),
  handoff: context("V7-PRODUCT-HANDOFF"),
  decision: context("DECISIONS") + "#d-v7-6-ai-연구-잠정-종료-매우-어려움-v4-d-유지-2026-11-26-사용자-결정",
  difficulty: file("src/GameDifficulty.tsx"),
  servicePolicy: file("src/ai.ts#L146"),
  v5Trial: file("src/product-ai/models.ts"),
  benchV2: file("scripts/confirm-v2.mjs"),
  bench: file("scripts/research-v5/bench.ts"),
  agents: file("scripts/research-v5/agents.ts"),
  workflow: file(".github/workflows/v5-apex-research.yml"),
  aggregate: file("scripts/research-v7/shard-lines.py"),
  audit: file("docs/audits/release-hardening-2026-11-26/research-handoff.md"),
  auditSamples: file("docs/audits/release-hardening-2026-11-26/ci-sample.tsv"),
  raw9551: file(`${v7Data}/confirm-v71/shards-9551.jsonl`),
  raw9571v4: file(`${v7Data}/confirm-v71/shards-9571-v4D.jsonl`),
  raw9571v5: file(`${v7Data}/confirm-v71/shards-9571-v5R.jsonl`),
  dev9102: directory(`${v7Data}/dev-9102`),
  dev9107: directory(`${v7Data}/dev-9107`),
  regret: file(`${v7Data}/regret-f9101-K4.json`),
  regretResponse: file(`${v7Data}/regret-f9101-K4-oblivious.json`),
  regretI2RO: file(`${v7Data}/regret-f9101-K4-i2ro.json`),
  regretProduct: file(`${v7Data}/regret-f9101-K4-product.json`),
  cost: directory(`${v7Data}/product-bench`),
  offPolicy: context("FULLGAME-OFFPOLICY-RESEARCH"),
  extendedPpo: context("EXTENDED-PSRO-PMF-PPO-RESULTS"),
  external: context("_generated/EXTERNAL-CHAMPIONSHIP-LATEST"),
  externalCode: file("src/external-challengers.ts"),
  externalRunner: file("scripts/external-championship.mjs"),
  serverCost: file(`${v7Data}/server-bench-local.json`),
};

const references = [
  { id: "nintendo", name: "Nintendo. 51 Worldwide Games · Yacht Dice.", url: "https://www.nintendo.com/au/games/nintendo-switch/51-worldwide-games/" },
  { id: "verhoeff", name: "T. Verhoeff and E. T. J. Scheffers (1999). Optimal solitaire Yahtzee player & proficiency test.", url: "https://research.tue.nl/en/publications/optimal-solitaire-yahtzee-player-amp-proficiency-test/" },
  { id: "pawlewicz", name: "J. Pawlewicz (2011). Towards Optimal Play in Multi-Player Yahtzee. ICGA Journal 34(1), 7–21.", url: "https://doi.org/10.3233/ICG-2011-34103" },
  { id: "qr-dqn", name: "W. Dabney et al. (2018). Distributional Reinforcement Learning with Quantile Regression. AAAI.", url: "https://doi.org/10.1609/aaai.v32i1.11791" },
  { id: "glasserman-yao", name: "P. Glasserman and D. D. Yao (1992). Some Guidelines and Guarantees for Common Random Numbers. Management Science 38(6), 884–908.", url: "https://doi.org/10.1287/mnsc.38.6.884" },
  { id: "holm", name: "S. Holm (1979). A Simple Sequentially Rejective Multiple Test Procedure. Scandinavian Journal of Statistics 6(2), 65–70.", url: "https://www.jstor.org/stable/4615733" },
];

// Estimates and interval endpoints are percentages. Each n counts seat-swapped seed pairs.
const benchmark = [
  { a: "Win DP v2", b: "DP Expert", seed: "1,350,000", n: 10000, score: 50.630, ci: [50.406, 50.854], level: 95, runId: 44690511514 },
  { a: "Win DP v2", b: "Win DP v1", seed: "1,370,000", n: 5000, score: 50.435, ci: [50.132, 50.738], level: 95, runId: 44690511514 },
  { a: "Win DP v3", b: "Win DP v2", seed: 9501, n: 50000, score: 50.175, ci: [50.049, 50.302], runId: 45572667620 },
  { a: "v4-D", b: "Win DP v2", seed: 9501, n: 20000, score: 50.179, ci: [49.938, 50.419], runId: 45572667620 },
  { a: "v5-R", b: "Win DP v2", seed: 9501, n: 50000, score: 50.626, ci: [50.372, 50.879], runId: 45572667620 },
  { a: "v5-R", b: "Win DP v3", seed: 9501, n: 50000, score: 50.479, ci: [50.229, 50.729], runId: 45572667620 },
  { a: "v5-R", b: "DP Expert", seed: 9501, n: 30000, score: 51.223, ci: [50.891, 51.554], runId: 45572667620 },
  { a: "v5-R", b: "v4-D", seed: 9501, n: 20000, score: 50.591, ci: [50.193, 50.989], runId: 45572667620 },
  { a: "v6-P", b: "v5-R", seed: 9511, n: 50000, score: 50.131, ci: [50.005, 50.257], runId: 45606191583, plot: true },
  { a: "v6-P", b: "v5-R", seed: 9512, n: 20000, score: 50.209, ci: [50.010, 50.408], runId: 45606203906, plot: true },
  { a: "v7-I1RO", b: "v6-P", seed: 9531, n: 50000, score: 50.091, ci: [49.994, 50.188], runId: 45634704402, plot: true },
  { a: "v7-I1RO", b: "DP Expert", seed: 9531, n: 20000, score: 51.392, ci: [50.983, 51.802], runId: 45634710467 },
  { a: "v7-I1RO", b: "v5-R", seed: 9531, n: 20000, score: 50.148, ci: [49.925, 50.370], runId: 45634710467 },
  { a: "v7-I1RO", b: "v6-P", seed: 9541, n: 50000, score: 50.136, ci: [50.038, 50.235], runId: 45634717931, plot: true },
  { a: "v7-I1RO", b: "v6-P", seed: 9551, n: 100000, score: 50.028, ci: [49.958, 50.098], runId: 45668088483, plot: true, counts: [99284, 1544, 99172], raw: source.raw9551 },
  { a: "v7-I1", b: "v6-P", seed: 9552, n: 100000, score: 50.020, ci: [49.943, 50.097], runId: 45668095586 },
  { a: "v7-I1R", b: "v6-P", seed: 9552, n: 100000, score: 50.033, ci: [49.956, 50.111], runId: 45668102728 },
  { a: "I2RO1", b: "v4-D", seed: 9571, n: 50000, score: 50.548, ci: [50.296, 50.800], runId: 45677873061, plot: true, counts: [50165, 766, 49069], raw: source.raw9571v4 },
  { a: "v5-R", b: "v4-D", seed: 9571, n: 50000, score: 50.547, ci: [50.293, 50.800], runId: 45677873061, counts: [50162, 769, 49069], raw: source.raw9571v4 },
  { a: "I2RO1", b: "v5-R", seed: 9571, n: 100000, score: 50.064, ci: [49.969, 50.158], runId: 45677867233, plot: true, counts: [99347, 1561, 99092], raw: source.raw9571v5 },
  { a: "I2RO1", b: "v4-D", seed: 9581, n: 20000, score: 50.559, ci: [50.155, 50.962], runId: 45677888312, plot: true },
  { a: "I2RO1", b: "v5-R", seed: 9581, n: 100000, score: 50.019, ci: [49.924, 50.114], runId: 45677883743, plot: true },
  { a: "I2RO1", b: "v4-D", seed: 9591, n: 20000, score: 50.905, ci: [50.503, 51.307], runId: 45717552130 },
  { a: "I2RO1", b: "v5-R", seed: 9591, n: 20000, score: 49.954, ci: [49.747, 50.160], runId: 45717547846 },
];

const sectionIds = [
  "abstract", "background", "related-work", "problem-formulation", "methodology", "model-evolution",
  "experimental-setup", "benchmark-results", "ablation-study", "computational-cost",
  "limitations", "reproducibility", "future-work", "references",
];

const headings = {
  en: [
    "Abstract", "Background", "Related Work", "Problem Formulation", "Methodology", "Model Evolution",
    "Experimental Setup", "Benchmark Results", "Ablation Study", "Computational Cost",
    "Limitations", "Reproducibility", "Future Work", "References",
  ],
  ko: [
    "초록", "배경", "관련 연구", "문제 정의", "연구 방법", "모델의 발전 과정",
    "실험 설계", "벤치마크 결과", "구성 요소 비교", "계산 비용",
    "한계", "재현 방법", "후속 연구", "참고문헌",
  ],
};

const number = new Intl.NumberFormat("en-US");
const pct = (x) => `${x.toFixed(3)}%`;
const interval = ([low, high]) => `${low.toFixed(3)}–${high.toFixed(3)}%`;
const escapeHtml = (x) => String(x).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const link = (url, text) => `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
const cite = (id, label) => link(`#ref-${id}`, label);
const matchup = ({ a, b }) => `${a} vs ${b}`;

function dataTable(id, caption, columns, rows) {
  return `<div class="research-table" role="region" aria-labelledby="${id}" tabindex="0">
<table>
  <caption id="${id}">${caption}</caption>
  <thead><tr>${columns.map((name) => `<th scope="col">${name}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(([name, ...cells]) => `<tr><th scope="row">${name}</th>${cells.map((value) => `<td>${value}</td>`).join("")}</tr>`).join("\n    ")}</tbody>
</table></div>`;
}

function benchmarkTable(ko) {
  return dataTable(
    "research-benchmark-table",
    ko ? "대진별 승리점수율과 시드쌍 신뢰구간" : "Win credit and paired confidence intervals by matchup",
    ko ? ["대진 (A vs B)", "시드", "경기 / 쌍", "A 승리점수율", "쌍별 신뢰구간", "실행"]
       : ["Matchup (A vs B)", "Seed", "Games / pairs", "A win credit", "Paired CI", "Run"],
    benchmark.map((row) => [
      matchup(row), row.seed, `${number.format(row.n * 2)} / ${number.format(row.n)}`, pct(row.score),
      `${interval(row.ci)} (${row.level ?? 99}%)`, link(run(row.runId), row.runId),
    ]),
  );
}

function shardTable(ko) {
  return dataTable(
    "research-shard-table",
    ko ? "보존된 샤드 로그에서 재집계한 승·무·패" : "Win, draw, and loss counts recomputed from shard logs",
    ko ? ["대진 (A vs B)", "시드군", "승", "무", "패", "샤드 로그"]
       : ["Matchup (A vs B)", "Family", "Wins", "Draws", "Losses", "Shard logs"],
    benchmark.filter((row) => row.counts).map((row) => [
      matchup(row), row.seed, ...row.counts.map((count) => number.format(count)),
      link(row.raw, "JSONL"),
    ]),
  );
}

function intervalChart(ko) {
  const min = 49.5;
  const max = 51.5;
  const position = (x) => `${((x - min) / (max - min) * 100).toFixed(3)}%`;
  const rows = benchmark.filter((row) => row.plot).map((row) => {
    const [low, high] = row.ci;
    return `<li>
  <div class="research-ci-value">
    <strong>${matchup(row)} · ${row.seed}</strong>
    <span>${pct(row.score)} (${interval(row.ci)})</span>
  </div>
  <div aria-hidden="true" class="research-ci-track">
    <span class="research-ci-range" style="--low:${position(low)}; --high:${position(high)}"></span>
    <span class="research-ci-point" style="--estimate:${position(row.score)}"></span>
  </div>
</li>`;
  }).join("\n");
  const caption = ko
    ? "주요 대진의 승리점수율과 99% 시드쌍 신뢰구간"
    : "Win credit and 99% paired confidence intervals for selected matchups";
  const legend = ko
    ? "점은 추정치, 양끝이 표시된 선은 신뢰구간, 세로 점선은 50% 기준입니다. 모든 행의 가로축 범위는 49.5–51.5%입니다."
    : "Dots mark estimates, capped bars show intervals, and the dashed line marks 50%. Every row uses the same 49.5–51.5% scale.";
  return `<figure class="research-ci">
  <figcaption><strong>${caption}</strong><br>${legend}</figcaption>
  <ul role="list">${rows}</ul>
  <div aria-hidden="true" style="position:relative;height:1.5em;font-size:.85em">
    <span style="position:absolute;left:0">49.5%</span>
    <span style="position:absolute;left:${position(50)};transform:translateX(-50%)">50%</span>
    <span style="position:absolute;left:${position(50.5)};transform:translateX(-50%)">50.5%</span>
    <span style="position:absolute;left:${position(51)};transform:translateX(-50%)">51%</span>
    <span style="position:absolute;right:0">51.5%</span>
  </div>
</figure>`;
}

function modelFlow(ko) {
  const stages = ko
    ? [["공개 상태", "주사위, 남은 굴림, 양쪽 점수판"], ["합법 행동", "킵과 재굴림 또는 점수 기록"], ["이후 점수분포", "고정 정책 PMF 또는 상대 대응 혼합"], ["정지가치 비교", "승리 확률과 동점 확률의 절반"]]
    : [["Public state", "Dice, rolls left, and both scorecards"], ["Legal actions", "Keep and reroll or score now"], ["Future scores", "Fixed-policy PMF or a mixture over opponent responses"], ["Stopping value", "Probability of a win plus half the probability of a tie"]];
  return `<ol class="research-flow" role="list">${stages.map(([label, detail]) => `<li><strong>${label}</strong>${detail}</li>`).join("")}</ol>`;
}

function referenceList(ko) {
  const project = ko
    ? [
        [source.results, "실험 및 성능 기록"], [source.v5, "v5 사전 등록과 방법"], [source.v5Final, "v5 확증 집계"],
        [source.v6, "v6 연구와 확증"], [source.v7, "v7 사전 등록과 최종 판정"], [source.v7Confirm, "v7 초기 확증 집계"],
        [source.handoff, "v7 제품 인수인계"], [source.audit, "v6·v7 재현성 감사"],
      ]
    : [
        [source.results, "Experiment results index"], [source.v5, "v5 protocol and methods"], [source.v5Final, "v5 confirmation aggregate"],
        [source.v6, "v6 research and confirmation"], [source.v7, "v7 protocols and final decisions"], [source.v7Confirm, "Initial v7 confirmation summaries"],
        [source.handoff, "v7 product handoff"], [source.audit, "v6–v7 reproducibility audit"],
      ];
  return `<ul lang="en">${references.map(({ id, name, url }) => `<li id="ref-${id}">${link(url, name)}</li>`).join("")}</ul>
<p>${ko ? "YachtLab 연구 기록" : "YachtLab research records"}</p>
<ul>${project.map(([url, label]) => `<li>${link(url, label)}</li>`).join("")}</ul>`;
}

function english(up) {
  return [
    `<p class="lead">YachtLab tested whether planning for an opponent’s response improves play in 12-category Yacht Dice. The v7 models reduced exact endgame decision loss. In full games, v6-P retained the research lead under the registered selection rule. The single-bank I2RO1 candidate beat v4-D in two seed families, while its advantage over v5-R remains unresolved. The free Very Hard setting uses Win DP v4-D. ${link(source.v7, "v7 research record")} · ${link(source.handoff, "Product handoff")}</p>`,
    `<p>YachtLab uses Nintendo-style scoring with five fair six-sided dice, up to three rolls per turn, twelve scoring categories, and a 35-point upper-section bonus at 63 or more. The DP Expert baseline maximizes expected solo score and has an initial theoretical value of 191.760879752165 points under these rules. In head-to-head play, the best choice can depend on the opponent’s score and remaining categories. ${link(up + "guide/", "YachtLab rules (Korean)")} · ${link(up + "scores/", "Scorecard (Korean)")} · ${link(source.dp, "DP baseline")}</p>`,
    `<p>Verhoeff and Scheffers implemented an optimal solitaire Yahtzee player. Pawlewicz studied multiplayer Yahtzee, including approximations for its much larger joint state space. These works inform the distinction between solo and competitive planning. Their score and performance figures follow Yahtzee scoring conventions. Nintendo’s Yacht Dice listing identifies the ruleset family, and the YachtLab engine defines the benchmark rules. ${cite("verhoeff", "Verhoeff and Scheffers (1999)")} · ${cite("pawlewicz", "Pawlewicz (2011)")} · ${cite("nintendo", "Nintendo")}</p>`,
    `<p>A decision uses the visible dice, rolls used, both scorecards, and whose turn it is. A player can score an open category or keep dice and reroll the others when a roll remains. For own final score <var>S</var> and opponent score <var>T</var>, the objective is <strong>P(<var>S</var> &gt; <var>T</var>) + ½ P(<var>S</var> = <var>T</var>)</strong>. Under a fixed opponent model, a prospective score <var>s</var> earns the probability that <var>T</var> falls below <var>s</var> plus half the mass at <var>s</var>. Using a score distribution preserves the information needed to weigh a tie and the risk of losing.</p>`,
    `${modelFlow(false)}
<p>The turn solver enumerates dice multisets and weights reroll outcomes by their exact probabilities. It compares the expected continuation for each legal hold with the value of scoring now. Future score probability mass functions (PMFs) are cached by remaining-category mask and upper subtotal. A PMF is exact for its specified policy and tie-breaking order. A fixed-policy rollout approximates play against an opponent whose decisions react to the scorecard.</p>
<p>For the endgame comparison, each estimator supplies stopping values, and the exact turn solver derives its policy. An interactive expectiminimax solver then evaluates that policy against the same optimal-play reference. <dfn>Decision regret</dfn> is the reference optimal turn value minus the value of the estimator’s turn policy, in percentage points per turn. The calculation integrates over possible rolls at each sampled position. ${link(source.v5, "PMF and solver methods")} · ${link(source.v7, "Exact regret protocol")}</p>`,
    `<p>Earlier learning experiments included PPO with self-play and a DP teacher, as well as distributional QR-DQN. The full-game QR-DQN pilot fits 16 quantiles of future terminal credit per action. That learned return distribution serves a different purpose from the exact final-score PMF of a fixed policy. The three-initialization PPO with a DP teacher averaged 50.069% against Win DP v2 (1,200 held-out games per initialization, 95% interval across initializations 49.335–50.804%). This comparison left superiority unresolved. ${cite("qr-dqn", "Dabney et al. (2018)")} · ${link(source.offPolicy, "Full-game RL pilots")} · ${link(source.extendedPpo, "Multiseed PPO results")}</p>
<dl>
<dt><strong>Win DP v2 and v3</strong></dt><dd>v2 extends the competitive Bellman calculation to the last two categories, assuming DP Expert for the opponent’s remaining play. v3 adds a third category for its own planning and uses a Gaussian opponent-score approximation when the opponent has at least three categories left.</dd>
<dt><strong>Win DP v4-D</strong></dt><dd>The service configuration uses a frozen REINFORCE residual checkpoint and a v3.3-family late-game policy. The harness calls the service’s registered v4-D configuration. The optional v3.3 pack and v3.4 response feature are disabled in this configuration.</dd>
<dt><strong>v5-R and v6-P</strong></dt><dd>v5-R optimizes this turn’s win credit, then rolls out DP Expert score distributions for both players. v6-P lets its future play commit to the best of seven exponential-utility policies with different risk preferences, while forecasting a DP Expert opponent.</dd>
<dt><strong>v7 response models</strong></dt><dd>I1RO solves the opponent’s next turn with the v5-R objective, mixes the outcomes into an opponent final-score PMF, and evaluates its continuation against that mixture. I2RO1 uses one DP Expert bank and also solves its own next turn against the mixture. I2R1 solves that next turn separately for each opponent outcome.</dd>
</dl>
<p>${link(source.servicePolicy, "Registered v4-D policy")} · ${link(source.agents, "Benchmark model registry")} · ${link(source.v6, "v6 policy set")} · ${link(source.handoff, "I2RO1 algorithm")}</p>`,
    `<p>The benchmarks play complete 1:1 games. Each seed is used twice with seats swapped, so each policy goes first once. The engine uses separate per-seat dice streams, reusing the seeded streams across seat swaps and intentionally matched comparisons. Policies receive the public state with seed and RNG fields cleared. The single observation is the average credit of the two games at a seed. A common-opponent contrast takes the difference of those pair averages on the same seeds. ${link(source.bench, "Tournament runner")} · ${cite("glasserman-yao", "Glasserman and Yao (1992)")}</p>
<p>Intervals are two-sided paired normal approximations, 95% for the original v2 run and 99% for the later runs shown here. The project’s registered superiority tests use one-sided p-values, with Holm adjustment where specified for the hypothesis family. Sample size and stopping were fixed for the confirmatory runs. Development families such as 9001, 9011, 9101, 9102, and 9107 were used for design or selection. Families 9501/9502, 9511/9512, 9531/9541, 9551–9553, and 9571/9581 are the later test blocks, with 9553 primarily supporting descriptive comparisons. Family 9591 was reserved for finalist selection. ${cite("holm", "Holm (1979)")} · ${link(source.v7, "Registered v7 plans")}</p>`,
    `<p><strong>Win credit</strong> is (wins + 0.5 × draws) / games. Outright win rate is wins / games. For example, 50,165 outright wins in 100,000 games is 50.165%. The 766 draws raise credit to 50.548%. The first two rows list v2 seed bases. The remaining rows list seed families. Each row has <var>n</var> unique pairs and 2<var>n</var> games.</p>
${benchmarkTable(false)}
${intervalChart(false)}
<p>In the v2 confirmation against DP Expert, v2 averaged 191.08 points to 191.94. v5-R passed all three registered 9501 tests against v2, v3, and DP Expert. Against v2 it averaged 189.13 points to 190.82. v6-P beat v5-R directly in 9511 (Holm-adjusted decision at α = 0.01) and 9512, while their common-opponent contrast against v2 was +0.071 percentage points in 9511 (99% CI −0.051 to +0.192, 50,000 pairs). ${link(source.results, "Results index")} · ${link(run(45558614547), "9501 tournament shards")} · ${link(source.v5Final, "9501 aggregate")} · ${link(source.v6, "v6 confirmation")}</p>
<p>In v7’s 9531 primary family, I1RO beat DP Expert (51.392% credit despite mean scores 189.65 to 192.17). Its v6-P comparison missed the Holm-adjusted threshold (adjusted p = 0.016 at family α = 0.01). The 9541 replication was positive (one-sided p = 0.0002). The larger 9551 test missed the threshold (p = 0.152), as did each 9552 variant. I1RO remains partially confirmed, and v6-P retained the research lead. ${link(source.v7Confirm, "9531/9541 summaries")} · ${link(source.v7, "Final v7 interpretation")}</p>
<p>I2RO1 passed the 9571 test against v4-D (Holm-adjusted p ≈ 2.3 × 10<sup>−8</sup>) and replicated in 9581. Its 9571 comparison with v5-R missed the threshold (p = 0.041 at family α = 0.01), and the 9581 interval again included 50%. The v5-R row against v4-D in 9571 is descriptive. Family 9591 selected I2RO1 as the finalist, with superiority over v5-R still unresolved. The service retained v4-D for free Very Hard and kept v5-R as an opt-in trial. ${link(source.handoff, "Product handoff")} · ${link(source.decision, "Service decision D-V7-6")} · ${link(source.difficulty, "Difficulty mapping")} · ${link(source.v5Trial, "Trial configuration")} · ${link(up + "ai/", "AI levels (Korean)")}</p>
${shardTable(false)}
<h3>External strategy ports</h3>
<p>The separate external-strategy comparison used 2,000 seat-swapped games per port, all under YachtLab’s 12-category rules. RustOptimalEquivalent12 was a proxy with the same expected-score objective and earned 49.250% against Win DP v2 (multiplicity-adjusted 98.75% CI 48.313–50.187%). BenjiWinObjective12 used a local win-objective proxy and earned 50.025% (49.189–50.861%). The comparisons establish no advantage for either proxy. Original binaries, 13-category joker rules and original evaluation objectives would require a separate benchmark. ${link(source.external, "Rule adaptations and original sources")} · ${link(source.externalCode, "Port definitions")} · ${link(source.externalRunner, "Comparison runner")}</p>`,
    `<p><strong>Rollout and solver depth.</strong> In 9501 against v2, v5-X3 (DP Expert with an exact interactive endgame when both players have at most three open categories) trailed v5-R by 0.337 percentage points (paired 99% CI −0.596 to −0.077). Adding the exact three-category interactive endgame to v5-R (v5-B3) yielded +0.046 points (−0.051 to +0.143). Each contrast uses 50,000 seed pairs. ${link(source.v5Final, "v5 paired ablations")}</p>
<p><strong>Opponent response.</strong> Across 2,400 K=4 positions (both players at most four categories left, sampled from 300 development games in 9101), regret was 0.0171 percentage points per turn for v6-P, 0.0151 for the nonreactive I1D control, 0.0089 for I1RO, and 0.0035 for I2RO. This supports explicit opponent response as a mechanism in the tested endgame. I2RO1 reduced single-bank regret from v5-R’s 0.0270 to 0.0043 at K=4 and from 0.0258 to 0.0062 on the 2,000-position K=5 sample. In full-game development play, I2R and I2RO had slightly negative point estimates against I1RO, so the registered research-track confirmation was deferred. ${link(source.regret, "K=4 response ablation")} · ${link(source.regretResponse, "I1RO regret")} · ${link(source.regretI2RO, "I2RO regret")} · ${link(source.regretProduct, "Single-bank ablation")} · ${link(source.v7, "Development matchups and K=5 protocol")}</p>`,
    `<p>v6-P and I1RO both use seven PMF banks (about 2.1 GB for Float64 tables, about 1 GB for Float32 tables). In the early v7 Actions matches, I1RO averaged about 2.0–2.2 ms per decision (p99 approximately 16–18 ms against v6-P), versus about 0.19 ms for v6-P. The 100,000-game head-to-head matches used roughly 8,200–8,800 aggregate runner CPU seconds for both agents. A separate Float64 server prototype used about 2.7 GB resident after loading seven banks. ${link(source.v6, "Table memory")} · ${link(source.v7Confirm, "Runner timing")} · ${link(source.serverCost, "Server prototype measurements")}</p>
<p>In the clean archived browser benchmark, v5-R and I2RO1 each used 146.25 MiB of WASM linear memory. I2RO1 took 4.5 ms mean, 39.2 ms p99, and 49.3 ms maximum per decision in a desktop Chromium Web Worker across 20 games. Pixel 7 emulation at 4× CPU slowdown on the main thread measured 18.9 ms mean, 163.4 ms p99, and 187.8 ms maximum. v5-R measured 0.14 ms and 0.48 ms mean in those two configurations. The I2RO1 bank took about 8.2 s to build on desktop and 33 s under emulation on a cold start. Decision timing excludes setup. Linear memory excludes JS heap and process overhead. The emulated figures describe the benchmark host, and physical Android/iOS measurements remain open. ${link(source.cost, "Browser and Node measurements")} · ${link(source.handoff, "Measurement protocol")}</p>`,
    `<p>The claims apply to the named YachtLab policies, seeds, engine, and fixed game rules. Results against humans or an external field, whole-game optimality, and performance under other rules require separate evidence. Establishing the state of the art (SOTA) would require independent opponents evaluated with the same rules, objective, and computational budget. The intervals report estimation uncertainty, and the registered one-sided tests determine superiority. Establishing equivalence or noninferiority requires a design for that objective, such as the v5-R Float32 noninferiority check. Endgame positions come from development games, and lower regret over four or five remaining categories has limited predictive value for full-game strength. ${link(source.v7, "v7 limitations")} · ${link(source.results, "Float32 noninferiority protocol")}</p>
<p>The archive audit found 60 game seeds shared by two 9106 teacher datasets, so a joint analysis needs a game-seed split. The 9107 log repeats shard 1 in four matchups, with one retained compressed result per shard and matchup. The audit examined a sample of CI artifacts and confirmed only part of the public summary against raw materials. Its legacy cache and seed-address findings limit assumptions about unfinished or undocumented runs. ${link(source.audit, "Audit findings and coverage")}</p>`,
    `<p>For v2, the run uses separate seed bases 1,350,000 and 1,370,000. For v5–v7, the runner hashes <code>0x5eed0000 + family × 1,000,003 + shard × 20,011 + i</code>, where <code>i</code> is the pair index within a shard. Use the model revision and shard plan from the matching run. The run history includes v2 <code>76f206d</code>, v5 <code>96b0025</code>, v6 <code>c8a3bd3</code>, early v7 <code>5561c58</code>, 9551/9552 <code>9c62460</code>, 9571/9581 <code>7cd8f89</code>, and 9591 <code>e638a62</code>. The 9501 aggregation was a separate run. ${link(source.benchV2, "v2 seed schedule")} · ${link(source.bench, "v5–v7 runner")} · ${link(source.workflow, "Workflow")} · ${link(run(45558614547), "Original 9501 run")}</p>
<p>The versioned shard lines contain win/draw/loss counts and the first two moments of pair credit. Pool those moments by matchup to reproduce the paired interval. Each displayed JSONL aggregate has 20 unique shards per matchup. For example, from the repository root:</p>
<pre tabindex="0"><code>python3 scripts/research-v7/shard-lines.py training/results/v7/confirm-v71/shards-9551.jsonl</code></pre>
<p>To reproduce a tournament shard, check out the run’s model commit, install the locked dependencies, and use that run’s pairing and seed parameters. The following is shard 0 of the archived 9571 v4-D comparison. It writes the individual game scores to a compressed file.</p>
<pre tabindex="0"><code>git switch --detach 7cd8f89
npm ci
npx tsx scripts/research-v5/bench.ts --a p-I2RO1 --b v4D --family 9571 --shard 0 --pairs 2500 --out out</code></pre>
<p>The 9102 and 9107 compressed shards also preserve individual scores and seeds. Aggregate one file per shard and matchup. The 9581 and 9591 figures above follow the archived summary outputs. Actions artifacts are subject to retention limits, so the pinned summaries and JSONL logs provide stable entry points. ${link(source.aggregate, "Aggregation code")} · ${link(source.dev9102, "9102 raw shards")} · ${link(source.dev9107, "9107 raw shards")} · ${link(source.auditSamples, "Audited Actions sample")}</p>`,
    `<p>The archived roadmap prioritizes early- and midgame decision quality, where endgame teachers provide little coverage. It proposes exact teacher generation around six open categories, sampled rollout regret for larger states, and faster simulation with additional variance reduction. The record leaves the 9561-series research and 9592 product seed reservations unused. Any resumption should keep teacher splits at the game-seed level and check physical device latency and memory before revisiting the service model. ${link(source.v7, "Archived directions")} · ${link(source.handoff, "Device validation plan")}</p>`,
    referenceList(false),
  ];
}

function korean(up) {
  return [
    `<p class="lead">YachtLab은 12칸 요트다이스에서 상대의 대응을 미리 계산하면 대국 성능이 높아지는지 검증했습니다. v7 모델은 정확한 종반 결정 손실을 줄였고, 전체 대국에서는 사전 등록한 선정 규칙에 따라 v6-P가 연구 기준 최강 모델로 남았습니다. 분포표 하나를 쓰는 I2RO1은 두 시드군에서 v4-D를 앞섰으며, v5-R 대비 우위는 아직 미확정입니다. 서비스의 무료 ‘매우 어려움’은 Win DP v4-D를 사용합니다. ${link(source.v7, "v7 연구 기록")} · ${link(source.handoff, "제품 인수인계")}</p>`,
    `<p>YachtLab은 공정한 6면체 주사위 5개, 차례당 최대 3회 굴림, 점수 칸 12개를 쓰는 닌텐도식 요트다이스입니다. 상단 합계가 63점 이상이면 35점이 추가됩니다. DP Expert는 단독 플레이의 기대 총점을 최대화하는 기준 정책이며, 시작 시 이론 기대값은 191.760879752165점입니다. 대국에서 좋은 선택은 상대의 점수와 남은 칸에 따라 달라질 수 있습니다. ${link(up + "guide/", "게임 규칙")} · ${link(up + "scores/", "족보와 점수판")} · ${link(source.dp, "DP 기준선")}</p>`,
    `<p>Verhoeff와 Scheffers는 단독 Yahtzee의 최적 정책을 구현했습니다. Pawlewicz는 참가자 상태를 함께 고려해야 하는 다인 Yahtzee와 그 근사 해법을 연구했습니다. 두 연구는 기대점수와 대국 성능을 구분하는 데 참고가 됩니다. 각 문헌의 점수와 성능 수치는 미국식 Yahtzee 규칙에 따릅니다. Nintendo의 소개에서 요트다이스의 규칙 계열을 확인할 수 있으며, 벤치마크의 세부 규칙은 YachtLab 엔진에 따릅니다. ${cite("verhoeff", "Verhoeff·Scheffers (1999)")} · ${cite("pawlewicz", "Pawlewicz (2011)")} · ${cite("nintendo", "Nintendo")}</p>`,
    `<p>판단에 쓰는 정보는 공개된 주사위 눈, 사용한 굴림 횟수, 양쪽 점수판, 그리고 현재 차례입니다. 빈 칸에 점수를 쓰거나 굴림이 남았으면 일부 주사위를 킵하고 나머지를 다시 굴릴 수 있습니다. 내 최종 점수를 <var>S</var>, 상대 점수를 <var>T</var>라 하면 목표는 <strong>P(<var>S</var> &gt; <var>T</var>) + ½ P(<var>S</var> = <var>T</var>)</strong>를 최대화하는 것입니다. 상대 정책을 고정하면 내 예상 점수 <var>s</var>의 가치는 <var>T</var>가 <var>s</var>보다 낮을 확률에 동점 확률의 절반을 더한 값입니다. 점수분포를 쓰면 동점과 패배 위험을 함께 반영할 수 있습니다.</p>`,
    `${modelFlow(true)}
<p>턴 솔버는 주사위 눈의 중복 조합을 열거하고 재굴림 결과에 정확한 확률을 곱합니다. 각 킵의 기대 가치와 지금 기록할 때의 정지가치를 비교합니다. 미래 점수의 확률질량함수(PMF)는 남은 칸을 나타내는 비트마스크와 상단 누적 점수별로 저장합니다. 이 분포는 지정한 정책과 동률 처리 순서에 대해 정확합니다. 점수판에 반응하는 상대에게 고정 정책 롤아웃을 적용하면 근사가 됩니다.</p>
<p>종반 평가에서는 각 추정값을 정지가치로 삼아 정확한 턴 솔버로 정책을 구합니다. 그런 다음 상대의 대응까지 포함하는 정확한 expectiminimax 솔버로 이 정책의 가치를 평가합니다. <dfn>결정 손실(regret)</dfn>은 기준 솔버의 최적 턴 가치에서 후보 정책의 턴 가치를 뺀 값이며, 턴당 퍼센트포인트(%p)로 표시합니다. 각 표본 국면의 계산에는 가능한 굴림 결과가 모두 포함됩니다. ${link(source.v5, "분포와 솔버 방법")} · ${link(source.v7, "정확 결정 손실 평가")}</p>`,
    `<p>앞선 학습 실험에서는 자기대국 PPO와 DP 교사, 분포형 강화학습 QR-DQN을 비교했습니다. 12라운드 QR-DQN 파일럿은 행동별 최종 승점 분포의 분위수 16개를 학습합니다. 앞서 정의한 PMF는 고정 정책의 최종 점수분포를 정확히 계산하는 데 쓰입니다. DP 교사를 쓴 PPO의 Win DP v2 상대 평균은 50.069%였습니다(초기화 3개, 각각 미사용 시드 1,200경기, 초기화 간 95% 구간 49.335–50.804%). 이 비교에서 우위는 미확정입니다. ${cite("qr-dqn", "Dabney 외 (2018)")} · ${link(source.offPolicy, "전체 경기 강화학습 실험")} · ${link(source.extendedPpo, "PPO 다중 시드 결과")}</p>
<dl>
<dt><strong>Win DP v2·v3</strong></dt><dd>v2는 상대가 남은 차례에 DP Expert처럼 둔다고 보고, 마지막 2칸까지 경쟁 목적의 Bellman 계산을 확장했습니다. v3는 내 마지막 3칸을 계산하고 상대가 3칸 이상 남았을 때 상대 점수분포를 가우시안으로 근사합니다.</dd>
<dt><strong>Win DP v4-D</strong></dt><dd>고정된 REINFORCE 잔차 정책 체크포인트와 v3.3 계열 종반 정책을 사용합니다. 벤치마크는 서비스에 등록된 v4-D 구현을 호출하며, 선택형 v3.3 팩과 v3.4 상대 대응 기능은 비활성 상태입니다.</dd>
<dt><strong>v5-R·v6-P</strong></dt><dd>v5-R은 현재 턴의 승리점수율을 최적화하고 이후 양쪽에 DP Expert 점수분포를 적용합니다. v6-P는 상대를 DP Expert로 예측하면서, 내 미래 플레이에는 위험 선호가 다른 지수효용 정책 7개 중 최선인 하나를 선택합니다.</dd>
<dt><strong>v7 상대 대응 모델</strong></dt><dd>I1RO는 v5-R 목적함수로 상대의 다음 턴을 풀고, 그 결과들을 섞어 상대의 최종점수 분포를 만든 뒤 내 이후 가치를 구합니다. I2RO1은 DP Expert 분포표 하나를 사용하며, 이 혼합 분포에 대해 내 다음 턴도 정확히 풉니다. I2R1은 상대의 결과마다 내 다음 턴을 따로 풉니다.</dd>
</dl>
<p>${link(source.servicePolicy, "서비스 v4-D 구현")} · ${link(source.agents, "대국 평가 모델 목록")} · ${link(source.v6, "v6 정책군")} · ${link(source.handoff, "I2RO1 알고리즘")}</p>`,
    `<p>모든 대진은 1대1 완전 대국입니다. 시드마다 좌석을 바꿔 두 경기를 진행해 각 정책이 한 번씩 선공합니다. 엔진은 좌석별로 별도의 주사위 난수열을 사용하며, 같은 시드의 좌석 교대 경기와 의도적으로 짝지은 비교 대진에는 동일한 난수열을 다시 사용합니다. 정책에는 시드와 난수 생성기 상태를 지운 공개 상태를 전달합니다. 두 경기의 평균 승점을 시드쌍 관측치 하나로 처리합니다. 공통 상대 대비는 같은 시드에서 두 정책의 쌍별 평균 승점 차이로 구합니다. ${link(source.bench, "대국 실행기")} · ${cite("glasserman-yao", "Glasserman·Yao (1992)")}</p>
<p>신뢰구간은 시드쌍 단위의 양측 정규 근사입니다. 초기 v2는 95%, 이후 표의 대진은 99%입니다. 사전 등록 우월성 검정에는 단측 p값을 사용하고, 계획에 지정된 가설군에는 Holm 보정을 적용했습니다. 확증 대국은 표본 크기와 종료 규칙을 사전에 고정했습니다. 9001, 9011, 9101, 9102, 9107 등은 개발 또는 후보 선정에 사용한 시드군입니다. 9501/9502, 9511/9512, 9531/9541, 9551–9553, 9571/9581은 이후의 평가 시드군이며, 9553은 주로 기술 비교에 사용했습니다. 9591은 최종 후보 선정에 사용했습니다. ${cite("holm", "Holm (1979)")} · ${link(source.v7, "v7 사전 등록 계획")}</p>`,
    `<p><strong>승리점수율</strong>은 (승리 수 + 0.5 × 무승부 수) / 경기 수입니다. 승률을 순수 승리 비율로 계산하면 승리 수 / 경기 수입니다. 예를 들어 100,000경기의 50,165승은 순수 승리 비율 50.165%이며, 766무를 반영한 승리점수율은 50.548%입니다. 첫 두 행의 시드는 v2의 기준값이고, 나머지는 시드군 번호입니다. 각 행은 고유 시드쌍 <var>n</var>개와 총 2<var>n</var>경기로 구성됩니다.</p>
${benchmarkTable(true)}
${intervalChart(true)}
<p>v2가 DP Expert와 치른 확증 대국의 평균 점수는 191.08 대 191.94였습니다. v5-R은 9501에서 v2, v3, DP Expert 상대 주 가설 3개를 모두 통과했습니다. v2전의 평균 점수는 189.13 대 190.82였습니다. v6-P는 9511(Holm 보정, α = 0.01)과 9512에서 v5-R 직접 대결 우위를 보였습니다. 공통 상대 v2와의 9511 대진에서 쌍별 차이는 +0.071%p였습니다(99% 신뢰구간 −0.051~+0.192%p, 50,000쌍). ${link(source.results, "실험 결과 목록")} · ${link(run(45558614547), "9501 원 실행")} · ${link(source.v5Final, "9501 집계")} · ${link(source.v6, "v6 확증")}</p>
<p>v7의 9531 주 확증에서 I1RO는 DP Expert를 상대로 승리점수율 51.392%를 냈습니다(평균 점수 189.65 대 192.17). v6-P 상대 결과는 Holm 기준에 미달했습니다(보정 p = 0.016, 가설군 α = 0.01). 9541 재현은 유의했습니다(단측 p = 0.0002). 더 큰 9551 검정(p = 0.152)과 9552의 두 변형은 기준에 미달했습니다. I1RO는 부분 확증으로 기록됐고, 연구 기준 최강 모델은 v6-P로 유지됐습니다. ${link(source.v7Confirm, "9531·9541 집계")} · ${link(source.v7, "v7 최종 해석")}</p>
<p>I2RO1의 v4-D 상대 우위는 9571(Holm 보정 p ≈ 2.3 × 10<sup>−8</sup>)에서 확증됐고 9581에서 재현됐습니다. v5-R 상대 9571 검정은 기준에 미달했고(p = 0.041, 가설군 α = 0.01), 9581의 구간도 50%를 포함했습니다. 9571의 v5-R 대 v4-D 행은 기술 통계입니다. 9591에서는 I2RO1을 최종 후보로 선정했으며, v5-R 대비 우위는 미확정입니다. 서비스는 무료 ‘매우 어려움’의 v4-D와 선택형 v5-R 시험판을 유지했습니다. ${link(source.handoff, "제품 인수인계")} · ${link(source.decision, "운영 결정 D-V7-6")} · ${link(source.difficulty, "난이도 설정")} · ${link(source.v5Trial, "시험판 설정")} · ${link(up + "ai/", "AI 난이도")}</p>
${shardTable(true)}
<h3>외부 전략의 12칸 이식 비교</h3>
<p>별도 외부 전략 비교는 YachtLab 12칸 규칙에서 이식판마다 2,000경기를 좌석을 바꿔 진행했습니다. 기대점수 목적의 대리 정책 RustOptimalEquivalent12는 Win DP v2 상대 49.250%(다중 비교 보정 98.75% 구간 48.313–50.187%), 승리 목적의 대리 정책 BenjiWinObjective12는 50.025%(49.189–50.861%)였습니다. 두 대리 정책의 우위는 미확정입니다. 원본 실행 파일과 13칸 조커 규칙, 원래 목적함수는 별도 평가가 필요합니다. ${link(source.external, "규칙 이식 방식과 원저자 자료")} · ${link(source.externalCode, "이식 정책 코드")} · ${link(source.externalRunner, "평가 실행기")}</p>`,
    `<p><strong>롤아웃과 종반 탐색 깊이.</strong> 9501에서 v2를 상대로 한 쌍별 대비에서 DP Expert에 양측 3칸 이하의 정확한 상호작용 솔버를 더한 v5-X3는 v5-R보다 0.337%p 낮았습니다(99% 신뢰구간 −0.596~−0.077%p). v5-R에 양측 3칸 이하의 정확한 상호작용 솔버를 더한 v5-B3는 +0.046%p였습니다(−0.051~+0.143%p). 두 대비는 각각 50,000쌍을 사용했습니다. ${link(source.v5Final, "v5 쌍별 구성 비교")}</p>
<p><strong>상대 대응.</strong> 개발 시드 9101의 300경기에서 뽑은 K=4 국면 2,400개(양쪽 모두 남은 칸 4개 이하)에서 턴당 결정 손실은 v6-P 0.0171%p, 상대가 내 점수에 반응하지 않는 대조군 I1D 0.0151%p, I1RO 0.0089%p, I2RO 0.0035%p였습니다. 이 비교는 해당 종반에서 상대 대응을 모델링한 효과를 뒷받침합니다. 단일 분포표를 쓰는 I2RO1은 v5-R 대비 K=4에서 0.0270%p에서 0.0043%p로, K=5 국면 2,000개에서 0.0258%p에서 0.0062%p로 줄였습니다. 전체 개발 대국에서 I1RO를 상대한 I2R·I2RO의 점추정은 50%를 조금 밑돌아, 연구 트랙의 확증은 보류됐습니다. ${link(source.regret, "K=4 상대 대응 비교")} · ${link(source.regretResponse, "I1RO 결정 손실")} · ${link(source.regretI2RO, "I2RO 결정 손실")} · ${link(source.regretProduct, "단일 분포표 비교")} · ${link(source.v7, "개발 대국과 K=5 설계")}</p>`,
    `<p>v6-P와 I1RO는 분포표 7개를 사용합니다(Float64 약 2.1 GB, Float32 약 1 GB). 초기 v7 Actions 대국에서 I1RO의 판단 평균은 약 2.0–2.2 ms(v6-P 상대 p99 약 16–18 ms), v6-P는 약 0.19 ms였습니다. 100,000경기 직접 대결의 두 에이전트 합산 러너 CPU 시간은 약 8,200–8,800초였습니다. Float64 서버 프로토타입에서 분포표 7개를 올린 뒤 상주 메모리는 약 2.7 GB였습니다. ${link(source.v6, "분포표 메모리")} · ${link(source.v7Confirm, "러너 측정")} · ${link(source.serverCost, "서버 프로토타입 측정")}</p>
<p>경합 없이 실행한 보존 벤치마크에서 v5-R과 I2RO1은 각각 WASM 선형 메모리 146.25 MiB를 사용했습니다. I2RO1의 데스크톱 Chromium Web Worker 20경기 판단 시간은 평균 4.5 ms, p99 39.2 ms, 최대 49.3 ms였습니다. CPU를 4배 감속한 Pixel 7 에뮬레이션의 메인 스레드에서는 평균 18.9 ms, p99 163.4 ms, 최대 187.8 ms였습니다. v5-R의 평균은 각각 0.14 ms와 0.48 ms였습니다. 콜드 스타트에서 I2RO1 분포표 생성에 각각 약 8.2초와 33초가 들었습니다. 판단 시간은 초기화 이후의 값이며, JS 힙과 프로세스 오버헤드는 선형 메모리와 별도입니다. 이 수치는 에뮬레이션을 실행한 호스트에서 얻었으며, 실제 Android·iOS 기기 측정은 남아 있습니다. ${link(source.cost, "브라우저·Node 원자료")} · ${link(source.handoff, "측정 조건")}</p>`,
    `<p>결과의 적용 범위는 명시된 YachtLab 정책, 시드, 엔진, 고정 규칙입니다. 인간이나 외부 AI 전체에 대한 성능, 전 구간 최적성, 다른 규칙에서의 성능은 별도 근거가 필요합니다. 요트다이스 SOTA를 판단하려면 동일한 규칙·목적함수·계산 예산으로 독립된 상대 정책과 비교해야 합니다. 신뢰구간은 추정의 불확실성을 나타내며, 우위 판정은 사전 등록한 단측 검정을 따릅니다. 동등성이나 비열등성을 판단하려면 그 목적에 맞는 사전 설계가 필요하며, v5-R의 Float32 검증이 그 예입니다. 남은 4~5칸 국면은 개발 대국에서 뽑았고, 해당 국면의 결정 손실로 전체 대국 성능을 예측하는 데는 한계가 있습니다. ${link(source.v7, "v7 해석의 한계")} · ${link(source.results, "Float32 비열등성 검증")}</p>
<p>재현성 감사에서 두 9106 교사 자료에 공통 경기 시드 60개가 확인됐습니다. 두 자료를 함께 분석할 때는 경기 시드 단위로 분할해야 합니다. 9107의 네 대진 로그에서 샤드 1이 두 번 기록됐고, 압축 결과는 대진과 샤드마다 한 파일씩 보존돼 있습니다. 감사는 CI 아티팩트를 표본 조사했고, 공개 요약 일부를 원자료와 대조했습니다. 이전 캐시와 시드 주소 방식의 제약 때문에 중단됐거나 메타데이터가 없는 실행까지 소급 검증하기는 어렵습니다. ${link(source.audit, "감사 결과와 검증 범위")}</p>`,
    `<p>v2는 시드 기준값 1,350,000과 1,370,000을 따로 사용했습니다. v5–v7 실행기는 <code>0x5eed0000 + family × 1,000,003 + shard × 20,011 + i</code>를 해시하며, <code>i</code>는 샤드 내 시드쌍 인덱스입니다. 각 실행에 기록된 모델 커밋과 샤드 계획을 사용합니다. 실행 커밋은 v2 <code>76f206d</code>, v5 <code>96b0025</code>, v6 <code>c8a3bd3</code>, 초기 v7 <code>5561c58</code>, 9551/9552 <code>9c62460</code>, 9571/9581 <code>7cd8f89</code>, 9591 <code>e638a62</code>입니다. 9501은 별도 실행에서 집계했습니다. ${link(source.benchV2, "v2 시드 방식")} · ${link(source.bench, "v5–v7 실행기")} · ${link(source.workflow, "워크플로")} · ${link(run(45558614547), "9501 원 실행")}</p>
<p>보존된 샤드 로그에는 승·무·패와 쌍별 승점의 합 및 제곱합이 있습니다. 같은 대진의 값을 합쳐 쌍별 신뢰구간을 재계산할 수 있습니다. 표의 JSONL 집계는 대진별 고유 샤드 20개를 사용합니다. 예를 들어 저장소 루트에서 다음 명령으로 9551을 집계합니다.</p>
<pre tabindex="0"><code>python3 scripts/research-v7/shard-lines.py training/results/v7/confirm-v71/shards-9551.jsonl</code></pre>
<p>대국 샤드를 재현하려면 실행의 모델 커밋을 체크아웃하고 잠금 파일 기준으로 의존성을 설치한 뒤, 원 실행의 대진과 시드를 지정합니다. 아래는 9571 v4-D 대조의 0번 샤드이며 경기별 점수를 압축 파일로 저장합니다.</p>
<pre tabindex="0"><code>git switch --detach 7cd8f89
npm ci
npx tsx scripts/research-v5/bench.ts --a p-I2RO1 --b v4D --family 9571 --shard 0 --pairs 2500 --out out</code></pre>
<p>9102와 9107의 압축 샤드에는 개별 경기 점수와 시드도 보존돼 있습니다. 대진·샤드별로 파일을 하나씩 집계합니다. 표의 9581과 9591은 보존된 요약 출력을 따릅니다. Actions 아티팩트 보존 기간이 지나도 고정 커밋의 요약과 JSONL 로그를 확인할 수 있습니다. ${link(source.aggregate, "집계 코드")} · ${link(source.dev9102, "9102 원시 샤드")} · ${link(source.dev9107, "9107 원시 샤드")} · ${link(source.auditSamples, "감사에서 확인한 Actions 표본")}</p>`,
    `<p>보존된 계획은 기존 종반 교사로 평가하기 어려운 초·중반 결정 품질을 우선합니다. 남은 칸 6개 안팎의 정확 교사 생성, 더 큰 상태의 표본 롤아웃 기반 결정 손실, 엔진 가속과 추가 분산 감소가 후속 과제입니다. 연구용 9561번대와 제품 후속 검증용 9592는 미사용으로 남겨 두었습니다. 연구를 재개할 경우 교사 자료를 경기 시드 단위로 분리하고, 서비스 모델을 다시 검토하기 전에 실기기 지연과 메모리를 확인하는 것이 인수인계 계획에 포함돼 있습니다. ${link(source.v7, "후속 연구 기록")} · ${link(source.handoff, "실기기 검증 계획")}</p>`,
    referenceList(true),
  ];
}

function makePage(lang) {
  const ko = lang === "ko";
  const path = ko ? "research/" : "research/en/";
  const alternatePath = ko ? "research/en/" : "research/";
  const alternateHref = ko ? "./en/" : "../";
  const alternateLang = ko ? "en" : "ko";
  const up = ko ? "../" : "../../";
  const url = site + path;
  const headline = ko ? "YachtLab 요트다이스 AI 연구" : "YachtLab Yacht Dice AI Research";
  const title = ko ? `${headline} | 대국 벤치마크 v2–v7` : `${headline} | v2–v7 Benchmarks`;
  const description = ko
    ? "12칸 요트다이스 AI v2–v7 연구. 승리점수율과 시드쌍 신뢰구간, 정확 종반 결정 손실, 계산 비용, 서비스 모델 v4-D의 근거를 공개합니다."
    : "YachtLab’s v2–v7 research on 12-category Yacht Dice, with paired win-credit benchmarks, exact endgame regret, compute costs, and the v4-D service decision.";
  const sections = ko ? korean(up) : english(up);
  const nav = sectionIds.map((id, i) => link(`#${id}`, headings[lang][i])).join("\n  ");
  const content = sectionIds.map((id, i) => `<section id="${id}">
<h2>${headings[lang][i]}</h2>
${sections[i]}
</section>`).join("\n");
  const translation = { "@id": `${site}${alternatePath}#article` };
  const article = {
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline,
    description,
    url,
    mainEntityOfPage: url,
    inLanguage: lang,
    author: { "@type": "Organization", name: "YachtLab", url: repo },
    genre: ko ? "프로젝트 연구 보고서" : "Project research report",
    isBasedOn: [source.v7, source.handoff, source.audit],
    citation: [...references.map(({ url }) => url), source.results, source.v5Final, source.v6, source.v7Confirm],
    ...(ko ? { workTranslation: translation } : { translationOfWork: translation }),
  };

  return {
    path,
    title,
    description,
    crumb: ko ? "AI 연구" : "AI Research",
    lang,
    body: `<article class="research-article">
<header class="research-heading">
<h1>${headline}</h1>
<p><a href="${alternateHref}" rel="alternate" hreflang="${alternateLang}" lang="${alternateLang}">${ko ? "Read in English" : "한국어로 읽기"}</a></p>
<p class="note">${ko ? "연구 기록 기준일" : "Archive snapshot"} <time datetime="2026-11-26">${ko ? "2026년 11월 26일" : "November 26, 2026"}</time></p>
</header>
<nav class="toc" aria-label="${ko ? "연구 목차" : "Research contents"}">
  ${nav}
</nav>
${content}
</article>`,
    jsonld: [article],
  };
}

export const researchPages = [makePage("ko"), makePage("en")];
