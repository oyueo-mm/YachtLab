import { authHeader, session } from "../identity/account-client";
import type { DailyStep, DailyView } from "./game";
import type { RankedEntry, Visibility } from "./ranking";
import type { ActionKey, PuzzleKey, PuzzleQuestion, PuzzleResult } from "./puzzles/types";

/** Client of /api/daily (LIVE-1). Errors keep the server's current attempt so the page can resync. */
export type Mode = "official" | "practice";
export type AttemptView = { mode: Mode; status: "playing" | "finished" | "expired"; ranked: boolean; startedAt: number; finishedAt: number | null; state: DailyView };
export type Today = {
  /** Server time (ms) when answered: the page uses it instead of the device clock. */
  now: number;
  date: string; rules: string; phase: string; closesAt: number; nextDate: string; commitment: string; epoch: string;
  puzzles: { id: string; level: string; kind: string; title: string }[];
  me: null | { official: AttemptView | null; practice: AttemptView | null; practiceLeft: number; puzzleResults: PuzzleResult[]; visibility: Visibility };
};
export type History = {
  today: string;
  history: { records: { date: string; status: string; score: number | null; ranked: boolean; finishedAt: number | null; card: Record<string, number> | null }[]; best: { date: string; score: number } | null; played: number; completed: number; average: number | null; puzzles: { answered: number; correct: number; days: string[] }; visibility: Visibility };
};
export type PuzzleItem = { question: PuzzleQuestion; result: PuzzleResult | null; key: (Omit<PuzzleKey, "best"> & { best: ActionKey[] }) | null };

export class DailyError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly attempt?: AttemptView) {
    super(message);
  }
}

async function call<T>(server: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(server + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...authHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new DailyError("NETWORK", "서버에 연결할 수 없어요. 연결되면 같은 상태에서 이어서 할 수 있어요.", 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string }; attempt?: AttemptView }) | null;
  if (!res.ok || !data) throw new DailyError(data?.error?.code ?? "SERVER", data?.error?.message ?? "요청을 처리하지 못했어요.", res.status, data?.attempt);
  return data;
}

export const signedIn = () => !!session();
export const today = (server: string) => call<Today>(server, "/api/daily/today");
export const start = (server: string, date: string, mode: Mode) => call<{ attempt: AttemptView; created: boolean }>(server, "/api/daily/start", { date, mode });
export const play = (server: string, date: string, mode: Mode, seq: number, step: DailyStep) => call<{ attempt: AttemptView; duplicate: boolean; finished: boolean }>(server, "/api/daily/play", { date, mode, seq, step });
export const attempt = (server: string, date: string, mode: Mode) => call<{ attempt: AttemptView | null }>(server, `/api/daily/attempt?date=${date}&mode=${mode}`);
export const history = (server: string) => call<History>(server, "/api/daily/history");
export const reveal = (server: string, date: string) => call<{ date: string; key: string; commitment: string; log: DailyStep[] | null }>(server, `/api/daily/reveal?date=${date}`);
export const puzzles = (server: string, date: string) => call<{ date: string; closed: boolean; puzzles: PuzzleItem[] }>(server, `/api/daily/puzzles?date=${date}`);
export const answer = (server: string, date: string, puzzleId: string, answer: ActionKey) =>
  call<{ result: PuzzleResult; first: boolean; recorded: boolean; key: PuzzleItem["key"] }>(server, "/api/daily/puzzles/answer", { date, puzzleId, answer });
