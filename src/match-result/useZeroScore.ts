/**
 * 실제 게임의 카드 변화에서 0점 확정 기록을 찾아 팝업 알림을 만든다 (A3).
 * useGameSounds(game-feel.ts)와 같은 규칙: 새 경기(기록 칸이 줄어듦), 좌석 수 변화, 동기화 키 변화(재접속·새로고침
 * 따라잡기)는 조용히 받아들여 지난 기록을 다시 연출하지 않는다. 소리는 game-feel이 이미 내므로 여기서 내지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import type { Card } from "../engine";
import { zeroScored, zeroScoreNotice, type ZeroScoreNotice } from "./zero-score";

/** watch(i): 그 좌석의 0점을 알릴지, 알린다면 이름(여러 사람이 한 기기에서 할 때). null이면 알리지 않음. */
export function useZeroScoreNotice(cards: readonly Card[], watch: (seat: number) => { who?: string } | null, sync: unknown = 0) {
  const previous = useRef<{ cards: readonly Card[]; sync: unknown }>({ cards, sync });
  const [notice, setNotice] = useState<ZeroScoreNotice | null>(null);
  const counter = useRef(0);
  const watchRef = useRef(watch);
  watchRef.current = watch;
  useEffect(() => {
    const before = previous.current;
    previous.current = { cards, sync };
    if (sync !== before.sync) return;
    const filled = (list: readonly Card[]) => list.reduce((n, card) => n + Object.keys(card).length, 0);
    if (cards.length !== before.cards.length || filled(cards) <= filled(before.cards)) {
      if (filled(cards) < filled(before.cards)) setNotice(null); // 새 경기
      return;
    }
    cards.forEach((card, seat) => {
      const target = watchRef.current(seat);
      if (!target) return;
      const category = zeroScored(before.cards[seat] ?? {}, card);
      if (category) setNotice(zeroScoreNotice(category, card, `${category}-${seat}-${++counter.current}`, target.who));
    });
  }, [cards, sync]);
  return [notice, () => setNotice(null)] as const;
}
