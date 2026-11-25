import type { Decision } from "../ai";
import { analyzeProductSituation } from "../review/product-analysis";
import type { Assessment, Situation } from "../review/model";
import type { Game } from "../engine";
import { winDPv5Decision } from "../research-v5/apex";
import { productV5 } from "./models";
import { initialize, type InitPhase, type Runtime } from "./runtime";

export type Request =
  | { id: number; type: "decide"; position: Game }
  | { id: number; type: "review"; situations: Situation[] }
  | { id: number; type: "cancel" };
export type Response =
  | { id: number; phase: InitPhase }
  | { id: number; completed: number }
  | { id: number; values: Assessment[] }
  | { id: number; decision: Decision; diagnostics: Runtime["diagnostics"] }
  | { id: number; error: string };

const send = (response: Response) => self.postMessage(response);
const reviewJobs = new Map<number, AbortController>();

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if (data.type === "cancel") {
    reviewJobs.get(data.id)?.abort();
    return;
  }
  const review = data.type === "review" ? new AbortController() : null;
  if (review) reviewJobs.set(data.id, review);
  try {
    const { config, diagnostics } = await initialize((phase) => send({ id: data.id, phase }));
    if (data.type === "review") {
      if (!data.situations.length || data.situations.length > 72) throw Error("분석할 수 있는 1:1 기보가 필요해요.");
      const values: Assessment[] = [];
      for (const situation of data.situations) {
        if (review!.signal.aborted) return;
        values.push(analyzeProductSituation(situation, values.length, config));
        send({ id: data.id, completed: values.length });
        await new Promise<void>((resume) => setTimeout(resume, 0));
      }
      if (!review!.signal.aborted) send({ id: data.id, values });
      return;
    }
    const result = winDPv5Decision(data.position, config);
    // Keep analysis banks and additional research diagnostics inside the worker.
    const base = { value: result.value, candidates: result.candidates, note: result.note, execution: productV5 };
    const decision: Decision = result.type === "score" ? { ...base, type: "score", category: result.category } :
      { ...base, type: "reroll", ids: result.ids };
    send({ id: data.id, decision, diagnostics });
  } catch (error) {
    send({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    reviewJobs.delete(data.id);
  }
};
