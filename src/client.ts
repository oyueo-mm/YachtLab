import type { Request } from "./worker";
import type { Game } from "./engine";
import type { Algorithm, Options, Decision } from "./ai";
type Job = Request extends infer R
  ? R extends Request
    ? Omit<R, "id">
    : never
  : never;

// A human game retains one worker, so its lazily loaded DP table is decoded
// once per game instead of once per decision. Restart/unmount terminates it.
export function createDecisionSession() {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  let id = 0,
    closed = false;
  const pending = new Map<
    number,
    { resolve: (d: Decision) => void; reject: (e: Error) => void }
  >();
  const cancel = () => {
    closed = true;
    worker.terminate();
    for (const p of pending.values()) p.reject(Error("작업이 취소되었습니다."));
    pending.clear();
  };
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.error) p.reject(Error(data.error));
    else p.resolve(data.result);
  };
  worker.onerror = (e) => {
    closed = true;
    worker.terminate();
    for (const p of pending.values())
      p.reject(Error(e.message || "AI 작업 오류"));
    pending.clear();
  };
  return {
    cancel,
    decide: (state: Game, algorithm: Algorithm, options?: Options) =>
      new Promise<Decision>((resolve, reject) => {
        if (closed) {
          reject(Error("AI 계산 세션이 종료되었습니다."));
          return;
        }
        const current = ++id;
        pending.set(current, { resolve, reject });
        worker.postMessage({
          id: current,
          type: "decide",
          state,
          algorithm,
          options,
        });
      }),
  };
}
export function runJob<T>(
  request: Job,
  onProgress?: (progress: number, results: unknown) => void,
) {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  let rejectJob: (reason: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined)
        onProgress?.(data.progress, data.results);
      else {
        worker.terminate();
        if (data.error) reject(Error(data.error));
        else resolve(data.result as T);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(Error(e.message || "AI 작업 오류"));
    };
    worker.postMessage({ ...request, id: 1 });
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectJob(Error("작업이 취소되었습니다."));
    },
  };
}
