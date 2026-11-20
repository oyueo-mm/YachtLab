import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const smoke = process.argv.includes("--smoke");
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
const mix = (x) => { x >>>= 0; x = Math.imul(x ^ x >>> 16, 0x85ebca6b); x = Math.imul(x ^ x >>> 13, 0xc2b2ae35); return (x ^ x >>> 16) >>> 0; };
const bitcount = (x) => { let n = 0; for (; x; x &= x - 1) n++; return n; };
const average = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const round = (x) => +x.toFixed(7);

try {
  const { createGame, transition, total, available, upper, categories, score } = await server.ssrLoadModule("/src/engine.ts");
  const { decide } = await server.ssrLoadModule("/src/ai.ts");
  const { dpDecision, dpActionValue, dpActionValues, dpFutureValue } = await server.ssrLoadModule("/src/dp.ts");
  const { winDPDecision } = await server.ssrLoadModule("/src/win-dp.ts");
  const { winDPv2Decision } = await server.ssrLoadModule("/src/competitive-v2.ts");
  const { researchGuidedDecision } = await server.ssrLoadModule("/src/research-guided-mcts.ts");
  const manifest = JSON.parse(await readFile("src/dp-manifest.json", "utf8"));
  const packed = gunzipSync(await readFile("public/ai/" + manifest.asset));
  const { setDPTable } = await server.ssrLoadModule("/src/dp.ts");
  setDPTable(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));

  const all = [], make = (family, param, description, heavy = false) => {
    const id = family + (param === undefined ? "" : "-" + String(param).replace(/\./g, "_"));
    const policy = { id, family, param, description, heavy };
    if (all.some((p) => p.id === id)) throw Error("duplicate: " + id);
    all.push(policy);
    return policy;
  };
  const dp = make("baseline", "DP", "Exact full-game expected score DP");
  const v1 = make("baseline", "WinDP", "One-category final-turn win DP");
  const v2 = make("baseline", "WinDPv2", "Two-category final-turn win DP");
  make("legacy", "Greedy", "One-reroll greedy");
  make("legacy", "Expectimax", "Full-turn expectimax approximate utility", true);
  for (const n of [32, 96, 256]) make("legacyMCTS", n, "UCT turn search at " + n + " iterations", true);
  for (const width of [6, 10, 15, 20, 30, 45]) make("balanceGate", width, "Win DP v2 only near projected parity ±" + width);
  for (const threshold of [-25, -15, -5, 0, 5, 15, 25]) make("trailGate", threshold, "Win DP v2 if projected score gap ≤ " + threshold);
  for (const cap of [0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 16]) make("lossCap", cap, "Win DP v2 only when immediate DP-expectation loss ≤ " + cap);
  for (const s of [0.05, 0.1, 0.2, 0.35, 0.5, 0.8]) make("adaptiveCap", s, "Allowed DP loss = 0.5 + " + s + " × projected point deficit");
  for (const width of [0.05, 0.1, 0.2, 0.3]) make("winProbGate", width, "Win DP v2 only when predicted competitive value within 0.5 ± " + width);
  for (const alpha of [-2, -1, -0.5, 0.5, 1, 2]) make("riskProxy", alpha, "DP Q with opponent-score-aware dice-volatility surrogate " + alpha);
  for (const [type, bias] of [["upper",0.5],["upper",1.5],["yacht",0.5],["yacht",1.5],["straight",0.5],["straight",1.5]]) make("categoryPrior", type + bias, "DP Q + " + bias + " additive " + type + " category prior");
  for (const n of [16, 48, 96]) make("guided", n, "Root UCB sampled chance rollouts with DP heuristic, " + n + " iterations", true);
  for (const t of [-20, 0, 20]) make("guidedConditional", t, "Root UCB only with projected deficit >= " + t + " at 3 remaining", true);

  const remainingMask = (card) => categories.reduce((m, c, i) => m | (card[c] === undefined ? 1 << i : 0), 0);
  const expectedGap = (state) => {
    const mine = state.cards[state.player], other = state.cards[1 - state.player];
    return total(mine) + dpFutureValue(remainingMask(mine), Math.min(63, upper(mine)))
      - total(other) - dpFutureValue(remainingMask(other), Math.min(63, upper(other)));
  };
  const publicHash = (state) => {
    let h = 2166136261 >>> 0;
    for (const n of [...state.dice.map(d => d.value),state.rolls,state.player,
      ...state.cards.flatMap(card => categories.map(c => card[c] === undefined ? 255 : card[c]))])
      h = Math.imul(h ^ n, 16777619) >>> 0;
    return h;
  };
  const baseline = (state) => dpDecision(state);
  const lastOne = (state) => winDPDecision(state) ?? baseline(state);
  const candidateFromQ = (state, q, family, param) => {
    const card = state.cards[state.player], rem = available(card).length;
    const gap = expectedGap(state), trailing = gap < 0 ? 1 : -1;
    let best = -Infinity, chosen = -1;
    for (let i = 0; i < q.length; i++) {
      if (!Number.isFinite(q[i])) continue;
      let bonus = 0;
      if (family === "riskProxy" && rem >= 3 && rem <= 8) {
        const sigma = i < 32 ? Math.sqrt(5 - bitcount(i)) : Math.sqrt(Math.max(1, rem - 1)) / 2;
        bonus = Number(param) * trailing * sigma;
      }
      if (family === "categoryPrior" && rem >= 3 && rem <= 8 && i >= 32) {
        const c = categories[i - 32], [kind, number] = String(param).match(/^(upper|yacht|straight)(.*)$/).slice(1);
        if ((kind === "upper" && i - 32 < 6) || (kind === "yacht" && c === "yacht") ||
          (kind === "straight" && (c === "small" || c === "large"))) bonus = Number(number);
      }
      const value = q[i] + bonus;
      if (value > best + 1e-10) { best = value; chosen = i; }
    }
    if (chosen < 0) throw Error("No valid legal action in Q policy");
    const common = { value: q[chosen], candidates: [], note: "research " + family + ": point-value proxy, not a calibrated win probability" };
    return chosen >= 32
      ? { type: "score", category: categories[chosen - 32], ...common }
      : { type: "reroll", ids: state.dice.filter(d => chosen & (1 << d.id)).map(d => d.id), ...common };
  };
  const choose = (state, policy) => {
    const rem = available(state.cards[state.player]).length;
    if (policy.family === "baseline") {
      if (policy.param === "DP") return baseline(state);
      if (policy.param === "WinDP") return lastOne(state);
      return winDPv2Decision(state) ?? baseline(state);
    }
    if (policy.family === "legacy") return decide(state, policy.param, { seed: publicHash(state) });
    if (policy.family === "legacyMCTS") return decide(state, "MCTS", { iterations: policy.param, seed: publicHash(state) });
    if (rem === 1) return lastOne(state);
    if ((policy.family === "guided" || policy.family === "guidedConditional") && rem === 3) {
      if (policy.family === "guided" || -expectedGap(state) >= policy.param) return researchGuidedDecision(state, policy.family === "guided" ? policy.param : 48);
    }
    if ((policy.family === "riskProxy" || policy.family === "categoryPrior") && rem >= 3 && rem <= 8)
      return candidateFromQ(state, dpActionValues(state), policy.family, policy.param);
    if (rem !== 2) return baseline(state);
    const gap = expectedGap(state);
    if (policy.family === "balanceGate" && Math.abs(gap) > policy.param) return baseline(state);
    if (policy.family === "trailGate" && gap > policy.param) return baseline(state);
    const w = winDPv2Decision(state);
    if (!w) return baseline(state);
    if (policy.family === "winProbGate" && Math.abs(w.value - 0.5) > policy.param) return baseline(state);
    if (policy.family === "lossCap" || policy.family === "adaptiveCap") {
      const qWin = dpActionValue(state, w);
      const qOpt = dpDecision(state).value;
      const loss = qOpt - qWin;
      const cap = policy.family === "lossCap" ? Number(policy.param) : 0.5 + Math.max(0, -gap) * Number(policy.param);
      if (loss > cap + 1e-9) return baseline(state);
    }
    return w;
  };
  const play = (candidate, opponent, seed, side) => {
    const agents = side === 0 ? [candidate, opponent] : [opponent, candidate];
    let state = createGame(seed, true), moves = 0;
    const decisionTimes = [0,0];
    while (!state.done) {
      if (!state.rolls) { state = transition(state,{type:"roll"}); continue; }
      const actor = state.player, start = performance.now();
      const d = choose(state, agents[actor]);
      decisionTimes[actor] += performance.now() - start;
      if (d.type === "score") state = transition(state,{type:"score",category:d.category});
      else { state = transition(state,{type:"hold",ids:d.ids}); state = transition(state,{type:"roll"}); }
      if (++moves > 160) throw Error("Exceeded game move budget: " + candidate.id + " / " + opponent.id);
    }
    const mine = total(state.cards[side]), their = total(state.cards[1-side]);
    return { mine, their, credit: mine > their ? 1 : mine === their ? 0.5 : 0, decisionMs: decisionTimes[side] };
  };
  const test = (candidate, opponent, pairs, base, retainRaw = false) => {
    const credits = [], samples = retainRaw ? [] : null;
    let score = 0, theirs = 0, time = 0, wins = 0, draws = 0, losses = 0;
    for (let p = 0; p < pairs; p++) {
      const seed = mix(base + p);
      const first = play(candidate, opponent, seed, 0), second = play(candidate, opponent, seed, 1);
      const credit = (first.credit + second.credit) / 2;
      credits.push(credit);
      for (const x of [first,second]) {
        score += x.mine; theirs += x.their; time += x.decisionMs;
        if (x.credit === 1) wins++;
        else if (x.credit === 0.5) draws++;
        else losses++;
      }
      if (samples) samples.push({seed,first,second});
    }
    const mean = average(credits), sd = Math.sqrt(credits.reduce((a,c)=>a+(c-mean)**2,0)/Math.max(1,pairs-1));
    const margin = 1.96*sd/Math.sqrt(pairs);
    return { policy:candidate.id, family:candidate.family, opponent:opponent.id, pairs, games:pairs*2,
      winCredit:round(mean), ci95:[round(Math.max(0,mean-margin)),round(Math.min(1,mean+margin))],
      scoreMean:round(score/(pairs*2)), opponentScoreMean:round(theirs/(pairs*2)), decisionMsPerGame:round(time/(pairs*2)),
      wins,draws,losses,seedBase:base, ...(samples ? { samples } : {}) };
  };
  const sample = all.find(p => p.family === "lossCap");
  const fake = { ...createGame(1222,true),rolls:1,dice:[1,2,3,5,6].map((value,id)=>({id,value,held:false})) };
  const altered = { ...fake,seed:123123,rng:[111,222] };
  for (const candidate of all) {
    const a=choose(fake,candidate), b=choose(altered,candidate);
    if (a.type !== b.type || (a.type === "score" ? a.category !== b.category : a.ids.join(",") !== b.ids.join(","))) throw Error("Public-observation determinism failed: " + candidate.id);
  }
  const scan = [];
  const searchBase = 1700000, validationBase = 1850000, finalBase = 2110000;
  for (const [idx,policy] of all.entries()) {
    const pairs = smoke ? 2 : policy.heavy ? 12 : 64;
    scan.push(test(policy,dp,pairs,searchBase));
    if ((idx + 1) % 8 === 0 || idx+1 === all.length)
      console.log("SWEEP_PROGRESS " + JSON.stringify({ complete:idx+1,variants:all.length,latest:policy.id }));
  }
  const searchRanked = scan.filter(x=>x.family !== "legacy" && x.family !== "legacyMCTS").sort((a,b)=>b.winCredit-a.winCredit);
  const ids = [...new Set([v2.id,...searchRanked.slice(0,smoke?2:12).map(x=>x.policy)])];
  const contenders = ids.map(id=>all.find(p=>p.id===id));
  const round2 = contenders.map((c,i)=>test(c,dp,smoke?2:400,validationBase));
  const best = round2.filter(x=>x.policy!==v2.id).sort((a,b)=>b.winCredit-a.winCredit)[0] ?? round2[0];
  const selected = all.find(p=>p.id===best.policy);
  const confirm = [
    test(selected,dp,smoke?2:6000,finalBase,true),
    test(selected,v2,smoke?2:6000,finalBase+8000,true),
    test(selected,v1,smoke?2:1000,finalBase+16000,true),
    test(v2,dp,smoke?2:1500,finalBase+21000,true),
  ];
  const diagnostics = {
    timestamp: new Date().toISOString(), mode: smoke?"smoke":"full",
    rules:"Nintendo-style 12-category Yacht Dice, five dice, three rolls, upper 63 bonus 35",
    modelVersion:"GitHub commit " + (process.env.GITHUB_SHA ?? "local"),
    baseline:"DP Expert (exact expected-score objective), independent seat-specific dice streams",
    metrics:"win=1, draw=0.5, loss=0; normal approximate 95% CI on independent paired-seed means",
    families:[...new Set(all.map(p=>p.family))], variants:all, candidatesTested:all.length,
    protocol:{ searchSeedBase:searchBase,validationSeedBase:validationBase,confirmSeedBase:finalBase,
      selection:"64 seed pairs for normal variants (12 for costly variants), promote 12 + baseline; evaluate promoted candidates using 400 pairs; select one primary nominee without consulting confirmation seeds; two-sided direct matches vs baseline and v1; DO NOT interpret search wins as proof.",
      smoke, multipleComparisons:"Search/validation comparisons are exploratory; independent direct head-to-head vs Win DP v2 is the primary check; 95% CIs are unadjusted for the many searched configurations." },
    scan, round2, selected: selected.id, confirm,
    limitations:[
      "Many candidates are hyperparameter variants, not independent algorithm families.",
      "Risk proxies and category priors are heuristics, not calibrated win probabilities.",
      "Opponent models in Win DP v2 assume fixed DP Expert policy.",
      "Exhaustive self-play, trained deep RL, PSRO, and full expectiminimax are not implemented by this sweep.",
      "Changing a source model, calibration, or opponent changes the interpretation of the result.",
      "GitHub Actions artifacts may expire; a compact summary is committed to the repository.",
    ],
  };
  await mkdir("benchmarks/research",{recursive:true});
  await writeFile("benchmarks/research/zoo-run.json",JSON.stringify(diagnostics,null,2)+"\n");
  const short = { timestamp:diagnostics.timestamp,mode:diagnostics.mode,modelVersion:diagnostics.modelVersion,
    candidatesTested:all.length,families:diagnostics.families,scan:scan.map(({policy,family,winCredit,ci95,pairs})=>({policy,family,winCredit,ci95,pairs})),
    round2:round2.map(({policy,family,winCredit,ci95,pairs})=>({policy,family,winCredit,ci95,pairs})),selected:selected.id,
    confirm:confirm.map(({samples,...rest})=>rest),protocol:diagnostics.protocol,limitations:diagnostics.limitations };
  await mkdir("docs/context/_generated",{recursive:true});
  await writeFile("docs/context/_generated/zoo-summary.json",JSON.stringify(short,null,2)+"\n");
  const table=(rows)=>["| 후보 | 상대 | 경기 | 승리 점수율 | 95% 근사 CI |","|---|---|---:|---:|---|",...rows.map(r=>"| "+r.policy+" | "+r.opponent+" | "+r.games+" | "+(r.winCredit*100).toFixed(3)+"% | "+(r.ci95[0]*100).toFixed(3)+"~"+(r.ci95[1]*100).toFixed(3)+"% |")];
  const md=[
    "# 알고리즘 대량 실험 — 자동 생성 결과",
    "",
    "> 성공한 스크립트가 계산한 실제 통계. 이 문서는 자동 생성되며 세계 SOTA 주장이 아닙니다.",
    "",
    "- 실행 시간(UTC): "+diagnostics.timestamp,
    "- 소스 커밋: "+diagnostics.modelVersion,
    "- 시험 후보: **"+all.length+"개 파라미터/기법 조합**, 알고리즘 계열 "+diagnostics.families.length+"종.",
    "- 규칙: 12카테고리 Nintendo-style Yacht Dice; 승리 1/무승부 0.5/패배 0.",
    "- 모든 비교에서 독립적인 주사위 RNG를 선수별로 사용하고 시드마다 선후공을 바꿈.",
    "- **주의:** 선별 단계의 최고 승률은 여러 후보 중 선택된 편향이 있음. 미사용 최종 시드의 직접 대결 결과가 핵심.",
    "",
    "## 유망 후보 탐색 — 상위 12종",
    "",...table(round2.slice().sort((a,b)=>b.winCredit-a.winCredit).slice(0,12)),
    "",
    "## 확증 — 탐색 종료 후 고정된 1개 후보",
    "",
    "- 사전 선별 후보: **"+selected.id+"** ("+selected.family+").",
    "",...table(confirm),
    "",
    "## 연구적 한계",
    "",
    ...diagnostics.limitations.map(x=>"- "+x),
    "",
    "## 원시 결과",
    "",
    "- [결과 JSON 요약](./zoo-summary.json)",
    "- 원시 경기별 점수 및 모든 후보군 스캔 결과: GitHub Actions \`algorithm-zoo-raw\` 아티팩트",
    "- 재현: \`node scripts/sweep-algorithms.mjs\` (\`--smoke\`는 축소 테스트)",
    "- 기존 검증 결과: [RESULTS.md](../RESULTS.md)",
    "",
  ];
  await writeFile("docs/context/_generated/LATEST_EXPERIMENT.md",md.join("\n"));
  console.log("SWEEP_SUMMARY "+JSON.stringify({variants:all.length,families:diagnostics.families.length,selected:selected.id,round2:round2.map(x=>({policy:x.policy,rate:x.winCredit})),confirm:confirm.map(({samples,...rest})=>rest)}));
} finally { await server.close(); }
