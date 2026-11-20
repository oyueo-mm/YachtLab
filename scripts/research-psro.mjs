import { createServer } from "vite";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return (x^(x>>>16))>>>0;};
const uniform=seed=>mix(seed)/4294967296;
const gauss=seed=>Math.sqrt(-2*Math.log(Math.max(1e-12,uniform(seed))))*Math.cos(2*Math.PI*uniform(seed+991));
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
try {
const eng=await server.ssrLoadModule("/src/engine.ts");
const {dpDecision,setDPTable}=await server.ssrLoadModule("/src/dp.ts");
const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
const {residualDecision,ZERO_RESIDUAL_WEIGHTS}=await server.ssrLoadModule("/src/selfplay-residual.ts");
const {solveZeroSumMetaGame,drawMetaPolicy}=await server.ssrLoadModule("/src/psro-meta.ts");
const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8"));const b=gunzipSync(await readFile("public/ai/"+manifest.asset));
setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const dp={name:"DP Expert",kind:"dp"},win={name:"Win DP v2",kind:"win"};
const residual=(name,weights)=>({name,kind:"residual",weights:weights.map(x=>Math.max(-3,Math.min(3,x)))});
const initial=[
  dp,win,
  residual("risk-seeking residual",ZERO_RESIDUAL_WEIGHTS.map((_,i)=>i===1?1.6:i===8?1.1:i===2?-.65:0)),
  residual("upper-bonus residual",ZERO_RESIDUAL_WEIGHTS.map((_,i)=>i===3?1.5:i===10?1.6:i===4?-.7:0))
];
let actions=0;
function game(a,b,seed,seat){
  const players=seat===0?[a,b]:[b,a];
  let s=eng.createGame(seed,true);
  while(!s.done){
    if(!s.rolls){s=eng.transition(s,{type:"roll"});continue;}
    const p=players[s.player];let d;
    if(p.kind==="dp")d=dpDecision(s);
    else if(p.kind==="win")d=winDPv2Decision(s)??dpDecision(s);
    else d=residualDecision(s,p.weights).decision;
    actions++;
    if(d.type==="score")s=eng.transition(s,{type:"score",category:d.category});
    else{s=eng.transition(s,{type:"hold",ids:d.ids});s=eng.transition(s,{type:"roll"});}
  }
  const x=eng.total(s.cards[seat]),y=eng.total(s.cards[1-seat]);
  return {my:x,opp:y,credit:x>y?1:x===y?0.5:0};
}
function pair(a,b,seed){
  const x=game(a,b,seed,0),y=game(a,b,seed,1);
  return {seed,first:x,second:y,credit:(x.credit+y.credit)/2};
}
function winRate(a,b,pairs,seedBase,retain=false){
  const rows=[];let total=0;
  for(let i=0;i<pairs;i++){const r=pair(a,b,mix(seedBase+i));total+=r.credit;if(retain)rows.push(r);}
  const m=total/pairs;
  const sd=retain?Math.sqrt(rows.reduce((s,v)=>s+(v.credit-m)**2,0)/Math.max(1,pairs-1)):null;
  return {policy:a.name,opponent:b.name,pairs,games:pairs*2,winCredit:m,...(retain?{ci95:[Math.max(0,m-1.96*sd/Math.sqrt(pairs)),Math.min(1,m+1.96*sd/Math.sqrt(pairs))],samples:rows}:{})};
}
function mixtureWinRate(candidate,pop,weights,pairs,seedBase,retain=false){
  const outcomes=[],counts=Array(pop.length).fill(0);
  for(let i=0;i<pairs;i++){
    const seed=mix(seedBase+i),index=drawMetaPolicy(weights,uniform(seed+0x777777));
    counts[index]++;
    const r=pair(candidate,pop[index],seed);
    outcomes.push(retain?{opponent:pop[index].name,...r}:r.credit);
  }
  const credits=retain?outcomes.map(x=>x.credit):outcomes;
  const m=avg(credits),sd=Math.sqrt(credits.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,pairs-1));
  return {policy:candidate.name,opponent:"PSRO empirical meta-mixture",winCredit:m,pairs,games:pairs*2,ci95:[Math.max(0,m-1.96*sd/Math.sqrt(pairs)),Math.min(1,m+1.96*sd/Math.sqrt(pairs))],opponentCounts:counts,...(retain?{samples:outcomes}:{})};
}
const population=[...initial],matrix=[],history=[];
const matrixPairs=smoke?2:60,oraclePairs=smoke?2:16,epochs=smoke?1:3,mutants=smoke?2:8,mutantRounds=smoke?1:2;
function addMissingMatrix(seedBase){
  while(matrix.length<population.length){matrix.push(Array(population.length).fill(0));}
  for(const row of matrix)while(row.length<population.length)row.push(0);
  for(let i=0;i<population.length;i++)for(let j=i+1;j<population.length;j++){
    if(matrix[i][j]!==0)continue;
    const v=winRate(population[i],population[j],matrixPairs,seedBase+i*40000+j*320);
    matrix[i][j]=2*v.winCredit-1;
    matrix[j][i]=-matrix[i][j];
  }
}
for(let epoch=0;epoch<epochs;epoch++){
  addMissingMatrix(40700000+epoch*240000);
  const solution=solveZeroSumMetaGame(matrix,smoke?300:20000);
  const mixture=solution.mixture;
  let champion=residual("Oracle "+epoch+" initial",ZERO_RESIDUAL_WEIGHTS.map((v,k)=>v+gauss(41200000+epoch*311+k)*.15));
  const gen=[];
  for(let genIndex=0;genIndex<mutantRounds;genIndex++){
    const candidates=[champion];
    for(let k=1;k<mutants;k++)
      candidates.push(residual("Oracle "+epoch+" generation "+genIndex+" sample "+k,
        champion.weights.map((w,j)=>w+gauss(43000000+epoch*700000+genIndex*7000+k*211+j)*(.7/(genIndex+1)))));
    const ranked=candidates.map((model,i)=>{
      const outcome=mixtureWinRate(model,population,mixture,oraclePairs,44000000+epoch*200000+genIndex*35000);
      return {model,estimate:outcome.winCredit,index:i};
    }).sort((a,b)=>b.estimate-a.estimate);
    champion=ranked[0].model;
    gen.push({generation:genIndex,best:ranked[0].estimate,range:[ranked[0].estimate,ranked.at(-1).estimate]});
  }
  const name="PSRO oracle "+epoch;
  const oracle=residual(name,champion.weights);
  const fresh=mixtureWinRate(oracle,population,mixture,smoke?2:120,45500000+epoch*100000,true);
  history.push({epoch,populationBefore:population.map(p=>p.name),matrix:matrix.map(row=>[...row]),
    meta:solution,oracle:name,oracleWeights:oracle.weights,oracleValidation:fresh,training:gen,
    note:"Oracle is approximately optimized by finite ES search against sampled Nash meta-mixture; not an exact best response."});
  population.push(oracle);
  console.log("PSRO_ITERATION "+JSON.stringify({epoch,mixture,exploitability:solution.restrictedExploitability,oracleValidation:fresh.winCredit,population:population.length}));
}
addMissingMatrix(46600000);
const finalMeta=solveZeroSumMetaGame(matrix,smoke?300:40000);
const chooseMix=(name)=>({name,kind:"meta",population,weights:finalMeta.mixture});
function evaluateMixture(agent,baseline,pairs,seedBase){
  const rows=[],credits=[];
  for(let i=0;i<pairs;i++){
    const seed=mix(seedBase+i),idx=drawMetaPolicy(agent.weights,uniform(seed+0x99baba));
    const r=pair(agent.population[idx],baseline,seed);
    credits.push(r.credit);rows.push({selected:idx,...r});
  }
  const m=avg(credits),sd=Math.sqrt(credits.reduce((s,v)=>s+(v-m)**2,0)/Math.max(1,pairs-1));
  return {policy:agent.name,opponent:baseline.name,pairs,games:pairs*2,winCredit:m,ci95:[Math.max(0,m-1.96*sd/Math.sqrt(pairs)),Math.min(1,m+1.96*sd/Math.sqrt(pairs))],samples:rows};
}
const selected=chooseMix("PSRO restricted meta-game mixture");
const final=[
  evaluateMixture(selected,win,smoke?2:1200,48300000),
  evaluateMixture(selected,dp,smoke?2:1200,48500000),
];
const result={name:"PSRO empirical metagame + approximate ES response oracle",rule:"YachtLab 12-category Nintendo-style",sourceSha:process.env.GITHUB_SHA??"local",
  population:population.map(p=>p.kind==="residual"?p:{name:p.name,kind:p.kind}),payoff:matrix,meta:finalMeta,history,final,
  training:"3 empirical PSRO expansions, seat-swapped meta-game matrix, zero-sum fictitious-play meta-solver and population evolution oracle trained with sampled mixture opponents",
  trainingSamplePairs:matrixPairs,oraclePairs,epochs,mutants,mutantRounds,totalActions:actions,
  disclaimer:[
    "This is genuine empirical meta-game solving and iterative approximate oracle expansion; the oracle is finite ES search and not a true optimal response.",
    "Restricted exploitability is only within sampled observed policy population, not the extensive-form game Nash exploitability.",
    "Payoff matrix has finite-seed sampling noise; its entry confidence intervals should be quantified before strong equilibrium claims.",
    "The opponent in each candidate game is sampled from the current meta mixture and changes after each oracle expansion.",
    "Independent final seed ranges were excluded from training, validation and matrix estimation.",
    "No verified improvement means no deployment/default AI replacement.",
  ]};
