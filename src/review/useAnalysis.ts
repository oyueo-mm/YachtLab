import { useEffect, useMemo, useRef, useState } from "react";
import { reviewV5 } from "../product-ai/worker-client";
import { cachedReview, reviewKey, saveAnalysis } from "./cache";
import { productReviewModel, reviewAlgorithmVersion, reviewModel, type Assessment, type ReviewEvent, type ReviewMatch, type ReviewResults } from "./model";
import { createReviewReport, type ReviewAnalysisStatus } from "./report";

const history = new Map<string, ReviewResults>();

export function useReviewAnalysis(match: ReviewMatch) {
  const total = match.steps.length + (match.unpairedFirstRolls?.length ?? 0);
  const [model, setModel] = useState(match.solo ? reviewModel : productReviewModel);
  const [run, setRun] = useState(0);
  const [values, setValues] = useState<Assessment[] | null>(null);
  const [status, setStatus] = useState<ReviewAnalysisStatus>(() =>
    total ? { state: "preparing", total } : { state: "unassessed", reason: "no-actions" });
  const operation = useRef<AbortController | null>(null);
  const [fallback, setFallback] = useState(false);
  const serialized = useMemo(() => JSON.stringify([!!match.solo, match.steps, match.unpairedFirstRolls]), [match]);

  useEffect(() => {
    if (!total) return;
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    let worker: Worker | undefined;
    let timer: number | undefined;
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      worker?.terminate();
    }, { once: true });
    let completed = 0;
    const key = JSON.stringify([reviewAlgorithmVersion, model.version, match.id, serialized]);
    const fail = (message: string) => {
      if (signal.aborted) return;
      controller.abort();
      setStatus({ state: "failed", message, completed, total });
    };

    const progress = (count: number) => {
      if (signal.aborted) return;
      completed = count;
      setStatus({ state: "analyzing", completed, total });
    };
    const start = async () => {
      const diskKey = match.device ? await reviewKey(match, serialized, model.version).catch(() => null) : null;
      const hit = history.get(key) ?? (diskKey ? await cachedReview(diskKey).catch(() => undefined) : undefined);
      if (signal.aborted) return;
      const done = (result: ReviewResults) => {
        if (signal.aborted) return;
        window.clearTimeout(timer);
        worker?.terminate();
        history.delete(key);
        if (history.size >= 10) history.delete(history.keys().next().value!);
        history.set(key, result);
        setValues(result.values);
        setStatus({ state: "complete", report: createReviewReport(match, result.values, model.version, result.openings) });
        if (diskKey && result !== hit) void saveAnalysis(diskKey, match, result, model.version).catch(() => {});
      };
      if (hit && hit.values.length === match.steps.length && hit.openings.length === (match.unpairedFirstRolls?.length ?? 0)) {
        done(hit);
        return;
      }

      if (model === productReviewModel) {
        try {
          const result = await reviewV5({ steps: match.steps, unpairedFirstRolls: match.unpairedFirstRolls }, (event) => {
            if ("completed" in event) progress(event.completed);
          }, signal);
          done({ values: result.values, openings: result.openings });
        } catch {
          if (signal.aborted) return;
          setFallback(true);
          setStatus({ state: "preparing", total });
          setModel(reviewModel);
        }
        return;
      }

      try {
        worker = new Worker(new URL("./review-worker.ts", import.meta.url), { type: "module" });
        timer = window.setTimeout(() => fail("분석 시간이 초과됐어요. 다시 시도할 수 있어요."), 60_000);
        worker.onerror = () => fail("분석 작업이 중단됐어요. 다시 시도할 수 있어요.");
        worker.onmessageerror = () => fail("분석 응답을 읽을 수 없어요.");
        worker.onmessage = ({ data }: MessageEvent<ReviewEvent>) => {
          if (data.type === "progress") progress(data.completed);
          else if (data.type === "error") fail(data.message);
          else done({ values: data.values, openings: data.openings });
        };
        worker.postMessage({ steps: match.steps, unpairedFirstRolls: match.unpairedFirstRolls });
      } catch {
        fail("기기에서 분석 작업을 시작할 수 없어요.");
      }
    };
    void start();
    return () => controller.abort();
  }, [match, model, run, serialized, total]);

  return {
    model, values, status, fallback,
    cancel() {
      if (status.state !== "analyzing" && status.state !== "preparing") return;
      operation.current?.abort();
      setStatus({ state: "cancelled", completed: status.state === "analyzing" ? status.completed : 0, total });
    },
    retry() {
      setFallback(false);
      setModel(match.solo ? reviewModel : productReviewModel);
      setStatus({ state: "preparing", total });
      setRun((current) => current + 1);
    },
  };
}
