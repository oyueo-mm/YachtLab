import {it,expect} from "vitest";
import {ppoSurrogate,terminalGae} from "../src/ppo-surrogate";
it("PPO clipped objective suppresses policy gradient when improving outside trust region",()=>{
 const pos=ppoSurrogate(0,Math.log(1.5),2,.2);
 expect(pos.objective).toBeCloseTo(2.4,10);expect(pos.gradientFactor).toBe(0);expect(pos.clipped).toBe(true);
 const neg=ppoSurrogate(0,Math.log(.6),-2,.2);
 expect(neg.objective).toBeCloseTo(-1.6,10);expect(neg.gradientFactor).toBe(0);expect(neg.clipped).toBe(true);
 const normal=ppoSurrogate(0,Math.log(1.1),2,.2);
 expect(normal.gradientFactor).toBeCloseTo(2.2,10);expect(normal.clipped).toBe(false);
});
it("GAE terminal rewards correspond to exactly undiscounted return at lambda 1",()=>{
 const values=[.2,.4,.6];const g=terminalGae(values,1,1,1);
 expect(g.advantages).toEqual([.8,.6,.4]);expect(g.returns.every(r=>Math.abs(r-1)<1e-10)).toBe(true);
 const short=terminalGae([.5],0);expect(short.returns).toEqual([0]);
});
it("PPO and GAE reject invalid inputs",()=>{
 expect(()=>ppoSurrogate(0,0,0,1.2)).toThrow();
 expect(()=>terminalGae([.5],2)).toThrow();
});
