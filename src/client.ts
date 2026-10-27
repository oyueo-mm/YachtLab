import type { Request } from "./worker";
type Job = Request extends infer R
  ? R extends Request
    ? Omit<R, "id">
    : never
  : never;
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
