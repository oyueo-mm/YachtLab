import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Dices, History, RotateCcw, Trophy } from "lucide-react";
import { MatchResult } from "../ui/MatchResult";
import ReviewLauncher from "../review/ReviewLauncher";
import { fromSoloReplay } from "../review/sources";
import { nearYacht, ScoreTotal } from "../ui/GameMoments";
import { DiceArea } from "../DiceArea";
import { MultiScoreboard } from "../MultiScoreboard";
import { createSoloGame, type MultiGame } from "../multi-engine";
import { appendMultiAction, newMultiReplay, type MultiReplay } from "../multi-replay";
import MultiReplayViewer from "../MultiReplayViewer";
import MobileScoreSheet, { MobileScoreButton } from "../MobileScoreSheet";
import MobileQuickScore from "../MobileQuickScore";
import { BonusChip, QuickPicks } from "../QuickPicks";
import { useYachtReady } from "../yacht-moment";
import { saveMultiReplay } from "../multi-replay-storage";
import { categories, total, upper, names as categoryNames, type Action, type Category } from "../engine";
import { useGameShortcuts } from "../ui/shortcuts";
import { useGameSounds, useThrowGesture } from "../game-feel";
import { Celebrate } from "../ui/Celebrate";
import { ConfirmDialog, type PendingAction } from "../ui/ConfirmDialog";
import { useDiceBusy } from "../useDiceBusy";
import { announceScore, clearScoreFx } from "../score-fx";
import { FirstTurnGuide, hasRecordedFirstScore, markFirstScoreRecorded } from "./Tutorial";
import { RULES_ID } from "../identity/records";
import { newSoloRecordId, saveSoloRecord, soloRecords } from "../solo/storage";
import { previousBest, soloStats, type SoloRecord } from "../solo/records";
import { syncSoloRecords } from "../solo/sync";
import { equippedBoard, useOwnLook } from "./own-look";
import { BoardFx, SynergyFx } from "./BoardFx";
import { diceLookOf, diceMaterialOf, useBoardTheme } from "./Looks";
import { SoloStatsPanel } from "./SoloStats";
import "./solo.css";

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
function subscribeRecords(fn: () => void) {
  window.addEventListener("yachtlab-solo-records", fn);
  window.addEventListener("yachtlab-session", fn);
  return () => {
    window.removeEventListener("yachtlab-solo-records", fn);
    window.removeEventListener("yachtlab-session", fn);
  };
}
let snapshot: { key: string; list: SoloRecord[] } = { key: "", list: [] };
/** Stable snapshot of this player's solo records for useSyncExternalStore. */
function readRecords() {
  const list = soloRecords();
  const key = list.map((r) => r.recordId).join(",");
  if (key !== snapshot.key) snapshot = { key, list };
  return snapshot.list;
}
export const useSoloRecords = () => useSyncExternalStore(subscribeRecords, readRecords, readRecords);

/**
 * 1인 플레이 (2026-11-27): the regular 12-round game alone, to beat your own best. Same engine
 * (multi-engine with one seat), same dice, scoring, review and equipped looks as every other mode.
 * Records are this browser's ("client-reported"): personal bests only, no ranking or rewards.
 */
