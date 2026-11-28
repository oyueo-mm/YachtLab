/**
 * H-A3-1·H-A3-2 (A3 §7): 온라인 경기가 끝나면 계정 상태(재화·퀘스트·연승)와 서버 기록을 다시 읽는다.
 * - receipt 조회로 서버 반영을 기다린다(404 재시도). 확정(settled)·보상 없음(none)·지연(delayed)이면 원장
 *   스냅샷을 다시 읽는다. 스냅샷은 언제나 서버 원장 그대로라 "지급된 것처럼" 보이게 만들지 않는다.
 *   지연에는 구버전 Worker(receipt API 없음 → 계속 404)도 포함된다. 네트워크 오류(failed)면 화면 값을 두고 나중에 재시도.
 * - 새 스냅샷은 상단 바·사이드바가 이미 듣는 "yachtlab-economy" 이벤트(구매·강화와 같은 형식)로 알린다.
 *   GET economy()는 이 이벤트를 보내지 않으므로 여기서 보낸다 → App.tsx·profile-economy.ts 변경 없이 갱신.
 * - 경합: 나중에 시작한 갱신이 있으면 먼저 시작한 갱신의 늦은 응답은 버린다(재대결 직후 이전 경기 응답이 최신을 덮어쓰지 않음).
 * - 계정: 시작할 때와 응답 받을 때의 세션이 다르면 알리지 않는다(로그아웃·계정 변경 시 이전 계정 정보 노출 방지).
 * - 조회 전용: 지급을 요청하지 않는다. 같은 matchId는 한 번만.
 * 연결은 C3 병합 후 OnlineGame·OnlineMulti에서 한 줄(useAccountRefreshAfterMatch).
 */
import { useEffect } from "react";
import { matchReward, serverRecords, session } from "../identity/account-client";
import { economy } from "../identity/economy-client";
import type { MatchRecord } from "../identity/records";
import { resolveReward } from "./useRewardState";
import type { RewardState } from "./model";

const refreshed = new Set<string>();
let generation = 0;

export type RefreshDeps = {
  readReceipt: () => Promise<unknown>;
  /** 원장 스냅샷을 읽는다. 결과를 돌려주면 publish가 받아 알린다. */
  readAccount: () => Promise<unknown>;
  publish: (snapshot: unknown) => void;
  announce: () => void;
  wait: (ms: number) => Promise<void>;
  /** 현재 세션(계정 확인용). */
  account: () => string | null;
};

export async function refreshAfterMatch(matchId: string, deps: RefreshDeps): Promise<RewardState["status"] | "skipped" | "stale"> {
  if (refreshed.has(matchId)) return "skipped";
  refreshed.add(matchId);
  const owner = deps.account();
  const mine = ++generation;
  const state = await resolveReward(deps.readReceipt, deps.wait);
  if (state.status === "failed") {
    refreshed.delete(matchId); // 다음 기회(재접속 등)에 다시 시도
    return state.status;
  }
  let snapshot: unknown;
  try {
    snapshot = await deps.readAccount();
  } catch {
    refreshed.delete(matchId);
    return "failed";
  }
  if (deps.account() !== owner) return "stale";
  if (mine === generation) deps.publish(snapshot);
  deps.announce(); // 기록 화면은 각자 다시 읽고 각자 최신 응답만 쓴다(useServerRecords)
  return mine === generation ? state.status : "stale";
}

export function useAccountRefreshAfterMatch(server: string | null, matchId: string | null, finished: boolean) {
  useEffect(() => {
    if (!finished || !server || !matchId || !session()) return;
    let active = true;
    const account = session();
    void refreshAfterMatch(matchId, {
      readReceipt: () => matchReward(server, matchId),
      readAccount: () => economy(server),
      publish: (snapshot) => {
        if (active && account && account === session()) window.dispatchEvent(new CustomEvent("yachtlab-economy", { detail: { account, server, snapshot } }));
      },
      announce: () => window.dispatchEvent(new Event("yachtlab-records")),
      wait: (ms) => new Promise<void>((done) => window.setTimeout(done, ms)),
      account: session,
    });
    return () => {
      active = false;
    };
  }, [server, matchId, finished]);
}

/**
 * H-A3-2: 로그인 상태의 서버 기록을 "yachtlab-records"·세션 변경 때 다시 읽는다(Profile·MatchHistory가 사용).
 * 마지막으로 시작한 요청의 응답만 반영하고, 응답한 계정이 현재 계정과 다르면 버린다.
 */
export function createRecordsReader(read: () => Promise<MatchRecord[]>, account: () => string | null, apply: (owner: string, records: MatchRecord[]) => void) {
  let seq = 0;
  return async () => {
    const owner = account();
    if (!owner) return;
    const mine = ++seq;
    try {
      const records = await read();
      if (mine === seq && account() === owner) apply(owner, records);
    } catch {
      /* 이전 값 유지 */
    }
  };
}

export function useServerRecords(server: string | null, apply: (owner: string, records: MatchRecord[]) => void) {
  useEffect(() => {
    if (!server) return;
    let active = true;
    const reader = createRecordsReader(() => serverRecords(server), session, (owner, records) => active && apply(owner, records));
    void reader();
    const again = () => void reader();
    window.addEventListener("yachtlab-records", again);
    window.addEventListener("yachtlab-session", again);
    return () => {
      active = false;
      window.removeEventListener("yachtlab-records", again);
      window.removeEventListener("yachtlab-session", again);
    };
    // apply는 호출한 쪽 setState(안정적)를 기대한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);
}

/** 테스트 전용 */
export const resetRefreshed = () => {
  refreshed.clear();
  generation = 0;
};
