import { BrandMark } from "../ui/BrandLoading";
import { BonusMoments } from "../bonus-moment";
import { MatchResultPanel } from "../match-result/MatchResultPanel";
import { ZeroScoreToast } from "../match-result/ZeroScoreToast";
import { useZeroScoreNotice } from "../match-result/useZeroScore";
import { winEffect } from "../match-result/win-effect";
import { deviceBestBefore } from "../match-result/device-best";
import { fromOfflineFrames } from "../match-result/adapters";
import type { ResultInput } from "../match-result/model";
import { ShareResultButton } from "../ui/ShareResult";
import ReviewLauncher from "../review/ReviewLauncher";
import { fromReplay } from "../review/sources";
import { nearYacht, ScoreTotal } from "../ui/GameMoments";
import { useEffect, useRef, useState } from "react";
import { Dices, RotateCcw, ChevronRight, History, SlidersHorizontal } from "lucide-react";
import { categories, createGame, transition, total, names, type Category } from "../engine";
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
import { saveLocalRecord } from "../identity/local";
import { RULES_ID } from "../identity/records";
import { newSeed, errorText, Thinking, ErrorMessage, DecisionView } from "../ui/common";
import { useGameSounds, useThrowGesture } from "../game-feel";
import { Celebrate } from "../ui/Celebrate";
import { ConfirmDialog, type PendingAction } from "../ui/ConfirmDialog";
import { aiSpeedScale, resolveHumanSeat, type AiMatchConfig } from "../setup";
import { useDiceBusy } from "../useDiceBusy";
import { useYachtReady } from "../yacht-moment";
import { BonusChip, QuickPicks } from "../QuickPicks";
import { announceScore, clearScoreFx } from "../score-fx";
import { useGameShortcuts } from "../ui/shortcuts";
import { FirstTurnGuide, hasRecordedFirstScore, markFirstScoreRecorded } from "./Tutorial";
import { equippedBoard, useOwnLook } from "./own-look";
import { BoardFx, SynergyFx } from "./BoardFx";
import { diceLookOf, diceMaterialOf, useBoardTheme } from "./Looks";

/**
 * Human vs AI. All choices (difficulty, names, who starts, AI pace) come from the setup screen;
 * the play screen only shows the game. Who starts is implemented by seating: the starting player
 * is always engine seat 0, so the 12-category engine and the AI code stay unchanged.
 */
