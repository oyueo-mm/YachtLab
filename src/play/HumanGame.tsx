import { useEffect, useRef, useState } from "react";
import { Trophy, Dices, RotateCcw, ArrowRight, ChevronRight, History } from "lucide-react";
import { createGame, transition, total, names, type Category } from "../engine";
import { type Algorithm, type Decision } from "../ai";
import { runJob, createDecisionSession } from "../client";
import { Dice } from "../Dice";
import { Scoreboard } from "../Scoreboard";
import ReplayViewer, { type AnalysisSource } from "../ReplayViewer";
import { newReplay, appendFrame, clone, type Replay } from "../replay";
import GameDifficulty, { difficultyLabel } from "../GameDifficulty";
import MobileQuickScore from "../MobileQuickScore";
import { useHumanTurn } from "../human-turn";
import MobileScoreSheet, { MobileScoreButton } from "../MobileScoreSheet";
import { saveReplay } from "../replay-storage";
import { newSeed, errorText, Thinking, ErrorMessage, DecisionView } from "../ui/common";
import { useGameSounds, useThrowGesture } from "../game-feel";
import { Celebrate } from "../ui/Celebrate";

export default function HumanGame({
  onBranch,
  onAnalyze,
}: {
  onBranch: (r: Replay, index: number) => void;
  onAnalyze: (s: AnalysisSource) => void;
}) {
  const [state, setState] = useState(() => createGame(newSeed(), true)),
    [algorithm, setAlgorithm] = useState<Algorithm>("Greedy"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [last, setLast] = useState<Decision | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0),
    job = useRef<ReturnType<typeof runJob<Decision>> | null>(null);
  const aiSession = useRef<ReturnType<typeof createDecisionSession> | null>(
    null,
  );
  useEffect(
    () => () => {
      generation.current++;
      job.current?.cancel();
    },
    [],
  );
  const [viewReplay, setViewReplay] = useState<Replay | null>(null);
  const [mobileScoreOpen, setMobileScoreOpen] = useState(false);
  const pausedRef = useRef(false);
  const record = useRef(
    newReplay(state, [
      { type: "human", name: "나" },
      { type: "ai", name: algorithm, algorithm },
    ], "요트 대국", 2),
  );
  useEffect(() => {
    if (state.actions === 0)
      record.current = {
        ...record.current,
        metadata: {
          ...record.current.metadata,
          players: [
            { type: "human", name: "나" },
            { type: "ai", name: algorithm, algorithm },
          ],
        },
      };
  }, [algorithm]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [aiTurn, setAiTurn] = useState(0),
    [caption, setCaption] = useState(""),
    [gameFeedback, setGameFeedback] = useState("");
  const [rollEvent, setRollEvent] = useState(0);
  const [aiPreviewCategory, setAiPreviewCategory] = useState<Category | null>(null);
  const commit = (
    action: Parameters<typeof transition>[1],
    decision?: Decision,
  ) => {
    const before = stateRef.current;
    const updated = appendFrame(record.current, action, decision);
    record.current = updated;
    const next = updated.finalState;
    if (next.done && !before.done) void saveReplay(updated).catch((e) => setError("기보 자동 저장 실패: " + errorText(e)));
    if (action.type === "roll") setRollEvent((n) => n + 1);
    if (action.type === "score") {
      setGameFeedback((before.player === 0 ? "나" : "AI") + " · " + names[action.category] + " " + (next.cards[before.player][action.category] ?? 0) + "점 기록");
    }
    stateRef.current = next;
    setState(next);
    if (before.player === 0 && next.player === 1) setAiTurn((n) => n + 1);
    return next;
  };
  useHumanTurn({
    stateRef,
    algorithm,
    trigger: aiTurn,
    retry,
    generation,
    session: aiSession,
    job,
    commit,
    setBusy,
    setError,
    setLast,
    setCaption,
    setPreviewScore: setAiPreviewCategory,
    paused: !!viewReplay,
    pausedRef,
  });
  const act = (action: Parameters<typeof transition>[1]) => {
    try {
      commit(action);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  };
  const restart = () => {
    generation.current++;
    job.current?.cancel();
    setBusy(false);
    setLast(null);
    setError("");
    const fresh = createGame(newSeed(), true);
    stateRef.current = fresh;
    record.current = newReplay(fresh, [
      { type: "human", name: "나" },
      { type: "ai", name: algorithm, algorithm },
    ], "요트 대국", 2);
    setState(fresh);
    setAiTurn(0);
    setCaption("");
    setGameFeedback("");
    setMobileScoreOpen(false);
    setAiPreviewCategory(null);
  };
  const can = state.player === 0 && !state.done && !busy;
  const gesture = useThrowGesture(can && state.rolls < 3, () => act({ type: "roll" }));
  const celebration = useGameSounds(state.cards, state.done, state.done ? (state.winner === "draw" ? "draw" : state.winner === 0 ? "win" : "lose") : null);
  const recordScore = (category: Category) => { if (!can || state.rolls === 0 || state.cards[0][category] !== undefined) return; act({ type: "score", category }); setMobileScoreOpen(false); };
  return (
    <>
      <div className="game-grid">
        <div className="game-left">
          <div className="game-tools">
            <button
              className="text-button"
              onClick={() => {
                pausedRef.current = true;
                setViewReplay(clone(record.current));
              }}
            >
              <History size={16}/>
              기보 보기
            </button>
            <div className="opponent-picker">
              <GameDifficulty value={algorithm} set={setAlgorithm} disabled={state.actions > 0} />
            </div>
            <button className="text-button" onClick={restart}>
              <RotateCcw size={15} />
              재대결
            </button>
          </div>
          <div className="score-summary">
            <div className={state.player === 0 ? "selected" : ""}>
              <span>나</span>
              <strong>
                {total(state.cards[0])}
                <small>점</small>
              </strong>
            </div>
            <div className={state.player === 1 ? "selected" : ""}>
              <span>AI · {difficultyLabel(algorithm)}</span>
              <strong>
                {total(state.cards[1])}
                <small>점</small>
              </strong>
            </div>
            <div className="round">
              <span>라운드</span>
              <strong>
                {state.round}
                <small>/ 12</small>
              </strong>
            </div>
          </div>
          <section className={"game-board throw-tray" + (state.rolls === 0 ? " dice-ready" : "")} aria-label="게임 보드" {...gesture}>
            <Celebrate value={celebration} />
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {state.done
                  ? "경기 종료"
                  : can
                    ? "나의 차례"
                    : "AI의 차례"}
              </span>
              <span>
                굴림 <b>{state.rolls}</b> / 3
              </span>
            </div>
            <Dice
              state={state}
              interactive={can}
              animate
              rollEvent={rollEvent}
              onToggle={(id) =>
                act({
                  type: "hold",
                  ids: state.dice
                    .filter((d) => (d.id === id ? !d.held : d.held))
                    .map((d) => d.id),
                })
              }
              onOrder={(ids) => act({ type: "order", ids })}
            />
            <div className="roll-area">
              <button
                className="primary roll-button"
                disabled={!can || state.rolls >= 3}
                onClick={() => act({ type: "roll" })}
              >
                <Dices size={20} />
                {state.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
                <span>{3 - state.rolls}회 남음</span>
              </button>
              <p>
                {state.done
                  ? ""
                  : state.player === 1
                    ? ""
                    : !state.rolls
                      ? "주사위를 굴려 시작하세요"
                      : state.rolls === 3
                        ? "점수판에서 기록할 점수를 선택하세요"
                        : "클릭하여 고정 · 드래그하여 순서 변경"}
              </p>
            </div>
            {caption && (
              <p className="ai-action-status" role="status">
                {caption}
              </p>
            )}
            {busy && <Thinking />}
            {state.done && (
              <div className="game-result" role="status">
                <Trophy size={25} />
                <h2>
                  {state.winner === "draw"
                    ? "무승부입니다"
                    : state.winner === 0
                      ? "승리했습니다!"
                      : "AI가 승리했습니다"}
                </h2>
                <p>
                  {total(state.cards[0])} : {total(state.cards[1])}
                </p>
                <button className="primary" onClick={restart}>
                  한 번 더 플레이
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </section>
          <MobileScoreButton onClick={() => setMobileScoreOpen(true)} rolls={state.rolls} canScore={can} />
          {mobileScoreOpen && <MobileScoreSheet onClose={() => setMobileScoreOpen(false)}><MobileQuickScore cards={state.cards} dice={state.dice} rolls={state.rolls} current={state.player} labels={["나","AI"]} canScore={can} onScore={recordScore}/></MobileScoreSheet>}
          {gameFeedback && <p className="game-feedback" role="status">{gameFeedback}</p>}
          <details className="game-rules"><summary>게임 방법</summary><p>12라운드 동안 주사위 5개를 최대 3번 굴려요. 원하는 주사위를 눌러 고정하고 점수판에서 원하는 점수를 한 번 누르면 바로 기록돼요. 한 번 기록한 칸은 다시 사용할 수 없어요. 상단 점수 합계가 63점 이상이면 보너스 35점을 받아요.</p></details>
          <ErrorMessage message={error} />
          {error && state.player === 1 && !state.done && (
            <button
              className="secondary"
              onClick={() => {
                job.current?.cancel();
                setError("");
                setRetry((n) => n + 1);
              }}
            >
              AI 다시 계산
            </button>
          )}
          {last && (
            <details className="decision-details">
              <summary>
                AI의 마지막 판단
                <ChevronRight size={14} />
              </summary>
              <DecisionView decision={last} />
            </details>
          )}
          <div className="keyboard-note">
            키보드로 순서 변경: 주사위에 초점을 두고 Alt + 좌우 방향키
          </div>
        </div>
        <Scoreboard state={state} select={can ? recordScore : undefined} previewCategory={aiPreviewCategory} />
      </div>
      {viewReplay && (
        <ReplayViewer
          replay={viewReplay}
          onClose={() => {
            pausedRef.current = false;
            setViewReplay(null);
          }}
          onBranch={onBranch}
          onAnalyze={onAnalyze}
        />
      )}
    </>
  );
}
