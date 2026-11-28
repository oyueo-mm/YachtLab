import { MatchResultPanel } from "./match-result/MatchResultPanel";
import { ZeroScoreToast } from "./match-result/ZeroScoreToast";
import { useZeroScoreNotice } from "./match-result/useZeroScore";
import { winEffect } from "./match-result/win-effect";
import { cardsHistoryFromMulti, stepsFromCards } from "./match-result/adapters";
import type { ResultInput } from "./match-result/model";
import { BonusMoments } from "./bonus-moment";
import ReviewLauncher from "./review/ReviewLauncher";
import { fromMultiReplay } from "./review/sources";
import { FirstTurnGuide, hasRecordedFirstScore, markFirstScoreRecorded } from "./play/Tutorial";
import { nearYacht, ScoreTotal } from "./ui/GameMoments";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, History, RotateCcw, SlidersHorizontal } from "lucide-react";
import { DiceArea } from "./DiceArea";
import "./play/multi-compact.css";
import { MultiScoreboard, MultiStandings } from "./MultiScoreboard";
import { createMultiGame, multiStandings, type MultiGame } from "./multi-engine";
import { appendMultiAction, newMultiReplay, type MultiReplay } from "./multi-replay";
import MultiReplayViewer from "./MultiReplayViewer";
import MobileScoreSheet, { MobileScoreButton } from "./MobileScoreSheet";
import { useYachtReady } from "./yacht-moment";
import { QuickPicks } from "./QuickPicks";
import MobileQuickScore from "./MobileQuickScore";
import { saveMultiReplay } from "./multi-replay-storage";
import { categories, total, names as categoryNames, type Action, type Category } from "./engine";
import { useGameShortcuts } from "./ui/shortcuts";
import { useGameSounds, useThrowGesture } from "./game-feel";
import { Celebrate } from "./ui/Celebrate";
import { ConfirmDialog, type PendingAction } from "./ui/ConfirmDialog";
import { Segmented } from "./ui/kit";
import { orderPlayers, type LocalOrder } from "./setup";
import { useDiceBusy } from "./useDiceBusy";
import { announceScore, clearScoreFx } from "./score-fx";
import { equippedBoard, useOwnLook } from "./play/own-look";
import { BoardFx, SynergyFx } from "./play/BoardFx";
import { diceLookOf, diceMaterialOf, useBoardTheme } from "./play/Looks";

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const asPlayers = (names: string[]) => names.map((name) => ({ type: "human" as const, name }));

/**
 * Local multiplayer (2–50 players on one device). Player count, names and start order are decided
 * on the setup screen. Seat order == turn order == replay player order, so standings, the score
 * sheet and saved replays always agree.
 */
