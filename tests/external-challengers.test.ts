import {describe,it,expect} from "vitest";
import {createGame,transition,available,type Game} from "../src/engine";
import {dpDecision,setDPTable} from "../src/dp";
import {externalChallengerDecision,externalChallengerIds,externalChallengerInfo} from "../src/external-challengers";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import manifest from "../src/dp-manifest.json";
const buf=gunzipSync(readFileSync("public/ai/"+manifest.asset));setDPTable(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
const valid=(state:Game,d:ReturnType<typeof dpDecision>)=>{if(d.type==="score")expect(available(state.cards[state.player])).toContain(d.category);else{expect(state.rolls).toBeLessThan(3);expect(new Set(d.ids).size).toBe(d.ids.length);for(const id of d.ids)expect(state.dice.some(die=>die.id===id)).toBe(true);}};
describe("source-attributed 12-category opponent ports",()=>{
 it("lists all four source strategies without claiming original native binaries",()=>{expect(externalChallengerIds.length).toBe(4);for(const id of externalChallengerIds){expect(externalChallengerInfo[id].source).toMatch(/^https:\/\//);expect(externalChallengerInfo[id].kind).toBeTruthy();}});
 it("ports the Rust made-hand stopping rule",()=>{const s=transition(createGame(131,true),{type:"roll"});s.dice=[1,2,3,4,5].map((value,id)=>({id,value,held:false}));const d=externalChallengerDecision(s,"RustHeuristic12");expect(d.type).toBe("score");valid(s,d);});
 it("Rust expected-score equivalent is identical to YachtLab exact DP objective",()=>{const s=transition(createGame(212,true),{type:"roll"}),r=externalChallengerDecision(s,"RustOptimalEquivalent12"),b=dpDecision(s);expect(r).toEqual(b);valid(s,r);});
 it("ported Benji win objective uses legal moves and scoring fallback",()=>{const s=transition(createGame(223,true),{type:"roll"}),d=externalChallengerDecision(s,"BenjiWinObjective12");valid(s,d);const final={...s,rolls:3};valid(final,externalChallengerDecision(final,"BenjiWinObjective12"));},30000);
 it("Pancht authored weighted DP solves and returns valid 12-category actions",()=>{const s=transition(createGame(241,true),{type:"roll"}),d=externalChallengerDecision(s,"PanchtWeighted12");valid(s,d);expect(Number.isFinite(d.value)).toBe(true);const final={...s,rolls:3};expect(externalChallengerDecision(final,"PanchtWeighted12").type).toBe("score");},180000);
});
