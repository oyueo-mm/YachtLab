import {
  Star,
  Shapes,
  Copy,
  House,
  ChartNoAxesColumnIncreasing,
  ArrowRight,
  Anchor,
  Sigma,
} from "lucide-react";
import {
  bonus,
  categories,
  names,
  score,
  total,
  upper,
  type Category,
  type Game,
} from "./engine";
import { DieIcon } from "./Dice";
export function CategoryIcon({ category }: { category: Category }) {
  const index = categories.indexOf(category);
  if (index < 6) return <DieIcon value={index + 1} />;
  const Icon = {
    choice: Shapes,
    four: Copy,
    full: House,
    small: ChartNoAxesColumnIncreasing,
    large: ArrowRight,
    yacht: Anchor,
  }[category as "choice"];
  return <Icon size={17} />;
}
export function Scoreboard({
  state,
  labels = ["나", "AI"],
  select,
}: {
  state: Game;
  labels?: [string, string];
  select?: (c: Category) => void;
}) {
  return (
    <section className="scoreboard panel" aria-label="점수판">
      <div className="score-title">
        <h2>점수판</h2>
        <span>12개 카테고리</span>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">카테고리</th>
            {labels.map((label, i) => (
              <th
                scope="col"
                key={i}
                className={state.player === i && !state.done ? "current" : ""}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="section-row">
            <th colSpan={3}>
              상단 <span>같은 눈의 합계</span>
            </th>
          </tr>
          {categories.map((c, i) => (
            <Rows
              key={c}
              category={c}
              index={i}
              state={state}
              select={select}
            />
          ))}
          <tr className="total-row">
            <th>
              <Sigma size={17} /> 총점
            </th>
            {state.cards.map((c, i) => (
              <td key={i}>{total(c)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="score-foot">
        <span className="preview-dot" /> 연한 숫자는 선택 가능한 점수입니다.
      </div>
    </section>
  );
}
function Rows({
  category: c,
  index,
  state,
  select,
}: {
  category: Category;
  index: number;
  state: Game;
  select?: (c: Category) => void;
}) {
  return (
    <>
      {index === 6 && (
        <>
          <tr className="bonus-row">
            <th>
              <Star size={16} /> 상단 보너스 <small>+35</small>
            </th>
            {state.cards.map((card, i) => (
              <td key={i}>
                <strong>
                  {bonus(card) > 0 ? "+35" : `${upper(card)} / 63`}
                </strong>
                <div className="bonus-track">
                  <i
                    style={{
                      width: `${Math.min(100, (upper(card) / 63) * 100)}%`,
                    }}
                  />
                </div>
              </td>
            ))}
          </tr>
          <tr className="section-row">
            <th colSpan={3}>
              하단 <span>주사위 조합</span>
            </th>
          </tr>
        </>
      )}
      <tr>
        <th scope="row">
          <CategoryIcon category={c} />
          {names[c]}
        </th>
        {state.cards.map((card, i) => {
          const can =
            Boolean(select) &&
            i === 0 &&
            state.player === 0 &&
            state.rolls > 0 &&
            !state.done &&
            card[c] === undefined;
          return (
            <td key={i}>
              {can ? (
                <button
                  className="score-option"
                  onClick={() => select?.(c)}
                  aria-label={`${names[c]} ${score(
                    state.dice.map((d) => d.value),
                    c,
                  )}점 선택`}
                >
                  {score(
                    state.dice.map((d) => d.value),
                    c,
                  )}
                </button>
              ) : card[c] !== undefined ? (
                <span className="fixed-score">{card[c]}</span>
              ) : (
                <span className="empty-score">—</span>
              )}
            </td>
          );
        })}
      </tr>
    </>
  );
}
