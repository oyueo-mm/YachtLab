import { Star, Sigma } from "lucide-react";
import { bonus, categories, names, score, total, upper, type Category } from "./engine";
import { CategoryIcon } from "./Scoreboard";
import { multiStandings, type MultiGame } from "./multi-engine";

export function MultiScoreboard({
  state, labels, select, focused = false,
}: {
  state: MultiGame;
  labels: string[];
  select?: (category: Category) => void;
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
        <span>12개 카테고리</span>
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
            <tr className="section-row"><th colSpan={indices.length + 1}>상단 <span>같은 눈의 합계</span></th></tr>
            {categories.map((category, ci) => (
              <FragmentRow key={category} category={category} categoryIndex={ci} />
            ))}
            <tr className="total-row">
              <th><Sigma size={17} /> 총점</th>
              {indices.map((i) => <td key={i}>{total(state.cards[i])}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="score-foot"><span className="preview-dot" /> 연한 숫자는 현재 차례의 선택 가능한 점수입니다.</div>
    </section>
  );

  function FragmentRow({ category, categoryIndex }: { category: Category; categoryIndex: number }) {
    return (
      <>
        {categoryIndex === 6 && (
          <>
            <tr className="bonus-row">
              <th><Star size={16} /> 상단 보너스 <small>+35</small></th>
              {indices.map((i) => (
                <td key={i}>
                  <strong>{bonus(state.cards[i]) > 0 ? "+35" : upper(state.cards[i]) + " / 63"}</strong>
                  <div className="bonus-track"><i style={{ width: Math.min(100, upper(state.cards[i]) / 63 * 100) + "%" }} /></div>
                </td>
              ))}
            </tr>
            <tr className="section-row"><th colSpan={indices.length + 1}>하단 <span>주사위 조합</span></th></tr>
          </>
        )}
        <tr data-category={category}>
          <th scope="row"><span className="category-label"><CategoryIcon category={category} /><span>{names[category]}</span></span></th>
          {indices.map((i) => (
            <td key={i} className={i === current ? "multi-current-cell" : ""}>
              {chosen(i, category) ? (
                <button
                  className="score-option"
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
            <strong>{item.points}점</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
