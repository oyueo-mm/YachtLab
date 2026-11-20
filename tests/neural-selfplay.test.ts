import { beforeAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { setDPTable, dpActionValue, dpDecision } from "../src/dp";
import { categories, createGame, transition, type Game, type Card } from "../src/engine";
import { createNeuralResidual, cloneNeuralResidual, unpackNeuralActor, setNeuralActor, neuralResidualDecision, NEURAL_GRADIENT_SIZE } from "../src/neural-residual";

beforeAll(() => {
  const b=gunzipSync(readFileSync("public/ai/"+manifest.asset));
  setDPTable(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
});
it("small neural residual uses only visible dice and scorecards, not seeded RNG",()=>{
  const s=transition(createGame(15,true),{type:"roll"}),model=createNeuralResidual(41);
  const r=neuralResidualDecision(s,model,{sample:true,rng:()=>.3});
  const t:Game={...s,seed:124123,rng:[123456,8888]};
  expect(neuralResidualDecision(t,model,{sample:true,rng:()=>.3})).toEqual(r);
  expect(r.gradient).toHaveLength(NEURAL_GRADIENT_SIZE);
  expect(r.gradient.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(dpActionValue(s,r.decision))).toBe(true);
  expect(r.stateValue).toBeGreaterThan(0);
  expect(r.stateValue).toBeLessThan(1);
});
it("zero neural residual leaves expected score DP Q preference intact",()=>{
  const model=createNeuralResidual(5);model.w2.fill(0);
  for(const seed of [13,21,38]){
    const state=transition(createGame(seed,true),{type:"roll"});
    const result=neuralResidualDecision(state,model);
    expect(dpActionValue(state,result.decision)).toBeCloseTo(dpDecision(state).value,7);
  }
});
it("neural weights round-trip and reject invalid numeric model",()=>{
  const model=createNeuralResidual(12),copy=cloneNeuralResidual(model),p=unpackNeuralActor(copy);
  expect(p).toHaveLength(NEURAL_GRADIENT_SIZE);
  p[0]+=.25;setNeuralActor(copy,p);
  expect(unpackNeuralActor(copy)[0]).toBeCloseTo(p[0],12);
  expect(unpackNeuralActor(model)[0]).not.toBeCloseTo(unpackNeuralActor(copy)[0],12);
  expect(()=>setNeuralActor(copy,p.slice(0,5))).toThrow();
});
it("last two categories still use existing Win DP v2 and zero neural gradient",()=>{
  const a:Card=Object.fromEntries(categories.filter(c=>c!=="choice"&&c!=="yacht").map(c=>[c,0]));
  const b:Card=Object.fromEntries(categories.filter(c=>c!=="sixes"&&c!=="four").map(c=>[c,0]));
  const state:Game={...createGame(123,true),cards:[a,b],player:0,rolls:1,round:11,dice:[1,4,5,6,6].map((value,id)=>({id,value,held:false}))};
  const model=createNeuralResidual(444);
  const r=neuralResidualDecision(state,model);
  expect(r.gradient.every(x=>x===0)).toBe(true);
  expect(r.decision.note).toContain("Win DP v2");
});
