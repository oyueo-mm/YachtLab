import { useEffect, useRef, useState } from "react";
import { Trophy, Dices, RotateCcw, ArrowRight, ChevronRight, History, SlidersHorizontal } from "lucide-react";
import { createGame, transition, total, names, type Category } from "../engine";
import { type Algorithm, type Decision } from "../ai";
import { runJob, createDecisionSession } from "../client";
import { DiceArea } from "../DiceArea";
import { Scoreboard } from "../Scoreboard";
import ReplayViewer, { type AnalysisSource } from "../ReplayViewer";
import { newReplay, appendFrame, clone, type Replay } from "../replay";
import { difficultyLabel, gameDifficulties } from "../GameDifficulty";
import MobileQuickScore from "../MobileQuickScore";
import { useHumanTurn } from "../human-turn";
import MobileScoreSheet, { MobileScoreButton } from "../MobileScoreSheet";
import { saveReplay } from "../replay-storage";
import { newSeed, errorText, Thinking, ErrorMessage, DecisionView } from "../ui/common";
import { useGameSounds, useThrowGesture } from "../game-feel";
import { Celebrate } from "../ui/Celebrate";
import { ConfirmDialog, type PendingAction } from "../ui/ConfirmDialog";
import { aiSpeedScale, resolveHumanSeat, type AiMatchConfig } from "../setup";
import { useDiceBusy } from "../useDiceBusy";
import { announceScore, clearScoreFx } from "../score-fx";

/**
 * Human vs AI. All choices (difficulty, names, who starts, AI pace) come from the setup screen;
 * the play screen only shows the game. Who starts is implemented by seating: the starting player
 * is always engine seat 0, so the 12-category engine and the AI code stay unchanged.
 */
