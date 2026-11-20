import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const smoke=process.argv.includes("--smoke");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;};
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
try {
  const engine=await server.ssrLoadModule("/src/engine.ts");
  const {dpDecision,setDPTable}=await server.ssrLoadModule("/src/dp.ts");
  const {winDPv2Decision}=await server.ssrLoadModule("/src/competitive-v2.ts");
  const {winDPv3Decision}=await server.ssrLoadModule("/src/competitive-v3.ts");
  const m=JSON.parse(await readFile("src/dp-manifest.json","utf8")),b=gunzipSync(await readFile("public/ai/"+m.asset));
  setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const opponent=JSON.parse(await readFile("training/results/opponent-calibration.json","utf8"));
  const calibrated=opponent.opponents["Win DP v2"].parameters;
  const dpCalibrated=opponent.opponents["DP Expert"].parameters;
  const play=(a,b,seed,seat)=>{
    let state=engine.createGame(seed,true),count=0,preciseMs=0;
    const players=seat===0?[a,b]:[b,a];
    const begin=performance.now();
    while(!state.done){
      if(!state.rolls){state=engine.transition(state,{type:"roll"});continue;}
      const name=players[state.player],timer=performance.now();
      const choice=name==="DP Expert"?dpDecision(state)
        :name==="Win DP v2"?(winDPv2Decision(state)??dpDecision(state))
        :name==="Win DP v3 (calibrated)"?(winDPv3Decision(state,{byRemaining: players[1-state.player]==="DP Expert"?dpCalibrated:calibrated})??dpDecision(state))
        :(winDPv3Decision(state)??dpDecision(state));
      if(name.startsWith("Win DP v3")&&engine.available(state.cards[state.player]).length===3){preciseMs+=performance.now()-timer;count++;}
      if(choice.type==="score")state=engine.transition(state,{type:"score",category:choice.category});
      else{state=engine.transition(state,{type:"hold",ids:choice.ids});state=engine.transition(state,{type:"roll"});}
    }
    const mine=engine.total(state.cards[seat]),opp=engine.total(state.cards[1-seat]);
    return{mine,opp,credit:mine>opp?1:(mine===opp?0.5:0),v3Decisions:count,v3ComputeMs:preciseMs,gameMs:performance.now()-begin};
  };
  const trial=(candidate,opp,pairs,seedBase)=>{
    const paired=[],raw=[],start=performance.now();
    let decisions=0,compute=0;
    for(let i=0;i<pairs;i++){
      const seed=mix(seedBase+i),one=play(candidate,opp,seed,0),two=play(candidate,opp,seed,1);
      paired.push((one.credit+two.credit)/2);raw.push({seed,first:one,second:two});
      decisions+=one.v3Decisions+two.v3Decisions;compute+=one.v3ComputeMs+two.v3ComputeMs;
      if((i+1)%5===0)console.log("V3_PROGRESS "+JSON.stringify({candidate,opponent:opp,pairs:i+1}));
    }
    const w=mean(paired),sd=Math.sqrt(paired.reduce((s,v)=>s+(v-w)**2,0)/Math.max(1,pairs-1)),half=1.96*sd/Math.sqrt(pairs);
    return{candidate,opponent:opp,games:pairs*2,pairedSeeds:pairs,winCredit:w,ci95Approx:[Math.max(0,w-half),Math.min(1,w+half)],v3Decisions:decisions,v3ComputeMs:compute,elapsedSeconds:(performance.now()-start)/1000,raw};
  };
  const pairs=smoke?1:36;
  const results=[
    trial("Win DP v3 (calibrated)","Win DP v2",pairs,27500000),
    trial("Win DP v3 (uncalibrated)","Win DP v2",smoke?1:12,27510000),
    trial("Win DP v3 (calibrated)","DP Expert",smoke?1:24,27520000),
  ];
  const data={rules:"YachtLab 12-category Nintendo-style",sourceCommit:process.env.GITHUB_SHA??"local",
    scope:"Research-only exact own 3-category competitive DP conditional on fixed score-forecast; opponent PMF approximated by calibrated Gaussian when >2 categories remain.",
    opponentModelSource:"training/results/opponent-calibration.json, disjoint seed range",
    admission:"NOT a full two-player game-theoretic solution; no superiority unless the confidence interval excludes 0.5 under untouched validation.",
    results};
  await mkdir("benchmarks/research",{recursive:true});
  await writeFile("benchmarks/research/win-v3-calibration-study.json",JSON.stringify(data,null,2)+"\n");
  console.log("V3_SUMMARY "+JSON.stringify(results.map(({raw,...rest})=>rest)));
}finally{await server.close();}
