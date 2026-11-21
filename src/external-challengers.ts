import kernel from "./dp-kernel.json";
import { chanceValues, dpDecision } from "./dp";
import { winDPv3Decision } from "./competitive-v3";
import { available, categories, score, upper, type Game } from "./engine";
import type { Decision } from "./ai";

// AUDITED RULE ADAPTATIONS, NOT THE ORIGINAL AUTHORS' UNMODIFIED BINARIES.
// The original open implementations have 13 categories, different point values,
// and BenjiHilton's solver uses only two rolls. These models ALL use YachtLab's
// 12-category, three-roll engine. Attribution and deviations are mandatory.
export const externalChallengerIds=["RustHeuristic12","RustOptimalEquivalent12","PanchtWeighted12","BenjiWinObjective12"] as const;
export type ExternalChallengerId=typeof externalChallengerIds[number];
export const externalChallengerInfo={
 RustHeuristic12:{source:"https://github.com/jdh8/yahtzee-engine/blob/main/src/heuristic.rs",kind:"source-logic port",originalRules:"13 categories, Hasbro joker/+100",adaptation:"Keeps source's fixed hold-priority ladder, monster-hand stopping and category score-minus-par; removes nonexistent three-of-a-kind box, substitutes YachtLab category scores and 3-roll engine; original par numbers NOT refitted"},
 RustOptimalEquivalent12:{source:"https://github.com/jdh8/yahtzee-engine/blob/main/src/solver.rs",kind:"mathematical-equivalence proxy, NOT external code",originalRules:"13 categories, Hasbro joker/+100",adaptation:"Exact expected-score Bellman policy under 12-category rules, using YachtLab independent DP Expert table; mathematically same objective as Rust OptimalBot, NOT a port/execution of its Rust binary"},
 PanchtWeighted12:{source:"https://seoh136199.github.io/posts/yacht-dice-optimal-selection-algorithm/",kind:"algorithm recreation from author's published C++ pseudocode",originalRules:"13 categories, bonus simplified into upper-weight 3.0",adaptation:"Original weighted points x3 for upper 1-6, expected-score DP over open-category mask and two rerolls, author’s uniform mean over 252 DISTINCT initial dice multisets (not their multinomial probabilities); removes original three-of-a-kind box, uses YachtLab's category scores; no explicit 63-point bonus in AI utility"},
 BenjiWinObjective12:{source:"https://github.com/BenjiHilton/yahtzee-vs-optimal",kind:"objective-level proxy via YachtLab Win DP v3, NOT external Python engine",originalRules:"13 categories, 2 rolls per turn, Hasbro joker/+100",adaptation:"Retains expected-score DP outside the last three categories and win-credit target DP over last three; opponent future score is DP Expert PMF if <=2 remain, approximate Gaussian otherwise. Uses YachtLab's existing Win DP v3 implementation with three-roll/12-category rules"}
} as const;
const D=252, fullIndex=new Map(kernel.states.slice(210).map((xs,i)=>[xs.join(""),i]));
const maskOf=(s:Game)=>categories.reduce((m,c,i)=>s.cards[s.player][c]===undefined?m|(1<<i):m,0);
const diceValues=(s:Game)=>s.dice.map(x=>x.value);
const finishScore=(s:Game)=>{const card=s.cards[s.player],values=diceValues(s),u=upper(card);let best=-Infinity,idx=-1;for(let i=0;i<12;i++)if(card[categories[i]]===undefined){const p=score(values,categories[i]),value=p+(i<6&&u<63&&u+p>=63?35:0)-par[i];if(value>=best){best=value;idx=i;}}if(idx<0)throw Error("No available category for heuristic");return{type:"score" as const,category:categories[idx],value:best,candidates:[],note:"jdh8 Rust HeuristicBot priority and score-minus-par logic adapted to 12-category YachtLab"};};
const par=[1.9,3.8,5.6,7.5,9.4,11.3,22,12.9,22.3,29.1,32.5,16.9];
function rustHeuristic(s:Game):Decision{
 const values=diceValues(s),counts=Array(7).fill(0);for(const v of values)counts[v]++;
 const card=s.cards[s.player],has=c=>card[c]===undefined,face=[1,2,3,4,5,6].sort((a,b)=>counts[b]-counts[a]||b-a)[0],max=counts[face];
 const made=counts.includes(5)||(has("large")&&score(values,"large")>0)||(has("small")&&!has("large")&&score(values,"small")>0)||(has("full")&&score(values,"full")>0);
 if(s.rolls===3||made)return finishScore(s);
 let held:number[]=[];
 if(max>=3&&(has(categories[face-1])||has("four")||has("yacht")))held=Array(max).fill(face);
 else{
  let last=0,length=0,bestEnd=0,bestLen=0;for(let v=1;v<=6;v++){length=counts[v]>0?length+1:0;if(length>=bestLen){bestEnd=v;bestLen=length;}last=v;}void last;
  if(bestLen>=4&&(has("small")||has("large")))held=Array.from({length:bestLen},(_,j)=>bestEnd-bestLen+1+j);
  else if(max===2&&has(categories[face-1]))held=[face,face];
  else if(has("choice"))held=values.filter(v=>v>=(s.rolls===1?5:4));
  else held=Array(max).fill(face);
 }
 if(held.length>=5)return finishScore(s);
 const remaining=[...held],ids=s.dice.filter(d=>{const i=remaining.indexOf(d.value);if(i<0)return false;remaining.splice(i,1);return true;}).map(d=>d.id);
 return{type:"reroll",ids,value:0,candidates:[],note:"jdh8 HeuristicBot fixed priority hold ladder, 12-category adaptation; not original Rust binary"};
}
let panchtTable:Float64Array|null=null;
function ensurePanchtTable():Float64Array{
 if(panchtTable)return panchtTable;const table=new Float64Array(4096),start=Date.now();
 for(let mask=1;mask<4096;mask++){
  const stop=panchtStop(mask,table),after1=panchtSweep(stop,stop),after2=panchtSweep(stop,after1);
  let avg=0;for(let d=0;d<D;d++)avg+=after2[d];
  table[mask]=avg/D; // Author's getAvgScore uses uniform 252 distinct rolls.
 }
 if(!Number.isFinite(table[4095])||table[4095]<=0)throw Error("Pancht dynamic program invalid");
 panchtTable=table;console.log("EXTERNAL_PANCHT_TABLE "+JSON.stringify({states:4096,weightedObjective:table[4095],seconds:(Date.now()-start)/1000,firstRollMeasure:"uniform unique 252 multisets, copied from source method"}));return table;
}
function panchtStop(mask:number,table:Float64Array):Float64Array{
 const out=new Float64Array(D);
 for(let d=0;d<D;d++){let best=-Infinity;for(let c=0;c<12;c++)if(mask&(1<<c)){const points=kernel.points[d][c]*(c<6?3:1),v=points+table[mask^(1<<c)];if(v>best)best=v;}out[d]=best;}
 return out;
}
function panchtSweep(stop:Float64Array,prev:Float64Array):Float64Array{
 const chance=chanceValues(prev),out=new Float64Array(D);
 for(let d=0;d<D;d++){let best=stop[d];for(const h of kernel.holds[d])if(h<210&&chance[h]>best)best=chance[h];out[d]=best;}
 return out;
}
export function panchtAdaptedDecision(s:Game):Decision{
 if(!s.rolls||s.done)throw Error("Require visible rolled state");const table=ensurePanchtTable(),mask=maskOf(s),values=diceValues(s),index=fullIndex.get([...values].sort((a,b)=>a-b).join(""));if(index===undefined)throw Error("Dice index missing");
 let best=-Infinity,cat=-1;for(let c=0;c<12;c++)if(mask&(1<<c)){const value=kernel.points[index][c]*(c<6?3:1)+table[mask^(1<<c)];if(value>best){best=value;cat=c;}}if(cat<0)throw Error("Invalid mask");
 let keep=-1;if(s.rolls<3){const stop=panchtStop(mask,table),prev=s.rolls===1?panchtSweep(stop,stop):stop,chance=chanceValues(prev);for(const h of kernel.holds[index])if(h<210&&chance[h]>best+1e-10){best=chance[h];keep=h;}}
 const common={value:best,candidates:[],note:"Pancht C++ algorithm adaptation: upper x3, future-category DP, uniform 252-state turn-start model; not original 13-category binary"};
 if(keep<0)return{type:"score",category:categories[cat],...common};
 const kept=[...kernel.states[keep]],ids=s.dice.filter(d=>{const i=kept.indexOf(d.value);if(i<0)return false;kept.splice(i,1);return true;}).map(d=>d.id);
 return{type:"reroll",ids,...common};
}
export function externalChallengerDecision(s:Game,id:ExternalChallengerId):Decision{
 if(!s.rolls||s.done)throw Error("Expected a rolled legal state");
 if(id==="RustHeuristic12")return rustHeuristic(s);
 if(id==="RustOptimalEquivalent12")return dpDecision(s);
 if(id==="PanchtWeighted12")return panchtAdaptedDecision(s);
 if(id==="BenjiWinObjective12")return winDPv3Decision(s)??dpDecision(s);
 throw Error("Unknown external challenger");
}
