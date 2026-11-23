import { useEffect, useRef } from "react";
import { categories, names, score, type Card, type Category } from "./engine";

/** Taps on a pick that appeared less than this long ago are ignored (a tap meant for what was there before). */
export const QUICK_PICK_GUARD_MS = 350;

/**
 * Phones: the best open categories for the dice on the table, one tap to record (the full score
 * sheet stays one tap away). Shown only after a roll on the player's own turn; never records anything
 * by itself. Hidden on wider screens, where the scoreboard is always visible.
 *
 * Mis-tap protection:
 *  - The row keeps its height even when empty (`reserve`), so the buttons below never jump when picks
 *    appear after a roll — a tap aimed at "점수 기록" cannot land on a pick that just slid in.
 *  - A pick ignores taps for 350 ms after the options change (new dice).
 */
export function QuickPicks({ values, card, rolls, canScore, onScore, reserve = true }: { values: number[]; card: Card; rolls: number; canScore: boolean; onScore: (c: Category) => void; reserve?: boolean }) {
  const options =
    !canScore || rolls === 0 || values.length !== 5
      ? []
      : categories
          .filter((c) => card[c] === undefined)
          .map((c, order) => ({ c, points: score(values, c), order }))
          .filter((o) => o.points > 0)
          .sort((a, b) => b.points - a.points || a.order - b.order)
          .slice(0, 3);
  const key = options.map((o) => `${o.c}:${o.points}`).join() + "|" + rolls + "|" + values.join("");
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = performance.now();
  }, [key]);
  if (!options.length) return reserve ? <div className="quick-picks quick-picks-empty" aria-hidden="true" /> : null;
  return (
    <div className="quick-picks" role="group" aria-label="추천 점수 바로 기록">
      {options.map(({ c, points }) => (
        <button
          key={c}
          type="button"
          className={"quick-pick" + (c === "yacht" ? " yacht" : "")}
          aria-label={`${names[c]} ${points}점 기록`}
          onClick={() => {
            if (performance.now() - shownAt.current < QUICK_PICK_GUARD_MS) return;
            onScore(c);
          }}
        >
          <span>{names[c].replace(/ \(\d\)$/, "")}</span>
          <strong>{points}</strong>
        </button>
      ))}
    </div>
  );
}

/** Phones: how far the player is from the upper-section bonus (63 → +35), shown in the score strip. */
export function BonusChip({ card }: { card: Card }) {
  const points = categories.slice(0, 6).reduce((sum, c) => sum + (card[c] ?? 0), 0);
  const done = categories.slice(0, 6).every((c) => card[c] !== undefined);
  const text = points >= 63 ? "보너스 +35" : done ? "보너스 실패" : `보너스까지 ${63 - points}`;
  return (
    <div className={"bonus-chip" + (points >= 63 ? " achieved" : "")} aria-label={`상단 ${points}점, ${text}`}>
      <span>상단 {points}/63</span>
      <strong>{text}</strong>
    </div>
  );
}
