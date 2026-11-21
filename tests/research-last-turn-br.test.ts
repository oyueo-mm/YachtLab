import {describe,it,expect} from "vitest";
import {createGame,transition,categories,type Game} from "../src/engine";
import {setDPTable} from "../src/dp";
import {winDPDecision} from "../src/win-dp";
import {analyzeExactLastTurn,eligibleExactLastTurn,clearExactLastTurnResearchCache} from "../src/research-last-turn-br";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import manifest from "../src/dp-manifest.json";
const buf=gunzipSync(readFileSync("public/ai/"+manifest.asset));setDPTable(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
function finalState(seed:number,ownCat="choice",oppCat="yacht",ownOffset=0,oppOffset=0):Game{
 const s=transition(createGame(seed,true),{type:"roll"});
 const card=(missing:string,offset:number)=>Object.fromEntries(categories.filter(x=>x!==missing).map((x,i)=>[x,i<6?3*(i+1):offset])) as Game["cards"][0];
 s.cards=[card(ownCat,ownOffset),card(oppCat,oppOffset)];return s;
}
describe("Exact final-turn adaptive-opponent best response",()=>{
 it("is applied only when player 0 and both scorecards have exactly one category",()=>{
  const s=finalState(1);expect(eligibleExactLastTurn(s)).toBe(true);
  expect(eligibleExactLastTurn({...s,player:1})).toBe(false);
  expect(eligibleExactLastTurn({...s,rolls:0})).toBe(false);
  expect(eligibleExactLastTurn({...s,done:true})).toBe(false);
 });
 it("matches the existing Win DP's baseline action and never has a negative exact advantage",()=>{
  const s=finalState(111,"choice","yacht",9,11),r=analyzeExactLastTurn(s),baseline=winDPDecision(s);
  expect(r).not.toBeNull();expect(r!.baseline.type).toBe(baseline!.type);
  if(r!.baseline.type==="score"&&baseline!.type==="score")expect(r!.baseline.category).toBe(baseline!.category);
  if(r!.baseline.type==="reroll"&&baseline!.type==="reroll")expect(r!.baseline.ids.slice().sort()).toEqual(baseline!.ids.slice().sort());
  expect(r!.gain).toBeGreaterThanOrEqual(0);expect(r!.optimalWin+1e-10).toBeGreaterThanOrEqual(r!.baselineWin);
  expect(r!.optimalWin).toBeLessThanOrEqual(1+1e-10);expect(r!.baselineWin).toBeGreaterThanOrEqual(-1e-10);
 });
 it("uses only public state and gives identical outputs if hidden RNG and seed are replaced",()=>{
  const s=finalState(1234,"sixes","large",10,8),a=analyzeExactLastTurn(s),b=analyzeExactLastTurn({...s,seed:0,rng:[0,0]});
  expect(a?.decision).toEqual(b?.decision);expect(a?.optimalWin).toBeCloseTo(b!.optimalWin,12);clearExactLastTurnResearchCache();
 });
});
