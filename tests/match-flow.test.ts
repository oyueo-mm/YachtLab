import { describe, expect, it } from "vitest";
import { LOCK_FRESH_MS, MATCHED_KEEP_MS, MATCH_COUNTDOWN_MS, PRACTICE_COUNTDOWN_MS, beatLock, claimLock, countdownFor, forgetMatched, matchedNotEntered, otherTabWaiting, releaseLock, rememberMatched } from "../src/online/match-flow";

/** A6 (SOC-1): one wait per browser (tab lock), countdown length, reload during the countdown. */
const kv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("A6 매칭 탭 잠금", () => {
  it("한 탭이 대기 중이면 다른 탭은 두 번째 티켓을 열지 않는다; 하트비트가 끊긴 잠금은 넘겨받는다", () => {
    const s = kv();
    expect(claimLock("tabA", 1000, s)).toEqual({ ok: true });
    expect(claimLock("tabB", 2000, s)).toMatchObject({ ok: false, holder: { tab: "tabA" } });
    expect(otherTabWaiting("tabB", 2000, s)).toBe(true);
    expect(otherTabWaiting("tabA", 2000, s)).toBe(false);
    // the same tab (reload) keeps it
    expect(claimLock("tabA", 3000, s)).toEqual({ ok: true });
    expect(beatLock("tabA", 10_000, s)).toBe(true);
    expect(beatLock("tabB", 10_000, s)).toBe(false);
    // tab A closed without releasing: stale after LOCK_FRESH_MS
    expect(claimLock("tabB", 10_000 + LOCK_FRESH_MS, s)).toEqual({ ok: true });
    releaseLock("tabA", s); // not the holder any more: no effect
    expect(otherTabWaiting("tabA", 10_000 + LOCK_FRESH_MS, s)).toBe(true);
    releaseLock("tabB", s);
    expect(otherTabWaiting("tabA", 10_000 + LOCK_FRESH_MS, s)).toBe(false);
  });
  it("저장소를 쓸 수 없는 환경(비공개 모드)에서는 막지 않는다(서버의 중복 검사가 기준)", () => {
    expect(claimLock("tabA", 1, null)).toEqual({ ok: true });
  });
});

describe("A6 카운트다운·새로고침 복구", () => {
  it("기본 3초, 오프라인 AI 대전을 잠시 둘 때 5초", () => {
    expect(countdownFor(false)).toBe(MATCH_COUNTDOWN_MS);
    expect(countdownFor(true)).toBe(PRACTICE_COUNTDOWN_MS);
    expect(PRACTICE_COUNTDOWN_MS).toBeGreaterThan(MATCH_COUNTDOWN_MS);
  });
  it("성사 후 입장 전 새로고침: 2분 안이면 같은 경기로 입장, 입장하면 기록 삭제", () => {
    const s = kv();
    rememberMatched({ code: "ABCDEF", opponent: "하늘", at: 1000 }, s);
    expect(matchedNotEntered(1000 + 5000, s)).toMatchObject({ code: "ABCDEF" });
    expect(matchedNotEntered(1000 + MATCHED_KEEP_MS, s)).toBeNull();
    forgetMatched(s);
    expect(matchedNotEntered(1500, s)).toBeNull();
  });
});
