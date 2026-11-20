import {readFile,writeFile,mkdir} from "node:fs/promises";
const n=3,t95=4.302652729911275;
const reports=[];
for(let seedIndex=0;seedIndex<n;seedIndex++){
 const r=JSON.parse(await readFile("training/results/ppo-multiseed-"+seedIndex+".json","utf8"));
 if(r.seedIndex!==seedIndex)throw Error("PPO trial index mismatch "+seedIndex);
 reports.push(r);
}
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const seedInterval=xs=>{const mu=avg(xs),sd=Math.sqrt(xs.reduce((s,x)=>s+(x-mu)**2,0)/(n-1));return{mean:mu,sd,ci95TrainingSeed:[mu-t95*sd/Math.sqrt(n),mu+t95*sd/Math.sqrt(n)],seedRates:xs};};
const pooledCI=xs=>{const mu=avg(xs),sd=Math.sqrt(xs.reduce((s,x)=>s+(x-mu)**2,0)/Math.max(1,xs.length-1));return{mean:mu,ci95PairedGames:[mu-1.96*sd/Math.sqrt(xs.length),mu+1.96*sd/Math.sqrt(xs.length)],pairs:xs.length};};
const variants=["Zero-neural reference","Full-game clipped PPO","Full-game clipped PPO + DP teacher KL"];
const baselines=["Win DP v2","DP Expert"];
const selection=variants.map(name=>{
 const values=reports.map(r=>{
  const v=r.validation.find(x=>x.name===name);
  if(!v)throw Error("Validation variant missing "+name);
  return (v.dp.winCredit+v.win.winCredit)/2;
 });
 return{name,score:seedInterval(values)};
}).sort((a,b)=>b.score.mean-a.score.mean);
const selected=selection[0].name;
const perVariant=[];
for(const name of variants)for(const opponent of baselines){
 const bySeed=reports.map(r=>{
  const item=r.final.find(x=>x.policy===name&&x.opponent===opponent);
  if(!item)throw Error("Missing untouched confirmation for "+name+" vs "+opponent);
  if(item.pairs!==600&&item.pairs!==2)throw Error("Unexpected confirm pair count");
  return item;
 });
 const winCredits=bySeed.map(x=>x.winCredit);
 const pooledPairs=bySeed.flatMap(x=>x.samples.map(s=>(s.first.credit+s.second.credit)/2));
 perVariant.push({name,opponent,perTrainSeed:seedInterval(winCredits),conditionalOnThreeTrainedModels:pooledCI(pooledPairs),
  trainingSeeds:bySeed.map((x,i)=>({index:i,winCredit:x.winCredit,pairs:x.pairs,ci95:x.ci95}))});
}
const report={name:"Three independent enlarged PPO initializations against fixed PSRO metagame",sourceSha:process.env.GITHUB_SHA??"local",
 seedCount:n,trainEpisodesPerSeedPerVariant:reports[0].trainEpisodesPerModel,
 trainEpisodesTotal:reports.reduce((s,r)=>s+2*r.trainEpisodesPerModel,0),selection,selectedByMeanValidationAcrossSeeds:selected,results:perVariant,
 modelNames:variants,sourcePSRO:reports.map(x=>x.sourcePSRO),seedIndexList:reports.map(x=>x.seedIndex),
 methodologicalNotes:[
  "Three separately initialized actors per PPO variant; training dice seeds, validation seeds and untouched confirmation seed sets are offset by one million per seed index.",
  "Each PPO variant and baseline is evaluated on the same untouched seed range within each training seed; no trial was selected based on final confirmation.",
  "Selection of a variant is based exclusively on pooled validation across training seeds. Final results for all variants are shown to avoid hiding failed variants.",
  "The t-based 95% intervals use only THREE training initializations (df=2) and are extremely uncertain; paired-game normal intervals condition on these fitted models.",
  "The PPO actor is a small neural residual anchored in DP; last two categories use Win DP v2. Hyperparameter optimization was not exhaustive.",
  "No claim of Nash optimality or broader SOTA. A win-credit confidence interval including 0.5 is not proof of equivalence.",
  "The PSRO population used for training was constructed from separate game seeds and all opponent strategies are public observation only.",
 ]};
await mkdir("training/results",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
await writeFile("training/results/ppo-multiseed-summary.json",JSON.stringify(report,null,2)+"\n");
const pct=x=>(100*x).toFixed(3)+"%",ci=xs=>xs.map(pct).join("–");
const md=["# 전체 게임 PPO 학습량 확대·3개 독립 시드 종합 보고","",
"> 일반 PPO, PPO + DP teacher KL 각각 세 개 초기화에서 실제 12라운드 경기로 학습. **강한 AI 판정은 Win DP v2 직접 검증이 우선**.","",
"- 전체 학습게임: **"+report.trainEpisodesTotal.toLocaleString()+"** (PPO 각 "+report.trainEpisodesPerSeedPerVariant.toLocaleString()+"경기 × 2 변형 × 3 시드).",
"- 후보 선택(세 시드 validation 성적 평균): **"+selected+"**. 모델마다 final seed를 교차 선택하지 않음.",
"- 신뢰구간은 (1) 경기별 쌍 표본에 대한 정규 근사, (2) 3개 **독립 훈련 시드** 평균에 대한 t(2) 구간을 함께 표시.","",
"## 독립 확증 — 모든 후보 공개","",
"| 후보 | 상대 | 3개 훈련시드 평균 | 훈련시드 평균 95% t(2) 구간 | 총 대국쌍 | 조건부 경기별 95% CI |",
"|---|---|---:|---:|---:|---:|",
...perVariant.map(r=>"| "+r.name+" | "+r.opponent+" | "+pct(r.perTrainSeed.mean)+" | "+ci(r.perTrainSeed.ci95TrainingSeed)+" | "+r.conditionalOnThreeTrainedModels.pairs+" | "+ci(r.conditionalOnThreeTrainedModels.ci95PairedGames)+" |"),"",
"## 학습 시드별 성적(Win DP v2 대상)","",
"| 모델 | Seed 0 | Seed 1 | Seed 2 |", "|---|---:|---:|---:|",
...variants.map(name=>"| "+name+" | "+reports.map(r=>pct(r.final.find(x=>x.policy===name&&x.opponent==="Win DP v2").winCredit)).join(" | ")+" |"),"",
"## 해석 및 제한","",...report.methodologicalNotes.map(x=>"- "+x),"",
"- 학습/validation/확증 raw game JSON과 신경망 가중치는 각 Actions ppo-large-seed-0/1/2 아티팩트에 보존.",""
];
await writeFile("docs/context/_generated/PPO-MULTISEED-LATEST.md",md.join("\n"));
console.log("PPO_MULTISEED_SUMMARY "+JSON.stringify({selected,trainEpisodes:report.trainEpisodesTotal,
 results:perVariant.map(({trainingSeeds,...r})=>r)}));