export default function LocalGame({
  players: inputNames,
  order,
  onChangeSetup,
  onLeave,
  onProgress,
}: {
  /** Final names in input order (already de-duplicated / defaulted). */
  players: string[];
  order: LocalOrder;
  onChangeSetup: () => void;
  onLeave: () => void;
  onProgress?: (inProgress: boolean) => void;
}) {
  const [names, setNames] = useState(() => orderPlayers(inputNames, order));
  const count = names.length;
  const [state, setState] = useState<MultiGame>(() => createMultiGame(count, newSeed()));
  const [error, setError] = useState("");
  const [viewReplay, setViewReplay] = useState<MultiReplay | null>(null);
  // UI-1: every column by default (the sheet pins the current player and scrolls when it can't fit).
  const [allScores, setAllScores] = useState(true);
  const [mobileScoreOpen, setMobileScoreOpen] = useState(false);
  const [sheetView, setSheetView] = useState<"quick" | "table">("quick");
  const [showGuide, setShowGuide] = useState(() => !hasRecordedFirstScore());
  const [gameFeedback, setGameFeedback] = useState("");
  const [rollEvent, setRollEvent] = useState(0);
  const [pending, setPending] = useState<PendingAction>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const record = useRef<MultiReplay | null>(null);
  if (!record.current) record.current = newMultiReplay(state, asPlayers(names), "사람 vs 사람");
  const rolling = useDiceBusy();
  // One device, one owner: this device's equipped dice and board for every seat (presentation only).
  const look = useOwnLook();
  const theme = useBoardTheme(equippedBoard(look));
  const boardRef = useRef<HTMLElement | null>(null);

  const active = !state.done && !viewReplay;
  const canAct = active && !rolling;
  const current = names[state.player];
  const inProgress = state.actions > 0 && !state.done;
  useEffect(() => onProgress?.(inProgress), [inProgress]);
  useEffect(() => () => onProgress?.(false), []);

  useEffect(() => {
    const rail = railRef.current;
    const item = rail?.children[state.player] as HTMLElement | undefined;
    if (!rail || !item) return;
    const left = item.offsetLeft - rail.offsetLeft;
    const right = left + item.offsetWidth;
    if (left < rail.scrollLeft) rail.scrollTo({ left, behavior: "smooth" });
    else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollTo({ left: right - rail.clientWidth, behavior: "smooth" });
  }, [state.player, count]);

  const act = (action: Action) => {
    if (!active) return;
    try {
      const next = appendMultiAction(record.current!, action);
      if (action.type === "score") announceScore(state.dice, action.category);
      if (action.type === "score") setGameFeedback(current + " · " + categoryNames[action.category] + " " + (next.finalState.cards[state.player][action.category] ?? 0) + "점 기록");
      record.current = next;
      setState(next.finalState);
      if (action.type === "roll") setRollEvent((n) => n + 1);
      if (next.finalState.done && !state.done) void saveMultiReplay(next).catch((e) => setError("기보 자동 저장 실패: " + (e instanceof Error ? e.message : String(e))));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** Same setup, new game: new seed and replay; a random start order is drawn again. */
  const restart = () => {
    clearScoreFx();
    const seats = orderPlayers(inputNames, order);
    const fresh = createMultiGame(seats.length, newSeed());
    record.current = newMultiReplay(fresh, asPlayers(seats), "사람 vs 사람");
    setNames(seats);
    setState(fresh);
    setError("");
    setViewReplay(null);
    setAllScores(false);
    setMobileScoreOpen(false);
    setGameFeedback("");
  };
  const guarded = (action: Exclude<PendingAction, null>) => (inProgress ? setPending(action) : action.run());
  const recordScore = (category: Category) => {
    if (!canAct || !state.rolls || state.cards[state.player][category] !== undefined) return;
    act({ type: "score", category });
    markFirstScoreRecorded();
    setShowGuide(false);
    setMobileScoreOpen(false);
  };
  const standings = state.done ? multiStandings(state) : [];
  const gesture = useThrowGesture(canAct && state.rolls < 3, () => act({ type: "roll" }));
  const yachtReady = useYachtReady(state.dice, state.rolls, !state.done && state.cards[state.player]?.yacht === undefined);
  const celebration = useGameSounds(state.cards, state.done, state.done ? "win" : null);
  // 한 기기에서 여럿이 하므로 0점 알림에 이름을 붙인다.
  const [zeroNotice, clearZero] = useZeroScoreNotice(state.cards, (seat) => ({ who: count > 1 ? names[seat] : undefined }), record.current!.metadata.id);
  const resultInput = useMemo<ResultInput | null>(() => {
    if (!state.done || !record.current) return null;
    const ids = names.map((_, i) => "s" + i);
    return {
      mode: "local",
      seats: names.map((name, i) => ({ id: ids[i], name, kind: "human" as const, card: { ...state.cards[i] } })),
      winners: state.winners.map((i) => ids[i]),
      steps: stepsFromCards(cardsHistoryFromMulti(record.current), ids),
      startedAt: Date.parse(record.current.metadata.createdAt) || null,
      endedAt: Date.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done, record.current?.metadata.id]);
  // LocalGame has no keyboard score preview sheet; Enter records the category chosen with ↑/↓.
  const keys = useGameShortcuts({
    active: canAct && !state.done, dice: state.dice, rolls: state.rolls, canRoll: canAct && state.rolls < 3, roll: () => act({ type: "roll" }),
    toggle: (id) => act({ type: "hold", ids: state.dice.filter((d) => (d.id === id ? !d.held : d.held)).map((d) => d.id) }),
    setAll: (held) => act({ type: "hold", ids: held ? state.dice.map((d) => d.id) : [] }),
    open: categories.filter((c) => state.cards[state.player]?.[c] === undefined), record: recordScore,
  });
  return (
    <div className="multi-local-game">
      <div className="game-tools multi-game-tools">
        <span className="multi-game-meta">
          로컬 대전 · {count}명 · {state.round}/12
        </span>
        <button className="text-button" onClick={() => setViewReplay(record.current!)}>
          <History size={15} /> 기보 보기
        </button>
        {!state.done && <>
        <button
          className="text-button"
          onClick={() => guarded({ title: "새 경기를 시작할까요?", message: "진행 중인 경기는 기록되지 않고 같은 설정으로 새 경기를 시작해요.", confirmLabel: "재대결", run: restart })}
        >
          <RotateCcw size={15} /> 재대결
        </button>
        <button
          className="text-button"
          onClick={() => guarded({ title: "설정을 바꿀까요?", message: "진행 중인 경기를 그만두고 상세 설정 화면으로 이동해요.", confirmLabel: "설정 변경", run: onChangeSetup })}
        >
          <SlidersHorizontal size={15} /> 설정 변경
        </button>
        </>}
      </div>
      <div className={"game-grid multi-game-grid " + (count <= 4 ? "multi-small" : count <= 8 ? "multi-medium" : "multi-wide")} style={{ "--np": count } as React.CSSProperties}>
        <div className="game-left">
          <div className="multi-player-strip" aria-label="참가자 점수 요약" ref={railRef}>
            {state.cards.map((card, i) => (
              <div key={i} className={"multi-player-chip " + (!state.done && state.player === i ? "selected" : "")}>
                <span title={names[i]}>{names[i]}</span>
                <strong>
                  <ScoreTotal value={total(card)} />
                  <small>점</small>
                </strong>
              </div>
            ))}
          </div>
          <section className={"game-board throw-tray " + (state.rolls === 0 ? "multi-dice-ready" : "") + (canAct && nearYacht(state.dice, state.rolls, state.cards[state.player]) ? " yacht-near" : "") + theme.className} style={theme.style} ref={boardRef} aria-label="사람 vs 사람 게임 보드" {...gesture}>
            <Celebrate value={celebration} />
            <ZeroScoreToast notice={zeroNotice} onDone={clearZero} />
            <BonusMoments scope={String(state.seed)} players={state.cards.map((c, i) => ({ id: "s" + i, name: names[i], card: c, mine: false, look }))} />
            <BoardFx itemId={look.board} level={look.boardLv ?? 1} host={boardRef} />
            <SynergyFx dice={look.dice} board={look.board} level={Math.min(look.diceLv ?? 1, look.boardLv ?? 1)} host={boardRef} />
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {state.done ? "경기 종료" : current + "의 차례"}
              </span>
              <span className="board-rolls">
                라운드 {state.round}/12 · 굴림 <b>{state.rolls}</b>/3
              </span>
            </div>
            <DiceArea state={state} colors={diceLookOf(look)} material={diceMaterialOf(look)} interactive={canAct} animate={active} rollEvent={rollEvent} onToggle={(id) => act({ type: "hold", ids: state.dice.filter((d) => (d.id === id ? !d.held : d.held)).map((d) => d.id) })} onOrder={(ids) => act({ type: "order", ids })} />
            <div className="roll-area">
              <button className="primary roll-button" disabled={!canAct || state.rolls >= 3} onClick={() => act({ type: "roll" })}>
                <Dices size={20} />
                {state.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
                <span>{3 - state.rolls}회 남음</span>
              </button>
              <FirstTurnGuide rolls={state.rolls} active={showGuide && active} busy={rolling} />
              {!showGuide && !state.done && !rolling && state.rolls === 3 && <p>점수 칸을 선택하세요</p>}
              <QuickPicks values={state.dice.map((d) => d.value)} card={state.cards[state.player]} rolls={state.rolls} canScore={canAct && !state.done} onScore={recordScore} />
              {keys.label && <p className="kbd-pick" role="status">{keys.label}</p>}
            </div>
            {state.done && resultInput && (
              <MatchResultPanel key={record.current!.metadata.id} waiting={!!celebration} input={resultInput}
                {...(state.winners.length === 1 ? winEffect(look, record.current!.metadata.id) : null)}
                actions={{
                  onRematch: restart,
                  rematchLabel: "한 번 더 플레이",
                  reviewSlot: count === 2 ? <ReviewLauncher source={() => fromMultiReplay(record.current!)} /> : undefined,
                  onHome: onLeave,
                  homeLabel: "나가기",
                }} />
            )}
          </section>
          <MobileScoreButton onClick={() => setMobileScoreOpen(true)} rolls={rolling ? 0 : state.rolls} canScore={canAct} yacht={yachtReady} />
          {mobileScoreOpen && (
            <MobileScoreSheet onClose={() => setMobileScoreOpen(false)}>
              <Segmented label="점수판 보기 방식" className="ui1-sheet-switch" value={sheetView} onChange={setSheetView}
                options={[{ value: "quick", label: "현재 차례" }, { value: "table", label: "전체 점수표" }]} />
              {sheetView === "quick"
                ? <MobileQuickScore cards={state.cards} dice={state.dice} rolls={rolling ? 0 : state.rolls} current={state.player} labels={names} canScore={canAct} onScore={recordScore} />
                : <MultiScoreboard state={state} labels={names} compact pinned={state.player} select={canAct ? recordScore : undefined} />}
            </MobileScoreSheet>
          )}
          {gameFeedback && (
            <p className="game-feedback" role="status" key={gameFeedback}>
              {gameFeedback}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {state.done && count < 9 && <MultiStandings state={state} labels={names} />}
        </div>
        <div className="multi-scores">
          {count >= 9 && (
            <div className="multi-view-switch">
              <button type="button" className={!allScores ? "active" : ""} aria-pressed={!allScores} onClick={() => setAllScores(false)}>
                현재 차례만
              </button>
              <button type="button" className={allScores ? "active" : ""} aria-pressed={allScores} onClick={() => setAllScores(true)}>
                전체 점수표
              </button>
            </div>
          )}
          <MultiScoreboard state={state} labels={names} compact focused={count >= 9 && !allScores} pinned={state.player} select={canAct ? recordScore : undefined} />
          {count >= 9 && <MultiStandings state={state} labels={names} />}
        </div>
      </div>
      {viewReplay && <MultiReplayViewer replay={viewReplay} onClose={() => setViewReplay(null)} />}
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
    </div>
  );
}
