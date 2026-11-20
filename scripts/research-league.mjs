import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=(x)=>{x^=x>>>16;x=Math.imul(x,0x85ebca6b);x^=x>>>13;x=Math.imul(x,0xc2b2ae35);return(x^(x>>>16))>>>0;};
const now=()=>performance.now();
try {
  const {createGame,transition,total,available}=await server.ssrLoadModule("/src/engine.ts");
  const {decide}=await server.ssrLoadModule("/src/ai.ts");
  const {researchGuidedDecision}=await server.ssrLoadModule("/src/research-guided-mcts.ts");
  const {setDPTable}=await server.ssrLoadModule("/src/dp.ts");
  const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8"));
  const b=gunzipSync(await readFile("public/ai/"+manifest.asset));
  setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const decision=(state,name)=>{
    if(name==="Guided MCTS")return researchGuidedDecision(state,48);
    if(name.startsWith("Hybrid ")){
      const threshold=Number(name.slice(7));
      const own=state.cards[state.player],other=state.cards[1-state.player];
      if(available(own).length===3&&total(other)-total(own)>=threshold)return researchGuidedDecision(state,48);
      return decide(state,"Win DP v2");
    }
    return decide(state,name);
  };
  const play=(candidate,opponent,seed,side)=>{
    const names=side===0?[candidate,opponent]:[opponent,candidate];
    let state=createGame(seed,true),actions=0;
    while(!state.done){
      if(state.rolls===0){state=transition(state,{type:"roll"});continue;}
      const d=decision(state,names[state.player]);
      if(d.type==="score")state=transition(state,{type:"score",category:d.category});
      else{state=transition(state,{type:"hold",ids:d.ids});state=transition(state,{type:"roll"});}
      if(++actions>150)throw Error("연구 시뮬레이션 행동 제한");
    }
    const score=total(state.cards[side]),other=total(state.cards[1-side]);
    return{score,other,credit:score>other?1:(score===other?0.5:0)};
  };
  const trial=(candidate,opponent,pairs,base)=>{
    const samples=[],games=[];
    const begin=now();
    for(let i=0;i<pairs;i++){
      const seed=mix(base+i),a=play(candidate,opponent,seed,0),b=play(candidate,opponent,seed,1);
      samples.push((a.credit+b.credit)/2);
      games.push({seed,first:a,second:b});
      if((i+1)%100===0)console.log("LEAGUE_PROGRESS "+candidate+" vs "+opponent+" "+(i+1)+"/"+pairs);
    }
    const mean=samples.reduce((a,b)=>a+b,0)/pairs;
    const sd=Math.sqrt(samples.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,pairs-1));
    const gap=1.96*sd/Math.sqrt(pairs);
    return{candidate,opponent,pairs,games:pairs*2,seedBase:base,winCredit:mean,ci95Approx:[Math.max(0,mean-gap),Math.min(1,mean+gap)],meanScore:games.reduce((s,g)=>s+g.first.score+g.second.score,0)/(pairs*2),elapsedSeconds:(now()-begin)/1000,matches:games};
  };
  const small=process.argv.includes("--smoke");
  const pairCount=small?4:300;
  const opponentResults=[
    trial("Win DP v2","DP Expert",pairCount,1100000),
    trial("Win DP v2","Win DP",small?4:100,1110000),
    trial("Win DP v2","Greedy",small?4:100,1120000),
    trial("Guided MCTS","DP Expert",small?2:24,1130000)
  ];
  const thresholds=small?[15]:[-20,0,20];
  const training=thresholds.map((t,i)=>trial("Hybrid "+t,"DP Expert",small?2:24,1150000+i*1000));
  const selected=training.slice().sort((a,b)=>b.winCredit-a.winCredit)[0].candidate;
  const validation=trial(selected,"DP Expert",small?2:64,1250000);
  const result={kind:"research league and exploratory policy-parameter search",date:"2026-11-20",rules:"12-category Nintendo-like Yacht Dice",opponents:opponentResults,training,selected,validation,notIndependentSOTAProof:true,limitations:["Fixed DP Expert opponent assumption in Win DP v2","Guided MCTS uses approximate outcome proxy, not exact calibrated win probability","Selection training is derivative-free parameter search, not QR-DQN training","Small exploratory search cannot establish world SOTA","Validation results are not used for tuning"]};
  await mkdir("benchmarks/research",{recursive:true});
  await writeFile("benchmarks/research/competitive-v2-league.json",JSON.stringify(result,null,2)+"\n");
  console.log("LEAGUE_SUMMARY "+JSON.stringify({opponents:opponentResults.map(({matches,...rest})=>rest),training:training.map(({matches,...rest})=>rest),selected,validation:{...validation,matches:undefined}}));
}finally{await server.close();}
