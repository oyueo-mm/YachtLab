// @ts-nocheck
// Research-only rollout gate: common future dice streams, pure DP/WinDP continuation, no hidden game RNG as model input.
import {transition,playerRngSeed,total,available} from "./engine";
import {dpDecision} from "./dp";
import {winDPv2Decision} from "./competitive-v2";
const win=(a,b)=>a>b?1:a===b?.5:0;
export function referenceAction(s){return available(s.cards[s.player]).length<=2?(winDPv2Decision(s)??dpDecision(s)):dpDecision(s);}
export function sameAction(a,b){return a.type===b.type&&(a.type==="score"?a.category===b.category:[...a.ids].sort().join(",")===[...b.ids].sort().join(","));}
export function stepGame(s,d){return d.type==="score"?transition(s,{type:"score",category:d.category}):transition(transition(s,{type:"hold",ids:d.ids}),{type:"roll"});}
export function followBaseline(state,seat,first,seed){let s={...state,rng:[playerRngSeed(seed,0),playerRngSeed(seed,1)]};s=stepGame(s,first);let steps=0;while(!s.done){if(++steps>128)throw Error("Counterfactual exceeds move bound");if(!s.rolls){s=transition(s,{type:"roll"});continue;}s=stepGame(s,referenceAction(s));}return win(total(s.cards[seat]),total(s.cards[1-seat]));}
export function safetyStats(samples,margin=.02,z=1.645){if(!samples.length)throw Error("No counterfactual evidence");const mean=samples.reduce((a,b)=>a+b,0)/samples.length,variance=samples.length>1?samples.reduce((a,b)=>a+(b-mean)**2,0)/(samples.length-1):Infinity,sem=Math.sqrt(variance/samples.length),lower=mean-z*sem;return{mean,sem,lower,accept:samples.length>1&&Number.isFinite(lower)&&lower>margin,n:samples.length};}
export function gateAction(state,proposed,{rollouts=12,margin=.02,seed=0,z=1.645}={}){const fallback=referenceAction(state);if(sameAction(proposed,fallback))return{decision:fallback,accepted:false,checked:false,reason:"same",stats:null};if(!Number.isInteger(rollouts)||rollouts<2)throw Error("Need at least two rollouts");const seat=state.player,samples=[];for(let i=0;i<rollouts;i++){const future=(seed+Math.imul(i+1,0x9e3779b9))>>>0,qr=followBaseline(state,seat,proposed,future),dp=followBaseline(state,seat,fallback,future);samples.push(qr-dp);}const stats=safetyStats(samples,margin,z);return{decision:stats.accept?proposed:fallback,accepted:stats.accept,checked:true,reason:stats.accept?"positive-lower-bound":"insufficient-evidence",stats};}