await mkdir("training/results",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
await writeFile("training/results/psro-real-matrix.json",JSON.stringify(result,null,2)+"\n");
await writeFile("training/results/psro-population.json",JSON.stringify({population:result.population,meta:finalMeta,sourceSha:result.sourceSha},null,2)+"\n");
const format=r=>"| "+r.policy+" | "+r.opponent+" | "+r.games+" | "+(r.winCredit*100).toFixed(3)+"% | "+r.ci95.map(x=>(100*x).toFixed(3)+"%").join("–")+" |";
const md=["# 실제 PSRO restricted meta-game 및 상대 적응 리그 결과","",
"> 모집단 간 직접 대국 payoff로 zero-sum empirical meta-game을 만들고 fictitious play로 계산한 **근사 제한게임 Nash 분포**. 본게임 Nash가 아님.","",
"- source SHA: "+result.sourceSha,
"- 정책 모집단: "+population.map(x=>x.name).join(", "),
"- 대국으로 채운 게임 payoff 행렬은 연구 아티팩트 JSON 저장. 대각선 0, 반대칭 보장.",
"- 현재 제한게임 exploitability proxy (zero-sum payoff): "+finalMeta.restrictedExploitability.toFixed(6),
"- fictitious-play duality gap: "+finalMeta.dualityGap.toFixed(6),
"","## 최종 후보: 메타게임 확률 혼합 정책","",
"| 정책 | 상대 | 경기 | 승리점수율 | paired 95% 근사 CI |","|---|---|---:|---:|---|",
...final.map(({samples,...r})=>format(r)),"",
"## 최종 메타게임 혼합 확률","",
"| 정책 | 확률 |","|---|---:|",
...population.map((p,i)=>"| "+p.name+" | "+(100*finalMeta.mixture[i]).toFixed(2)+"% |"),"",
"## 한계","",...result.disclaimer.map(x=>"- "+x),"",
"- 원시 경기와 오라클 이력은 GitHub Actions artifact \`psro-matrix-and-adaptive-oracles\`에 보관.",""
];
await writeFile("docs/context/_generated/PSRO-LATEST.md",md.join("\n"));
console.log("PSRO_FINAL "+JSON.stringify({size:population.length,mix:finalMeta.mixture,restrictedExploitability:finalMeta.restrictedExploitability,dualityGap:finalMeta.dualityGap,final:final.map(({samples,...rest})=>rest),totalActions:actions}));
}finally{await server.close();}