export default function HumanGame({
  config,
  suspended = false,
  onBranch,
  onAnalyze,
  onChangeSetup,
  onLeave,
  onProgress,
}: {
  config: AiMatchConfig;
  suspended?: boolean;
  onBranch: (r: Replay, index: number) => void;
  onAnalyze: (s: AnalysisSource) => void;
  onChangeSetup: () => void;
  onLeave: () => void;
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
  const [modelStatus, setModelStatus] = useState("");
  const skipTrial = useRef<(() => void) | null>(null);
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
  useEffect(() => {
    if (!suspended) return;
    job.current?.cancel();
    job.current = null;
  }, [suspended]);
  const [viewReplay, setViewReplay] = useState<Replay | null>(null);
  const [mobileScoreOpen, setMobileScoreOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const pausedRef = useRef(false);
  const record = useRef(newReplay(state, seatPlayers(humanSeat), "요트 대국", 2));
  /** Start of the current game (for this device's match record). */
  const startedAt = useRef(Date.now());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [aiTurn, setAiTurn] = useState(0),
    [caption, setCaption] = useState(""),
    [gameFeedback, setGameFeedback] = useState("");
  const [showGuide, setShowGuide] = useState(() => !hasRecordedFirstScore());
  const [resultInput, setResultInput] = useState<ResultInput | null>(null);
  const [rollEvent, setRollEvent] = useState(0);
  const [aiPreviewCategory, setAiPreviewCategory] = useState<Category | null>(null);
  const rolling = useDiceBusy();
  // The player's own equipped dice and board (presentation only; the AI rolls the default dice).
  const look = useOwnLook();
  const theme = useBoardTheme(equippedBoard(look));
  const boardRef = useRef<HTMLElement | null>(null);
  const commit = (action: Parameters<typeof transition>[1], decision?: Decision) => {
    const before = stateRef.current;
    const updated = appendFrame(record.current, action, decision);
    // Presentation only: tell the dice area which dice made this combination (the engine already scored it).
    if (action.type === "score") announceScore(before.dice, action.category);
    record.current = updated;
    const next = updated.finalState;
    if (next.done && !before.done) {
      void saveReplay(updated).catch((e) => setError("기보 자동 저장 실패: " + errorText(e)));
      // This device's record (profile/stats). Trust level: client-reported, never server-verified.
      const mine = total(next.cards[humanSeat]),
        theirs = total(next.cards[aiSeat]);
      // A3 결과 화면: 실제 기보 프레임의 카드 변화(채점 순서)와 이 기기의 이전 최고점(이번 경기 저장 전).
      const ids = ["s0", "s1"];
      setResultInput(fromOfflineFrames([{ state: updated.initialState }, ...updated.frames], ids.map((id, i) => ({ id, name: labels[i], you: i === humanSeat, kind: i === aiSeat ? ("ai" as const) : ("human" as const) })),
        next.winner === "draw" ? ids : next.winner === null ? [] : [ids[next.winner]],
        { mode: "ai", startedAt: startedAt.current, endedAt: Date.now(), personal: { bestBefore: deviceBestBefore("ai"), source: "device" } }));
      saveLocalRecord({
        recordId: updated.metadata.id,
        mode: "ai",
        rules: RULES_ID,
        source: "device",
        verification: "client-reported",
        startedAt: startedAt.current,
        endedAt: Date.now(),
        name: config.humanName,
        score: mine,
        card: { ...next.cards[humanSeat] },
        outcome: mine > theirs ? "win" : mine < theirs ? "loss" : "draw",
        endReason: "completed",
        opponent: { name: aiName, kind: "ai", score: theirs, aiLevel: isPublicLevel ? difficultyLabel(algorithm as Algorithm) : algorithm },
        aiLevel: isPublicLevel ? difficultyLabel(algorithm as Algorithm) : algorithm,
      });
    }
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
    setModelStatus,
    skipTrial,
    paused: !!viewReplay || suspended,
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
    startedAt.current = Date.now();
    setHumanSeat(seat);
    setState(fresh);
    setAiTurn((n) => n + 1); // re-arm the AI even when it is seat 0 and moves first
    setCaption("");
    setGameFeedback("");
    setResultInput(null);
    setMobileScoreOpen(false);
    setAiPreviewCategory(null);
  };
  const guarded = (action: Exclude<PendingAction, null>) => (inProgress ? setPending(action) : action.run());
  const can = !suspended && state.player === humanSeat && !state.done && !busy && !rolling;
  const gesture = useThrowGesture(can && state.rolls < 3, () => act({ type: "roll" }));
  const yachtReady = useYachtReady(state.dice, state.rolls, state.player === humanSeat && !state.done && state.cards[humanSeat].yacht === undefined);
  const outcome = state.done ? (state.winner === "draw" ? "draw" : state.winner === humanSeat ? "win" : "lose") : null;
  const celebration = useGameSounds(state.cards, state.done, outcome);
  const [zeroNotice, clearZero] = useZeroScoreNotice(state.cards, (seat) => (seat === humanSeat ? {} : null), record.current.metadata.id);
  const recordScore = (category: Category) => {
    if (!can || state.rolls === 0 || state.cards[humanSeat][category] !== undefined) return;
    act({ type: "score", category });
    markFirstScoreRecorded();
    setShowGuide(false);
    setMobileScoreOpen(false);
  };
  const mine = state.player === humanSeat;
  const keys = useGameShortcuts({
    active: can, dice: state.dice, rolls: state.rolls, canRoll: can && state.rolls < 3, roll: () => act({ type: "roll" }),
    toggle: (id) => act({ type: "hold", ids: state.dice.filter((d) => (d.id === id ? !d.held : d.held)).map((d) => d.id) }),
    setAll: (held) => act({ type: "hold", ids: held ? state.dice.map((d) => d.id) : [] }),
    open: categories.filter((c) => state.cards[humanSeat][c] === undefined), record: recordScore,
  });
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
            {!state.done && <>
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
            </>}
          </div>
          <div className="score-summary">
            {[0, 1].map((seat) => (
              <div key={seat} className={(state.player === seat ? "selected " : "") + (seat === humanSeat ? "tone-me" : "tone-opp")} data-seat={seat} data-role={seat === humanSeat ? "human" : "ai"}>
                <span>{labels[seat]}</span>
                <strong>
                  <ScoreTotal value={total(state.cards[seat])} />
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
            <BonusChip card={state.cards[humanSeat]} />
          </div>
          <section className={"game-board throw-tray" + (state.rolls === 0 ? " dice-ready" : "") + (can && nearYacht(state.dice, state.rolls, state.cards[humanSeat]) ? " yacht-near" : "") + theme.className} style={theme.style} ref={boardRef} aria-label="게임 보드" {...gesture}>
            <Celebrate value={celebration} />
            <ZeroScoreToast notice={zeroNotice} onDone={clearZero} />
            <BonusMoments scope={String(state.seed ?? 0)} players={state.cards.map((c, i) => ({ id: "s" + i, name: labels[i], card: c, mine: i === humanSeat, look: i === humanSeat ? look : null }))} />
            <BoardFx itemId={look.board} level={look.boardLv ?? 1} host={boardRef} />
            <SynergyFx dice={state.player === humanSeat ? look.dice : undefined} board={look.board} level={Math.min(look.diceLv ?? 1, look.boardLv ?? 1)} host={boardRef} />
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
              key={record.current.metadata.id}
              state={state}
              colors={state.player === humanSeat ? diceLookOf(look) : null}
              material={state.player === humanSeat ? diceMaterialOf(look) : undefined}
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
              <p>{!showGuide && !state.done && mine && !rolling && state.rolls === 3 ? "점수 칸을 선택하세요" : ""}</p>
              <QuickPicks values={state.dice.map((d) => d.value)} card={state.cards[humanSeat]} rolls={state.rolls} canScore={can} onScore={recordScore} />
            </div>
            {caption && (
              <p className="ai-action-status" role="status">
                {caption}
              </p>
            )}
            {modelStatus && <p className="ai-action-status" role="status">
              <BrandMark /> {modelStatus} <button type="button" className="secondary" onClick={() => skipTrial.current?.()}>준비 취소</button>
            </p>}
            {busy && !modelStatus && <Thinking />}
            {state.done && resultInput && (
              <MatchResultPanel key={record.current.metadata.id} waiting={!!celebration} input={resultInput}
                {...(state.winner === humanSeat ? winEffect(look, record.current.metadata.id) : null)}
                actions={{
                  onRematch: restart,
                  rematchLabel: "한 번 더 플레이",
                  reviewSlot: <ReviewLauncher source={() => fromReplay(record.current)} />,
                  shareSlot: <ShareResultButton facts={{
                    outcome: state.winner === "draw" ? "draw" : state.winner === humanSeat ? "win" : "lose",
                    me: { name: config.humanName, total: total(state.cards[humanSeat]), yachts: state.cards[humanSeat].yacht === 50 ? 1 : 0 },
                    opponent: { name: aiName, total: total(state.cards[aiSeat]), yachts: state.cards[aiSeat].yacht === 50 ? 1 : 0 },
                    kind: "AI 대전 · " + aiName.replace(/^AI · /, ""),
                  }} />,
                  onHome: onLeave,
                  homeLabel: "나가기",
                }} />
            )}
          </section>
          <MobileScoreButton onClick={() => setMobileScoreOpen(true)} rolls={rolling ? 0 : state.rolls} canScore={can} yacht={yachtReady} />
          <FirstTurnGuide rolls={state.rolls} active={showGuide && mine && !state.done} busy={rolling} />
          {mobileScoreOpen && (
            <MobileScoreSheet onClose={() => setMobileScoreOpen(false)}>
              <MobileQuickScore cards={state.cards} dice={state.dice} rolls={rolling ? 0 : state.rolls} current={state.player} labels={labels} canScore={can} onScore={recordScore} />
            </MobileScoreSheet>
          )}
          {gameFeedback && (
            <p className="game-feedback" role="status" key={gameFeedback}>
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
          {/* Research detail: only for research models chosen in advanced settings, not the public levels. */}
          {last && !isPublicLevel && (
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
        <Scoreboard state={state} labels={labels} tones={humanSeat === 0 ? ["me", "opp"] : ["opp", "me"]} round={state.round} selectPlayer={humanSeat} select={can ? recordScore : undefined} previewCategory={aiPreviewCategory}
          selected={keys.picked} onConfirm={keys.picked ? () => recordScore(keys.picked!) : undefined} onClear={() => keys.setPicked(null)} />
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
