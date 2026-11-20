import {createServer} from "vite";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom"});
const mix=(x)=>{x^=x>>>16;x=Math.imul(x,0x85ebca6b);x^=x>>>13;x=Math.imul(x,0xc2b2ae35);return(x^(x>>>16))>>>0;};
const games=Number(process.argv[2]??20000);
if(!Number.isInteger(games)||games<100||games>100000||games%2)throw Error("Expected even game count between 100 and 100000");
try {
  const {simulate}=await server.ssrLoadModule("/src/match.ts");
  const {total}=await server.ssrLoadModule("/src/engine.ts");
  const {setDPTable,dpDecision}=await server.ssrLoadModule("/src/dp.ts");
  const manifest=JSON.parse(await readFile("src/dp-manifest.json","utf8")),b=gunzipSync(await readFile("public/ai/"+manifest.asset));
  setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const run=(opponent,base,n)=>{
    const credits=[],results=[];
    let changed=0,optimized=0;
    const start=performance.now();
    for(let pair=0;pair<n/2;pair++){
      const seed=mix(base+pair),values=[];
      for(let side=0;side<2;side++){
        const players=side===0?["Win DP v2",opponent]:[opponent,"Win DP v2"];
        const game=simulate(players,seed),end=game.frames.at(-1).state;
        const own=total(end.cards[side]),other=total(end.cards[1-side]);
        const credit=own>other?1:own===other?0.5:0;
        values.push(credit);
        for(let j=1;j<game.frames.length;j++){
          const f=game.frames[j];
          if(f.actor!==side||!f.decision?.note.includes("Win DP v2"))continue;
          optimized++;
          const prev=game.frames[j-1].state,baseline=dpDecision(prev);
          const same=f.decision.type===baseline.type&&(baseline.type==="score"
            ?baseline.category===f.decision.category
            :[...baseline.ids].sort().join(",")===[...f.decision.ids].sort().join(","));
          if(!same)changed++;
        }
        results.push({seed,side,opponent,own,other,credit});
      }
      credits.push((values[0]+values[1])/2);
      if((pair+1)%500===0)console.log("CONFIRM_PROGRESS "+JSON.stringify({opponent,pairs:pair+1,games:2*(pair+1)}));
    }
    const mean=credits.reduce((s,v)=>s+v,0)/credits.length;
    const sd=Math.sqrt(credits.reduce((s,v)=>s+(v-mean)**2,0)/(credits.length-1));
    const bound=1.96*sd/Math.sqrt(credits.length);
    return{candidate:"Win DP v2",opponent,games:n,pairedSeeds:n/2,seedScheme:"Murmur3 finalizer "+base+"+i, unseen prior to this confirmatory experiment",seedBase:base,
      winCredit:mean,ci95Approx:[Math.max(0,mean-bound),Math.min(1,mean+bound)],
      meanCandidateScore:results.reduce((s,v)=>s+v.own,0)/n,
      meanOpponentScore:results.reduce((s,v)=>s+v.other,0)/n,
      actionsWithTwoTurnCompetitiveDP:optimized,changedActionsVsExpectedScoreDP:changed,
      elapsedSeconds:(performance.now()-start)/1000,individualMatches:results};
  };
  const primary=run("DP Expert",1350000,games);
  const secondary=run("Win DP",1370000,Math.max(200,Math.floor(games/2/2)*2));
  const summary={protocol:"fixed candidate; completely new confirmatory seeds; no tuning after observation",primary,secondary,
    caveats:["Conditional competitor model assumes DP Expert future play","Win DP v2 is not a full-game two-player Nash/optimal solver","Paired CI uses seat-swapped seed mean, normal approximation","No general SOTA claim","QR-DQN and root UCB research evaluated separately"]};
  await mkdir("benchmarks/research",{recursive:true});
  await writeFile("benchmarks/research/confirm-v2-"+games+".json",JSON.stringify(summary,null,2)+"\n");
  console.log("CONFIRM_SUMMARY "+JSON.stringify({primary:{...primary,individualMatches:undefined},secondary:{...secondary,individualMatches:undefined}}));
}finally{await server.close();}
