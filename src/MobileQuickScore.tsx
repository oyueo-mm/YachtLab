import { useEffect, useState } from "react";
import { categories, names, score, type Card, type Category, type Die } from "./engine";
import { BonusProgress, CategoryIcon } from "./Scoreboard";
import { CategoryHelp } from "./CategoryHelp";
import { isYachtDice } from "./yacht-moment";

/**
 * One-player-at-a-time score sheet for phones.
 * A recordable row is still one big tap target (the score button is "stretched" over the row),
 * but the small info button sits above that layer, so reading a rule never records a score.
 */
export default function MobileQuickScore({
  cards,
  dice,
  rolls,
  current,
  labels,
  canScore,
  onScore,
  onlyCategory,
}: {
  cards: readonly Card[];
  dice: readonly Die[];
  rolls: number;
  current: number;
  labels: string[];
  canScore: boolean;
  onScore: (category: Category) => void;
  onlyCategory?: Category;
}) {
  const [view, setView] = useState(current);
  const [compact, setCompact] = useState(false);
  useEffect(() => setView(current), [current]);
  const card = cards[view],
    canRecord = canScore && view === current && rolls > 0,
    values = dice.map((d) => d.value),
    yachtReady = view === current && isYachtDice(dice, rolls) && card.yacht === undefined;
  return (
    <section className="mobile-quick-score" aria-label="모바일 점수표">
      {cards.length > 1 && <div className="mobile-score-player-picker">
        {cards.length <= 2 ? (
          <div className="mobile-score-tabs" role="group" aria-label="플레이어 선택">
            {cards.map((_, i) => (
              <button type="button" key={i} aria-pressed={i === view} onClick={() => setView(i)}>
                {labels[i] ?? `플레이어 ${i + 1}`}
              </button>
            ))}
          </div>
        ) : (
          <label className="mobile-score-player-select">
            플레이어
            <select aria-label="점수표 플레이어" value={view} onChange={(e) => setView(Number(e.target.value))}>
              {cards.map((_, i) => (
                <option key={i} value={i}>
                  {labels[i] ?? `플레이어 ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>}
      {!onlyCategory && <><div className="mobile-quick-bonus">
        <span className="category-cell">
          <span>
            상단 보너스 <small>+35</small>
          </span>
          <CategoryHelp topic="bonus" />
        </span>
        <BonusProgress card={card} />
      </div>
      <div className="mobile-quick-toolbar">
        {canRecord && <p className="mobile-quick-instruction">점수를 누르면 바로 기록돼요</p>}
        <button type="button" className="mobile-compact-toggle text-button" aria-pressed={compact} onClick={() => setCompact(!compact)}>
          두 열 보기
        </button>
      </div></>}
      <div className={"mobile-quick-groups" + (compact ? " compact" : "")}>
      {(onlyCategory ? [[onlyCategory]] : [categories.slice(0, 6), categories.slice(6)]).map((group, groupIndex) => (
        <div className="mobile-quick-group" key={groupIndex}>
          {!onlyCategory && <div className="mobile-quick-group-title">{groupIndex === 0 ? "상단" : "하단"}</div>}
          {group.map((category) => {
            const fixed = card[category],
              available = canRecord && fixed === undefined,
              points = available ? score(values, category) : fixed;
            const name = (
              <span className="mobile-quick-name category-cell">
                <CategoryIcon category={category} />
                <span>{names[category]}</span>
                {!onlyCategory && <CategoryHelp topic={category} />}
              </span>
            );
            return (
              <div className={"mobile-quick-row" + (available ? " available" : "") + (fixed !== undefined ? " recorded" : "") + (yachtReady && category === "yacht" ? " yacht-ready" : "")} key={category} data-category={category}>
                {available ? (
                  <div className="mobile-quick-row-live">
                    {name}
                    <button className="score-option mobile-quick-score-button" type="button" aria-label={`${names[category]} ${points}점 기록`} onClick={() => onScore(category)}>
                      <strong>{points}점</strong>
                    </button>
                  </div>
                ) : (
                  <div className="mobile-quick-row-static">
                    {name}
                    {fixed === undefined ? (
                      <strong className="empty-score">—</strong>
                    ) : (
                      <div className="mobile-recorded-score">
                        <strong className="fixed-score">{fixed}점</strong>
                        <small className="score-recorded-label">기록됨</small>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      </div>
    </section>
  );
}
