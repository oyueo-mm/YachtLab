import { createServer } from "vite";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
const rng=seed=>{let state=mix(seed)||1;return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};};
const avg=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
const clip=(x,a,b)=>Math.min(b,Math.max(a,x));
const sigmoid=x=>1/(1+Math.exp(-clip(x,-20,20)));
try{
const eng=await server.ssrLoadModule("/src/engine.ts");
const {dpDecision,setDPTable}=await server.ssrLoadModule("/src/dp.ts");
const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
const {residualDecision}=await server.ssrLoadModule("/src/selfplay-residual.ts");
const nn=await server.ssrLoadModule("/src/neural-residual.ts");
const {ppoSurrogate,terminalGae}=await server.ssrLoadModule("/src/ppo-surrogate.ts");
const {drawMetaPolicy}=await server.ssrLoadModule("/src/psro-meta.ts");
const m=JSON.parse(await readFile("src/dp-manifest.json","utf8"));
const packed=gunzipSync(await readFile("public/ai/"+m.asset));
setDPTable(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength));
const psro=JSON.parse(await readFile("training/results/psro-population.json","utf8"));
const population=psro.population,metaWeights=psro.meta.mixture;
if(population.length!==metaWeights.length||Math.abs(metaWeights.reduce((s,x)=>s+x,0)-1)>1e-5)throw Error("PSRO population mismatch");
const dp={name:"DP Expert",kind:"dp"},win={name:"Win DP v2",kind:"win"};
const makeActor=(name,seed,regularization)=>({name,kind:"neural",params:nn.createNeuralResidual(seed),teacherKL:regularization});
const actors=[makeActor("Full-game clipped PPO",17777,0),makeActor("Full-game clipped PPO + DP teacher KL",48888,.015)];
const empty=makeActor("Zero-neural reference",17777,0);empty.params.w2.fill(0);
let decisions=0;
function chooseOpponent(random,snapshots,allowSnapshot){
 const chance=random();
 if(allowSnapshot&&snapshots.length&&chance<.27)return snapshots[Math.floor(random()*snapshots.length)];
 const p=population[drawMetaPolicy(metaWeights,random())];
 return p.kind==="dp"?dp:p.kind==="win"?win:{name:p.name,kind:"residual",weights:p.weights};
}
function game(a,b,seed,seat,{collect=false,sample=false}={}){
 const players=seat===0?[a,b]:[b,a],policyRng=[rng(seed+152021),rng(seed+922071)];
 let s=eng.createGame(seed,true),trajectory=[];
 while(!s.done){
  if(!s.rolls){s=eng.transition(s,{type:"roll"});continue;}
  const agent=players[s.player];let decision;
  if(agent.kind==="dp")decision=dpDecision(s);
  else if(agent.kind==="win")decision=winDPv2Decision(s)??dpDecision(s);
  else if(agent.kind==="residual")decision=residualDecision(s,agent.weights).decision;
  else{
    const observation=collect&&s.player===seat?{...s,seed:0,rng:[0,0]}:s;
    const sampleResult=nn.neuralResidualDecision(observation,agent.params,{sample:sample&&s.player===seat,rng:policyRng[s.player],temperature:.8,pointLossCap:3});
    decision=sampleResult.decision;
    if(collect&&s.player===seat&&sampleResult.actionIndex>=0)trajectory.push({
      state:observation,index:sampleResult.actionIndex,
      logOld:sampleResult.logProbability,oldValue:sampleResult.stateValue,
      valueFeatures:sampleResult.valueFeatures,
    });
  }
  decisions++;
  if(decision.type==="score")s=eng.transition(s,{type:"score",category:decision.category});
  else{s=eng.transition(s,{type:"hold",ids:decision.ids});s=eng.transition(s,{type:"roll"});}
 }
 const my=eng.total(s.cards[seat]),other=eng.total(s.cards[1-seat]);
 return{my,other,credit:my>other?1:(my===other?0.5:0),trajectory};
}
function evaluate(a,b,pairs,base,retain=false){
 const credits=[],sample=retain?[]:null;let total=0,opponentTotal=0;
 for(let i=0;i<pairs;i++){
   const seed=mix(base+i),one=game(a,b,seed,0),two=game(a,b,seed,1);
   const pair=(one.credit+two.credit)/2;
   credits.push(pair);total+=one.my+two.my;opponentTotal+=one.other+two.other;
   if(sample)sample.push({seed,first:{score:one.my,other:one.other,credit:one.credit},second:{score:two.my,other:two.other,credit:two.credit}});
 }
 const rate=avg(credits),sd=Math.sqrt(credits.reduce((s,v)=>s+(v-rate)**2,0)/Math.max(1,pairs-1));
 return{policy:a.name,opponent:b.name,pairs,games:pairs*2,winCredit:rate,ci95:[Math.max(0,rate-1.96*sd/Math.sqrt(pairs)),Math.min(1,rate+1.96*sd/Math.sqrt(pairs))],
  meanScore:total/(2*pairs),opponentMeanScore:opponentTotal/(2*pairs),...(sample?{samples:sample}:{})};
}
function adam(n){return{m:Array(n).fill(0),v:Array(n).fill(0),steps:0};}
function adamUpdate(weights,gradient,state,lr){
 state.steps++;
 return weights.map((w,j)=>{
   const g=clip(gradient[j],-1.5,1.5);
   state.m[j]=.9*state.m[j]+.1*g;state.v[j]=.999*state.v[j]+.001*g*g;
   return clip(w+lr*(state.m[j]/(1-.9**state.steps))/(Math.sqrt(state.v[j]/(1-.999**state.steps))+1e-8),-3,3);
 });
}
function learn(actor,episodes,snapshots,seed){
 const rollouts=[],rngPool=rng(seed+1);
 let winCredits=0;
 for(let i=0;i<episodes;i++){
  const opponent=chooseOpponent(rngPool,snapshots,true),seat=i%2,match=game(actor,opponent,mix(seed+i),seat,{collect:true,sample:true});
  winCredits+=match.credit;
  if(match.trajectory.length){
   const values=match.trajectory.map(x=>x.oldValue);
   const gae=terminalGae(values,match.credit,1,.95);
   for(let t=0;t<match.trajectory.length;t++)
     rollouts.push({...match.trajectory[t],advantage:gae.advantages[t],returnTarget:gae.returns[t]});
  }
 }
 const gAvg=avg(rollouts.map(x=>x.advantage)),gStd=Math.sqrt(avg(rollouts.map(x=>(x.advantage-gAvg)**2)))+.0001;
 for(const row of rollouts)row.advantage=(row.advantage-gAvg)/gStd;
 return{rollouts,trainWinRate:winCredits/episodes};
}
function optimize(actor,rollout,actorOpt,criticOpt,seed,epochs){
 const shuffled=rng(seed),batchSize=smoke?24:80;
 let losses=[],clipHits=0,nSamples=0,meanKL=0,earlyStop=false;
 for(let epoch=0;epoch<epochs;epoch++){
  const indices=rollout.map((_,i)=>i);
  for(let i=indices.length-1;i>0;i--){const j=Math.floor(shuffled()*(i+1));[indices[i],indices[j]]=[indices[j],indices[i]];}
  let epochKL=0,epochSeen=0;
  for(let start=0;start<indices.length;start+=batchSize){
   const batch=indices.slice(start,start+batchSize);
   const actorGrad=Array(nn.NEURAL_GRADIENT_SIZE).fill(0),criticGrad=Array(5).fill(0);
   for(const i of batch){
    const row=rollout[i],pred=nn.neuralResidualDecision(row.state,actor.params,{forcedIndex:row.index,temperature:.8,pointLossCap:3});
    const surrogate=ppoSurrogate(row.logOld,pred.logProbability,row.advantage,.2);
    const scalar=surrogate.gradientFactor;
    if(surrogate.clipped)clipHits++;
    for(let k=0;k<actorGrad.length;k++)actorGrad[k]+=scalar*pred.gradient[k]+actor.teacherKL*pred.teacherGradient[k];
    const error=row.returnTarget-pred.stateValue;
    for(let k=0;k<5;k++)criticGrad[k]+=error*pred.stateValue*(1-pred.stateValue)*row.valueFeatures[k];
    losses.push(surrogate.objective-actor.teacherKL*pred.teacherKl);
    epochKL+=row.logOld-pred.logProbability;epochSeen++;nSamples++;
   }
   const gradActor=actorGrad.map(x=>x/batch.length),old=nn.unpackNeuralActor(actor.params);
   nn.setNeuralActor(actor.params,adamUpdate(old,gradActor,actorOpt,.001));
   actor.params.critic=adamUpdate(actor.params.critic,criticGrad.map(x=>x/batch.length),criticOpt,.003);
  }
  meanKL=epochKL/Math.max(1,epochSeen);
  if(meanKL>.035){earlyStop=true;break;}
 }
 return{surrogateMean:avg(losses),meanApproxKl:meanKL,clipFraction:clipHits/Math.max(1,nSamples),earlyStop,observations:rollout.length};
}
const groups=smoke?2:32,gamesPerGroup=smoke?6:84,epochs=smoke?2:3;
const histories=[],snapshots=[empty];
for(let index=0;index<actors.length;index++){
 const actor=actors[index],actorOpt=adam(nn.NEURAL_GRADIENT_SIZE),criticOpt=adam(5),records=[];
 for(let group=0;group<groups;group++){
  const data=learn(actor,gamesPerGroup,snapshots,56100000+index*600000+group*700);
  const update=optimize(actor,data.rollouts,actorOpt,criticOpt,56200000+index*600000+group*700,epochs);
  if((group+1)%(smoke?1:8)===0){
   const ck={name:actor.name+" iter "+(group+1),kind:"neural",params:nn.cloneNeuralResidual(actor.params),teacherKL:actor.teacherKL};
   snapshots.push(ck);
   const quick=smoke?1:24;
   const winDP=evaluate(ck,win,quick,56400000+index*600000+group*100);
   const entry={name:actor.name,iteration:group+1,episodes:(group+1)*gamesPerGroup,trainingRate:data.trainWinRate,winDPv2Rate:winDP.winCredit,update};
   records.push(entry);console.log("PPO_PROGRESS "+JSON.stringify(entry));
  }
 }
 histories.push({name:actor.name,regularization:actor.teacherKL,history:records});
}
const candidates=[empty,...actors];
const validation=candidates.map(c=>({name:c.name,dp:evaluate(c,dp,smoke?2:200,59000000),win:evaluate(c,win,smoke?2:200,59100000)}));
const selection=validation.map((v,i)=>({...v,index:i,mean:(v.dp.winCredit+v.win.winCredit)/2})).sort((a,b)=>b.mean-a.mean);
const selected=candidates[selection[0].index];
const final=[
 evaluate(selected,win,smoke?2:1600,61100000,true),
 evaluate(selected,dp,smoke?2:1600,61200000,true),
 evaluate(actors[0],actors[1],smoke?2:280,61300000,true)
];
await mkdir("training/results",{recursive:true});await mkdir("training/checkpoints",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
const report={kind:"Full-game genuine PPO clipped policy optimization, opponent-adaptive league + restricted PSRO meta mixture",
 sourceSha:process.env.GITHUB_SHA??"local",date:new Date().toISOString(),sourcePSRO:psro.sourceSha,
 groups,gamesPerGroup,trainEpisodesPerModel:groups*gamesPerGroup,epochs,minibatchSize:smoke?24:80,
 trainOpponents:"A sampled strategy from the restricted-game PSRO empirical meta-mixture or uniformly sampled frozen previous PPO snapshots; 27% snapshot probability when available",
 trainingMethod:"On-policy rollouts; terminal win-credit reward; GAE(lambda=.95,gamma=1); old policy action log probability freeze; PPO clipped importance ratio epsilon .2; 3 epochs minibatch reuse; Adam actor/critic; approximate KL early stopping; optional DP-teacher reverse-KL gradient",
 clipEpsilon:.2,teacherKlCoefficients:actors.map(a=>a.teacherKL),
 models:actors.map(a=>({name:a.name,params:a.params,teacherKL:a.teacherKL})),histories,validation,
 selected:{name:selected.name,params:selected.params,teacherKL:selected.teacherKL},final,totalDecisions:decisions,
 limitations:[
 "PPO policy is a small per-action MLP residual on DP Expert Q; final two categories are delegated to Win DP v2.",
 "Opponent mixture comes from empirical PSRO zero-sum restricted meta-game, and snapshots are updated during PPO; not an optimal full-game Nash learner.",
 "The GAE reward is a terminal match result and player-specific decision transition, not a dense intermediate reward or advantage oracle.",
 "Teacher regularizer is KL to the DP-Q-induced softmax in the candidate action set, not an exact KL over every physically legal action.",
 "PPO replay is on-policy within a batch; multiple minibatch updates use fixed behavior log probabilities.",
 "CI pairs share a seed with seat swap; 95% intervals approximate. One training seed per variant; no broad SOTA claim.",
 "Checkpoint model stays research-only until independently and directly better than Win DP v2."
 ]};
await writeFile("training/results/ppo-full-game.json",JSON.stringify(report,null,2)+"\n");
await writeFile("training/checkpoints/ppo-selected.json",JSON.stringify({model:report.selected,deployApproved:false,sourceSha:report.sourceSha},null,2)+"\n");
const row=r=>"| "+r.policy+" | "+r.opponent+" | "+r.games+" | "+(100*r.winCredit).toFixed(3)+"% | "+r.ci95.map(v=>(100*v).toFixed(3)+"%").join("–")+" |";
const doc=["# 전체 게임 PPO와 적응형 상대 리그: 자동 결과","",
 "> 실제 PPO clipped surrogate(행동 로그확률 보존·비율 클리핑·재사용) + GAE + critic. 단순 REINFORCE가 아님.","",
 "- 코드: "+report.sourceSha,
 "- 실제 full-game train: 정책별 "+(groups*gamesPerGroup)+"게임, 후보선택/최종확증 다른 시드.",
 "- 강한 상대: DP Expert, Win DP v2, PSRO restricted meta-game mixture, 이전 PPO 세대.",
 "- 비교: PPO, PPO+DP teacher KL, 학습 전 잔차0 기준.",
 "- 선택: **"+selected.name+"**. 학습 전 기준이 1위일 수 있으며 이 경우 학습 성능 향상이 아님.","",
 "## 미사용 시드 독립 대전","",
 "| 후보 | 상대 | 경기 | 승리점수율 | 95% 짝별 근사 CI |","|---|---|---:|---:|---|",
 ...final.map(({samples,...r})=>row(r)),"",
 "## 모델 선택 전용 리그","",
 "| 후보 | vs DP Expert | vs Win DP v2 |","|---|---:|---:|",
 ...validation.map(v=>"| "+v.name+" | "+(100*v.dp.winCredit).toFixed(3)+"% | "+(100*v.win.winCredit).toFixed(3)+"% |"),"",
 "## 한계","",...report.limitations.map(x=>"- "+x),"",
 "- Actions artifact \`ppo-full-game-models-and-raw\`에는 파라미터, 학습 진행 기록, 게임별 결과 포함.",""
];
await writeFile("docs/context/_generated/PPO-LATEST.md",doc.join("\n"));
console.log("PPO_FINAL "+JSON.stringify({models:actors.map(a=>a.name),sourcePSRO:psro.sourceSha,trainEpisodesPerModel:groups*gamesPerGroup,selected:selected.name,
 validation:validation.map(v=>({name:v.name,dp:v.dp.winCredit,win:v.win.winCredit})),
 final:final.map(({samples,...rest})=>rest),totalDecisions:decisions}));
}finally{await server.close();}
