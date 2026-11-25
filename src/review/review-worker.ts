import { loadDP } from "../dp";
import type { ReviewEvent, Situation } from "./model";
import { assessSituation } from "./solver";

self.onmessage = async ({ data }: MessageEvent<Situation[]>) => {
  const reply = (event: ReviewEvent) => self.postMessage(event);
  try {
    if (!data.length || data.length > 72) throw Error("분석할 수 있는 1:1 기보가 필요해요.");
    await loadDP();
    const values = data.map((situation, index) => {
      const assessment = assessSituation(situation, index);
      reply({ type: "progress", completed: index + 1 });
      return assessment;
    });
    reply({ type: "done", values });
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : "리뷰 분석을 완료할 수 없어요." });
  }
};
