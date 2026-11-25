import type { Game } from "../engine";
import { publicDecisionState } from "./models";
import type { Request, Response } from "./product-worker";

let worker: Worker | undefined;
let nextId = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { receive: (value: Response) => void; fail: (error: Error) => void }>();

function stop(error: Error) {
  clearTimeout(idle);
  worker?.terminate();
  worker = undefined;
  const outstanding = [...pending.values()];
  pending.clear();
  for (const job of outstanding) job.fail(error);
}

function keepAlive() {
  clearTimeout(idle);
  if (!pending.size) idle = setTimeout(() => stop(Error("AI 작업이 종료되었어요.")), 120_000);
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./product-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<Response>) => pending.get(data.id)?.receive(data);
  worker.onerror = (event) => { event.preventDefault(); stop(Error("AI 계산 작업이 중단됐어요.")); };
  worker.onmessageerror = () => stop(Error("AI 계산 응답을 읽을 수 없어요."));
  return worker;
}

export function decideV5(position: Game, phase: (progress: "cache" | "build") => void, signal: AbortSignal) {
  return new Promise<Extract<Response, { decision: unknown }>>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const id = ++nextId;
    const timer = window.setTimeout(() => stop(Error("AI 준비 시간이 초과됐어요.")), 45_000);
    const clean = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      pending.delete(id);
      keepAlive();
    };
    const fail = (error: Error) => { clean(); reject(error); };
    function cancel() {
      fail(signal.reason);
      if (!pending.size) stop(Error("AI 작업이 취소되었어요."));
    }
    pending.set(id, {
      receive(message) {
        if ("phase" in message) phase(message.phase);
        else if ("error" in message) fail(Error(message.error));
        else { clean(); resolve(message); }
      },
      fail,
    });
    signal.addEventListener("abort", cancel, { once: true });
    clearTimeout(idle);
    try {
      const message: Request = { id, type: "decide", position: publicDecisionState(position) };
      getWorker().postMessage(message);
    } catch (error) {
      fail(error instanceof Error ? error : Error(String(error)));
    }
  });
}
