import {createServer} from "vite";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const hash=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
try{
 const eng=await server.ssrLoadModule("/src/engine.ts");
 const {dpDecision,setDPTable}=await server.ssrLoadModule("/src/dp.ts");
 const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
 const {residualCandidates}=await server.ssrLoadModule("/src/selfplay-residual.ts");
 const lib=await server.ssrLoadModule("/src/research-offpolicy.ts");
 const {softmax,dot,average,clamp,rng,clone,vector,actionFeatures,dueling,createDueling,stepDueling,createQuantiles,quantileValue,quantileOutput,quantileUpdate,pairCI}=lib;
 const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8"));
 const packed=gunzipSync(await readFile("public/ai/"+manifest.asset));
 setDPTable(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength));
 const GAMMA=.99,F=lib.F;
 const names=["Double Dueling DQN + PER","QR-DQN","Expert Iteration","Dyna-Q exact model","Discrete SAC"];
 const win={name:"Win DP v2",kind:"win"},dp={name:"DP Expert",kind:"dp"};
 const credit=(own,other)=>own>other?1:(own===other?0.5:0);
 const zeros=n=>Array(n).fill(0);
 function init(name,seed){
  if(name===names[0]||name===names[3])return{name,kind:name===names[0]?"ddqn":"dyna",q:createDueling(seed),target:createDueling(seed)};
  if(name===names[1])return{name,kind:"qr",q:createQuantiles(seed,16),target:createQuantiles(seed,16)};
  if(name===names[2])return{name,kind:"exit",actor:zeros(F)};
  if(name===names[4])return{name,kind:"sac",actor:vector(seed+11,F,.0005),q1:vector(seed+17,F,.003),q2:vector(seed+31,F,.003),t1:vector(seed+17,F,.003),t2:vector(seed+31,F,.003)};
  throw Error("Unknown algorithm");
 }
 const argmax=a=>a.reduce((best,x,i)=>x>a[best]+1e-12?i:best,0);
 const legal=state=>{const candidates=residualCandidates(state,6.0);return{candidates,features:actionFeatures(candidates)};};
 const qScalar=(w,x)=>clamp(.5+.018*x[F-1]+dot(w,x),.001,.999);
 const sacProbs=(model,f)=>softmax(f.map(x=>dot(model.actor,x)+.075*x[F-1]),1);
 function values(model,features){
  if(model.kind==="ddqn"||model.kind==="dyna")return dueling(model.q,features).q;
  if(model.kind==="qr")return quantileValue(model.q,features);
  if(model.kind==="exit")return features.map(x=>dot(model.actor,x)+.15*x[F-1]);
  if(model.kind==="sac")return features.map(x=>Math.min(qScalar(model.q1,x),qScalar(model.q2,x)));
  throw Error("Unknown kind "+model.kind);
 }
 function fromCandidate(state,c){
  if(c.index>=32)return{type:"score",category:eng.categories[c.index-32]};
  return{type:"reroll",ids:state.dice.filter(d=>c.index&(1<<d.id)).map(d=>d.id)};
 }
 function choose(state,model,{epsilon=0,rand=()=>.999}={}){
  const {candidates,features}=legal(state),v=values(model,features);
  let idx=argmax(v);
  if(model.kind==="sac"&&epsilon>0){
   let u=rand(),p=sacProbs(model,features);
   for(let i=0;i<p.length;i++){u-=p[i];if(u<=0){idx=i;break;}}
  }else if(rand()<epsilon)idx=Math.floor(rand()*features.length);
  return{decision:fromCandidate(state,candidates[idx]),idx,features,scoreGap:Math.max(...candidates.map(c=>c.q))-candidates[idx].q};
 }
 const advance=(s,a)=>a.type==="score"?eng.transition(s,{type:"score",category:a.category}):eng.transition(eng.transition(s,{type:"hold",ids:a.ids}),{type:"roll"});
 function defaultDecision(s,p){
  if(p.kind==="win")return winDPv2Decision(s)??dpDecision(s);
  if(p.kind==="dp")return dpDecision(s);
  if(eng.available(s.cards[s.player]).length<=2)return winDPv2Decision(s)??dpDecision(s);
  return choose(s,p).decision;
 }
 function game(agent,opponent,seed,seat,{train=false,epsilon=.16}={}){
  let state=eng.createGame(seed,true),players=seat===0?[agent,opponent]:[opponent,agent];
  const observations=[],random=rng(hash(seed+123442)),stats={decisions:0,changes:0};
  while(!state.done){
   if(!state.rolls){state=eng.transition(state,{type:"roll"});continue;}
   const p=players[state.player];
   if(p!==agent){state=advance(state,defaultDecision(state,p));continue;}
   if(eng.available(state.cards[state.player]).length<=2){state=advance(state,winDPv2Decision(state)??dpDecision(state));continue;}
   const choice=choose(state,agent,{epsilon:train?epsilon:0,rand:random});
   stats.decisions++;
   if(choice.scoreGap>.000001)stats.changes++;
   if(train){
    const publicState={...state,seed:0,rng:[0,0],dice:state.dice.map(d=>({...d})),cards:state.cards.map(c=>({...c}))};
    observations.push({features:choice.features,idx:choice.idx,state:publicState,seat});
   }
   state=advance(state,choice.decision);
  }
  const own=eng.total(state.cards[seat]),other=eng.total(state.cards[1-seat]);
  return{own,other,credit:credit(own,other),observations,stats};
 }
 function examples(rows,creditValue,nstep){
  const out=[];
  for(let i=0;i<rows.length;i++){
   const nextIndex=Math.min(i+nstep,rows.length),terminal=nextIndex===rows.length;
   out.push({features:rows[i].features,action:rows[i].idx,
    reward:terminal?Math.pow(GAMMA,rows.length-i-1)*creditValue:0,
    next:terminal?null:rows[nextIndex].features,discount:Math.pow(GAMMA,nextIndex-i),priority:1,
    state:rows[i].state,seat:rows[i].seat});
  }
  return out;
 }
 function replaySamples(buffer,num,random,prioritized){
  const weights=prioritized?buffer.map(t=>Math.pow(Math.max(.02,t.priority),.6)):null;
  const norm=weights?weights.reduce((a,b)=>a+b,0):buffer.length;
  const out=[];
  for(let j=0;j<num;j++){
   let idx=0;
   if(weights){
    let x=random()*norm;
    for(let k=0;k<weights.length;k++){x-=weights[k];if(x<=0){idx=k;break;}}
   }else idx=Math.floor(random()*buffer.length);
   const p=weights?weights[idx]/norm:1/buffer.length;
   out.push({t:buffer[idx],weight:Math.min(2,Math.pow(buffer.length*p,-.4))});
  }
  return out;
 }
 function updateDQN(model,buffer,random,updates,prioritized){
  let sum=0,count=0;
  for(let u=0;u<updates;u++)for(const {t,weight} of replaySamples(buffer,smoke?2:8,random,prioritized)){
   let target=t.reward;
   if(t.next){
    const selected=argmax(dueling(model.q,t.next).q);
    target+=t.discount*dueling(model.target,t.next).q[selected];
   }
   const delta=stepDueling(model.q,t.features,t.action,clamp(target,0,1),.025,weight);
   t.priority=.03+Math.abs(delta.td);sum+=Math.abs(delta.td);count++;
  }
  return sum/Math.max(1,count);
 }
 function updateQR(model,buffer,random,updates){
  let sum=0,count=0;
  for(let u=0;u<updates;u++)for(const {t} of replaySamples(buffer,smoke?2:7,random,true)){
   let targets=Array(model.q.n).fill(t.reward);
   if(t.next){
    const idx=argmax(quantileValue(model.q,t.next));
    targets=quantileOutput(model.target,t.next[idx]).map(y=>clamp(t.reward+t.discount*y,0,1));
   }
   const d=quantileUpdate(model.q,t.features[t.action],targets,.07);
   t.priority=.03+Math.abs(d.td);sum+=d.loss;count++;
  }
  return sum/Math.max(1,count);
 }
 function updateSAC(model,buffer,random,updates){
  let loss=0,count=0;
  const alpha=.055;
  for(let u=0;u<updates;u++)for(const {t} of replaySamples(buffer,smoke?2:7,random,false)){
   let target=t.reward;
   if(t.next){
    const ps=sacProbs(model,t.next);
    const expected=ps.reduce((sum,p,i)=>sum+p*(Math.min(qScalar(model.t1,t.next[i]),qScalar(model.t2,t.next[i]))-alpha*Math.log(Math.max(1e-10,p))),0);
    target+=t.discount*expected;
   }
   target=clamp(target,0,1);
   const f=t.features[t.action],d1=target-qScalar(model.q1,f),d2=target-qScalar(model.q2,f);
   for(let j=0;j<F;j++){model.q1[j]+=.018*clamp(d1,-1,1)*f[j];model.q2[j]+=.018*clamp(d2,-1,1)*f[j];}
   const ps=sacProbs(model,t.features);
   const utilities=ps.map((p,i)=>Math.min(qScalar(model.q1,t.features[i]),qScalar(model.q2,t.features[i]))-alpha*Math.log(Math.max(1e-10,p)));
   const mean=ps.reduce((sum,p,i)=>sum+p*utilities[i],0);
   for(let i=0;i<t.features.length;i++){
    const scale=.004*ps[i]*(utilities[i]-mean);
    for(let j=0;j<F;j++)model.actor[j]+=scale*t.features[i][j];
   }
   loss+=(Math.abs(d1)+Math.abs(d2))/2;count++;
  }
  return loss/Math.max(1,count);
 }
 function modelSample(row,candidate,seed){
  const state=row.state;
  let s={...state,seed:0,rng:[eng.playerRngSeed(seed,0),eng.playerRngSeed(seed,1)],
   dice:state.dice.map(d=>({...d})),cards:state.cards.map(c=>({...c}))};
  s=advance(s,fromCandidate(state,candidate));
  while(!s.done){
   if(!s.rolls){s=eng.transition(s,{type:"roll"});if(s.player===row.seat)break;continue;}
   if(s.player===row.seat)break;
   s=advance(s,winDPv2Decision(s)??dpDecision(s));
  }
  if(s.done)return{reward:credit(eng.total(s.cards[row.seat]),eng.total(s.cards[1-row.seat])),next:null};
  return{reward:0,next:legal(s).features};
 }
 function dynaSteps(rows,random,seed){
  const result=[];
  for(let i=0;i<rows.length;i++){
   const row=rows[i];if(random()>.15)continue;
   const legalActions=legal(row.state);
   const action=Math.floor(random()*legalActions.candidates.length);
   const m=modelSample(row,legalActions.candidates[action],hash(seed+i*199));
   result.push({features:legalActions.features,action,reward:m.reward,next:m.next,discount:GAMMA,priority:1,synthetic:true});
  }
  return result;
 }
 function expertIteration(model,rows,random,seed){
  const selected=rows.filter(()=>random()<.07).slice(0,smoke?1:3);
  let taught=0;
  for(let j=0;j<selected.length;j++){
   const row=selected[j],list=legal(row.state);
   const possibilities=list.candidates.map((c,i)=>({c,i})).sort((a,b)=>b.c.q-a.c.q).slice(0,smoke?2:3);
   let best=null;
   for(const {c,i} of possibilities){
    let score=0;
    for(let r=0;r<(smoke?1:3);r++){
     const seedValue=hash(seed+j*811+r*13007);
     let s={...row.state,seed:0,rng:[eng.playerRngSeed(seedValue,0),eng.playerRngSeed(seedValue,1)],
      dice:row.state.dice.map(d=>({...d})),cards:row.state.cards.map(card=>({...card}))};
     s=advance(s,fromCandidate(row.state,c));
     while(!s.done){if(!s.rolls){s=eng.transition(s,{type:"roll"});continue;}s=advance(s,winDPv2Decision(s)??dpDecision(s));}
     score+=credit(eng.total(s.cards[row.seat]),eng.total(s.cards[1-row.seat]));
    }
    const estimated=score/(smoke?1:3)+.001*c.q;
    if(!best||estimated>best.estimated)best={i,estimated};
   }
   if(!best)continue;
   const prob=softmax(list.features.map(f=>dot(model.actor,f)+.15*f[F-1]),.5);
   for(let i=0;i<prob.length;i++){
    const scale=.035*((i===best.i?1:0)-prob[i]);
    for(let k=0;k<F;k++)model.actor[k]+=scale*list.features[i][k];
   }
   taught++;
  }
  return taught;
 }
 function evaluate(agent,opponent,pairs,seedBase){
  const values=[],raw=[];let changes=0,decisions=0;
  for(let j=0;j<pairs;j++){
   const seed=hash(seedBase+j),a=game(agent,opponent,seed,0),b=game(agent,opponent,seed,1);
   values.push((a.credit+b.credit)/2);
   changes+=a.stats.changes+b.stats.changes;decisions+=a.stats.decisions+b.stats.decisions;
   raw.push({seed,first:{score:a.own,other:a.other,credit:a.credit},second:{score:b.own,other:b.other,credit:b.credit}});
  }
  return{opponent:opponent.name,games:pairs*2,...pairCI(values),changedDecisions:changes,totalDecisions:decisions,raw};
 }
 const full=smoke?2:1500,validPairs=smoke?1:100,confirmPairs=smoke?1:600,summary=[];
 for(let index=0;index<names.length;index++){
  const name=names[index],model=init(name,31800+index*1337),start=clone(model),random=rng(hash(82000000+index*1000)),replay=[],snapshots=[];
  let loss=0,taught=0,imagined=0,changed=0,decisions=0;
  const episodes=name==="Expert Iteration"?(smoke?2:350):full,progress=[];
  for(let ep=0;ep<episodes;ep++){
   const chance=random(),opponent=chance<.5?win:chance<.75?dp:snapshots.length?snapshots[Math.floor(random()*snapshots.length)]:win;
   const seed=hash(83000000+index*250000+ep),match=game(model,opponent,seed,ep%2,{train:true,epsilon:name==="Expert Iteration"?0:.14});
   changed+=match.stats.changes;decisions+=match.stats.decisions;
   if(model.kind==="exit")taught+=expertIteration(model,match.observations,random,seed);
   else{
    for(const t of examples(match.observations,match.credit,model.kind==="ddqn"?3:1)){
     if(replay.length>10000)replay.shift();replay.push(t);
    }
    if(model.kind==="dyna"){
     const simulated=dynaSteps(match.observations,random,seed);
     imagined+=simulated.length;
     for(const t of simulated){if(replay.length>10000)replay.shift();replay.push(t);}
    }
    if(replay.length>2){
     if(model.kind==="qr")loss=updateQR(model,replay,random,smoke?1:3);
     else if(model.kind==="sac")loss=updateSAC(model,replay,random,smoke?1:3);
     else loss=updateDQN(model,replay,random,smoke?1:3,model.kind==="ddqn");
    }
    if((ep+1)%50===0){
     if(model.kind==="qr"||model.kind==="ddqn"||model.kind==="dyna")model.target=clone(model.q);
     if(model.kind==="sac"){model.t1=clone(model.q1);model.t2=clone(model.q2);}
    }
   }
   if((ep+1)%(smoke?1:100)===0){
    snapshots.push(clone(model));if(snapshots.length>4)snapshots.shift();
    const x={episodes:ep+1,loss,changedActions:changed,totalDecisionCount:decisions,modelTransitions:imagined,expertUpdates:taught};
    progress.push(x);console.log("ALGORITHM_ZOO_TRAIN "+JSON.stringify({name,...x}));
   }
  }
  const variants=[{tag:"untrained",policy:start},{tag:"trained",policy:clone(model)}];
  const validation=variants.map(v=>({tag:v.tag,win:evaluate(v.policy,win,validPairs,85000000+index*200000),
   dp:evaluate(v.policy,dp,validPairs,85090000+index*200000)}));
  const chosen=validation.map(v=>({...v,score:(v.win.rate+v.dp.rate)/2})).sort((a,b)=>b.score-a.score)[0].tag;
  const final=variants.map(v=>({tag:v.tag,win:evaluate(v.policy,win,confirmPairs,87000000+index*200000),
   dp:evaluate(v.policy,dp,Math.max(1,Math.floor(confirmPairs/2)),87090000+index*200000)}));
  summary.push({name,kind:model.kind,episodes,realDecisions:decisions,changedActions:changed,imaginedExactEngineTransitions:imagined,expertImprovementUpdates:taught,
   progress,validation:validation.map(v=>({tag:v.tag,win:{rate:v.win.rate,games:v.win.games},dp:{rate:v.dp.rate,games:v.dp.games}})),
   validationSelected:chosen,final,model:clone(model)});
  console.log("ALGORITHM_ZOO_FINAL "+JSON.stringify({name,episodes,chosen,trainedWin:final[1].win.rate,untrainedWin:final[0].win.rate,
   ci95:final[1].win.ci95,actualActions:decisions,imagined,expertUpdates:taught}));
 }
 const output={experiment:"Full 12-round off-policy RL and Expert Iteration comparison",sourceSha:process.env.GITHUB_SHA??"local",date:new Date().toISOString(),
  raw:summary,rules:"YachtLab 12-category Nintendo-style 5 dice, 3 rolls, upper bonus 35 at 63",trainOpponentMix:"Win DP v2 50%, DP Expert 25%, historical frozen learner snapshots up to 25%",
  evaluation:"Each untrained and trained model against Win DP v2 and DP Expert on untouched paired seat-swapped seeds; validation and confirmation separate",
  limitations:["Double Dueling DQN plus PER plus 3-step targets is Rainbow-lite, not full Rainbow (no C51, noisy networks).",
   "Fixed quantile 16-head QR-DQN; Implicit Quantile Networks (IQN) not implemented.",
   "ExIt expert is sampled full-game win-credit Monte Carlo with DP/WinDP continuation and limited search; its statistical superiority over teacher not guaranteed.",
   "Dyna-Q uses the exact known simulator to synthesize next learner decisions, separate future dice RNG, not an approximate learned world model.",
   "Discrete SAC uses entropy-regularized stochastic actor and twin linear Q critics, a small-feature approximation not a full high-capacity deep SAC.",
   "All five learners use legal DP-anchored candidate actions within 6 expected-score points, falling back to existing Win DP v2 for last 2 categories.",
   "This pilot uses one training seed per algorithm and relatively small compute; confidence intervals are seat-paired normal approximation, multiple-comparison uncorrected.",
   "No new model is deployed as the default until independent robust improvement against Win DP v2 is confirmed."]};
 await mkdir("training/results",{recursive:true});await mkdir("docs/context/_generated",{recursive:true});
 await writeFile("training/results/fullgame-rl-zoo.json",JSON.stringify(output,null,2)+"\n");
 const pct=x=>(x*100).toFixed(3)+"%",fmt=xs=>xs.map(pct).join("–");
 const md=["# 12라운드 전게임 강화학습 대안 실험 실제 결과","",
  "> 전체 12라운드 최종 승패로 학습, 기존 Win DP v2의 우위가 유지되는지 독립 선후공 대전 평가.","",
  "| 모델 | 전체 게임 학습 수 | Win DP v2 상대 학습 전 | 학습 후 | 학습 후 paired 95% CI | validation 최종 선택 |",
  "|---|---:|---:|---:|---|---|",
  ...summary.map(r=>"| "+r.name+" | "+r.episodes+" | "+pct(r.final[0].win.rate)+" | "+pct(r.final[1].win.rate)+" | "+fmt(r.final[1].win.ci95)+" | "+r.validationSelected+" |"),
  "","## 정확한 구현 범위",...output.limitations.map(x=>"- "+x),
  "","원시 게임별 점수, 모델 가중치, 훈련 업데이트 기록은 GitHub Actions fullgame-rl-zoo-raw 아티팩트에 저장.",""];
 await writeFile("docs/context/_generated/FULLGAME-RL-ZOO-LATEST.md",md.join("\n"));
 console.log("ALGORITHM_ZOO_SUMMARY "+JSON.stringify(summary.map(r=>({name:r.name,episodes:r.episodes,changed:r.changedActions,imagined:r.imaginedExactEngineTransitions,expert:r.expertImprovementUpdates,
  win:r.final.map(x=>({variant:x.tag,rate:x.win.rate,ci:x.win.ci95})),
  dp:r.final.map(x=>({variant:x.tag,rate:x.dp.rate,ci:x.dp.ci95})),selected:r.validationSelected}))));
}finally{await server.close();}
