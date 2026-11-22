import { Star, Shapes, Sigma } from "lucide-react";
import {
  bonus,
  categories,
  names,
  score,
  total,
  upper,
  type Category,
  type Card,
  type Game,
} from "./engine";
import { DieIcon } from "./Dice";
import { CategoryHelp } from "./CategoryHelp";
export function BonusProgress({card}:{card:Card}) { const points=upper(card),remaining=Math.max(0,63-points),achieved=bonus(card)>0,finished=categories.slice(0,6).every(c=>card[c]!==undefined); return <div className={"bonus-progress"+(achieved?" achieved":"")}><strong>{achieved?"+35":points+" / 63"}</strong><small>{achieved?"달성!":finished?remaining+"점 부족":remaining+"점 남음"}</small><div className="bonus-track" role="progressbar" aria-label="상단 보너스 진행도" aria-valuemin={0} aria-valuemax={63} aria-valuenow={Math.min(63,points)}><i style={{width:Math.min(100,points/63*100)+"%"}}/></div></div>; }
export function CategoryIcon({ category }: { category: Category }) {
  const index = categories.indexOf(category);
  const patterns: Partial<Record<Category, number[]>> = {
    four: [4, 4, 4, 4],
    full: [2, 2, 3, 3, 3],
    small: [1, 2, 3, 4],
    large: [1, 2, 3, 4, 5],
    yacht: [6, 6, 6, 6, 6],
  };
  const values = index < 6 ? [index + 1] : patterns[category];
  return (
    <span
      className={`category-icon ${values && values.length > 1 ? "category-pattern" : ""}`}
      role="img"
      aria-label={
        values ? `${names[category]}: ${values.join(", ")}` : "초이스"
      }
    >
      {values ? (
        values.map((value, i) => (
          <DieIcon key={i} value={value} aria-hidden="true" />
        ))
      ) : (
        <Shapes size={17} aria-hidden="true" />
      )}
    </span>
  );
}
export function Scoreboard({
  state,
  labels = ["나", "AI"],
  select,
  selected = null,
  onConfirm,
  onClear,
  previewCategory = null,
  selectPlayer = 0,
}: {
  state: Game;
  labels?: [string, string];
  select?: (c: Category) => void;
  selected?: Category | null;
  onConfirm?: () => void;
  onClear?: () => void;
  previewCategory?: Category | null;
  selectPlayer?: 0 | 1;
}) {
  return (
    <section className="scoreboard panel" aria-label="점수판">
      <div className="score-title">
        <h2>점수판</h2>

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
              상단
            </th>
          </tr>
          {categories.map((c, i) => (
            <Rows
              key={c}
              category={c}
              index={i}
              state={state}
              select={select}
              selected={selected}
              previewCategory={previewCategory}
              selectPlayer={selectPlayer}
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
      {selected && select && onConfirm && state.player === selectPlayer && state.rolls > 0 && state.cards[selectPlayer][selected] === undefined && (
        <div className="score-confirm-bar" role="group" aria-label="점수 기록 확인">
          <div className="score-confirm-info"><span>선택한 점수</span><strong>{names[selected]} · {score(state.dice.map((d) => d.value), selected)}점</strong></div>
          <div className="score-confirm-actions"><button type="button" className="score-confirm-cancel" onClick={onClear}>취소</button><button type="button" className="primary score-confirm-button" onClick={onConfirm}>점수 기록 확정</button></div>
        </div>
      )}
    </section>
  );
}
function Rows({
  category: c,
  index,
  state,
  select,
  selected,
  previewCategory,
  selectPlayer,
}: {
  category: Category;
  index: number;
  state: Game;
  select?: (c: Category) => void;
  selected?: Category | null;
  previewCategory?: Category | null;
  selectPlayer: 0 | 1;
}) {
  return (
    <>
      {index === 6 && (
        <>
          <tr className="bonus-row">
            <th>
              <span className="category-cell">
                <span className="category-label">
                  <Star size={16} /> 상단 보너스 <small>+35</small>
                </span>
                <CategoryHelp topic="bonus" />
              </span>
            </th>
            {state.cards.map((card, i) => (<td key={i} className={state.player===i&&!state.done?"current-score-cell":""}><BonusProgress card={card}/></td>))}
          </tr>
          <tr className="section-row">
            <th colSpan={3}>
              하단
            </th>
          </tr>
        </>
      )}
      <tr data-category={c} className={`${selected === c ? "score-row-selected " : ""}${previewCategory === c ? "score-row-ai-preview " : ""}`}>
        <th scope="row">
          <span className="category-cell">
          {select && state.player === selectPlayer && state.rolls > 0 && !state.done && state.cards[selectPlayer][c] === undefined ? (
            <button type="button" className="category-label score-category-select" aria-pressed={selected === c} onClick={() => select(c)}><CategoryIcon category={c} /><span>{names[c]}</span></button>
          ) : (
            <span className="category-label"><CategoryIcon category={c} /><span>{names[c]}</span></span>
          )}
          <CategoryHelp topic={c} />
          </span>
        </th>
        {state.cards.map((card, i) => {
          const can =
            Boolean(select) &&
            i === selectPlayer &&
            state.player === selectPlayer &&
            state.rolls > 0 &&
            !state.done &&
            card[c] === undefined;
          return (
            <td key={i} className={state.player===i&&!state.done?"current-score-cell":""}>
              {can ? (
                <button
                  className="score-option"
                  aria-pressed={selected === c}
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
