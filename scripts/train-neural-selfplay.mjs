import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
const rng=seed=>{let x=mix(seed);return ()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};};
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const clip=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
try {
  const engine=await server.ssrLoadModule("/src/engine.ts");
  const {setDPTable,dpDecision}=await server.ssrLoadModule("/src/dp.ts");
  const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
  const neural=await server.ssrLoadModule("/src/neural-residual.ts");
  const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8")),b=gunzipSync(await readFile("public/ai/"+manifest.asset));
  setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const dp={name:"DP Expert",kind:"dp"},win={name:"Win DP v2",kind:"win"};
  const models=[
    {name:"Neural REINFORCE",kind:"neural",algorithm:"reinforce",params:neural.createNeuralResidual(304)},
    {name:"Neural Monte-Carlo Actor-Critic",kind:"neural",algorithm:"mc-actor-critic",params:neural.createNeuralResidual(911)},
  ];
  const actorStats=models.map(m=>({m:Array(neural.NEURAL_GRADIENT_SIZE).fill(0),v:Array(neural.NEURAL_GRADIENT_SIZE).fill(0),t:0}));
  let totalDecisions=0;
  function applyAdam(model,gradient,optimizer,lr) {
    let flat=neural.unpackNeuralActor(model.params);
    optimizer.t++;
    for(let k=0;k<flat.length;k++){
      const g=clip(gradient[k],-2,2);
      optimizer.m[k]=.9*optimizer.m[k]+.1*g;
      optimizer.v[k]=.999*optimizer.v[k]+.001*g*g;
      const m=optimizer.m[k]/(1-Math.pow(.9,optimizer.t));
      const v=optimizer.v[k]/(1-Math.pow(.999,optimizer.t));
      flat[k]=clip(flat[k]+lr*m/(Math.sqrt(v)+1e-8),-2.5,2.5);
    }
    neural.setNeuralActor(model.params,flat);
  }
  function play(a,b,seed,seat,{sample=false,training=false}={}) {
    const agents=seat===0?[a,b]:[b,a];
    const random=[rng(mix(seed+10100)),rng(mix(seed+20100))];
    let state=engine.createGame(seed,true);
    const records=[],start=performance.now();
    while(!state.done){
      if(!state.rolls){state=engine.transition(state,{type:"roll"});continue;}
      const who=state.player,agent=agents[who];
      let action;
      if(agent.kind==="dp")action=dpDecision(state);
      else if(agent.kind==="win")action=winDPv2Decision(state)??dpDecision(state);
      else {
        const d=neural.neuralResidualDecision(state,agent.params,{sample:sample&&who===seat,rng:random[who],temperature:.8,pointLossCap:3});
        action=d.decision;
        if(training&&who===seat)records.push({gradient:d.gradient,valueFeatures:d.valueFeatures,stateValue:d.stateValue});
      }
      totalDecisions++;
      if(action.type==="score")state=engine.transition(state,{type:"score",category:action.category});
      else{state=engine.transition(state,{type:"hold",ids:action.ids});state=engine.transition(state,{type:"roll"});}
    }
    const mine=engine.total(state.cards[seat]),other=engine.total(state.cards[1-seat]);
    return {credit:mine>other?1:(mine===other?0.5:0),mine,other,records,elapsedMs:performance.now()-start};
  }
  function duel(a,b,pairs,seedBase,{raw=false}={}) {
    let credits=[],own=0,opp=0,records=raw?[]:null;
    for(let i=0;i<pairs;i++){
      const seed=mix(seedBase+i),first=play(a,b,seed,0),second=play(a,b,seed,1);
      credits.push((first.credit+second.credit)/2);
      own+=first.mine+second.mine;opp+=first.other+second.other;
      if(records)records.push({seed,first:{credit:first.credit,mine:first.mine,other:first.other},second:{credit:second.credit,mine:second.mine,other:second.other}});
    }
    const rate=mean(credits),sd=Math.sqrt(credits.reduce((s,v)=>s+(v-rate)**2,0)/Math.max(1,pairs-1));
    const h=1.96*sd/Math.sqrt(pairs);
    return {policy:a.name,opponent:b.name,pairs,games:pairs*2,winCredit:rate,ci95Approx:[Math.max(0,rate-h),Math.min(1,rate+h)],
      meanPoints:own/(2*pairs),opponentPoints:opp/(2*pairs),...(records?{raw:records}:{})};
  }
  const batches=smoke?2:75, batchGames=smoke?8:96, snapshots=[{name:"Initial Neural",kind:"neural",params:neural.createNeuralResidual(304)}];
  const progress=[];
  for(let j=0;j<models.length;j++){
    const model=models[j],optimizer=actorStats[j],algorithm=model.algorithm,history=[];
    for(let batch=0;batch<batches;batch++){
      const actor=Array(neural.NEURAL_GRADIENT_SIZE).fill(0),critic=Array(5).fill(0);
      let rewardSum=0,observations=0,actorGradNorm=0;
      const opponents=[dp,win,...snapshots.slice(-3)];
      for(let k=0;k<batchGames;k++){
        const opponent=opponents[k%opponents.length],seat=k%2,seed=mix(31000000+j*250000+batch*400+k);
        const game=play(model,opponent,seed,seat,{sample:true,training:true});
        rewardSum+=game.credit;
        for(const step of game.records){
          if(!step.gradient.some(v=>v!==0))continue;
          const advantage=game.credit-(algorithm==="mc-actor-critic"?step.stateValue:.5);
          for(let x=0;x<actor.length;x++)actor[x]+=advantage*step.gradient[x];
          if(algorithm==="mc-actor-critic"){
            const delta=(game.credit-step.stateValue)*step.stateValue*(1-step.stateValue);
            for(let x=0;x<5;x++)critic[x]+=delta*step.valueFeatures[x];
          }
          observations++;
        }
      }
      const scale=Math.max(1,batchGames);
      applyAdam(model,actor.map(x=>x/scale),optimizer,.0028);
      if(algorithm==="mc-actor-critic")for(let x=0;x<5;x++)model.params.critic[x]=clip(model.params.critic[x]+.35*critic[x]/Math.max(1,observations),-6,6);
      if((batch+1)%(smoke?1:15)===0){
        const snapshot={name:model.name+" epoch "+(batch+1),kind:"neural",params:neural.cloneNeuralResidual(model.params)};
        snapshots.push(snapshot);
        const dpEval=duel(snapshot,dp,smoke?1:40,33000000+j*300000+batch*500);
        const v2Eval=duel(snapshot,win,smoke?1:40,33100000+j*300000+batch*500);
        const entry={model:model.name,batch:batch+1,games:(batch+1)*batchGames,trainingRate:rewardSum/batchGames,observations,
          winCreditVsDP:dpEval.winCredit,winCreditVsV2:v2Eval.winCredit,
          learnedActorNorm:Math.sqrt(neural.unpackNeuralActor(model.params).reduce((sum,v)=>sum+v*v,0))};
        history.push(entry);console.log("NEURAL_SELFPLAY_PROGRESS "+JSON.stringify(entry));
      }
    }
    progress.push({algorithm:model.name,batches,batchGames,history});
  }
  const baseline={name:"DP anchored zero neural",kind:"neural",params:neural.createNeuralResidual(304)};
  baseline.params.w2.fill(0);
  const selections=[baseline,...models];
  const validation=selections.map(m=>({name:m.name,
    vsDP:duel(m,dp,smoke?2:200,34000000),
    vsWinV2:duel(m,win,smoke?2:200,34100000)}));
  const ranked=validation.map((r,i)=>({...r,index:i,fitness:(r.vsDP.winCredit+r.vsWinV2.winCredit)/2})).sort((a,b)=>b.fitness-a.fitness);
  const chosen=selections[ranked[0].index];
  const final=[
    duel(chosen,dp,smoke?2:1800,37000000,{raw:true}),
    duel(chosen,win,smoke?2:1800,37100000,{raw:true}),
    duel(models[0],models[1],smoke?2:300,37200000,{raw:true})
  ];
  const summary={
    kind:"Full 12-round neural self-play: REINFORCE vs Monte-Carlo advantage actor-critic",
    date:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA??"local",
    batches,batchGames,trainingGamesPerAlgorithm:batches*batchGames,
    modelArchitecture:"Shared per-action MLP 12→12→1 as residual over exact DP Q; separate 5-feature sigmoid value baseline in actor-critic.",
    teacher:"DP Expert expected-score action values anchor; last two categories handled by existing Win DP v2",
    opponents:"DP Expert, Win DP v2 and frozen earlier trained neural snapshots",
    trainingSource:"real 12-round win=1/draw=.5/lose=0, on-policy policy-gradient, independent RNG per player and sampled policy",
    hyperparameters:"fixed: Adam lr .0028, temperature .8, point loss cap 3.0, 75×96 games each, critics trained with Monte-Carlo final returns",
    controls:"separate zero-weight teacher-anchored neural baseline; trained REINFORCE and MC advantage actor-critic; validation to choose one; final new seed matches",
    progress,validation,selected:chosen.name,
    selectedParameters:chosen.params,
    final,decisionCount:totalDecisions,
    limitations:[
      "Actor-critic uses Monte-Carlo terminal advantage, not bootstrapped temporal-difference A2C/PPO.",
      "Final two categories use fixed Win DP v2, not learned neural behavior.",
      "This is a small residual network (12 hidden units), not a large foundation model.",
      "Evolution policy, 3-turn solver and PSRO equilibrium solver are separate experiments; no claim to run full AlphaZero/MuZero.",
      "One seed per learner and fixed training budget; hyperparameter superiority is unverified.",
      "Selection/validation and untouched confirmation seeds are disjoint, but several research experiments may still have multiple-comparison effects.",
      "Even if trained and deployed on research GitHub, no baseline AI is replaced without direct statistically substantiated improvements."
    ]
  };
  await mkdir("training/results",{recursive:true});await mkdir("training/checkpoints",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
  await writeFile("training/results/neural-full-selfplay.json",JSON.stringify(summary,null,2)+"\n");
  await writeFile("training/checkpoints/neural-full-selfplay-chosen.json",JSON.stringify({selected:chosen.name,model:chosen.params,deployApproved:false},null,2)+"\n");
  const nice=r=>"| "+r.policy+" | "+r.opponent+" | "+r.games+" | "+(100*r.winCredit).toFixed(3)+"% | "+r.ci95Approx.map(x=>(100*x).toFixed(3)+"%").join("–")+" |";
  const md=[
    "# 신경망 기반 전체 게임 자기 대국 — 실제 실행 결과","",
    "> 실제 12라운드 승패를 reward로 쓰는 on-policy 신경망 학습 결과. 실험용이며 SOTA 주장이 아니다.","",
    "- 소스 SHA: "+summary.sourceCommit,
    "- 학습 에피소드: **정책당 "+(batches*batchGames)+" 전체 12라운드 경기**",
    "- 학습 방식: REINFORCE, Monte-Carlo advantage actor-critic (not bootstrapped A2C).",
    "- 정책은 DP Q 위에서 행동별 12→12→1 MLP 보정, 마지막 두 카테고리는 기존 Win DP v2.",
    "- 최종 고정 후보: **"+chosen.name+"**.",
    "","## 완전히 새로운 미사용 시드 확증","",
    "| 정책 | 상대 | 경기 | 승리점수율 | 95% paired-normal CI |","|---|---|---:|---:|---|",
    ...final.map(({raw,...rest})=>nice(rest)),
    "","## 후보 선택용 별도 시드","",
    "| 후보 | vs DP Expert | vs Win DP v2 |", "|---|---:|---:|",
    ...validation.map(v=>"| "+v.name+" | "+(100*v.vsDP.winCredit).toFixed(3)+"% | "+(100*v.vsWinV2.winCredit).toFixed(3)+"% |"),
    "","## 한계","",...summary.limitations.map(x=>"- "+x),"",
    "- 원시 경기 결과·정책별 가중치/훈련 기록: GitHub Actions \`full-neural-selfplay\` 아티팩트.",
    "- 기존 ES/REINFORCE 소형 정책 자기 대국 결과: [SELFPLAY-LATEST.md](./SELFPLAY-LATEST.md)",
    "- 연구 문서: [SELFPLAY-RESEARCH.md](../SELFPLAY-RESEARCH.md)",""
  ];
  await writeFile("docs/context/_generated/NEURAL-SELFPLAY-LATEST.md",md.join("\n"));
  console.log("NEURAL_SELFPLAY_SUMMARY "+JSON.stringify({models:models.map(x=>x.name),batches,batchGames,validation:validation.map(v=>({name:v.name,dp:v.vsDP.winCredit,v2:v.vsWinV2.winCredit})),selected:chosen.name,
    final:final.map(({raw,...rest})=>rest),totalDecisions}));
}finally{await server.close();}
