import type { ReviewMatch } from "./model";
import { missingOnlineReview } from "./sources";

const completed = new Map<string, ReviewMatch>();

// Only keep traces authorised in this open tab. A session change cannot inherit
// an earlier account's review, and no auth material is placed in the trace.
if (typeof window !== "undefined") {
  window.addEventListener("yachtlab-session", () => completed.clear());
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === "yachtlab.session.v1") completed.clear();
  });
}

export function rememberOnlineReview(match: ReviewMatch) {
  if (completed.size >= 8) completed.delete(completed.keys().next().value!);
  completed.set(match.id, match);
}

export function recentOnlineReview(id: string) {
  return completed.get(id) ?? missingOnlineReview;
}
