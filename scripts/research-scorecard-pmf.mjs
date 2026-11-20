import {createServer} from "vite";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const hash=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
const average=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const meanCI=xs=>{const m=average(xs),v=xs.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,xs.length-1);return{mean:m,ci95:[m-1.96*Math.sqrt(v/xs.length),m+1.96*Math.sqrt(v/xs.length)],nGames:xs.length};};
const policyNames=["DP Expert","Win DP v2","Greedy"];
try {
const engine=await server.ssrLoadModule("/src/engine.ts");
const {setDPTable,dpFutureValue,dpDecision}=await server.ssrLoadModule("/src/dp.ts");
const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
const {winDPv3Decision}=await server.ssrLoadModule("/src/competitive-v3.ts");
const {decide}=await server.ssrLoadModule("/src/ai.ts");
const pmf=await server.ssrLoadModule("/src/conditional-score-pmf.ts");
const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8")),gz=gunzipSync(await readFile("public/ai/"+manifest.asset));
setDPTable(gz.buffer.slice(gz.byteOffset,gz.byteOffset+gz.byteLength));
const openMask=card=>engine.categories.reduce((m,c,i)=>m|(card[c]===undefined?1<<i:0),0);
const models={};
const agent=(s,name)=>{
 if(name==="DP Expert")return dpDecision(s);
 if(name==="Win DP v2")return winDPv2Decision(s)??dpDecision(s);
 if(name==="Greedy")return decide(s,"Greedy");
 if(name==="Win DP v3 conditioned")return winDPv3Decision(s,{scorecardConditional:models["Win DP v2"].model})??dpDecision(s);
 if(name==="Win DP v3 gaussian")return winDPv3Decision(s,{byRemaining:models["Win DP v2"].gaussianRemaining})??dpDecision(s);
 throw Error("Unknown research policy "+name);
};
function collect(name,base,games){
 const output=[];
 for(let g=0;g<games;g++){
  let s=engine.createGame(hash(base+g),true),observations=[];
  while(!s.done){
   if(!s.rolls){
    s=engine.transition(s,{type:"roll"});
    if(s.player===0){
     const card=s.cards[0],remaining=engine.available(card).length;
     if(remaining>=3){
      const current=engine.total(card),mask=openMask(card),upper=engine.upper(card);
      observations.push({remaining,mask,upper,current,projected:current+dpFutureValue(mask,Math.min(63,upper)),game:g});
     }
    }
    continue;
   }
   const d=agent(s,s.player===0?name:"DP Expert");
   if(d.type==="score")s=engine.transition(s,{type:"score",category:d.category});
   else{s=engine.transition(s,{type:"hold",ids:d.ids});s=engine.transition(s,{type:"roll"});}
  }
  const final=engine.total(s.cards[0]);
  output.push(...observations.map(o=>({...o,residual:final-o.projected})));
 }
 return output;
}
function measure(rows,model){
 const results=[],perGame=new Map();
 for(const row of rows){
  const baseline=pmf.gaussianResidualPmf(model.byRemaining[String(row.remaining)].mean,model.byRemaining[String(row.remaining)].std);
  const global=pmf.predictUnconditionalResidual(model,row.remaining);
  const conditional=pmf.predictConditionalResidual(model,row);
  const scores={gaussian:pmf.scoreDiscretePmf(baseline,row.residual),global:pmf.scoreDiscretePmf(global,row.residual),conditional:pmf.scoreDiscretePmf(conditional,row.residual)};
  results.push(scores);
  if(!perGame.has(row.game))perGame.set(row.game,[]);
  perGame.get(row.game).push(scores.gaussian.crps-scores.conditional.crps);
 }
 const meanScore=(key,metric)=>average(results.map(x=>x[key][metric]));
 const differences=[...perGame.values()].map(xs=>average(xs));
 return{observations:results.length,games:perGame.size,
  gaussian:{crps:meanScore("gaussian","crps"),nll:meanScore("gaussian","nll")},
  unconditioned:{crps:meanScore("global","crps"),nll:meanScore("global","nll")},
  conditioned:{crps:meanScore("conditional","crps"),nll:meanScore("conditional","nll")},
  gaussianMinusConditionalGamePaired:meanCI(differences)};
}
const trainingGames=smoke?5:650,validationGames=smoke?4:200,confirmGames=smoke?4:400;
for(let id=0;id<policyNames.length;id++){
 const name=policyNames[id];
 const train=collect(name,73000000+id*1200000,trainingGames);
 const validate=collect(name,74000000+id*1200000,validationGames);
 const confirm=collect(name,75000000+id*1200000,confirmGames);
 const configs=[];
 for(const minLeaf of (smoke?[2]:[30,60,110]))
  for(const alpha of (smoke?[20]:[20,90]))
   for(const bandwidth of (smoke?[8]:[5,10])){
    const params={minLeaf,alpha,bandwidth,maxDepth:3};
    const trained=pmf.trainConditionalScoreModel(train,params);
    const metrics=measure(validate,trained);
    configs.push({params,score:metrics.conditioned.crps,model:trained});
   }
 configs.sort((a,b)=>a.score-b.score);
 const selected=configs[0];
 const final=measure(confirm,selected.model);
 const groups=Object.values(selected.model.byRemaining);
 const gaussianRemaining=Object.fromEntries(Object.entries(selected.model.byRemaining).map(([remaining,v])=>[remaining,{bias:v.mean,std:v.std}]));
 models[name]={model:selected.model,gaussianRemaining,chosen:selected.params,validationGrid:configs.map(({params,score})=>({params,crps:score})),
  confirm:final,trainingGames,validationGames,confirmGames,treeLeaves:groups.reduce((s,x)=>s+x.leaves,0)};
 console.log("CONDITIONAL_PMF_POLICY "+JSON.stringify({policy:name,params:selected.params,leaves:models[name].treeLeaves,confirm:final}));
}
const duel=(a,b,pairs,start)=>{
 const scores=[],rows=[];
 for(let i=0;i<pairs;i++){
  const seed=hash(start+i),pair=[];
  for(let seat=0;seat<2;seat++){
   let s=engine.createGame(seed,true);const sides=seat===0?[a,b]:[b,a];
   while(!s.done){
    if(!s.rolls){s=engine.transition(s,{type:"roll"});continue;}
    const d=agent(s,sides[s.player]);
    if(d.type==="score")s=engine.transition(s,{type:"score",category:d.category});
    else{s=engine.transition(s,{type:"hold",ids:d.ids});s=engine.transition(s,{type:"roll"});}
   }
   const my=engine.total(s.cards[seat]),other=engine.total(s.cards[1-seat]);
   pair.push({my,other,credit:my>other?1:my===other?0.5:0});
  }
  scores.push((pair[0].credit+pair[1].credit)/2);rows.push({seed,first:pair[0],second:pair[1]});
 }
 return{candidate:a,opponent:b,games:2*pairs,pairs,winCredit:meanCI(scores),raw:rows};
};
const matches=[
 duel("Win DP v3 conditioned","Win DP v2",smoke?1:120,79000000),
 duel("Win DP v3 conditioned","Win DP v3 gaussian",smoke?1:60,79200000),
 duel("Win DP v3 conditioned","DP Expert",smoke?1:100,79400000)
];
const report={title:"Opponent state-conditioned empirical remaining-score residual PMF",sourceSha:process.env.GITHUB_SHA??"local",
 scope:"Conditional empirical probability model by scorecard bitmask, current subtotal/upper subtotal, projected DP final score and remaining categories. Exact DP is not claimed.",
 policies:models,trainingGames,validationGames,confirmGames,bench:matches,
 selection:"CART tree with three levels on mask-bit and scalar threshold features; leaf Gaussian-smoothed score histogram shrunk to same remaining-cardinality prior. MinLeaf/alpha/bandwidth selected on validation CRPS only.",
 statistics:"CRPS and discrete negative log likelihood, with game-clustered confidence interval for per-game mean Gaussian-minus-conditional CRPS on 400 untouched test games per policy",
 caveats:["The distribution is empirical and only approximates future score outcomes; it is not exact scorecard-specific DP enumeration.",
 "Multiple snapshots per game share terminal score; confidence intervals use per-game aggregates rather than treating snapshots as independent.",
 "Separate policy-specific models assume the opponent's policy is known. Adversarial adaptation or mismatched opponent models may invalidate calibrated forecasts.",
 "Win DP v3 has exact own-three-turn Bellman conditional on the forecast; the forecast itself is approximate.",
 "Conditional PMF adoption depends on held-out CRPS; an improved likelihood or game score is not implied by training fit alone.",
 "No Win DP v2 replacement without independent win-credit evidence."]};
await mkdir("training/results",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
await writeFile("training/results/scorecard-conditional-pmf.json",JSON.stringify(report,null,2)+"\n");
const f=n=>n.toFixed(4),ci=x=>x.map(f).join("–");
const doc=["# 점수판 조건부 상대 점수분포 독립 확증","",
 "> 상대 정책·남은 카테고리 외에 **점수판 열린 항목 비트마스크, 상단 점수, 현재 총점, DP 예상 총점**을 조건부 분포에 반영한 CART+smoothed histogram.","",
 "- policy별 training "+trainingGames+" / selection "+validationGames+" / untouched confirm "+confirmGames+" games.",
 "- 중요한 평가지표: CRPS(낮을수록 좋음); 개별 10개 라운드는 같은 game cluster로 처리해 개선 신뢰구간 계산.","",
 "| 상대 정책 | Gaussian CRPS | 남은 턴만 PMF CRPS | **점수판 조건부 PMF CRPS** | Gaussian−조건부 CRPS (game-clustered 95% CI) |",
 "|---|---:|---:|---:|---|",
 ...policyNames.map(n=>{const x=models[n].confirm;return"| "+n+" | "+f(x.gaussian.crps)+" | "+f(x.unconditioned.crps)+" | "+f(x.conditioned.crps)+" | "+f(x.gaussianMinusConditionalGamePaired.mean)+" ("+ci(x.gaussianMinusConditionalGamePaired.ci95)+") |";}),"",
 "## 조건부 모델을 적용한 Win DP v3","",
 "| 후보 | 상대 | 게임 | 승리 점수율 | paired 95% CI |",
 "|---|---|---:|---:|---|",
 ...matches.map(r=>"| "+r.candidate+" | "+r.opponent+" | "+r.games+" | "+(r.winCredit.mean*100).toFixed(3)+"% | "+r.winCredit.ci95.map(x=>(x*100).toFixed(3)+"%").join("–")+" |"),"",
 "## 한계",...report.caveats.map(x=>"- "+x),
 "- 전체 학습 모델·검증 격자와 raw match는 Actions Artifact scorecard-conditional-pmf 참조.",""];
await writeFile("docs/context/_generated/SCORECARD-PMF-LATEST.md",doc.join("\n"));
console.log("SCORECARD_PMF_FINAL "+JSON.stringify({policies:policyNames.map(n=>({policy:n,chosen:models[n].chosen,confirm:models[n].confirm})),
  bench:matches.map(({raw,...rest})=>rest)}));
}finally{await server.close();}
