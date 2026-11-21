import kernel from "./dp-kernel.json";
import { chanceValues } from "./dp";
import { lastTurnDPDistribution, winDPDecision } from "./win-dp";
import { available, categories, total, upper, type Game } from "./engine";
import type { Candidate, Decision } from "./ai";

// Exact best response in the 1-v-1 final category subgame ONLY.
// Player 0 scores now. Player 1 will then see that final total and act with
// the exact fixed-score Win DP policy (not the DP Expert assumed by Win DP v2).
// No PRNG internals, Monte Carlo approximations, or hidden opponent state.
const EPS=1e-12, N=252, CAP=86;
type Plan={win:Float64Array[];points:Float64Array[];picks:Int16Array[]};
const fullIndex=new Map(kernel.states.slice(210).map((dice,i)=>[dice.join(""),i]));
const bestResponseCache=new Map<string,ReturnType<typeof build>>(), opponentResponseCache=new Map<string,number>();
const capped=(x:number)=>Math.min(63,x);
const gain=(d:number,c:number,u:number)=>{const p=kernel.points[d][c];return p+(c<6&&u<63&&u+p>=63?35:0);};
const better=(w:number,p:number,bw:number,bp:number)=>w>bw+EPS||(Math.abs(w-bw)<=EPS&&p>bp+EPS);
function plan(terminal:Float64Array,points:Float64Array):Plan{
 const win=[terminal],score=[points],picks=[new Int16Array(N).fill(-1)];
 for(let r=1;r<=2;r++){const chanceWin=chanceValues(win[r-1]),chanceScore=chanceValues(score[r-1]),w=new Float64Array(N),p=new Float64Array(N),act=new Int16Array(N).fill(-1);
  for(let d=0;d<N;d++){let bw=terminal[d],bp=points[d],bh=-1;for(const h of kernel.holds[d])if(h<210&&better(chanceWin[h],chanceScore[h],bw,bp)){bw=chanceWin[h];bp=chanceScore[h];bh=h;}w[d]=bw;p[d]=bp;act[d]=bh;}
  win.push(w);score.push(p);picks.push(act);
 }
 return{win,points:score,picks};
}
function evaluateFixed(terminal:Float64Array,picks:Int16Array[]):Float64Array[]{
 const values=[terminal];
 for(let r=1;r<=2;r++){const chance=chanceValues(values[r-1]),next=new Float64Array(N);for(let d=0;d<N;d++){const h=picks[r][d];next[d]=h<0?terminal[d]:chance[h];}values.push(next);}
 return values;
}
function opponentMaximumCredit(category:number,u:number,needed:number):number{
 // needed = our final total minus their already-recorded total.
 if(needed<0)return 1;if(needed>CAP-1)return 0;
 const key=category+":"+capped(u)+":"+needed,hit=opponentResponseCache.get(key);if(hit!==undefined)return hit;
 const stop=new Float64Array(N);
 for(let d=0;d<N;d++){const g=gain(d,category,u);stop[d]=g>needed?1:g===needed?.5:0;}
 let values=stop;
 for(let r=1;r<=2;r++){const chance=chanceValues(values),next=new Float64Array(N);for(let d=0;d<N;d++){let best=stop[d];for(const h of kernel.holds[d])if(h<210&&chance[h]>best)best=chance[h];next[d]=best;}values=next;}
 let expectation=0;for(let d=0;d<N;d++)expectation+=kernel.probabilities[d]*values[d];
 if(opponentResponseCache.size>=12000)opponentResponseCache.clear();
 opponentResponseCache.set(key,expectation);return expectation;
}
function build(myCat:number,myUpper:number,myBase:number,oppCat:number,oppUpper:number,oppBase:number){
 const points=new Float64Array(N),actual=new Float64Array(N),assumed=new Float64Array(N),opponentDP=lastTurnDPDistribution(categories[oppCat],oppUpper);
 const prefix=new Float64Array(opponentDP.length+1);for(let i=0;i<opponentDP.length;i++)prefix[i+1]=prefix[i]+opponentDP[i];
 for(let d=0;d<N;d++){
  const inc=gain(d,myCat,myUpper),diff=myBase+inc-oppBase;points[d]=inc;
  actual[d]=1-opponentMaximumCredit(oppCat,oppUpper,diff);
  assumed[d]=diff<0?0:diff>=opponentDP.length?1:prefix[diff]+opponentDP[diff]/2;
 }
 const optimal=plan(actual,points),baseline=plan(assumed,points),baselineActual=evaluateFixed(actual,baseline.picks);
 return{optimal,baseline,baselineActual};
}
export function eligibleExactLastTurn(state:Game):boolean{
 return!state.done&&state.rolls>0&&state.player===0&&available(state.cards[0]).length===1&&available(state.cards[1]).length===1;
}
export type LastTurnBRAnalysis={decision:Decision;baseline:Decision;gain:number;optimalWin:number;baselineWin:number;different:boolean;selectedAction:number;baselineAction:number};
export function analyzeExactLastTurn(state:Game):LastTurnBRAnalysis|null{
 if(!eligibleExactLastTurn(state))return null;
 const myCat=categories.indexOf(available(state.cards[0])[0]),oppCat=categories.indexOf(available(state.cards[1])[0]),mine=state.cards[0],opp=state.cards[1],u=capped(upper(mine)),ou=capped(upper(opp)),own=total(mine),other=total(opp);
 const key=[myCat,u,own,oppCat,ou,other].join(":");let solve=bestResponseCache.get(key);if(!solve){solve=build(myCat,u,own,oppCat,ou,other);if(bestResponseCache.size>=128)bestResponseCache.clear();bestResponseCache.set(key,solve);}
 const index=fullIndex.get(state.dice.map(d=>d.value).sort((a,b)=>a-b).join(""));if(index===undefined)throw Error("Unrecognized full-dice multiset");
 const left=3-state.rolls,h=solve.optimal.picks[left][index],bh=solve.baseline.picks[left][index];
 const score=(action:number,value:number):Decision=>{
  const common={value,candidates:[] as Candidate[],note:"Research: exact player-0 last-turn best response to adaptive player-1 Win DP; opponent policy is fixed, not game-theoretic Nash"};
  if(action<0)return{type:"score",category:categories[myCat],...common};
  const held=[...kernel.states[action]];
  return{type:"reroll",ids:state.dice.filter(d=>{const at=held.indexOf(d.value);if(at<0)return false;held.splice(at,1);return true;}).map(d=>d.id),...common};
 };
 const opt=solve.optimal.win[left][index],base=solve.baselineActual[left][index],decision=score(h,opt),baseline=score(bh,base);
 const different=decision.type!==baseline.type||(decision.type==="reroll"&&baseline.type==="reroll"&&decision.ids.slice().sort((a,b)=>a-b).join()!==baseline.ids.slice().sort((a,b)=>a-b).join());
 return{decision,baseline,gain:Math.max(0,opt-base),optimalWin:opt,baselineWin:base,different,selectedAction:h,baselineAction:bh};
}
export function exactLastTurnBRDecision(state:Game):Decision|null{return analyzeExactLastTurn(state)?.decision??null;}
export function clearExactLastTurnResearchCache(){bestResponseCache.clear();opponentResponseCache.clear();}
