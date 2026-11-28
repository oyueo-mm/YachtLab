import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ScoreTotal } from "./ui/GameMoments";
import { Star, Sigma } from "lucide-react";
import { categories, names, score, total, type Category } from "./engine";
import { CategoryIcon, BonusProgress } from "./Scoreboard";
import { CategoryHelp } from "./CategoryHelp";
import { multiStandings, type MultiGame } from "./multi-engine";
import { sheetLayout, type SheetLayout } from "./ui/sheet-layout";
import "./ui/scoreboard-ui1.css";

/** Width of the scroll area, measured so the sheet can decide between "all columns fit" and "pin + scroll". */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Common N-player score sheet (UI-1, 2026-11-28) for local, online, AI replay and solo screens.
 *
 * - Every column has a minimum width (category ≥ 96px, player ≥ 60px) and every score button fills its
 *   cell (≥ 44×36 px), so buttons never shrink into the category names (local 2–8 bug before UI-1).
 * - When all columns fit, players keep their seat order. When they don't (many players, narrow
 *   screens), the `pinned` player (me online, the current player locally) moves next to the sticky
 *   category column and stays visible while the other columns scroll horizontally.
 * - The current player's column carries a coloured header band, a "차례" badge and a tinted column.
 * - Long names are cut with an ellipsis in the header; the full name is in `title`.
 */
export function MultiScoreboard({
  state, labels, select, selected = null, onConfirm, onClear, focused = false, compact = false, pinned,
}: {
  state: MultiGame;
  labels: string[];
  select?: (category: Category) => void;
  selected?: Category | null;
  onConfirm?: () => void;
  onClear?: () => void;
  focused?: boolean;
  /** Multi-player layout: header with rank and turn. */
  compact?: boolean;
  /** Seat kept visible next to the category column when the sheet has to scroll (defaults to the current player). */
  pinned?: number;
}) {
  const [scrollRef, width] = useWidth<HTMLDivElement>();
  const current = state.player;
  const seats = focused ? [current] : state.cards.map((_, i) => i);
  const layout: SheetLayout = sheetLayout({ width, seats, pinned: focused ? undefined : pinned ?? current });
  const indices = layout.order;
  const chosen = (index: number, category: Category) =>
    Boolean(select) && index === current && state.rolls > 0 && !state.done && state.cards[index][category] === undefined;
  const rankOf = compact ? new Map(multiStandings(state).map((x) => [x.player, x.rank])) : null;
  const turnOf = (i: number) => current === i && !state.done && state.cards.length > 1;
  const cellClass = (i: number) => [i === current && !state.done ? "multi-current-cell" : "", layout.scroll && i === layout.pinned ? "ui1-pinned" : ""].filter(Boolean).join(" ") || undefined;
  return (
    <section
      className={"scoreboard panel multi-scoreboard ui1-sheet" + (compact ? " compact" : "") + (layout.scroll ? " ui1-scrolls" : " ui1-fits")}
      aria-label="점수판"
      data-players={state.cards.length}
      style={{ "--ui1-cols": indices.length, "--ui1-cat": layout.category + "px", "--ui1-col": layout.column + "px" } as React.CSSProperties}
    >
      <div className="score-title">
        <h2>{focused ? labels[current] + " 점수판" : "점수판"}</h2>
        {layout.scroll && <span className="ui1-scroll-hint" aria-hidden="true">옆으로 밀어 다른 플레이어 보기 →</span>}
      </div>
      <div className="multi-score-scroll" tabIndex={0} aria-label="점수표 스크롤 영역" ref={scrollRef}>
        <table>
          <colgroup>
            <col className="ui1-col-category" />
            {indices.map((i) => <col key={i} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">카테고리</th>
              {indices.map((i) => (
                <th scope="col" className={[turnOf(i) ? "current" : "", layout.scroll && i === layout.pinned ? "ui1-pinned" : ""].filter(Boolean).join(" ") || undefined} key={i} title={labels[i]} data-seat={i}>
                  <span className="col-name">{labels[i]}</span>
                  {rankOf && <span className="col-meta">{rankOf.get(i)}위{turnOf(i) ? <b className="ui1-turn-badge"> · 차례</b> : ""}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="section-row"><th colSpan={indices.length + 1}>상단</th></tr>
            {categories.map((category, ci) => (
              <Fragment key={category}>{FragmentRow({ category, categoryIndex: ci })}</Fragment>
            ))}
            <tr className="total-row">
              <th><Sigma size={17} /> 총점</th>
              {indices.map((i) => <td key={i} className={cellClass(i)}><ScoreTotal value={total(state.cards[i])} /></td>)}
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
              <th><span className="category-cell"><span className="category-label"><Star size={16} /> <span className="ui1-cat-name">상단 보너스</span> <small>+35</small></span><CategoryHelp topic="bonus" /></span></th>
              {indices.map((i) => (
                <td key={i} className={cellClass(i)}>
                  <BonusProgress card={state.cards[i]}/>
                </td>
              ))}
            </tr>
            <tr className="section-row"><th colSpan={indices.length + 1}>하단</th></tr>
          </>
        )}
        <tr data-category={category} className={selected === category ? "score-row-selected" : ""}>
          <th scope="row" title={names[category]}><span className="category-cell">{chosen(current, category) ? <button type="button" className="category-label score-category-select" aria-pressed={selected === category} onClick={() => select?.(category)}><CategoryIcon category={category} /><span className="ui1-cat-name">{names[category]}</span></button> : <span className="category-label"><CategoryIcon category={category} /><span className="ui1-cat-name">{names[category]}</span></span>}<CategoryHelp topic={category} /></span></th>
          {indices.map((i) => (
            <td key={i} className={cellClass(i)}>
              {chosen(i, category) ? (
                <button
                  type="button"
                  className="score-option"
                  aria-pressed={selected === category}
                  aria-label={names[category] + " " + score(state.dice.map((d) => d.value), category) + (onConfirm ? "점 선택" : "점 기록")}
                  onClick={() => select?.(category)}
                >
                  {score(state.dice.map((d) => d.value), category)}
                </button>
              ) : state.cards[i][category] !== undefined ? (
                <span className="fixed-score" aria-label={`${state.cards[i][category]}점 기록됨`}>{state.cards[i][category]}</span>
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
            <span className="multi-standing-name" title={labels[item.player]}>{labels[item.player]}</span>
            <span className="multi-standing-progress">{item.finished}/12</span>
            <strong><ScoreTotal value={item.points} />점</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
