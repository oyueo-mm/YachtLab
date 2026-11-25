import { useState } from "react";
import { Check, Dices } from "lucide-react";
import { DiceArea } from "../DiceArea";
import MobileQuickScore from "../MobileQuickScore";
import { createGame, transition, type Game } from "../engine";
import { playSfx } from "../sound";
import { useDiceBusy } from "../useDiceBusy";
import { finishTutorial } from "./tutorial-progress";

const steps = [
  { kind: "roll", values: [6, 6, 3, 2, 1], text: "주사위 굴리기를 누르세요." },
  { kind: "keep", id: 0, text: "첫 번째 6을 눌러 킵하세요." },
  { kind: "keep", id: 1, text: "두 번째 6도 킵하세요." },
  { kind: "roll", values: [6, 6, 6, 4, 2], text: "킵한 주사위를 두고 나머지를 다시 굴리세요." },
  { kind: "keep", id: 2, text: "새로 나온 6을 킵하세요." },
  { kind: "roll", values: [6, 6, 6, 6, 2], text: "마지막으로 다시 굴리세요." },
  { kind: "score", text: "헥사 24점을 누르면 점수판에 바로 기록돼요." },
] as const;

export default function Tutorial({ onExit, returning }: { onExit: () => void; returning: boolean }) {
  const [practice, setPractice] = useState(() => ({ game: createGame(1), step: 0 }));
  const { game, step } = practice;
  const instruction = steps[step];
  const busy = useDiceBusy();
  const completed = !instruction;
  const keep = instruction?.kind === "keep" ? instruction.id : undefined;
  const scoreTurn = instruction?.kind === "score";

  function advance(next: Game) {
    setPractice({ game: next, step: step + 1 });
  }

  function roll() {
    if (busy || instruction?.kind !== "roll") return;
    const next = transition(game, { type: "roll" });
    const values = instruction.values;
    advance({ ...next, dice: next.dice.map((die) => ({ ...die, value: values[die.id] })) });
  }

  function hold(id: number) {
    if (busy || id !== keep) return;
    advance(transition(game, { type: "hold", ids: [...game.dice.filter((die) => die.held).map((die) => die.id), id] }));
  }

  return (
    <section className="tutorial guided-tutorial" aria-label="튜토리얼">
      <header className="tutorial-heading">
        <span>{completed ? "연습 완료" : `${step + 1} / ${steps.length}`}</span>
        {!completed && <button type="button" className="secondary" onClick={() => {
          finishTutorial("skipped");
          onExit();
        }}>건너뛰기</button>}
      </header>
      {completed ? (
        <div className="tutorial-result">
          <p className="game-feedback" role="status"><Check size={16} aria-hidden="true" /> 헥사 {game.cards[0].sixes}점 기록 완료</p>
          <button type="button" className="primary" onClick={onExit}>{returning ? "계속하기" : "홈으로 가기"}</button>
        </div>
      ) : (
        <div className="guided-board">
          <section className="game-board throw-tray" aria-label="연습 보드">
            <div className="guided-dice" data-focus-die={keep}>
              <DiceArea state={game} animate forceRenderer="2.5d" rollEvent={game.rolls} interactive={!busy && keep !== undefined} focusDie={keep} onToggle={hold} />
            </div>
            <p className="guided-instruction" role="status">{instruction.text}</p>
            <div className="roll-area">
              <button type="button" className={`primary roll-button${instruction.kind === "roll" ? " guided-target" : ""}`} disabled={busy || instruction.kind !== "roll"} onClick={roll}>
                <Dices size={18} aria-hidden="true" /> {game.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
              </button>
            </div>
            <div className={scoreTurn ? "guided-target" : "guided-inactive"} inert={!scoreTurn}>
              <MobileQuickScore cards={[game.cards[0]]} dice={game.dice} rolls={game.rolls} current={0} labels={["내 점수"]} onlyCategory="sixes" canScore={scoreTurn && !busy} onScore={(category) => {
                if (busy || !scoreTurn || category !== "sixes") return;
                advance(transition(game, { type: "score", category }));
                playSfx("score");
                finishTutorial("completed");
              }} />
            </div>
          </section>
        </div>
      )}
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
