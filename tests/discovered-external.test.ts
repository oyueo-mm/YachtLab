import {describe,it,expect} from "vitest";
import {createGame,transition,available,type Game} from "../src/engine";
import {discoveredExternalDecision,newExternalIds,newExternalSources} from "../src/discovered-external";
const s=()=>transition(createGame(3031,true),{type:"roll"});
const visible=(game:Game,d:ReturnType<typeof discoveredExternalDecision>)=>{if(d.type==="score")expect(available(game.cards[game.player])).toContain(d.category);else{expect(game.rolls).toBeLessThan(3);expect(new Set(d.ids).size).toBe(d.ids.length);for(const i of d.ids)expect(game.dice.some(x=>x.id===i)).toBe(true);}};
describe("2026 independently published Dart Yacht policy rule adaptations",()=>{
 it("source provenance and 12-score adaptations are explicit",()=>{expect(newExternalIds).toEqual(["Z7DartHard12","Z7DartMedium12"]);for(const id of newExternalIds)expect(newExternalSources[id].source).toContain("/z7workbench/minigames/");});
 it("Medium preserves authored category priority",()=>{const state={...s(),rolls:3};const decision=discoveredExternalDecision(state,"Z7DartMedium12");expect(decision).toMatchObject({type:"score",category:"yacht"});visible(state,decision);});
 it("Hard handles a complete five-of-a-kind without reroll",()=>{const state=s();state.dice=state.dice.map(d=>({...d,value:5}));const decision=discoveredExternalDecision(state,"Z7DartHard12");expect(decision).toMatchObject({type:"score",category:"yacht"});visible(state,decision);});
 it("Hard source's sampled expectimax samples legal rerolls deterministically from PUBLIC observations",()=>{const state=s(),a=discoveredExternalDecision(state,"Z7DartHard12"),b=discoveredExternalDecision(state,"Z7DartHard12");expect(a).toEqual(b);visible(state,a);},120000);
 it("both source models return legal final decisions",()=>{for(const id of newExternalIds){const state={...s(),rolls:3};visible(state,discoveredExternalDecision(state,id));}},120000);
});
