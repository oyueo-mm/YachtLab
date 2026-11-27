/**
 * 0점 확정 기록 알림 (A3). 전략적으로 0점을 쓰는 경우가 많으므로 실패·비난 표현을 쓰지 않고,
 * 확인 가능한 사실(어느 칸, 남은 칸, 상단 보너스까지 남은 점수)만 짧게 알린다.
 */
import { categories, names, upper, type Card, type Category } from "../engine";

export type ZeroScoreNotice = { key: string; category: Category; title: string; detail: string | null };

const UPPER = categories.slice(0, 6) as readonly Category[];
const FACE: Partial<Record<Category, number>> = { aces: 1, deuces: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

/** 카드 변화에서 새로 0점으로 확정된 칸 하나를 찾는다(없으면 null). */
export function zeroScored(before: Card, after: Card): Category | null {
  for (const c of categories) if (before[c] === undefined && after[c] === 0) return c;
  return null;
}

/** 아직 비어 있는 상단 칸을 모두 5개로 채웠을 때의 최대 상단 점수. */
export function maxUpper(card: Card) {
  return upper(card) + UPPER.filter((c) => card[c] === undefined).reduce((s, c) => s + 5 * FACE[c]!, 0);
}

export function zeroScoreNotice(category: Category, after: Card, key = `${category}-${Object.keys(after).length}`): ZeroScoreNotice {
  const left = categories.filter((c) => after[c] === undefined).length;
  let detail: string | null = left ? `남은 칸 ${left}개` : null;
  if (UPPER.includes(category)) {
    const now = upper(after);
    if (now < 63 && maxUpper(after) >= 63) detail = `상단 보너스까지 ${63 - now}점`;
  }
  return { key, category, title: `${names[category]} 0점 기록`, detail };
}
