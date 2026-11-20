import { categories, total, upper, available, type Game } from "./engine";
import { dpDecision } from "./dp";
import { winDPv2Decision } from "./competitive-v2";
import { residualCandidates, publicProjectedGap, FEATURE_NAMES } from "./selfplay-residual";
import type { Decision } from "./ai";

export const NEURAL_INPUTS = FEATURE_NAMES.length;
export const NEURAL_HIDDEN = 12;
export const NEURAL_GRADIENT_SIZE = NEURAL_HIDDEN * NEURAL_INPUTS + NEURAL_HIDDEN * 2;
export type NeuralResidual = { w1: number[][]; b1: number[]; w2: number[]; critic: number[]; label?: string };
export type NeuralSample = { decision: Decision; gradient: number[]; valueFeatures: number[]; stateValue: number; probability: number };
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const truncate = (x: number) => Math.max(-1, Math.min(1, x));
const zeros = (n: number) => Array(n).fill(0);

export function createNeuralResidual(seed = 777): NeuralResidual {
  let s = seed >>> 0;
  const rand = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296 - .5; };
  return { w1: Array.from({ length: NEURAL_HIDDEN }, () => Array.from({ length: NEURAL_INPUTS }, () => .2 * rand())),
    b1: zeros(NEURAL_HIDDEN), w2: Array.from({ length: NEURAL_HIDDEN }, () => .02 * rand()), critic: zeros(5) };
}
export function cloneNeuralResidual(model: NeuralResidual): NeuralResidual {
  return { w1: model.w1.map(row => [...row]), b1: [...model.b1], w2: [...model.w2], critic: [...model.critic], label: model.label };
}
export function unpackNeuralActor(model: NeuralResidual): number[] {
  return [...model.w1.flat(), ...model.b1, ...model.w2];
}
export function setNeuralActor(model: NeuralResidual, flat: number[]): void {
  if (flat.length !== NEURAL_GRADIENT_SIZE || !flat.every(Number.isFinite)) throw Error("Invalid neural actor vector.");
  let at = 0;
  for (let j = 0; j < NEURAL_HIDDEN; j++) for (let k = 0; k < NEURAL_INPUTS; k++) model.w1[j][k] = flat[at++];
  for (let j = 0; j < NEURAL_HIDDEN; j++) model.b1[j] = flat[at++];
  for (let j = 0; j < NEURAL_HIDDEN; j++) model.w2[j] = flat[at++];
}
export function neuralValueFeatures(state: Game): number[] {
  const mine = state.cards[state.player], other = state.cards[1 - state.player];
  const rem = available(mine).length;
  return [1, truncate(publicProjectedGap(state) / 45), rem / 12,
    truncate((upper(mine) - upper(other)) / 65),
    truncate((total(mine) - total(other)) / 90)];
}
function fromIndex(state: Game, idx: number, value: number): Decision {
  const common = { value, candidates: [],
    note: "RESEARCH full-game neural residual policy over DP Q values; projected points not calibrated win probability" };
  return idx >= 32 ? { type:"score", category:categories[idx - 32], ...common }
    : { type:"reroll", ids:state.dice.filter(d=>idx & (1<<d.id)).map(d=>d.id), ...common };
}
export function neuralResidualDecision(
  state: Game, model: NeuralResidual,
  opts: { sample?: boolean; rng?: () => number; temperature?: number; pointLossCap?: number } = {}
): NeuralSample {
  if (!state.rolls || state.done) throw Error("Neural policy requires a rolled visible game.");
  if (model.w1.length !== NEURAL_HIDDEN || model.critic.length !== 5 || !unpackNeuralActor(model).every(Number.isFinite))
    throw Error("Invalid neural policy parameters.");
  const vf = neuralValueFeatures(state), value = sigmoid(dot(vf, model.critic));
  if (available(state.cards[state.player]).length <= 2) {
    return { decision:winDPv2Decision(state) ?? dpDecision(state),
      gradient:zeros(NEURAL_GRADIENT_SIZE), valueFeatures:vf, stateValue:value, probability:1 };
  }
  const candidates = residualCandidates(state, opts.pointLossCap ?? 3.5);
  const bestQ = Math.max(...candidates.map(c=>c.q)), temperature = Math.max(.2, opts.temperature ?? .8);
  const hidden=candidates.map(c=>model.w1.map((row,j)=>Math.tanh(dot(row,c.features)+model.b1[j])));
  const logits=candidates.map((c,i)=>(c.q-bestQ)/temperature + dot(hidden[i],model.w2));
  const hi=Math.max(...logits),weights=logits.map(v=>Math.exp(v-hi)),norm=weights.reduce((s,v)=>s+v,0),probs=weights.map(x=>x/norm);
  let selected=0;
  if(opts.sample){
    let u=opts.rng?.()??.5;
    for(let i=0;i<probs.length;i++){ u-=probs[i]; if(u<=0 || i===probs.length-1){selected=i;break;} }
  } else for(let i=1;i<logits.length;i++)if(logits[i]>logits[selected]+1e-12)selected=i;
  const gradients=candidates.map((candidate,i)=>{
    const grad:number[]=[];
    for(let j=0;j<NEURAL_HIDDEN;j++) {
      const derivative=model.w2[j]*(1-hidden[i][j]*hidden[i][j]);
      for(let k=0;k<NEURAL_INPUTS;k++)grad.push(derivative*candidate.features[k]);
    }
    for(let j=0;j<NEURAL_HIDDEN;j++)
      grad.push(model.w2[j]*(1-hidden[i][j]*hidden[i][j]));
    grad.push(...hidden[i]);
    return grad;
  });
  const grad=zeros(NEURAL_GRADIENT_SIZE);
  for(let i=0;i<candidates.length;i++)
    for(let j=0;j<grad.length;j++)grad[j] -= probs[i]*gradients[i][j];
  for(let j=0;j<grad.length;j++)grad[j]+=gradients[selected][j];
  return {decision:fromIndex(state,candidates[selected].index,candidates[selected].q),
    gradient:grad, valueFeatures:vf,stateValue:value,probability:probs[selected]};
}
