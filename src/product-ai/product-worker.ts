import type { Decision } from "../ai";
import type { Game } from "../engine";
import { winDPv5Decision } from "../research-v5/apex";
import { productV5 } from "./models";
import { initialize, type InitPhase, type Runtime } from "./runtime";

export type Request = { id: number; type: "decide"; position: Game };
export type Response =
  | { id: number; phase: InitPhase }
  | { id: number; decision: Decision; diagnostics: Runtime["diagnostics"] }
  | { id: number; error: string };

const send = (response: Response) => self.postMessage(response);
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const { config, diagnostics } = await initialize((phase) => send({ id: data.id, phase }));
    const result = winDPv5Decision(data.position, config);
    // Keep analysis banks and additional research diagnostics inside the worker.
    const base = { value: result.value, candidates: result.candidates, note: result.note, execution: productV5 };
    const decision: Decision = result.type === "score" ? { ...base, type: "score", category: result.category } :
      { ...base, type: "reroll", ids: result.ids };
    send({ id: data.id, decision, diagnostics });
  } catch (error) {
    send({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
