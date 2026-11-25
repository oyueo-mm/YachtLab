import { Award, TrendingUp } from "lucide-react";
import { categories, total, type Card, type Die } from "../engine";
import { localRecords } from "../identity/local";
import type { RecordMode } from "../identity/records";
import "./game-moments.css";

export function nearYacht(dice: readonly Die[], rolls: number, card: Card | undefined) {
  if (!card || card.yacht !== undefined || rolls < 1 || rolls >= 3 || dice.length !== 5) return false;
  const matching = dice.find(({ value }) => dice.filter((die) => die.value === value).length === 4);
  return !!matching && dice.some((die) => die.value !== matching.value && !die.held);
}

/** Local feedback reflects the device's comparable completed records. */
export function beatDeviceScore(mode: RecordMode, points: number, recordId?: string) {
  const scores = localRecords().filter((record) => record.mode === mode && record.endReason === "completed" && record.recordId !== recordId).map((record) => record.score);
  return scores.length > 0 && points > Math.max(...scores);
}

export function behindAfterNine(cards: readonly Card[], me: number) {
  return cards.length === 2 && cards.every((card) => categories.filter((category) => card[category] !== undefined).length === 9) && total(cards[1 - me]) - total(cards[me]) >= 30;
}

export function MatchMilestones({ comeback, best }: { comeback: boolean; best: boolean }) {
  if (!comeback && !best) return null;
  return (
    <ul className="match-milestones" aria-label="이번 경기의 기록">
      {comeback && <li><TrendingUp size={15} aria-hidden="true" /> 역전승</li>}
      {best && <li><Award size={15} aria-hidden="true" /> 이 기기 최고점 갱신</li>}
    </ul>
  );
}

export function ScoreTotal({ value }: { value: number }) {
  return <b key={value} className={value > 0 ? "score-total-value score-total-pop" : "score-total-value"}>{value}</b>;
}
