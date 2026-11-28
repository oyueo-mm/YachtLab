/**
 * H-A3-3 (A3 §7): 연속 경기의 홈 보상 알림 목록. App.tsx의 한 칸짜리 pendingReward를 대신한다(C3 병합 후 연결).
 * - matchId로 중복 제거, 여러 경기를 순서대로 보존(최대 MAX_NOTICES).
 * - 계정이 바뀌면 다른 계정의 알림은 보이지 않는다(목록에서도 버린다).
 * - 결과 창에서 이미 보여 준 코인·보석은 다시 표시하지 않는다(퀘스트·업적은 보여 준다).
 * - 금액·퀘스트·업적은 서버 receipt에서만 만든다. receipt가 없는 경기는 표시하지 않는다.
 * 지급과 무관한 표시 상태이며, 경제 정책·지급 로직은 바꾸지 않는다.
 */
import type { MatchReceipt } from "../economy/live/receipt";

export const MAX_NOTICES = 10;
export type PendingNotice = { matchId: string; account: string; at: number };

export function addNotice(list: readonly PendingNotice[], notice: PendingNotice): PendingNotice[] {
  if (list.some((n) => n.matchId === notice.matchId)) return [...list];
  return [...list, notice].slice(-MAX_NOTICES);
}
export function noticesFor(list: readonly PendingNotice[], account: string | null): PendingNotice[] {
  return account ? list.filter((n) => n.account === account) : [];
}
export function dropNotices(list: readonly PendingNotice[], matchIds: readonly string[]): PendingNotice[] {
  return list.filter((n) => !matchIds.includes(n.matchId));
}

/** 결과 창에서 재화를 보여 준 경기(같은 탭, 메모리). */
const walletShown = new Set<string>();
export const markWalletShown = (matchId: string) => void walletShown.add(matchId);
export const walletWasShown = (matchId: string) => walletShown.has(matchId);
export const resetWalletShown = () => walletShown.clear();

export type CombinedNotice = {
  matchIds: string[];
  coins: number;
  gems: number;
  quests: { id: string; previous: number; progress: number; done: boolean }[];
  grants: { label: string; coins: number; gems: number; kind: string }[];
  /** receipt를 아직 못 받은 경기 수(알림에서 "확인 중"으로만 표시, 금액 없음). */
  unresolved: number;
};

/**
 * 여러 경기의 receipt를 하나의 알림으로 합친다(오래된 경기부터 적용).
 * 같은 퀘스트는 처음 previous와 마지막 progress로 합쳐 진행이 이어 보이게 한다.
 */
export function combineReceipts(entries: readonly { matchId: string; receipt: MatchReceipt | null | undefined }[], shown: (matchId: string) => boolean = walletWasShown): CombinedNotice {
  const out: CombinedNotice = { matchIds: [], coins: 0, gems: 0, quests: [], grants: [], unresolved: 0 };
  for (const { matchId, receipt } of entries) {
    out.matchIds.push(matchId);
    if (!receipt) {
      out.unresolved++;
      continue;
    }
    if (!shown(matchId)) {
      out.coins += Math.max(0, receipt.after.coins - receipt.before.coins);
      out.gems += Math.max(0, receipt.after.gems - receipt.before.gems);
    }
    for (const q of receipt.quests) {
      const prev = out.quests.find((x) => x.id === q.id);
      if (prev) Object.assign(prev, { progress: q.progress, done: prev.done || q.done });
      else out.quests.push({ ...q });
    }
    for (const g of receipt.grants) if (g.kind === "achievement" || g.kind === "quest-bonus") out.grants.push({ ...g });
  }
  return out;
}

export const isEmptyNotice = (n: CombinedNotice) => n.coins === 0 && n.gems === 0 && n.quests.length === 0 && n.grants.length === 0 && n.unresolved === 0;
