import {available,bonus,categories,score,upper,type Game} from "./engine";
import type {Decision} from "./ai";

// The original MIT-licensed Dart source is https://github.com/z7workbench/minigames
// Hard: lib/games/yacht_dice/ai/hard_ai.dart ; Medium: medium_ai.dart.
// These are explicitly PORTED to the common YachtLab 12-category score rules;
// neither is the original Dart runtime; all 400ms UI delays removed.
// Full House (Dart 25) is scored as YachtLab dice sum and Hard sampler uses
// deterministic PUBLIC state hashes rather than Dart Random nondeterminism.
export const newExternalIds=["Z7DartHard12","Z7DartMedium12"] as const;
export type NewExternalId=typeof newExternalIds[number];
export const newExternalSources={
 Z7DartHard12:{source:"https://github.com/z7workbench/minigames/blob/main/lib/games/yacht_dice/ai/hard_ai.dart",originalKind:"Dart 2-ply sampled expectimax",changes:"Original category scoring adapted to YachtLab, no artificial 400-ms UI delay, deterministic public-state pseudorandom samples replacing dart:math Random, 12 category scoring (source full-house is flat 25)"},
 Z7DartMedium12:{source:"https://github.com/z7workbench/minigames/blob/main/lib/games/yacht_dice/ai/medium_ai.dart",originalKind:"Dart hardcoded priority rules",changes:"Original 12 categories remapped, original score priority (1000× rank) retained, scoring uses YachtLab common score engine, 350-ms UI delay removed"}
} as const;
type Category=typeof categories[number];
const availableCats=(s:Game)=>available(s.cards[s.player]);
const n=(s:Game)=>s.dice.map(d=>d.value);
const candidate=(type:"score"|"reroll",x:Category|number[],value:number,note:string):Decision=>type==="score"?{type,category:x as Category,value,candidates:[],note}:{type,ids:x as number[],value,candidates:[],note};
const hash=(v:number)=>{v>>>=0;v=Math.imul(v^(v>>>16),0x85ebca6b)>>>0;v=Math.imul(v^(v>>>13),0xc2b2ae35)>>>0;return(v^(v>>>16))>>>0;};
const publicHash=(s:Game)=>{let k=0x9e3779b9;for(const c of categories){k=hash(k+((s.cards[s.player][c]??-1)+1)*1777);}for(const d of s.dice)k=hash(k+d.value*13+d.id);return hash(k+s.rolls*32719+s.player*107);};
const rngFor=(s:Game,salt:number)=>{let x=hash(publicHash(s)+salt);return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return(x/4294967296);};};
const hold=(s:Game,values:number[],note:string):Decision=>{const copy=[...values],ids=s.dice.filter(d=>{const i=copy.indexOf(d.value);if(i<0)return false;copy.splice(i,1);return true;}).map(d=>d.id);return candidate("reroll",ids,0,note);};
const priority:Category[]=["yacht","large","small","full","four","sixes","fives","fours","threes","deuces","aces","choice"];
function medium(s:Game):Decision{
 const vs=n(s),avail=availableCats(s),note="z7workbench MediumAi original fixed score priority (priority×1000+points), Yamaha 12-score adaptation";
 if(s.rolls===3){const cat=priority.find(c=>avail.includes(c))!;return candidate("score",cat,score(vs,cat),note);}if(s.rolls===2)return hold(s,vs,"z7workbench MediumAi source consumes final reroll by keeping all five dice");
 const count=Array(7).fill(0);for(const v of vs)count[v]++;
 const max=Math.max(...count),target=count.indexOf(max);
 if(max>=3&&avail.includes("yacht"))return hold(s,vs.filter(v=>v===target),note);
 if(max>=2&&avail.includes("four"))return hold(s,vs.filter(v=>v===target),note);
 if(avail.includes("full")){const pair=count.indexOf(2),triple=count.indexOf(3);if(pair>0||triple>0){const h=vs.filter(v=>v===pair||v===triple);if(h.length>0)return hold(s,h,note);}}
 if(avail.includes("large")||avail.includes("small")){const unique=[...new Set(vs)].sort((a,b)=>a-b),members=new Set<number>();for(let i=0;i<unique.length;i++){let j=i;while(j+1<unique.length&&unique[j+1]===unique[j]+1)j++;if(j-i+1>=3)for(let k=i;k<=j;k++)members.add(unique[k]);}if(members.size)return hold(s,vs.filter(v=>members.has(v)),note);}
 for(let v=6;v>=1;v--)if(avail.includes(categories[v-1])&&count[v]>=2)return hold(s,vs.filter(x=>x===v),note);
 const m=Math.max(...vs);return hold(s,vs.filter(v=>v===m),note);
}
const potential=[5,10,15,20,25,30,30,30,25,30,40,50]; // Dart original potential, not refitted for 12-rule scores
function hardEval(s:Game,vs:number[]):number{
 const card=s.cards[s.player],u=upper(card);let best=0;
 for(const cat of categories){if(card[cat]!==undefined)continue;const idx=categories.indexOf(cat),sc=score(vs,cat),sum=u+(idx<6?sc:0),bon=idx<6?(sum>=63?35:sum/63*35):0;
  const q=sc+potential[idx]*0.05+bon;if(q>best)best=q;}
 return best;
}
const scoreHard=(s:Game):Decision=>{const vs=n(s),card=s.cards[s.player],u=upper(card);let best=-Infinity,choice:Category|undefined;
 for(const cat of categories){if(card[cat]!==undefined)continue;const idx=categories.indexOf(cat),sc=score(vs,cat),sum=u+(idx<6?sc:0),bon=idx<6?(sum>=63?35:sum/63*35):0,v=sc+potential[idx]*0.05+bon;
  if(v>best){best=v;choice=cat;}}
 if(!choice)throw Error("No category in published Hard source adaptation");
 return candidate("score",choice,best,"z7workbench HardAi immediate score+0.05×potential+bonus-progress rule, fixed 25-to-dice-sum full-house adaptation");
};
const combo=(vs:number[],mask:number,rng:()=>number)=>vs.map((v,i)=>(mask&(1<<i))?v:Math.floor(rng()*6)+1);
const evalKeep=(s:Game,vs:number[],mask:number,depth:number,rng:()=>number):number=>{
 if(depth>=2)return hardEval(s,vs);const n=5-Array.from({length:5},(_,i)=>mask&(1<<i)?1:0).reduce((a,b)=>a+b,0);if(!n)return hardEval(s,vs);
 const samples=n<=2?36:6;let total=0;
 for(let z=0;z<samples;z++){const next=combo(vs,mask,rng);
  if(depth===0&&s.rolls===1){let max=-Infinity;for(let nextMask=0;nextMask<31;nextMask++){const sampleRng= rng;const v=evalKeep(s,next,nextMask,1,sampleRng);if(v>max)max=v;}total+=Number.isFinite(max)?max:hardEval(s,next);}
  else total+=hardEval(s,next);
 }return total/samples;
};
function hard(s:Game):Decision{
 const vs=n(s),avail=availableCats(s);if(s.rolls===3)return scoreHard(s);
 // Dart HardAi uses _shouldSelectCategoryNow before its sampled 2-ply calculation.
 let highest=0;for(const c of avail)highest=Math.max(highest,score(vs,c));const count=Array(7).fill(0);for(const v of vs)count[v]++;
 let considerScore=true;if(Math.max(...count)>=4&&highest<50)considerScore=false;
 const uniq=[...new Set(vs)].sort((a,b)=>a-b);if(considerScore&&uniq.length>=4&&highest<30){let run=1;for(let i=1;i<uniq.length;i++)run=uniq[i]===uniq[i-1]+1?run+1:1;if(run>=4&&highest<40)considerScore=false;}
 if(considerScore&&highest>=40)return scoreHard(s);
 if(considerScore){const rng=rngFor(s,14087);let ev=0;for(let z=0;z<10;z++){const next=[...vs],cs=[...count];for(let i=0;i<5;i++)if(cs[vs[i]]<=1&&rng()<.5)next[i]=Math.floor(rng()*6)+1;ev+=hardEval(s,next);}if(highest>=ev/10)return scoreHard(s);}
 // Source returns all held when only one reroll remains (rather than optimizing another throw).
 if(s.rolls===2)return hold(s,vs,"z7workbench HardAi published rollsRemaining<=1 keeps all five dice; source quirk preserved");
 let best=-Infinity,keep=0;const rng=rngFor(s,5021);
 for(let mask=0;mask<31;mask++){const value=evalKeep(s,vs,mask,0,rng);if(value>best){best=value;keep=mask;}}
 const kept=vs.filter((v,i)=>keep&(1<<i));return hold(s,kept,"z7workbench HardAi two-ply sampled expectimax, deterministic public-state sampling; not exact game DP");
}
export function discoveredExternalDecision(s:Game,id:NewExternalId):Decision{if(s.done||!s.rolls)throw Error("Rolled state required");return id==="Z7DartHard12"?hard(s):medium(s);}
