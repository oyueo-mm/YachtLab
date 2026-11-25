import { ScoreTotal } from "./ui/GameMoments";
import { Star, Sigma } from "lucide-react";
import { categories, names, score, total, type Category } from "./engine";
import { CategoryIcon, BonusProgress } from "./Scoreboard";
import { CategoryHelp } from "./CategoryHelp";
import { multiStandings, type MultiGame } from "./multi-engine";

export function MultiScoreboard({
  state, labels, select, selected = null, onConfirm, onClear, focused = false,
}: {
  state: MultiGame;
  labels: string[];
  select?: (category: Category) => void;
  selected?: Category | null;
  onConfirm?: () => void;
  onClear?: () => void;
  focused?: boolean;
}) {
  const indices = focused ? [state.player] : state.cards.map((_, i) => i);
  const current = state.player;
  const chosen = (index: number, category: Category) =>
    Boolean(select) && index === current && state.rolls > 0 && !state.done && state.cards[index][category] === undefined;
  return (
    <section className="scoreboard panel multi-scoreboard" aria-label="점수판">
      <div className="score-title">
        <h2>{focused ? labels[current] + " 점수판" : "점수판"}</h2>

      </div>
      <div className="multi-score-scroll" tabIndex={0} aria-label="점수표 스크롤 영역">
        <table>
          <thead>
            <tr>
              <th scope="col">카테고리</th>
              {indices.map((i) => (
                <th scope="col" className={current === i && !state.done ? "current" : ""} key={i}>
                  {labels[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="section-row"><th colSpan={indices.length + 1}>상단</th></tr>
            {categories.map((category, ci) => (
              <FragmentRow key={category} category={category} categoryIndex={ci} />
            ))}
            <tr className="total-row">
              <th><Sigma size={17} /> 총점</th>
              {indices.map((i) => <td key={i}><ScoreTotal value={total(state.cards[i])} /></td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {selected && select && onConfirm && !state.done && state.rolls > 0 && state.cards[current][selected] === undefined && (
        <div className="score-confirm-bar" role="group" aria-label="점수 기록 확인">
          <div className="score-confirm-info"><span>선택한 점수</span><strong>{names[selected]} · {score(state.dice.map((d) => d.value), selected)}점</strong></div>
          <div className="score-confirm-actions"><button type="button" className="score-confirm-cancel" onClick={onClear}>취소</button><button type="button" className="primary score-confirm-button" onClick={onConfirm}>점수 기록 확정</button></div>
        </div>
      )}
    </section>
  );

  function FragmentRow({ category, categoryIndex }: { category: Category; categoryIndex: number }) {
    return (
      <>
        {categoryIndex === 6 && (
          <>
            <tr className="bonus-row">
              <th><span className="category-cell"><span className="category-label"><Star size={16} /> 상단 보너스 <small>+35</small></span><CategoryHelp topic="bonus" /></span></th>
              {indices.map((i) => (
                <td key={i}>
                  <BonusProgress card={state.cards[i]}/>
                </td>
              ))}
            </tr>
            <tr className="section-row"><th colSpan={indices.length + 1}>하단</th></tr>
          </>
        )}
        <tr data-category={category} className={selected === category ? "score-row-selected" : ""}>
          <th scope="row"><span className="category-cell">{chosen(current, category) ? <button type="button" className="category-label score-category-select" aria-pressed={selected === category} onClick={() => select?.(category)}><CategoryIcon category={category} /><span>{names[category]}</span></button> : <span className="category-label"><CategoryIcon category={category} /><span>{names[category]}</span></span>}<CategoryHelp topic={category} /></span></th>
          {indices.map((i) => (
            <td key={i} className={i === current ? "multi-current-cell" : ""}>
              {chosen(i, category) ? (
                <button
                  className="score-option"
                  aria-pressed={selected === category}
                  aria-label={names[category] + " " + score(state.dice.map((d) => d.value), category) + "점 선택"}
                  onClick={() => select?.(category)}
                >
                  {score(state.dice.map((d) => d.value), category)}
                </button>
              ) : state.cards[i][category] !== undefined ? (
                <span className="fixed-score">{state.cards[i][category]}</span>
              ) : (<span className="empty-score">—</span>)}
            </td>
          ))}
        </tr>
      </>
    );
  }
}

export function MultiStandings({ state, labels }: { state: MultiGame; labels: string[] }) {
  const ordered = multiStandings(state);
  return (
    <section className="panel multi-standings" aria-label="전체 순위">
      <div className="multi-standing-title"><h2>{state.done ? "최종 순위" : "현재 순위"}</h2><span>{state.cards.length}명</span></div>
      <div className="multi-standing-list">
        {ordered.map((item) => (
          <div key={item.player} className={"multi-standing-row " + (!state.done && item.player === state.player ? "active" : "")} data-player={item.player}>
            <span className="multi-rank">{item.rank}위</span>
            <span className="multi-standing-name">{labels[item.player]}</span>
            <span className="multi-standing-progress">{item.finished}/12</span>
            <strong><ScoreTotal value={item.points} />점</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
