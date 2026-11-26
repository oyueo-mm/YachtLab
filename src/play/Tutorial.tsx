import { useCallback, useEffect, useState } from "react";
import { Check, Dices } from "lucide-react";
import { DiceArea } from "../DiceArea";
import MobileQuickScore from "../MobileQuickScore";
import { createGame, transition, type Game } from "../engine";
import { playSfx } from "../sound";
import { useDiceBusy } from "../useDiceBusy";
import { diceRenderer, useSettings } from "../settings";
import { TutorialRules } from "./TutorialRules";
import { finishTutorial } from "./tutorial-progress";

const steps = [
  { kind: "roll", values: [6, 6, 3, 2, 1], text: "주사위 굴리기를 누르세요." },
  { kind: "keep", id: 0, text: "첫 번째 6을 눌러 킵하세요." },
  { kind: "keep", id: 1, text: "두 번째 6도 킵하세요." },
  { kind: "release", id: 1, text: "킵한 6을 한 번 더 눌러 해제하세요." },
  { kind: "keep", id: 1, text: "해제한 6을 다시 킵하세요." },
  { kind: "roll", values: [6, 6, 6, 4, 2], text: "킵한 주사위를 두고 나머지를 다시 굴리세요." },
  { kind: "keep", id: 2, text: "새로 나온 6을 킵하세요." },
  { kind: "roll", values: [6, 6, 6, 6, 2], text: "마지막으로 다시 굴리세요." },
  { kind: "score", text: "헥사 24점을 누르면 점수판에 바로 기록돼요." },
] as const;

export default function Tutorial({ onExit, returning, practiceOnly = false }: { onExit: () => void; returning?: boolean; practiceOnly?: boolean }) {
  const [practice, setPractice] = useState(() => ({ game: createGame(1), step: 0 }));
  const { game, step } = practice;
  const instruction = steps[step];
  const settings = useSettings();
  const wants3d = diceRenderer(settings).startsWith("3d");
  const [rendererRequested, setRendererRequested] = useState(practiceOnly);
  const [rendererReady, setRendererReady] = useState(false);
  const [queuedRoll, setQueuedRoll] = useState(false);
  const prepare3d = wants3d && rendererRequested;
  const preparing = prepare3d && !rendererReady;
  const rendererDidBecomeReady = useCallback(() => setRendererReady(true), []);
  const busy = useDiceBusy();
  const completed = !instruction;
  const keep = instruction?.kind === "keep" || instruction?.kind === "release" ? instruction.id : undefined;
  const scoreTurn = instruction?.kind === "score";

  function advance(next: Game) {
    setPractice({ game: next, step: step + 1 });
  }

  const rollDice = useCallback(() => {
    setPractice((current) => {
      const next = steps[current.step];
      if (next?.kind !== "roll") return current;
      const { game } = current;
      return {
        step: current.step + 1,
        game: { ...game, rolls: game.rolls + 1, dice: game.dice.map((die) => die.held ? die : { ...die, value: next.values[die.id] }) },
      };
    });
  }, []);
  useEffect(() => {
    if (!queuedRoll || preparing || busy) return;
    setQueuedRoll(false);
    rollDice();
  }, [queuedRoll, preparing, busy, rollDice]);

  function roll() {
    if (preparing || queuedRoll || busy || instruction?.kind !== "roll") return;
    if (wants3d && !rendererRequested) {
      setRendererRequested(true);
      setQueuedRoll(true);
      return;
    }
    rollDice();
  }

  function hold(id: number) {
    if (busy || id !== keep) return;
    const ids = game.dice.filter((die) => die.id === id ? !die.held : die.held).map((die) => die.id);
    advance(transition(game, { type: "hold", ids }));
  }

  return (
    <section className="tutorial guided-tutorial" aria-label={practiceOnly ? "한 차례 연습하기" : "튜토리얼"}>
      <header className="tutorial-heading">
        <h1>{practiceOnly ? "한 차례 연습하기" : "첫 차례 튜토리얼"}</h1>
        {!completed && <button type="button" className="secondary" onClick={() => {
          if (!practiceOnly) finishTutorial("skipped");
          onExit();
        }}>{practiceOnly ? "나가기" : "건너뛰기"}</button>}
      </header>
      {completed ? (
        <div className="tutorial-result">
          <p className="game-feedback" role="status"><Check size={16} aria-hidden="true" /> 헥사 {game.cards[0].sixes}점 기록 완료</p>
          {!practiceOnly && <TutorialRules />}
          <button type="button" className="primary" onClick={onExit}>{practiceOnly ? "오프라인 대전으로" : returning ? "계속하기" : "홈으로 가기"}</button>
        </div>
      ) : (
        <div className="guided-board">
          <section className="game-board throw-tray" aria-label="연습 보드">
            <div className="guided-dice" data-focus-die={keep}>
              <DiceArea state={game} animate rollEvent={game.rolls} interactive={!busy && keep !== undefined} focusDie={keep} onToggle={hold}
                forceRenderer={wants3d && !rendererRequested ? "2.5d" : undefined}
                onRendererReady={prepare3d ? rendererDidBecomeReady : undefined} />
            </div>
            <p className="guided-instruction" role="status">{preparing ? "주사위를 준비하고 있어요." : instruction.text}</p>
            <div className="roll-area">
              <button type="button" className={`primary roll-button${instruction.kind === "roll" ? " guided-target" : ""}`} disabled={preparing || queuedRoll || busy || instruction.kind !== "roll"} onClick={roll}>
                <Dices size={18} aria-hidden="true" /> {game.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
              </button>
            </div>
            <div className={scoreTurn ? "guided-target" : "guided-inactive"} inert={!scoreTurn}>
              <MobileQuickScore cards={[game.cards[0]]} dice={game.dice} rolls={game.rolls} current={0} labels={["내 점수"]} onlyCategory="sixes" canScore={scoreTurn && !busy} onScore={(category) => {
                if (busy || !scoreTurn || category !== "sixes") return;
                advance(transition(game, { type: "score", category }));
                playSfx("score");
                if (!practiceOnly) finishTutorial("completed");
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
