import { categories, names, score, type Card, type Category } from "./engine";

/**
 * Phones: the best open categories for the dice on the table, one tap to record (the full score
 * sheet stays one tap away). Shown only after a roll on the player's own turn; never records anything
 * by itself. Hidden on wider screens, where the scoreboard is always visible.
 */
export function QuickPicks({ values, card, rolls, canScore, onScore }: { values: number[]; card: Card; rolls: number; canScore: boolean; onScore: (c: Category) => void }) {
  if (!canScore || rolls === 0 || values.length !== 5) return null;
  const options = categories
    .filter((c) => card[c] === undefined)
    .map((c, order) => ({ c, points: score(values, c), order }))
    .filter((o) => o.points > 0)
    .sort((a, b) => b.points - a.points || a.order - b.order)
    .slice(0, 3);
  if (!options.length) return null;
  return (
    <div className="quick-picks" role="group" aria-label="추천 점수 바로 기록">
      {options.map(({ c, points }) => (
        <button key={c} type="button" className={"quick-pick" + (c === "yacht" ? " yacht" : "")} aria-label={`${names[c]} ${points}점 기록`} onClick={() => onScore(c)}>
          <span>{names[c].replace(/ \(\d\)$/, "")}</span>
          <strong>{points}</strong>
        </button>
      ))}
    </div>
  );
}