export default function HumanGame({
  config,
  onBranch,
  onAnalyze,
  onChangeSetup,
  onProgress,
}: {
  config: AiMatchConfig;
  onBranch: (r: Replay, index: number) => void;
  onAnalyze: (s: AnalysisSource) => void;
  onChangeSetup: () => void;
  onProgress?: (inProgress: boolean) => void;
}) {
  const algorithm = config.algorithm;
  const isPublicLevel = gameDifficulties.some((d) => d.algorithm === algorithm);
  const aiName = isPublicLevel ? `AI · ${difficultyLabel(algorithm as Algorithm)}` : `AI · ${algorithm}`;
  const [humanSeat, setHumanSeat] = useState<0 | 1>(() => resolveHumanSeat(config.first));
  const aiSeat = (1 - humanSeat) as 0 | 1;
  const seatPlayers = (seat: 0 | 1) => {
    const human = { type: "human" as const, name: config.humanName };
    const ai = { type: "ai" as const, name: algorithm, algorithm };
    return (seat === 0 ? [human, ai] : [ai, human]) as Parameters<typeof newReplay>[1];
  };
  const labels = (humanSeat === 0 ? [config.humanName, aiName] : [aiName, config.humanName]) as [string, string];
  const [state, setState] = useState(() => createGame(newSeed(), true)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [last, setLast] = useState<Decision | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0),
    job = useRef<ReturnType<typeof runJob<Decision>> | null>(null);
  const aiSession = useRef<ReturnType<typeof createDecisionSession> | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      job.current?.cancel();
    },
    [],
  );
  const [viewReplay, setViewReplay] = useState<Replay | null>(null);
  const [mobileScoreOpen, setMobileScoreOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const pausedRef = useRef(false);
  const record = useRef(newReplay(state, seatPlayers(humanSeat), "요트 대국", 2));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [aiTurn, setAiTurn] = useState(0),
    [caption, setCaption] = useState(""),
    [gameFeedback, setGameFeedback] = useState("");
  const [rollEvent, setRollEvent] = useState(0);
  const [aiPreviewCategory, setAiPreviewCategory] = useState<Category | null>(null);
  const rolling = useDiceBusy();
  const commit = (action: Parameters<typeof transition>[1], decision?: Decision) => {
    const before = stateRef.current;
    const updated = appendFrame(record.current, action, decision);
    // Presentation only: tell the dice area which dice made this combination (the engine already scored it).
    if (action.type === "score") announceScore(before.dice, action.category);
    record.current = updated;
    const next = updated.finalState;
    if (next.done && !before.done) void saveReplay(updated).catch((e) => setError("기보 자동 저장 실패: " + errorText(e)));
    if (action.type === "roll") setRollEvent((n) => n + 1);
    if (action.type === "score") setGameFeedback(labels[before.player] + " · " + names[action.category] + " " + (next.cards[before.player][action.category] ?? 0) + "점 기록");
    stateRef.current = next;
    setState(next);
    if (before.player !== aiSeat && next.player === aiSeat) setAiTurn((n) => n + 1);
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
    aiSeat,
    speed: aiSpeedScale[config.speed],
  });
  const act = (action: Parameters<typeof transition>[1]) => {
    try {
      commit(action);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  };
  const inProgress = state.actions > 0 && !state.done;
  useEffect(() => onProgress?.(inProgress), [inProgress]);
  useEffect(() => () => onProgress?.(false), []);
  /** Same setup, brand-new game: new seed, new replay, seats re-drawn when the first player is random. */
  const restart = () => {
    generation.current++;
    job.current?.cancel();
    clearScoreFx();
    setBusy(false);
    setLast(null);
    setError("");
    const seat = resolveHumanSeat(config.first);
    const fresh = createGame(newSeed(), true);
    stateRef.current = fresh;
    record.current = newReplay(fresh, seatPlayers(seat), "요트 대국", 2);
    setHumanSeat(seat);
    setState(fresh);
    setAiTurn((n) => n + 1); // re-arm the AI even when it is seat 0 and moves first
    setCaption("");
    setGameFeedback("");
    setMobileScoreOpen(false);
    setAiPreviewCategory(null);
  };
  const guarded = (action: Exclude<PendingAction, null>) => (inProgress ? setPending(action) : action.run());
  const can = state.player === humanSeat && !state.done && !busy && !rolling;
  const gesture = useThrowGesture(can && state.rolls < 3, () => act({ type: "roll" }));
  const outcome = state.done ? (state.winner === "draw" ? "draw" : state.winner === humanSeat ? "win" : "lose") : null;
  const celebration = useGameSounds(state.cards, state.done, outcome);
  const recordScore = (category: Category) => {
    if (!can || state.rolls === 0 || state.cards[humanSeat][category] !== undefined) return;
    act({ type: "score", category });
    setMobileScoreOpen(false);
  };
  const mine = state.player === humanSeat;
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
              <History size={16} />
              기보 보기
            </button>
            <button
              className="text-button"
              onClick={() => guarded({ title: "새 경기를 시작할까요?", message: "진행 중인 경기는 기록되지 않고 같은 설정으로 새 경기를 시작해요.", confirmLabel: "재대결", run: restart })}
            >
              <RotateCcw size={15} />
              재대결
            </button>
            <button
              className="text-button"
              onClick={() => guarded({ title: "설정을 바꿀까요?", message: "진행 중인 경기를 그만두고 상세 설정 화면으로 이동해요.", confirmLabel: "설정 변경", run: onChangeSetup })}
            >
              <SlidersHorizontal size={15} />
              설정 변경
            </button>
          </div>
          <div className="score-summary">
            {[0, 1].map((seat) => (
              <div key={seat} className={state.player === seat ? "selected" : ""} data-seat={seat} data-role={seat === humanSeat ? "human" : "ai"}>
                <span>{labels[seat]}</span>
                <strong>
                  {total(state.cards[seat])}
                  <small>점</small>
                </strong>
              </div>
            ))}
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
                {state.done ? "경기 종료" : mine ? "나의 차례" : "AI의 차례"}
              </span>
              <span>
                굴림 <b>{state.rolls}</b> / 3
              </span>
            </div>
            <DiceArea
              state={state}
              interactive={can}
              animate
              rollEvent={rollEvent}
              onToggle={(id) =>
                act({
                  type: "hold",
                  ids: state.dice.filter((d) => (d.id === id ? !d.held : d.held)).map((d) => d.id),
                })
              }
              onOrder={(ids) => act({ type: "order", ids })}
            />
            <div className="roll-area">
              <button className="primary roll-button" disabled={!can || state.rolls >= 3} onClick={() => act({ type: "roll" })}>
                <Dices size={20} />
                {state.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
                <span>{3 - state.rolls}회 남음</span>
              </button>
              <p>
                {!state.done && mine && !rolling && state.rolls === 3 ? "점수 칸을 선택하세요" : ""}
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
                <h2>{state.winner === "draw" ? "무승부입니다" : state.winner === humanSeat ? "승리했습니다!" : "AI가 승리했습니다"}</h2>
                <p>
                  {total(state.cards[humanSeat])} : {total(state.cards[aiSeat])}
                </p>
                <div className="game-result-actions">
                  <button className="primary" onClick={restart}>
                    한 번 더 플레이
                    <ArrowRight size={16} />
                  </button>
                  <button className="secondary" onClick={onChangeSetup}>
                    설정 변경
                  </button>
                </div>
              </div>
            )}
          </section>
          <MobileScoreButton onClick={() => setMobileScoreOpen(true)} rolls={rolling ? 0 : state.rolls} canScore={can} />
          {mobileScoreOpen && (
            <MobileScoreSheet onClose={() => setMobileScoreOpen(false)}>
              <MobileQuickScore cards={state.cards} dice={state.dice} rolls={rolling ? 0 : state.rolls} current={state.player} labels={labels} canScore={can} onScore={recordScore} />
            </MobileScoreSheet>
          )}
          {gameFeedback && (
            <p className="game-feedback" role="status">
              {gameFeedback}
            </p>
          )}
          <ErrorMessage message={error} />
          {error && state.player === aiSeat && !state.done && (
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
          <p className="keyboard-note sr-only">키보드로 순서 변경: 주사위에 초점을 두고 Alt + 좌우 방향키</p>
        </div>
        <Scoreboard state={state} labels={labels} selectPlayer={humanSeat} select={can ? recordScore : undefined} previewCategory={aiPreviewCategory} />
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
      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ""}
        message={pending?.message ?? ""}
        confirmLabel={pending?.confirmLabel ?? "확인"}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const run = pending?.run;
          setPending(null);
          run?.();
        }}
      />
    </>
  );
}