export default function SoloGame({ name, server, onLeave, onProgress, onRecords }: { name: string; server: string | null; onLeave: () => void; onProgress?: (inProgress: boolean) => void; onRecords?: () => void }) {
  const [state, setState] = useState<MultiGame>(() => createSoloGame(newSeed()));
  const [error, setError] = useState("");
  const [viewReplay, setViewReplay] = useState<MultiReplay | null>(null);
  const [mobileScoreOpen, setMobileScoreOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(() => !hasRecordedFirstScore());
  const [gameFeedback, setGameFeedback] = useState("");
  const [rollEvent, setRollEvent] = useState(0);
  const [pending, setPending] = useState<PendingAction>(null);
  const [result, setResult] = useState<{ record: SoloRecord; before: number | null } | null>(null);
  const record = useRef<MultiReplay | null>(null);
  if (!record.current) record.current = newMultiReplay(state, [{ type: "human", name }], "1인 플레이");
  const startedAt = useRef(Date.now());
  const rolling = useDiceBusy();
  const records = useSoloRecords();
  const stats = useMemo(() => soloStats(records), [records]);
  const best = stats.best;
  const look = useOwnLook();
  const theme = useBoardTheme(equippedBoard(look));
  const boardRef = useRef<HTMLElement | null>(null);

  const card = state.cards[0];
  const active = !state.done && !viewReplay;
  const canAct = active && !rolling;
  const inProgress = state.actions > 0 && !state.done;
  useEffect(() => onProgress?.(inProgress), [inProgress]);
  useEffect(() => () => onProgress?.(false), []);
  useEffect(() => void syncSoloRecords(server), [server]);

  const finish = (replay: MultiReplay) => {
    const before = previousBest(soloRecords());
    const saved: SoloRecord = {
      recordId: newSoloRecordId(), rules: RULES_ID, source: "device", verification: "client-reported",
      startedAt: startedAt.current, endedAt: Date.now(), score: total(replay.finalState.cards[0]), card: { ...replay.finalState.cards[0] }, replayId: replay.metadata.id,
    };
    saveSoloRecord(saved);
    setResult({ record: saved, before });
    void saveMultiReplay(replay).catch((e) => setError("기보 자동 저장 실패: " + (e instanceof Error ? e.message : String(e))));
    void syncSoloRecords(server);
  };
  const act = (action: Action) => {
    if (!active) return;
    try {
      const next = appendMultiAction(record.current!, action);
      if (action.type === "score") {
        announceScore(state.dice, action.category);
        setGameFeedback(categoryNames[action.category] + " " + (next.finalState.cards[0][action.category] ?? 0) + "점 기록");
      }
      record.current = next;
      setState(next.finalState);
      if (action.type === "roll") setRollEvent((n) => n + 1);
      if (next.finalState.done && !state.done) finish(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** 즉시 재도전: a new seed, a new replay, the same screen. */
  const restart = () => {
    clearScoreFx();
    const fresh = createSoloGame(newSeed());
    record.current = newMultiReplay(fresh, [{ type: "human", name }], "1인 플레이");
    startedAt.current = Date.now();
    setState(fresh);
    setError("");
    setViewReplay(null);
    setMobileScoreOpen(false);
    setGameFeedback("");
    setResult(null);
  };
  const guarded = (action: Exclude<PendingAction, null>) => (inProgress ? setPending(action) : action.run());
  const recordScore = (category: Category) => {
    if (!canAct || !state.rolls || card[category] !== undefined) return;
    act({ type: "score", category });
    markFirstScoreRecorded();
    setShowGuide(false);
    setMobileScoreOpen(false);
  };
  const newBest = !!result && result.before !== null && result.record.score > result.before;
  const firstRecord = !!result && result.before === null;
  const gesture = useThrowGesture(canAct && state.rolls < 3, () => act({ type: "roll" }));
  const yachtReady = useYachtReady(state.dice, state.rolls, !state.done && card.yacht === undefined);
  const celebration = useGameSounds(state.cards, state.done, state.done ? (newBest || firstRecord ? "win" : "draw") : null);
  const toggle = (id: number) => act({ type: "hold", ids: state.dice.filter((d) => (d.id === id ? !d.held : d.held)).map((d) => d.id) });
  const keys = useGameShortcuts({
    active: canAct && !state.done, dice: state.dice, rolls: state.rolls, canRoll: canAct && state.rolls < 3, roll: () => act({ type: "roll" }),
    toggle, setAll: (held) => act({ type: "hold", ids: held ? state.dice.map((d) => d.id) : [] }),
    open: categories.filter((c) => card[c] === undefined), record: recordScore,
  });
  const score = total(card);
  const gap = best === null ? null : score - best;
  return (
    <div className="solo-game">
      <div className="game-grid solo-grid">
        <div className="game-left">
          <div className="score-summary solo-summary" aria-label="1인 플레이 진행">
            <div className="tone-me" data-role="human">
              <span>현재 점수</span>
              <strong><ScoreTotal value={score} /><small>점</small></strong>
            </div>
            <div className="solo-best">
              <span><Trophy size={13} aria-hidden="true" /> 개인 최고</span>
              <strong>{best ?? "—"}<small>{best === null ? "" : "점"}</small></strong>
            </div>
            <div className="round">
              <span>라운드</span>
              <strong>{state.round}<small>/ 12</small></strong>
            </div>
            <BonusChip card={card} />
          <div className="game-tools solo-tools">
            <button className="text-button" onClick={() => setViewReplay(record.current!)}>
              <History size={15} /> 기보 보기
            </button>
            {!state.done && (
              <button className="text-button" onClick={() => guarded({ title: "처음부터 다시 할까요?", message: "진행 중인 경기는 기록되지 않고 새 경기를 시작해요.", confirmLabel: "다시 시작", run: restart })}>
                <RotateCcw size={15} /> 다시 시작
              </button>
            )}
          </div>
          </div>
          <section
            className={"game-board throw-tray" + (state.rolls === 0 ? " dice-ready" : "") + (canAct && nearYacht(state.dice, state.rolls, card) ? " yacht-near" : "") + theme.className}
            style={theme.style}
            ref={boardRef}
            aria-label="1인 플레이 게임 보드"
            {...gesture}
          >
            <Celebrate value={celebration} />
            <BoardFx itemId={look.board} level={look.boardLv ?? 1} host={boardRef} />
            <SynergyFx dice={look.dice} board={look.board} level={Math.min(look.diceLv ?? 1, look.boardLv ?? 1)} host={boardRef} />
            <div className="board-top">
              <span className="turn-indicator"><i />{state.done ? "경기 종료" : "1인 플레이"}</span>
              <span>굴림 <b>{state.rolls}</b> / 3</span>
            </div>
            <DiceArea key={record.current.metadata.id} state={state} colors={diceLookOf(look)} material={diceMaterialOf(look)} interactive={canAct} animate={active} rollEvent={rollEvent} onToggle={toggle} onOrder={(ids) => act({ type: "order", ids })} />
            <div className="roll-area">
              <button className="primary roll-button" disabled={!canAct || state.rolls >= 3} onClick={() => act({ type: "roll" })}>
                <Dices size={20} />
                {state.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
                <span>{3 - state.rolls}회 남음</span>
              </button>
              <FirstTurnGuide rolls={state.rolls} active={showGuide && active} busy={rolling} />
              {!showGuide && !state.done && !rolling && state.rolls === 3 && <p>점수 칸을 선택하세요</p>}
              <QuickPicks values={state.dice.map((d) => d.value)} card={card} rolls={state.rolls} canScore={canAct && !state.done} onScore={recordScore} />
              {keys.label && <p className="kbd-pick" role="status">{keys.label}</p>}
            </div>
            {state.done && result && (
              <MatchResult waiting={!!celebration} mood={newBest || firstRecord ? "win" : "lose"} title={newBest ? "최고 기록 갱신!" : firstRecord ? "첫 기록 완성" : "경기 종료"}
                actions={<>
                  <button className="primary" onClick={restart}>바로 다시 도전</button>
                  <ReviewLauncher source={() => fromSoloReplay(record.current!)} />
                  {onRecords && <button className="secondary" onClick={onRecords}>내 기록</button>}
                  <button className="secondary" onClick={onLeave}>나가기</button>
                </>}>
                <p className="solo-final"><strong>{result.record.score}점</strong></p>
                <p className="solo-final-note">
                  {newBest ? `이전 최고 ${result.before}점보다 ${result.record.score - result.before!}점 높아요.`
                    : firstRecord ? "이 점수가 개인 최고 기록이 돼요."
                    : `개인 최고 ${result.before}점까지 ${result.before! - result.record.score}점 남았어요.`}
                </p>
                <ul className="solo-final-facts">
                  <li>플레이 {stats.plays}회</li>
                  {stats.average !== null && <li>평균 {stats.average.toFixed(1)}점</li>}
                  <li>상단 보너스 {upper(card) >= 63 ? "달성" : "미달성"}</li>
                  {card.yacht === 50 && <li>요트 달성</li>}
                </ul>
              </MatchResult>
            )}
          </section>
          <MobileScoreButton onClick={() => setMobileScoreOpen(true)} rolls={rolling ? 0 : state.rolls} canScore={canAct} yacht={yachtReady} />
          {mobileScoreOpen && (
            <MobileScoreSheet onClose={() => setMobileScoreOpen(false)}>
              <MobileQuickScore cards={state.cards} dice={state.dice} rolls={rolling ? 0 : state.rolls} current={0} labels={[name]} canScore={canAct} onScore={recordScore} />
            </MobileScoreSheet>
          )}
          {gameFeedback && <p className="game-feedback" role="status" key={gameFeedback}>{gameFeedback}</p>}
          {error && <p role="alert" className="error">{error}</p>}
          {!state.done && gap !== null && state.round >= 2 && <p className="solo-pace">개인 최고와 차이 {gap >= 0 ? "+" : ""}{gap}점 (현재까지 기록한 점수 기준)</p>}
        </div>
        <div className="multi-scores solo-scores">
          <MultiScoreboard state={state} labels={[name]} select={canAct ? recordScore : undefined} />
          <SoloStatsPanel stats={stats} compact />
        </div>
      </div>
      {viewReplay && <MultiReplayViewer replay={viewReplay} onClose={() => setViewReplay(null)} />}
      <ConfirmDialog
        open={pending !== null}
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
