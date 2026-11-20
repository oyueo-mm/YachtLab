import { dpActionValues, dpDecision, dpFutureValue } from "./dp";
import { available, bonus, categories, score, total, upper, type Game } from "./engine";
import type { Candidate, Decision } from "./ai";

// Research-only DP-guided UCB scenario search. This deliberately uses a
// *proxy* opponent final-score model: it is not a calibrated win probability.
// It must beat independent baselines before becoming a default UI model.
function visibleHash(state: Game): number {
  let h = 2166136261 >>> 0;
  const data = [...state.dice.map(d=>d.value),state.rolls,state.player,...state.cards.flatMap(card=>categories.map(c=>card[c]===undefined?255:card[c]))];
  for(const x of data) { h = Math.imul(h ^ x, 16777619) >>> 0; }
  return h || 1;
}
const mask = (state: Game, p:number) => categories.reduce((m,c,i)=>m|(state.cards[p][c]===undefined?1<<i:0),0);
const count = (m:number) => { let n=0;for(;m;m&=m-1)n++;return n; };
const sigmoid = (x:number) => 1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
export function researchGuidedDecision(state: Game, iterations=64): Decision {
  if(state.done || !state.rolls) throw Error("굴림 후 상태만 평가할 수 있습니다.");
  const own=state.cards[state.player], ownMask=mask(state,state.player);
  if(count(ownMask)>3) return dpDecision(state);
  const q=dpActionValues(state), best=Math.max(...q);
  const actions=q.map((value,index)=>({index,value})).filter(a=>Number.isFinite(a.value)&&a.value>=best-7).sort((a,b)=>b.value-a.value).slice(0,10);
  if(actions.length===1) return dpDecision(state);
  const other=state.cards[1-state.player], otherMask=mask(state,1-state.player);
  const target=total(other)+dpFutureValue(otherMask,Math.min(63,upper(other)));
  const sigma=Math.max(10,8*Math.sqrt(count(ownMask)+count(otherMask)));
  let rng=visibleHash(state);
  const rand=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return (rng>>>0)/4294967296;};
  const rollout=(root:number)=>{
    let dice=state.dice.map(d=>d.value),rolls=state.rolls, category=-1;
    const execute=(a:number)=>{
      if(a>=32){category=a-32;return;}
      const held=dice.filter((_,i)=>Boolean(a&(1<<i)));
      dice=[...held,...Array.from({length:5-held.length},()=>Math.floor(rand()*6)+1)];
      rolls++;
    };
    execute(root);
    while(category<0) {
      const fake:Game={...state,rolls,dice:dice.map((value,id)=>({id,value,held:false}))};
      const d=dpDecision(fake);
      if(d.type==="score") { category=categories.indexOf(d.category);break; }
      const held=d.ids.map(id=>dice[id]);
      dice=[...held,...Array.from({length:5-held.length},()=>Math.floor(rand()*6)+1)];
      rolls++;
      if(rolls>3)throw Error("연구용 재굴림 한도 초과");
    }
    const c=categories[category],p=score(dice,c),next={...own,[c]:p};
    const remaining=ownMask^(1<<category);
    const expected=total(own)+p+(bonus(next)-bonus(own))+dpFutureValue(remaining,Math.min(63,upper(next)));
    return sigmoid((expected-target)/sigma);
  };
  const visits=new Int32Array(actions.length), sums=new Float64Array(actions.length);
  for(let i=0;i<Math.max(actions.length,Math.min(1024,iterations));i++){
    let chosen=-1,highest=-Infinity;
    for(let j=0;j<actions.length;j++){
      const score=visits[j]===0?Infinity:sums[j]/visits[j]+Math.sqrt(1.5*Math.log(i+1)/visits[j])+0.02*(actions[j].value-best);
      if(score>highest){highest=score;chosen=j;}
    }
    if(chosen<0)throw Error("선택할 수 없는 연구 행동");
    visits[chosen]++;sums[chosen]+=rollout(actions[chosen].index);
  }
  const ranked=actions.map((a,i)=>({...a,visits:visits[i],mean:sums[i]/visits[i]})).sort((a,b)=>b.visits-a.visits||b.mean-a.mean);
  const pick=ranked[0], candidates:Candidate[]=ranked.map(a=>({
    label:a.index>=32?categories[a.index-32]:"고정 "+state.dice.filter(d=>a.index&(1<<d.id)).map(d=>d.value).join("·"),
    value:a.mean,visits:a.visits,
  }));
  const note="연구용 DP-guided UCB · 이번 턴 확률 롤아웃 + DP 미래 기대점수 + 상대 점수 프록시(실제 승률 아님)";
  return pick.index>=32
    ?{type:"score",category:categories[pick.index-32],value:pick.mean,candidates,note}
    :{type:"reroll",ids:state.dice.filter(d=>pick.index&(1<<d.id)).map(d=>d.id),value:pick.mean,candidates,note};
}
