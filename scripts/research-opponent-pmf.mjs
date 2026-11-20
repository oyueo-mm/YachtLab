import { createServer } from "vite";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
const normalCdf=x=>{const z=Math.abs(x),t=1/(1+.2316419*z),phi=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI),v=1-phi*(.319381530*t-.356563782*t*t+1.781477937*t*t*t-1.821255978*t*t*t*t+1.330274429*t*t*t*t*t);return x>=0?v:1-v;};
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const CLIP=160,BINS=CLIP*2+1;
try {
const engine=await server.ssrLoadModule("/src/engine.ts");
const {dpDecision,dpFutureValue,setDPTable}=await server.ssrLoadModule("/src/dp.ts");
const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
const {winDPv3Decision}=await server.ssrLoadModule("/src/competitive-v3.ts");
const {decide}=await server.ssrLoadModule("/src/ai.ts");
const m=JSON.parse(await readFile("src/dp-manifest.json","utf8"));
const packed=gunzipSync(await readFile("public/ai/"+m.asset));
setDPTable(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength));
const mask=card=>engine.categories.reduce((s,c,i)=>s|(card[c]===undefined?1<<i:0),0);
const policies=["DP Expert","Win DP v2","Greedy"];
function policyDecision(s,name){
 if(name==="DP Expert")return dpDecision(s);
 if(name==="Win DP v2")return winDPv2Decision(s)??dpDecision(s);
 if(name==="Greedy")return decide(s,"Greedy");
 if(name==="Win DP v3 PMF")return winDPv3Decision(s,{discreteResidualByRemaining:models["Win DP v2"]?.discreteResidualByRemaining})??dpDecision(s);
 return winDPv3Decision(s,{byRemaining:models["Win DP v2"]?.gaussianRemaining})??dpDecision(s);
}
function collect(name,base,games){
 const rows=[];
 for(let i=0;i<games;i++){
  let state=engine.createGame(mix(base+i),true),saved=[];
  while(!state.done){
    if(!state.rolls){
      state=engine.transition(state,{type:"roll"});
      if(state.player===0){
        const c=state.cards[0],remaining=engine.available(c).length,
        pred=engine.total(c)+dpFutureValue(mask(c),Math.min(63,engine.upper(c)));
        if(remaining>=3)saved.push({remaining,predicted:pred,upper:engine.upper(c)});
      }
      continue;
    }
    const d=state.player===0?policyDecision(state,name):dpDecision(state);
    if(d.type==="score")state=engine.transition(state,{type:"score",category:d.category});
    else{state=engine.transition(state,{type:"hold",ids:d.ids});state=engine.transition(state,{type:"roll"});}
  }
  const final=engine.total(state.cards[0]);
  rows.push(...saved.map(r=>({...r,actual:final,residual:final-r.predicted,game:i})));
 }
 return rows;
}
function fitGaussian(values){
 const bias=avg(values),std=Math.max(2,Math.sqrt(avg(values.map(v=>(v-bias)**2))));
 return {bias,std,samples:values.length};
}
function pdfBin(mu,sigma,i){return Math.max(0,normalCdf((i+.5-mu)/sigma)-normalCdf((i-.5-mu)/sigma));}
function pmf(values,gaussian,bw){
 const distribution=Array(BINS).fill(0);
 for(let bin=-CLIP;bin<=CLIP;bin++){
   let density=0;
   for(const v of values)density+=pdfBin(v,bw,bin);
   // Shrink to a wide Gaussian prior to avoid overfitting small tails.
   distribution[bin+CLIP]=density+35*pdfBin(gaussian.bias,gaussian.std,bin);
 }
 const norm=distribution.reduce((s,x)=>s+x,0);
 return {offset:-CLIP,probabilities:distribution.map(v=>v/norm),bandwidth:bw};
}
function scoreHistogram(model,r){
 const i=Math.max(0,Math.min(BINS-1,Math.round(r)+CLIP));
 const likelihood=Math.max(1e-14,model.probabilities[i]);
 let cdf=0,crps=0;
 for(let k=0;k<BINS;k++){
   cdf+=model.probabilities[k];
   const x=k-CLIP;
   crps+=(cdf-(r<=x?1:0))**2;
 }
 return {crps,negativeLogLikelihood:-Math.log(likelihood)};
}
function scoreGaussian(model,r){
 const likelihood=Math.max(1e-14,pdfBin(model.bias,model.std,Math.round(r)));
 let crps=0;
 for(let k=-CLIP;k<=CLIP;k++){
   const cdf=normalCdf((k+.5-model.bias)/model.std);
   crps+=(cdf-(r<=k?1:0))**2;
 }
 return {crps,negativeLogLikelihood:-Math.log(likelihood)};
}
function scoreAll(rows,model,type){
 const scores=rows.map(x=>type==="hist"?scoreHistogram(model[String(x.remaining)],x.residual):scoreGaussian(model[String(x.remaining)],x.residual));
 return {observations:scores.length,games:scores.length/10,crps:avg(scores.map(x=>x.crps)),negativeLogLikelihood:avg(scores.map(x=>x.negativeLogLikelihood))};
}
const models={},train=smoke?5:350,validation=smoke?4:180,confirm=smoke?4:320;
for(let index=0;index<policies.length;index++){
 const name=policies[index],training=collect(name,52000000+index*400000,train),
   valid=collect(name,53000000+index*400000,validation),
   test=collect(name,54000000+index*400000,confirm);
 const gaussianRemaining={},values={};
 for(let r=3;r<=12;r++){
  const selected=training.filter(x=>x.remaining===r).map(x=>x.residual);
  if(!selected.length)throw Error("No training data in remaining "+r);
  gaussianRemaining[String(r)]=fitGaussian(selected);
  values[String(r)]=selected;
 }
 const gaussValidation=scoreAll(valid,gaussianRemaining,"gaussian");
 const bandwidths=smoke?[5]:[2,5,9,15];
 const candidates=bandwidths.map(bandwidth=>{
   const dist=Object.fromEntries(Object.keys(values).map(k=>[k,pmf(values[k],gaussianRemaining[k],bandwidth)]));
   const score=scoreAll(valid,dist,"hist");
   return{bandwidth,score,dist};
 }).sort((a,b)=>a.score.crps-b.score.crps);
 const best=candidates[0],testGaussian=scoreAll(test,gaussianRemaining,"gaussian"),
   testHistogram=scoreAll(test,best.dist,"hist");
 models[name]={gaussianRemaining,discreteResidualByRemaining:best.dist,chosenBandwidth:best.bandwidth,
   trainingGames:train,validationGames:validation,confirmGames:confirm,
   modelSelection:{gaussian:gaussValidation,kernel:candidates.map(x=>({bandwidth:x.bandwidth,score:x.score}))},
   confirm:{gaussian:testGaussian,histogram:testHistogram,crpsImprovement:testGaussian.crps-testHistogram.crps,
     nllImprovement:testGaussian.negativeLogLikelihood-testHistogram.negativeLogLikelihood}};
 console.log("PMF_POLICY "+JSON.stringify({name,bandwidth:best.bandwidth,confirm:models[name].confirm}));
}
const policyState=name=>({name,kind:name});
function match(a,b,seed,seat){
 let state=engine.createGame(seed,true),players=seat===0?[a,b]:[b,a];
 while(!state.done){
  if(!state.rolls){state=engine.transition(state,{type:"roll"});continue;}
  const choice=policyDecision(state,players[state.player]);
  if(choice.type==="score")state=engine.transition(state,{type:"score",category:choice.category});
  else{state=engine.transition(state,{type:"hold",ids:choice.ids});state=engine.transition(state,{type:"roll"});}
 }
 const own=engine.total(state.cards[seat]),their=engine.total(state.cards[1-seat]);
 return{own,their,credit:own>their?1:own===their?0.5:0};
}
function duel(a,b,pairs,base){
 const rows=[],credits=[];
 for(let i=0;i<pairs;i++){
  const seed=mix(base+i),first=match(a,b,seed,0),second=match(a,b,seed,1);
  const score=(first.credit+second.credit)/2;
  rows.push({seed,first,second});credits.push(score);
 }
 const rate=avg(credits),sd=Math.sqrt(credits.reduce((s,x)=>s+(x-rate)**2,0)/Math.max(1,credits.length-1));
 return{policy:a,opponent:b,games:pairs*2,pairs,winCredit:rate,ci95Approx:[Math.max(0,rate-1.96*sd/Math.sqrt(pairs)),Math.min(1,rate+1.96*sd/Math.sqrt(pairs))],samples:rows};
}
const bench=[
 duel("Win DP v3 PMF","Win DP v2",smoke?1:200,55100000),
 duel("Win DP v3 PMF","Win DP v3 Gaussian",smoke?1:100,55200000),
 duel("Win DP v3 PMF","DP Expert",smoke?1:120,55300000)
];
const output={kind:"Conditional empirical discrete residual PMF for end-of-game opponent score prediction",sourceSha:process.env.GITHUB_SHA??"local",
 modelScope:"Opponent-policy-conditioned residual distribution, one histogram per remaining category count; Monte Carlo sample-based forecast, not full exact DP distribution",
 calibration:"kernel density smoothing with Gaussian prior shrinkage; bandwidth selected on validation only; untouched confirm",
 trainGamesPerPolicy:train,validationGamesPerPolicy:validation,confirmGamesPerPolicy:confirm,
 models,bench,limitations:[
  "PMF is sampled from policy-specific complete games; it is not exact enumeration.",
  "Model conditions only on policy and number of remaining categories; scorecard mask, opponent adaptation and upper-bonus state shift residuals.",
  "Forecast of final score is discretized by rounding projected DP expected score plus integer residual; ties in discrete game treated as half win.",
  "CRPS is approximate discrete-bin CRPS over residual [-160,160]; endpoint clipping and kernel tuning may influence results.",
  "Only select PMF as better when untouched confirmation test CRPS actually decreases.",
  "Win DP v3 has exact own-three-turn DP conditional on an approximate opponent model; this is not an exact full-game Nash solution."
 ]};
