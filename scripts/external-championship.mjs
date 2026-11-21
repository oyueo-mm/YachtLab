import {createServer} from "vite";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
const arg=(key,fallback)=>{const at=process.argv.indexOf(key);return at<0?fallback:process.argv[at+1];},smoke=process.argv.includes("--smoke"),opponent=arg("--opponent","RustHeuristic12"),shard=Number(arg("--shard","0")),pairs=smoke?2:Number(arg("--pairs","250")),hash=x=>{x>>>=0;x=Math.imul(x^(x>>>16),0x85ebca6b)>>>0;x=Math.imul(x^(x>>>13),0xc2b2ae35)>>>0;return(x^(x>>>16))>>>0;},mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
if(!Number.isInteger(shard)||shard<0||shard>9||!Number.isInteger(pairs)||pairs<1||pairs>10000)throw Error("Invalid tournament partition");
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
try{
 const eng=await server.ssrLoadModule("/src/engine.ts"),dp=await server.ssrLoadModule("/src/dp.ts"),win=await server.ssrLoadModule("/src/competitive-v2.ts"),external=await server.ssrLoadModule("/src/external-challengers.ts");
 if(!external.externalChallengerIds.includes(opponent))throw Error("Unrecognized external challenger");
 const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8")),buf=gunzipSync(await readFile("public/ai/"+manifest.asset));dp.setDPTable(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
 const baseline=s=>win.winDPv2Decision(s)??dp.dpDecision(s),challenger=s=>external.externalChallengerDecision(s,opponent);
 const play=(seed,seat)=>{let s=eng.createGame(seed,true),steps=0,externalMs=0,baselineMs=0,challengerActions=0,baselineActions=0,roundDecisions=Array(12).fill(0);
  while(!s.done){if(++steps>190)throw Error("Full game exceeded legal action bound");if(!s.rolls){s=eng.transition(s,{type:"roll"});continue;}
   const mine=s.player===seat,started=performance.now(),action=mine?challenger(s):baseline(s),ms=performance.now()-started;
   if(mine){externalMs+=ms;challengerActions++;}else{baselineMs+=ms;baselineActions++;}roundDecisions[eng.available(s.cards[s.player]).length-1]++;
   if(action.type==="score"){if(!eng.available(s.cards[s.player]).includes(action.category))throw Error("Illegal outside category");s=eng.transition(s,{type:"score",category:action.category});}
   else{if(s.rolls>=3||new Set(action.ids).size!==action.ids.length||action.ids.some(id=>!s.dice.some(d=>d.id===id)))throw Error("Illegal reroll");s=eng.transition(eng.transition(s,{type:"hold",ids:action.ids}),{type:"roll"});}
  }
  const own=eng.total(s.cards[seat]),other=eng.total(s.cards[1-seat]),winCredit=own>other?1:own===other?.5:0;
  return{winCredit,own,other,challengerActions,baselineActions,externalMs,baselineMs};
 };
 const paired=[],rows=[],start=performance.now();let sumOwn=0,sumOther=0,externalMs=0,baselineMs=0,externalActions=0,baselineActions=0,wins=0,losses=0,ties=0;
 for(let i=0;i<pairs;i++){const seed=hash(312700000+shard*131071+i),a=play(seed,0),b=play(seed,1),credit=(a.winCredit+b.winCredit)/2;paired.push(credit);rows.push({seed,challengerFirst:a,challengerSecond:b,pairedCredit:credit});
  for(const game of [a,b]){sumOwn+=game.own;sumOther+=game.other;externalMs+=game.externalMs;baselineMs+=game.baselineMs;externalActions+=game.challengerActions;baselineActions+=game.baselineActions;wins+=game.winCredit===1?1:0;losses+=game.winCredit===0?1:0;ties+=game.winCredit===.5?1:0;}
  if((i+1)%(smoke?1:50)===0)console.log("EXTERNAL_TOURNAMENT_PROGRESS "+JSON.stringify({opponent,shard,pairsComplete:i+1,pairs,winCredit:mean(paired),elapsedS:(performance.now()-start)/1000}));
 }
 const m=mean(paired),sd=Math.sqrt(paired.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,pairs-1)),half=1.96*sd/Math.sqrt(pairs),result={opponent,shard,sourceCommit:process.env.GITHUB_SHA??"local",sources:external.externalChallengerInfo[opponent],study:"SOURCE-DERIVED POLICY ADAPTATIONS, not original external executable competition",rules:"YachtLab Nintendo 12 categories: three rolls, full house sum, small 15, large 30, no 3-of-kind, no joker/+100, upper >=63 +35",pairedSeeds:pairs,games:pairs*2,winCredit:m,ci95Paired:[Math.max(0,m-half),Math.min(1,m+half)],wins,losses,ties,ownMean:sumOwn/(2*pairs),baselineMean:sumOther/(2*pairs),challengerMeanDecisionMs:externalMs/Math.max(1,externalActions),baselineMeanDecisionMs:baselineMs/Math.max(1,baselineActions),elapsedSeconds:(performance.now()-start)/1000,raw:rows,limits:["Every opponent policy is explicitly adapted or a mathematically-equivalent proxy. Original 13-category binaries are NOT run against YachtLab's 12-category engine.","RustOptimalEquivalent12 is a copy of YachtLab DP Expert behavior on the same rules, not an independent external optimizer output","BenjiWinObjective12 reuses YachtLab Win DP v3 for the author-inspired objective and is NOT the author's Python solver","Matched dice seeds and seat swaps; game pairs are the independent statistical units","No default AI, production tournament tab or deployment policy modified"]};
 await mkdir("training/results/external-championship",{recursive:true});const output="training/results/external-championship/"+opponent+"-shard-"+shard+".json";await writeFile(output,JSON.stringify(result,null,2)+"\n");console.log("EXTERNAL_TOURNAMENT_SHARD "+JSON.stringify({opponent,shard,games:result.games,winCredit:m,ci:result.ci95Paired,challengerScore:result.ownMean,winDPv2Score:result.baselineMean,seconds:result.elapsedSeconds}));
}finally{await server.close();}
