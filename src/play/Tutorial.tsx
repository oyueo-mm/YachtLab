import { useState } from "react";
import { Check, Dices } from "lucide-react";
import { helpEntries } from "../CategoryHelp";
import { DiceArea } from "../DiceArea";
import MobileQuickScore from "../MobileQuickScore";
import { categories, createGame, names, score, transition, type Action, type Category } from "../engine";
import { playSfx } from "../sound";
import { useDiceBusy } from "../useDiceBusy";

const TUTORIAL_KEY = "yachtlab.tutorial.v1";

export function tutorialSeen() {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "seen";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(TUTORIAL_KEY, "seen");
  } catch {
    // The tutorial remains usable when storage is unavailable.
  }
}

export default function Tutorial({ onHome }: { onHome: () => void }) {
  // This practice game has its own state and does not write records, rewards or online commands.
  const [game, setGame] = useState(() => createGame());
  const [recorded, setRecorded] = useState<Category | null>(null);
  const busy = useDiceBusy();
  const held = game.dice.find((die) => die.held);
  const canScore = !recorded && game.rolls === 2 && !busy;
  const step = recorded
    ? "한 차례를 끝냈어요. 실제 경기에서는 각 족보를 한 번씩 기록해 총점을 겨뤄요."
    : game.rolls === 0
      ? "버튼을 눌러 주사위 다섯 개를 굴려 보세요."
      : game.rolls === 2
        ? "점수판에서 점수가 적힌 버튼을 누르세요. 누르면 그 족보에 바로 기록돼요."
        : held
          ? "킵한 주사위는 그대로 두고 나머지 네 개를 다시 굴려 보세요."
          : "남기고 싶은 주사위 하나를 눌러 킵하세요.";

  const exit = () => {
    markSeen();
    onHome();
  };

  const act = (action: Action) => setGame((previous) => transition(previous, action));

  function record(category: Category) {
    if (!canScore) return;
    const points = score(game.dice.map((die) => die.value), category);
    act({ type: "score", category });
    setRecorded(category);
    playSfx(points ? "score" : "scoreZero");
    markSeen();
  }

  return (
    <section className="tutorial" aria-labelledby="tutorial-title">
      <header className="tutorial-heading">
        <h1 id="tutorial-title">한 차례 연습하기</h1>
        {!recorded && <button type="button" className="secondary" onClick={exit}>건너뛰기</button>}
      </header>
      <p className="first-turn-guide" role="status">{step}</p>
      {recorded ? (
        <div className="tutorial-result">
          <p className="game-feedback"><Check size={16} aria-hidden="true" /> {names[recorded]} {game.cards[0][recorded]}점 기록 완료</p>
          <button type="button" className="primary" onClick={exit}>홈으로 가기</button>
        </div>
      ) : (
        <div className="tutorial-grid">
          <section className="game-board throw-tray" aria-label="연습 보드">
            <DiceArea
              state={game}
              animate
              rollEvent={game.rolls}
              interactive={game.rolls === 1 && !busy}
              onToggle={(id) => act({ type: "hold", ids: held?.id === id ? [] : [id] })}
            />
            <div className="roll-area">
              <button type="button" className="primary roll-button" disabled={busy || game.rolls >= 2 || (game.rolls === 1 && !held)} onClick={() => act({ type: "roll" })}>
                <Dices size={18} aria-hidden="true" /> {game.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
              </button>
            </div>
          </section>
          {game.rolls === 2 && (
            <div className="tutorial-score">
              <h2>연습 점수판</h2>
              <MobileQuickScore cards={[game.cards[0]]} dice={game.dice} rolls={game.rolls} current={0} labels={["내 점수"]} canScore={canScore} onScore={record} />
            </div>
          )}
        </div>
      )}
      <details className="tutorial-rules">
        <summary>족보와 점수 계산</summary>
        <p>한 차례에 최대 세 번 굴릴 수 있어요. 0점도 한 칸을 사용해요. 열두 칸을 모두 채우면 경기가 끝나요.</p>
        <dl>
          <div>
            <dt>상단 여섯 칸</dt>
            <dd>족보의 숫자와 같은 눈만 더해요. 예를 들어 3이 세 개면 트리플에 9점을 기록해요. {helpEntries.bonus.text}</dd>
          </div>
          {categories.slice(6).map((category) => (
            <div key={category}>
              <dt>{names[category]}</dt>
              <dd>{helpEntries[category].text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

const FIRST_SCORE_KEY = "yachtlab.first-score.v1";
let firstScoreRecorded = false;

export function hasRecordedFirstScore() {
  try {
    return firstScoreRecorded || localStorage.getItem(FIRST_SCORE_KEY) === "recorded";
  } catch {
    return firstScoreRecorded;
  }
}

export function markFirstScoreRecorded() {
  firstScoreRecorded = true;
  try {
    localStorage.setItem(FIRST_SCORE_KEY, "recorded");
  } catch {
    // Keep the requested behavior for the current tab.
  }
}

export function FirstTurnGuide({ rolls, active, busy }: { rolls: number; active: boolean; busy: boolean }) {
  if (!active || busy) return null;
  return (
    <p className="first-turn-guide" role="status">
      {rolls === 0 ? "주사위 굴리기를 눌러 시작하세요." : rolls < 3 ? "주사위를 눌러 킵할 수 있어요. 다시 굴리거나 점수가 표시된 버튼을 눌러 바로 기록하세요." : "점수 버튼을 눌러 기록하세요. 점수가 0이어도 빈 칸 하나를 골라야 해요."}
    </p>
  );
}
