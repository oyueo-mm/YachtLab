import {createServer} from "vite";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
const smoke=process.argv.includes("--smoke"), pairs=smoke?3:320;
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const hash=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
const average=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
function interval(xs){const m=average(xs),v=xs.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,xs.length-1);return{mean:m,ci95:[m-1.96*Math.sqrt(v/xs.length),m+1.96*Math.sqrt(v/xs.length)],n:xs.length};}
try{
const engine=await server.ssrLoadModule("/src/engine.ts");
const {setDPTable,dpDecision}=await server.ssrLoadModule("/src/dp.ts");
const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
const {residualDecision}=await server.ssrLoadModule("/src/selfplay-residual.ts");
const {drawMetaPolicy}=await server.ssrLoadModule("/src/psro-meta.ts");
const {decide}=await server.ssrLoadModule("/src/ai.ts");
const m=JSON.parse(await readFile("src/dp-manifest.json","utf8")),b=gunzipSync(await readFile("public/ai/"+m.asset));
setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const source=JSON.parse(await readFile("training/results/psro-real-matrix.json","utf8"));
const pool=source.population,history=source.history;
if(!history.length||history.length>3||pool.length!==4+history.length)throw Error("Invalid PSRO staged population");
const byName=new Map(pool.map(x=>[x.name,x]));
const win=byName.get("Win DP v2");
function play(a,b,seed,seat){
 let s=engine.createGame(seed,true),players=seat===0?[a,b]:[b,a];
 while(!s.done){
  if(!s.rolls){s=engine.transition(s,{type:"roll"});continue;}
  const p=players[s.player],d=p.kind==="dp"?dpDecision(s):p.kind==="win"?winDPv2Decision(s)??dpDecision(s):p.kind==="greedy"?decide(s,"Greedy"):residualDecision(s,p.weights).decision;
  if(d.type==="score")s=engine.transition(s,{type:"score",category:d.category});
  else{s=engine.transition(s,{type:"hold",ids:d.ids});s=engine.transition(s,{type:"roll"});}
 }
 const x=engine.total(s.cards[seat]),y=engine.total(s.cards[1-seat]);return x>y?1:x===y?0.5:0;
}
const pair=(a,b,seed)=>(play(a,b,seed,0)+play(a,b,seed,1))/2;
const stages=[];
for(let index=0;index<history.length;index++){
 const h=history[index],pop=h.populationBefore.map(name=>byName.get(name));
 if(pop.some(p=>!p))throw Error("Historical opponent policy missing");
 const mix=h.meta.mixture;
 if(pop.length!==mix.length)throw Error("Historical meta mixture mismatch");
 const oracle=byName.get(h.oracle);
 const estimates=pop.map((p,i)=>h.matrix[i].reduce((s,v,j)=>s+v*mix[j],0));
 const bestPrevious=pop[estimates.indexOf(Math.max(...estimates))];
 const challengers=[oracle,win,bestPrevious];
 const sample=challengers.map(()=>[]);
 const unseen=challengers.map(()=>[]);
 for(let j=0;j<pairs;j++){
  const seed=hash(71000000+index*120000+j);
  const u=hash(seed+111)/4294967296;
  const opp=pop[drawMetaPolicy(mix,u)];
  const unseenOpponent={name:"Greedy held-out",kind:"greedy"};
  for(let k=0;k<challengers.length;k++){
   sample[k].push(pair(challengers[k],opp,seed));
   unseen[k].push(pair(challengers[k],unseenOpponent,hash(seed+7001)));
  }
 }
 const diffs=sample[0].map((x,j)=>x-sample[2][j]),v2diffs=sample[0].map((x,j)=>x-sample[1][j]);
 const unit={stage:index,approximateOracle:oracle.name,trainingMetaMixture:mix,historicalPopulation:h.populationBefore,
  incumbentChosenFromTrainingMatrix:bestPrevious.name,
  oracleAgainstMeta:interval(sample[0]),incumbentAgainstMeta:interval(sample[2]),
  winDPv2AgainstMeta:interval(sample[1]),oracleMinusIncumbent:interval(diffs),
  oracleMinusWinDPv2:interval(v2diffs),oracleAgainstUnseenGreedy:interval(unseen[0]),
  incumbentAgainstUnseenGreedy:interval(unseen[2]),
  raw:{seededPairCredits:{oracle:sample[0],incumbent:sample[2],winDPv2:sample[1],unseenOracle:unseen[0],unseenIncumbent:unseen[2]}}};
 stages.push(unit);
 console.log("PSRO_ORACLE_AUDIT_STAGE "+JSON.stringify({stage:index,oracle:oracle.name,incumbent:bestPrevious.name,oracleAgainstMeta:unit.oracleAgainstMeta.mean,pairedExcess:unit.oracleMinusIncumbent.mean,pairedExcessCI:unit.oracleMinusIncumbent.ci95,unseenGreedy:unit.oracleAgainstUnseenGreedy.mean}));
}
const out={sourceSha:process.env.GITHUB_SHA??"local",sourceResearch:source.sourceSha,method:"Out-of-sample paired evaluation of each approximate PSRO response oracle against its frozen historical meta mixture, versus a training-matrix selected incumbent and Win DP v2",pairSeeds:pairs,stages,
 limits:["Finite ES approximation is not a Nash oracle or optimal best response.","Meta mixture and incumbent are frozen from training. Audit seeds are disjoint.","Mix sampling and pair games use shared evaluation seeds across candidates for paired-difference confidence intervals.","For an oracle to count as improvement, the paired CI of oracle minus previous incumbent must exclude zero in the positive direction.","Only three stages and a small policy pool; held-out Greedy tests do not establish general robustness.","PSRO restricted meta-game exploitability ignores policy space outside its finite population."]};
await mkdir("training/results",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
await writeFile("training/results/psro-oracle-audit.json",JSON.stringify(out,null,2)+"\n");
const pct=x=>(x*100).toFixed(3)+"%", ci=x=>x.map(pct).join("~");
const doc=["# PSRO 오라클의 실제 최적 대응 품질 — 독립 시드 검증","",
"- 학습 중 메타게임 혼합을 단계별로 고정한 뒤 완전히 다른 시드에서 새 Oracle의 승리점수율과 그 단계의 최강 기존 전략을 paired comparison.","- 총 단계당 "+pairs+" seed pairs × 2 seats.","- 같은 상대 샘플·시드와 두 좌석으로 통제. 유의성은 paired 차이의 95% 근사 구간으로 판정.","",
"| 확장 단계 | Oracle 승리점수율 (vs 단계별 meta mix) | 기존 최강 정책 | Oracle − 기존 정책 (95% CI) | 미관측 Greedy 상대 |",
"|---|---:|---|---:|---:|",...stages.map(s=>"| "+s.stage+" | "+pct(s.oracleAgainstMeta.mean)+" | "+s.incumbentChosenFromTrainingMatrix+" | "+pct(s.oracleMinusIncumbent.mean)+" ("+ci(s.oracleMinusIncumbent.ci95)+") | "+pct(s.oracleAgainstUnseenGreedy.mean)+" |"),"",
"## 해석",...out.limits.map(x=>"- "+x),"- 원시 시드별 정책쌍 대결 차이는 Actions psro-oracle-audit 아티팩트 JSON에 보존.", ""];
await writeFile("docs/context/_generated/PSRO-ORACLE-AUDIT.md",doc.join("\n"));
console.log("PSRO_ORACLE_AUDIT_FINAL "+JSON.stringify({pairs,stages:stages.map(({raw,...r})=>r)}));
}finally{await server.close();}
