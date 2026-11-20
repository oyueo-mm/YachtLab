import { expect,it } from "vitest";
import { checkPayoff,solveZeroSumMetaGame,drawMetaPolicy } from "../src/psro-meta";
it("rock paper scissors restricted symmetric zero-sum Nash mixture",()=>{
  const a=[[0,-1,1],[1,0,-1],[-1,1,0]];
  expect(checkPayoff(a)).toBe(3);
  const sol=solveZeroSumMetaGame(a,24000);
  expect(sol.mixture.reduce((p,c)=>p+c,0)).toBeCloseTo(1,12);
  expect(sol.restrictedExploitability).toBeLessThan(.045);
  expect(sol.dualityGap).toBeLessThan(.09);
  expect(sol.mixture.every(x=>x>.2&&x<.45)).toBe(true);
});
it("dominant policy gets most of Nash meta mass",()=>{
  const a=[[0,1,1],[-1,0,.4],[-1,-.4,0]];
  const sol=solveZeroSumMetaGame(a,10000);
  expect(sol.mixture[0]).toBeGreaterThan(.96);
  expect(sol.restrictedExploitability).toBeLessThan(.015);
});
it("reject non symmetric payoff or invalid meta draws",()=>{
  expect(()=>checkPayoff([[0,1],[1,0]])).toThrow();
  expect(()=>drawMetaPolicy([.4,.7],.5)).toThrow();
  expect(drawMetaPolicy([.2,.3,.5],.1)).toBe(0);
  expect(drawMetaPolicy([.2,.3,.5],.35)).toBe(1);
  expect(drawMetaPolicy([.2,.3,.5],.95)).toBe(2);
});