await mkdir("training/results",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
await writeFile("training/results/opponent-empirical-pmf.json",JSON.stringify(output,null,2)+"\n");
const metric=(x)=>x.toFixed(4);
const row=(name,x)=>"| "+name+" | "+metric(x.gaussian.crps)+" | "+metric(x.histogram.crps)+" | "+metric(x.crpsImprovement)+" | "+metric(x.gaussian.negativeLogLikelihood)+" | "+metric(x.histogram.negativeLogLikelihood)+" |";
const line=(r)=>"| "+r.policy+" | "+r.opponent+" | "+r.games+" | "+(100*r.winCredit).toFixed(3)+"% | "+r.ci95Approx.map(v=>(100*v).toFixed(3)+"%").join("–")+" |";
const doc=["# 상대 점수분포 — 실측 비정규 이산 확률분포","",
 "> 실제 게임 기반 잔차 histogram/KDE vs Gaussian, 훈련·선택·확증 세 시드 구간 완전 분리.","",
 "- source SHA: "+output.sourceSha,
 "- 정책별 "+train+" 훈련게임, "+validation+" 대역폭 선택게임, "+confirm+" 미사용 최종 확증게임.",
 "- CRPS가 **낮을수록 정확한 확률 예측**. 음수 개선은 오히려 악화됨.","",
 "| 상대 정책 | Gaussian CRPS | 이산 PMF CRPS | Gaussian - PMF | Gaussian NLL | PMF NLL |",
 "|---|---:|---:|---:|---:|---:|",
 ...policies.map(name=>row(name,models[name].confirm)),"",
 "## PMF 보조 Win DP v3 직접 경기","",
 "| 후보 | 상대 | 게임 | 승리 점수율 | paired 95% 근사 CI |","|---|---|---:|---:|---|",...bench.map(({samples,...r})=>line(r)),"",
 "## 한계","",...output.limitations.map(x=>"- "+x),"",
 "- 전체 정책별 잔차 확률분포와 개별 대전 결과는 GitHub Actions \`opponent-empirical-pmf\` 아티팩트의 JSON 참조.",""
];
await writeFile("docs/context/_generated/PMF-LATEST.md",doc.join("\n"));
console.log("PMF_FINAL "+JSON.stringify({models:policies.map(name=>({name,confirm:models[name].confirm,bandwidth:models[name].chosenBandwidth})),bench:bench.map(({samples,...rest})=>rest)}));
}finally{await server.close();}
