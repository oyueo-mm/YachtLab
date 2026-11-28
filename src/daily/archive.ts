import { applyStep, newDailyState, viewOf, type DailyState, type DailyStep, type DailyView } from "./game";
import { fromHex } from "./sha256";
import { commitmentOf, type DayKey } from "./tape";

/**
 * 지난 도전 다시 플레이: a closed day's key is public, so the replay runs entirely in this browser
 * (no server request per step, no ranking). The key is checked against the commitment published
 * that morning before it is used.
 */
export type ArchiveDriver = { date: string; view(): DailyView; step(step: DailyStep): DailyView };
export function archiveDriver(date: string, keyHex: string, commitment: string): ArchiveDriver {
  const key: DayKey | null = fromHex(keyHex);
  if (!key || commitmentOf(key) !== commitment) throw Error("공개된 주사위 키가 확인값과 맞지 않아요.");
  let state: DailyState = newDailyState(date, key);
  return {
    date,
    view: () => viewOf(state),
    step(step) {
      state = applyStep(state, step, key);
      return viewOf(state);
    },
  };
}

/* Local results of archive replays (practice: this browser only, never uploaded). */
const STORE = "yachtlab-daily-archive";
export type ArchiveResult = { date: string; score: number; at: number };
export function archiveResults(): ArchiveResult[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? "[]") as ArchiveResult[];
    return Array.isArray(list) ? list.filter((r) => typeof r?.date === "string" && Number.isInteger(r?.score)).slice(0, 200) : [];
  } catch {
    return [];
  }
}
export function saveArchiveResult(r: ArchiveResult) {
  try {
    localStorage.setItem(STORE, JSON.stringify([r, ...archiveResults()].slice(0, 200)));
  } catch {
    /* storage unavailable: nothing to keep */
  }
}
