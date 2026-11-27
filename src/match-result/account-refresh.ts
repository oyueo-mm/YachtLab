/**
 * Hotfix 후보 H-A3-1 (A3 §7): 온라인 경기가 끝나면 계정 상태(재화·퀘스트·연승)를 다시 읽는다.
 * - 서버 receipt가 생긴 뒤(지급 확정 후)에만 다시 읽는다. 404는 짧게 재시도, 끝내 없으면 그대로 둔다.
 * - 새 스냅샷을 상단 바·사이드바가 이미 듣는 "yachtlab-economy" 이벤트(구매·강화와 같은 형식)로 알린다.
 *   GET economy()는 이 이벤트를 보내지 않으므로 여기서 보낸다 → App.tsx·profile-economy.ts 변경 없이 갱신.
 *   프로필·전적 화면을 위해 "yachtlab-records"도 알린다.
 * - 조회 전용: 지급을 요청하지 않는다. 같은 matchId는 한 번만.
 * 연결은 C3 병합 후 OnlineGame·OnlineMulti에서 한 줄(useAccountRefreshAfterMatch)로 한다.
 */
import { useEffect } from "react";
import { matchReward, session } from "../identity/account-client";
import { economy } from "../identity/economy-client";
import { resolveReward } from "./useRewardState";
import type { RewardState } from "./model";

const refreshed = new Set<string>();

export async function refreshAfterMatch(matchId: string, deps: {
  readReceipt: () => Promise<unknown>;
  refreshAccount: () => Promise<unknown>;
  announce: () => void;
  wait: (ms: number) => Promise<void>;
}): Promise<RewardState["status"] | "skipped"> {
  if (refreshed.has(matchId)) return "skipped";
  refreshed.add(matchId);
  const state = await resolveReward(deps.readReceipt, deps.wait);
  // 기록이 서버에 들어간 경우(settled, 또는 보상 없는 경기)만 다시 읽는다. 지연·실패는 화면 값을 바꾸지 않는다.
  if (state.status === "settled" || state.status === "none") {
    await deps.refreshAccount().catch(() => undefined);
    deps.announce();
  } else refreshed.delete(matchId); // 다음 기회(재접속 등)에 다시 시도
  return state.status;
}

export function useAccountRefreshAfterMatch(server: string | null, matchId: string | null, finished: boolean) {
  useEffect(() => {
    if (!finished || !server || !matchId || !session()) return;
    let active = true;
    const wait = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));
    void refreshAfterMatch(matchId, {
      readReceipt: () => matchReward(server, matchId),
      refreshAccount: async () => {
        const account = session();
        if (!active || !account) return;
        const snapshot = await economy(server);
        // 그사이 로그아웃·계정 변경이면 알리지 않는다(다른 사람의 잔액 표시 방지).
        if (account === session()) window.dispatchEvent(new CustomEvent("yachtlab-economy", { detail: { account, server, snapshot } }));
      },
      announce: () => window.dispatchEvent(new Event("yachtlab-records")),
      wait,
    });
    return () => {
      active = false;
    };
  }, [server, matchId, finished]);
}

/** 테스트 전용: 기억한 matchId를 지운다. */
export const resetRefreshed = () => refreshed.clear();
