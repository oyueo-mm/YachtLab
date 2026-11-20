import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const smoke = process.argv.includes("--smoke");
const mode = smoke ? "smoke" : "full";
const server = await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix = x => {x >>>= 0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return (x^(x>>>16))>>>0;};
const rngFrom = init => {let n=mix(init)||1;return ()=>{n=(Math.imul(1664525,n)+1013904223)>>>0;return n/4294967296;};};
const gaussian = rng => {const u=Math.max(1e-12,rng()),v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
const mean = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
const round = x => +x.toFixed(7);
try {
  const engine=await server.ssrLoadModule("/src/engine.ts");
  const { dpDecision, setDPTable }=await server.ssrLoadModule("/src/dp.ts");
  const { winDPv2Decision }=await server.ssrLoadModule("/src/competitive-v2.ts");
  const { residualDecision, FEATURE_NAMES, ZERO_RESIDUAL_WEIGHTS }=await server.ssrLoadModule("/src/selfplay-residual.ts");
  const m=JSON.parse(await readFile("src/dp-manifest.json","utf8"));
  const zipped=gunzipSync(await readFile("public/ai/"+m.asset));
  setDPTable(zipped.buffer.slice(zipped.byteOffset,zipped.byteOffset+zipped.byteLength));

  const base={name:"DP Expert",kind:"dp"};
  const win={name:"Win DP v2",kind:"win"};
  const zeros={name:"DP anchored residual (zero)",kind:"learned",weights:[...ZERO_RESIDUAL_WEIGHTS]};
  const normalize = (weights) => weights.map(x=>Math.min(3,Math.max(-3,x)));
  const fromWeights = (name,weights) => ({name,kind:"learned",weights:normalize(weights)});
  const fitness=(matches)=>mean(matches.map(m=>m.winCredit));
  let policyRng=rngFrom(20261120);
  let decisionCount=0;

  function simulate(a,b,seed,seat,{sample=false,trace=false}={}) {
    const players=seat===0?[a,b]:[b,a];
    const random=[rngFrom(mix(seed+0x1234567)),rngFrom(mix(seed+0x9876543))];
    let state=engine.createGame(seed,true);
    const logs=[[],[]];
    let moves=0;
    const start=performance.now();
    while(!state.done){
      if(state.rolls===0){state=engine.transition(state,{type:"roll"});continue;}
      const who=state.player, agent=players[who];
      let d;
      if(agent.kind==="dp")d=dpDecision(state);
      else if(agent.kind==="win")d=winDPv2Decision(state)??dpDecision(state);
      else {
        const picked=residualDecision(state,agent.weights,{sample, rng:random[who],temperature:.85});
        d=picked.decision;
        if(trace&&who===seat)logs[who].push(picked.gradient);
      }
      decisionCount++;
      if(d.type==="score")state=engine.transition(state,{type:"score",category:d.category});
      else{state=engine.transition(state,{type:"hold",ids:d.ids});state=engine.transition(state,{type:"roll"});}
      if(++moves>180)throw Error("Full-game self-play exceeded legal decision budget");
    }
    const own=engine.total(state.cards[seat]),other=engine.total(state.cards[1-seat]);
    return {seed,seat,own,other,winCredit:own>other?1:(own===other?0.5:0),elapsedMs:performance.now()-start,
      ...(trace?{gradient:logs[seat].reduce((a,b)=>a.map((x,i)=>x+b[i]),Array(FEATURE_NAMES.length).fill(0))}:{})};
  }

  function duel(a,b,pairs,baseSeed,{raw=false}={}) {
    const credits=[],samples=raw?[]:null;
    let score=0,oppScore=0,elapsed=0,wins=0,draws=0,losses=0;
    for(let j=0;j<pairs;j++){
      const seed=mix(baseSeed+j),one=simulate(a,b,seed,0),two=simulate(a,b,seed,1);
      credits.push((one.winCredit+two.winCredit)/2);
      for(const x of [one,two]){
        score+=x.own;oppScore+=x.other;elapsed+=x.elapsedMs;
        if(x.winCredit===1)wins++;
        else if(x.winCredit===.5)draws++;
        else losses++;
      }
      if(samples)samples.push({seed,first:one,second:two});
    }
    const v=mean(credits),sd=Math.sqrt(credits.reduce((a,x)=>a+(x-v)**2,0)/Math.max(1,credits.length-1));
    const ci=1.96*sd/Math.sqrt(credits.length);
    return {policy:a.name,opponent:b.name,pairs,games:2*pairs,winCredit:round(v),
      ci95:[round(Math.max(0,v-ci)),round(Math.min(1,v+ci))],
      ownMean:round(score/(2*pairs)),opponentMean:round(oppScore/(2*pairs)),
      totalSimTimeMs:round(elapsed),wins,draws,losses,...(samples?{samples}:{})};
  }

  function assess(candidate,opponents,pairs,baseSeed) {
    const matches=opponents.map((opp,i)=>duel(candidate,opp,pairs,baseSeed+i*25000));
    return {candidate:candidate.name,fitness:round(fitness(matches)),matches};
  }

  const generations=smoke?1:6,population=smoke?3:12,trainPairs=smoke?1:10,validatePairs=smoke?2:180,finalPairs=smoke?2:1800;
  let champion=zeros;
  const history=[],hall=[zeros],saved=[zeros],populationTrace=[];
  for(let generation=0;generation<generations;generation++){
    const sigma=.85*Math.pow(.84,generation);
    const contestants=[champion];
    for(let k=1;k<population;k++)
      contestants.push(fromWeights("ES g"+generation+" candidate"+k,
        champion.weights.map(v=>v+gaussian(policyRng)*sigma)));
    const opponents=[base,win,hall[Math.max(0,hall.length-2)]];
    const results=contestants.map(c=>assess(c,opponents,trainPairs,16000000+generation*50000));
    const best=results.map((x,i)=>({...x,index:i})).sort((a,b)=>b.fitness-a.fitness)[0];
    champion=contestants[best.index];
    const snapshot=fromWeights("ES champion g"+generation,champion.weights);
    champion=snapshot;
    hall.push(snapshot);saved.push(snapshot);
    history.push({generation,candidate:snapshot.name,weights:snapshot.weights,fitness:best.fitness,
      winCreditVsDP:best.matches[0].winCredit,winCreditVsWinDPv2:best.matches[1].winCredit,
      winCreditVsSelfPlayAncestor:best.matches[2].winCredit,sigma});
    populationTrace.push({generation,results:results.map((x,i)=>({candidate:contestants[i].name,fitness:x.fitness}))});
    console.log("SELFPLAY_ES_PROGRESS "+JSON.stringify(history.at(-1)));
  }

  // Genuine on-policy REINFORCE: policy decisions are sampled, and their
  // full-game scorecard WIN/LOSS reward updates the actor, against a league.
  const gradientEpochs=smoke?1:10,gradientGames=smoke?4:96;
  const pgUpdates=[],pgWeights=[...champion.weights],lr=.65;
  for(let epoch=0;epoch<gradientEpochs;epoch++){
    const grad=Array(pgWeights.length).fill(0),league=[base,win,zeros,hall[Math.floor(policyRng()*hall.length)]];
    const learner=fromWeights("REINFORCE actor",pgWeights);
    let totalReward=0;
    for(let i=0;i<gradientGames;i++){
      const opp=league[i%league.length],seat=(i%2);
      const sample=simulate(learner,opp,mix(18300000+epoch*2000+i),seat,{sample:true,trace:true});
      const reward=sample.winCredit-.5;
      totalReward+=sample.winCredit;
      for(let k=0;k<grad.length;k++)grad[k]+=reward*sample.gradient[k];
    }
    for(let k=0;k<pgWeights.length;k++)pgWeights[k]=Math.max(-3,Math.min(3,pgWeights[k]+lr*grad[k]/gradientGames));
    pgUpdates.push({epoch,trainingWinCredit:round(totalReward/gradientGames),weights:[...pgWeights]});
    console.log("SELFPLAY_PG_PROGRESS "+JSON.stringify(pgUpdates.at(-1)));
  }
  const pg=fromWeights("REINFORCE full-game self-play",pgWeights);
  saved.push(pg);

  // Model selection has an independent validation range, separate from the
  // final confirmatory set. After selection, weights are frozen.
  const selectionCandidates=[zeros,...hall.slice(-3),pg];
  const unique=[...new Map(selectionCandidates.map(x=>[x.name,x])).values()];
  const evaluation=unique.map(c=>assess(c,[base,win],validatePairs,19800000));
  evaluation.sort((a,b)=>b.fitness-a.fitness);
  const selected=unique.find(c=>c.name===evaluation[0].candidate);
  if(!selected)throw Error("Selected candidate not found");
  console.log("SELFPLAY_SELECTION "+JSON.stringify({selected:selected.name,evaluation:evaluation.map(x=>({candidate:x.candidate,fitness:x.fitness}))}));
  const confirm=[
    duel(selected,base,finalPairs,22100000,{raw:true}),
    duel(selected,win,finalPairs,22100000+9000,{raw:true}),
    duel(win,base,smoke?2:450,22100000+18000,{raw:true}),
  ];
  const leagueEval=[base,win,zeros,...hall.slice(-2),pg];
  const metaResults=[];
  for(let i=0;i<leagueEval.length;i++)for(let j=i+1;j<leagueEval.length;j++)
    metaResults.push(duel(leagueEval[i],leagueEval[j],smoke?1:24,23100000+i*100+j));
  const report={
    kind:"full 12-category reward-driven self-play training and opponent league",mode,date:new Date().toISOString(),
    sourceCommit:process.env.GITHUB_SHA??"local",
    purpose:"Compare evolution-strategy league best response, REINFORCE final-win policy gradient and strong DP anchors",
    seedPolicy:"unique deterministic per-seat dice RNG via engine.createGame(seed,true); policy sampling RNG independently derived from public external research seed",
    featureNames:FEATURE_NAMES,
    models:{zeroBaseline:zeros,selected,finalES:champion,reinforce:pg},
    training:{method:"evolution strategies against DP Expert / Win DP v2 / historical league snapshots; then on-policy REINFORCE gradient from full game win/draw/loss",generations,population,trainPairs,gradientEpochs,gradientGames,
      selectedBy:"separate validation seed range 19800000", trainingHistory:history,policyGradient:pgUpdates,populationTrace},
    selection:evaluation,
    confirmation:{seedBase:22100000,pairedSeats:true,finalPairs,headToHead:confirm},
    metaGame:metaResults,
    totalDecisions:decisionCount,
    limitations:[
      "Evolution strategies and REINFORCE are genuine training from full-game win rewards, but neither is a proof of Nash equilibrium or world SOTA.",
      "The league uses historical snapshots and DP opponents; it is PSRO-inspired, not a complete PSRO meta-solver or an equilibrium oracle.",
      "Parameter/hyperparameter selection uses separate training and validation seeds. Confirmatory direct head-to-head uses a new untouched range.",
      "Win DP v2 assumes a fixed DP Expert final-turn opponent policy, so opponent modeling might differ for learned policies.",
      "Winning on one fixed set of opponents does not establish robustness to all opponent strategies.",
      "Candidate may not improve over the baseline; in that case only the research checkpoint is saved and the website default must not change."
    ]
  };
  await mkdir("training/results",{recursive:true});
  await mkdir("training/checkpoints",{recursive:true});
  await mkdir("docs/context/_generated",{recursive:true});
  await writeFile("training/results/full-selfplay-research.json",JSON.stringify(report,null,2)+"\n");
  await writeFile("training/checkpoints/full-selfplay-selected.json",JSON.stringify({
    name:selected.name,weights:selected.weights,featureNames:FEATURE_NAMES,trainingSource:report.sourceCommit,selectionSeedBase:19800000,validationWins:evaluation[0],confirmation:confirm.map(({samples,...rest})=>rest),deployApproved:false
  },null,2)+"\n");
  const conf=confirm.map(({samples,...rest})=>rest);
  const line=r=>"| "+r.policy+" | "+r.opponent+" | "+r.games+" | "+(100*r.winCredit).toFixed(3)+"% | "+r.ci95.map(x=>(x*100).toFixed(3)+"%").join("–")+" |";
  const markdown=[
    "# 전체 12라운드 자기 대국 연구 — 자동 실험 결과","",
    "> 승패 보상으로 정책 가중치를 실제 학습한 결과. 세계 SOTA나 검증된 최강 모델이라고 가정하지 않음.","",
    "- 코드 SHA: "+report.sourceCommit,
    "- 전체 게임 진화 탐색: "+generations+" 세대 × "+population+" 후보, 리그 상대 DP Expert/Win DP v2/이전 세대.",
    "- 실제 최종 승패 보상 REINFORCE: "+gradientEpochs+" epochs × "+gradientGames+" games.",
    "- 최종 후보는 별도 시드 검증에서 고정: **"+selected.name+"**.",
    "- 후보 가중치 및 학습 이력: [결과 체크포인트](https://github.com/oyueo-mm/YachtLab/actions/workflows/full-selfplay.yml) (Actions Artifacts).",
    "","## 독립 시드 확증","",
    "| 정책 | 상대 | 경기 | 승리 점수율 | 95% 짝별 근사 CI |",
    "|---|---|---:|---:|---|",...conf.map(line),"",
    "## 모델 선택 검증(확증과 다른 시드)","",
    "| 후보 | 종합 리그 점수 |", "|---|---:|",...evaluation.map(r=>"| "+r.candidate+" | "+(r.fitness*100).toFixed(3)+"% |"),"",
    "## 해석상 주의사항","",...report.limitations.map(s=>"- "+s),"",
    "- 원시 경기별 결과는 \`full-selfplay-research\` GitHub Actions 아티팩트에 보존함.",
    "- 전체 실험/학습 상세: [프로젝트 연구 설명](../SELFPLAY-RESEARCH.md).",
    "- 기존 검증: [RESULTS](../RESULTS.md), [Algorithm Zoo](../EXPERIMENT-ZOO-2026-11-20.md).",""
  ];
  await writeFile("docs/context/_generated/SELFPLAY-LATEST.md",markdown.join("\n"));
  console.log("SELFPLAY_SUMMARY "+JSON.stringify({mode,features:FEATURE_NAMES.length,generations,population,gradientEpochs,selected:selected.name,
    trainingHistory:history.map(({weights,...rest})=>rest),validation:evaluation.map(r=>({candidate:r.candidate,fitness:r.fitness})),
    confirmation:conf,totalDecisions:decisionCount}));
} finally { await server.close(); }
