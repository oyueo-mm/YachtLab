/** 이 기기의 같은 모드 완료 경기 최고점(이번 경기 제외). 없으면 null. GameMoments.beatDeviceScore와 같은 기준. */
import { localRecords } from "../identity/local";
import type { RecordMode } from "../identity/records";

export function deviceBestBefore(mode: RecordMode, excludeRecordId?: string): number | null {
  const scores = localRecords().filter((r) => r.mode === mode && r.endReason === "completed" && r.recordId !== excludeRecordId).map((r) => r.score);
  return scores.length ? Math.max(...scores) : null;
}
