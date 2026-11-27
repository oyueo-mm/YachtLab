import { loadDP } from "../dp";
import type { ReviewEvent, ReviewInput } from "./model";
import { assessOpening, assessSituation } from "./solver";

self.onmessage = async ({ data }: MessageEvent<ReviewInput>) => {
  const reply = (event: ReviewEvent) => self.postMessage(event);
  try {
    const openings = data.unpairedFirstRolls ?? [];
    const total = data.steps.length + openings.length;
    if (!total || total > 72) throw Error("분석할 수 있는 1:1 기보가 필요해요.");
    await loadDP();
    const values = data.steps.map((situation, index) => {
      const assessment = assessSituation(situation, index);
      reply({ type: "progress", completed: index + 1 });
      return assessment;
    });
    const openingValues = openings.map((position, index) => {
      const result = assessOpening(position);
      reply({ type: "progress", completed: values.length + index + 1 });
      return result;
    });
    reply({ type: "done", values, openings: openingValues });
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : "리뷰 분석을 완료할 수 없어요." });
  }
};
