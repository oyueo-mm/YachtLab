/**
 * 서버 receipt를 결과 화면의 보상 상태로 바꾸는 훅 (A3, 읽기 전용 API만 사용).
 * - 지급 자체는 서버 원장이 이미 처리했다. 이 훅은 조회만 하며 지급을 다시 요청하지 않는다.
 * - Worker가 기록을 계정에 늦게 전달하면 404 → 짧게 재시도 → 그래도 없으면 "delayed".
 * - 네트워크·기타 오류는 "failed". 실패를 지급 완료처럼 보이게 하지 않는다.
 * 기존 MatchRewards.tsx(C3·Hotfix 범위)는 바꾸지 않고, 통합 단계에서 이 훅으로 교체 여부를 정한다.
 */
import { useEffect, useState } from "react";
import { AccountError, matchReward, session } from "../identity/account-client";
import type { RewardState } from "./model";

export const RECEIPT_RETRY_MS = [750, 1500, 2250] as const;

/** 테스트 가능한 순수 조회 루프. read는 receipt|null을 돌려주거나 AccountError를 던진다. */
export async function resolveReward(read: () => Promise<unknown>, wait: (ms: number) => Promise<void>, onPending?: () => void): Promise<RewardState> {
  onPending?.();
  for (let attempt = 0; ; attempt++) {
    try {
      const receipt = await read();
      // 기록은 있으나 receipt가 없는 경우(보상 대상이 아닌 경기 등): 금액을 만들지 않는다.
      if (!receipt) return { status: "none", reason: "mode" };
      return { status: "settled", receipt: receipt as never };
    } catch (error) {
      const notYet = error instanceof AccountError && error.status === 404;
      if (!notYet) return { status: "failed" };
      if (attempt >= RECEIPT_RETRY_MS.length) return { status: "delayed" };
      await wait(RECEIPT_RETRY_MS[attempt]);
    }
  }
}

export function useRewardState(server: string | null, matchId: string, rewarded: boolean): RewardState {
  const [owner] = useState(session);
  const [state, setState] = useState<RewardState>(() => (!rewarded ? { status: "none", reason: "mode" } : !owner || !server ? { status: "none", reason: "guest" } : { status: "pending" }));
  useEffect(() => {
    if (!rewarded || !owner || !server) return;
    let active = true;
    const timers = new Set<number>();
    const wait = (ms: number) => new Promise<void>((done) => { const t = window.setTimeout(() => { timers.delete(t); done(); }, ms); timers.add(t); });
    void resolveReward(() => matchReward(server, matchId), wait).then((next) => {
      // 계정이 바뀌었으면 다른 사람의 보상을 보이지 않는다.
      if (active) setState(session() === owner ? next : { status: "none", reason: "signed-out" });
    });
    return () => {
      active = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [server, matchId, rewarded, owner]);
  return state;
}
