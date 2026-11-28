import { useEffect, useRef, useState } from "react";
import { Dices, LogOut, ShieldCheck } from "lucide-react";
import { DiceArea } from "../DiceArea";
import { MultiScoreboard } from "../MultiScoreboard";
import { BonusChip } from "../QuickPicks";
import { names as categoryNames, total, type Category } from "../engine";
import type { MultiGame } from "../multi-engine";
import type { DailyStep, DailyView } from "./game";
import { DailyError, type AttemptView } from "./client";

/**
 * One daily game (공식 도전 / 같은 날 연습 / 지난 도전). The page gives a driver; the screen never computes
 * dice. Server modes: every roll and score is one request and the answer replaces the local view.
 * After a score the server already made the next turn's first roll — it stays hidden (the previous dice
 * are shown) until the player presses "주사위 굴리기", so the screen plays like any other game.
 */
export type GameMode = "official" | "practice" | "archive";
export type Driver = { mode: GameMode; date: string; step(seq: number, step: DailyStep): Promise<{ attempt: Pick<AttemptView, "status" | "ranked" | "state"> }> };

const MODE_LABEL: Record<GameMode, string> = { official: "공식 기록", practice: "연습 · 기록 안 됨", archive: "지난 도전 · 이 기기 연습" };

export default function DailyGame({ driver, initial, name, onFinished, onExit }: {
  driver: Driver;
  initial: Pick<AttemptView, "status" | "ranked" | "state">;
  name: string;
  onFinished: (view: DailyView) => void;
  onExit: () => void;
}) {
  const [view, setView] = useState<DailyView>(initial.state);
  const [status, setStatus] = useState(initial.status);
  const [held, setHeld] = useState(initial.state.rolls >= 2 ? initial.state.keep : 0);
  const [hidden, setHidden] = useState(false);
  const [shown, setShown] = useState<number[]>(initial.state.dice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rollEvent, setRollEvent] = useState(0);
  const finishedOnce = useRef(initial.state.done);

  useEffect(() => {
    if (view.done && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished(view);
    }
  }, [view.done]);

  const playing = status === "playing" && !view.done;
  const canAct = playing && !busy;
  const send = async (step: DailyStep) => {
    setBusy(true);
    setError("");
    try {
      const r = await driver.step(view.seq, step);
      setStatus(r.attempt.status);
      return r.attempt.state;
    } catch (e) {
      if (e instanceof DailyError && e.attempt) {
        // another tab moved first or the request was replayed: show the server's state
        setView(e.attempt.state);
        setShown(e.attempt.state.dice);
        setStatus(e.attempt.status);
        setHeld(0);
        setHidden(false);
      }
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const roll = async () => {
    if (!canAct) return;
    if (hidden) {
      setHidden(false);
      setShown(view.dice);
      setRollEvent((n) => n + 1);
      return;
    }
    if (view.rolls >= 3 || held === 31) return;
    const next = await send({ t: "roll", keep: held });
    if (!next) return;
    setView(next);
    setShown(next.dice);
    setRollEvent((n) => n + 1);
  };
  const record = async (c: Category) => {
    if (!canAct || hidden || view.card[c] !== undefined) return;
    const next = await send({ t: "score", c });
    if (!next) return;
    setView(next);
    setHeld(0);
    if (!next.done) setHidden(true); // keep showing the dice that were just scored
  };
  const toggle = (id: number) => {
    if (!canAct || hidden || view.rolls >= 3) return;
    setHeld((m) => m ^ (1 << id));
  };

  const rolls = hidden ? 0 : view.rolls;
  const game: MultiGame = {
    dice: shown.map((value, id) => ({ id, value, held: !hidden && !!(held & (1 << id)) })),
    order: [0, 1, 2, 3, 4], cards: [view.card], player: 0, round: Math.min(12, view.round), rolls, done: view.done,
    winners: view.done ? [0] : [], seed: 0, rng: [0], actions: view.seq,
  };
  const score = total(view.card);
  return (
    <div className="solo-game daily-game" data-mode={driver.mode}>
      <div className="game-grid solo-grid">
        <div className="game-left">
          <div className="score-summary solo-summary" aria-label="오늘의 요트 진행">
            <div className="tone-me" data-role="human">
              <span>현재 점수</span>
              <strong>{score}<small>점</small></strong>
            </div>
            <div className="daily-badge-cell">
              <span className={"daily-badge daily-badge-" + driver.mode}>{driver.mode === "official" ? <ShieldCheck size={13} aria-hidden="true" /> : null}{MODE_LABEL[driver.mode]}</span>
              <small>{driver.date}</small>
            </div>
            <div className="round">
              <span>라운드</span>
              <strong>{Math.min(12, view.round)}<small>/ 12</small></strong>
            </div>
            <BonusChip card={view.card} />
            <div className="game-tools solo-tools">
              <button className="text-button" onClick={onExit} aria-label="나가기" title={driver.mode === "archive" ? "나가기 (진행은 저장되지 않아요)" : "나가기 (진행은 서버에 저장돼요)"}>
                <LogOut size={15} /> <span className="tool-label">나가기</span>
              </button>
            </div>
          </div>
          <section className={"game-board throw-tray" + (rolls === 0 ? " dice-ready" : "")} aria-label="오늘의 요트 게임 보드">
            <div className="board-top">
              <span className="turn-indicator"><i />{view.done ? "도전 종료" : status === "expired" ? "시간 종료" : "오늘의 요트"}</span>
              <span>굴림 <b>{rolls}</b> / 3</span>
            </div>
            <DiceArea state={game} interactive={canAct && !hidden && view.rolls < 3} animate={playing} rollEvent={rollEvent} onToggle={toggle} />
            <div className="roll-area">
              <button className="primary roll-button" disabled={!canAct || (!hidden && (view.rolls >= 3 || held === 31))} onClick={() => void roll()}>
                <Dices size={20} />
                {hidden || rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
                <span>{3 - rolls}회 남음</span>
              </button>
              {!hidden && playing && view.rolls === 3 && <p>점수 칸을 선택하세요</p>}
              {!hidden && playing && held === 31 && view.rolls < 3 && <p>다시 굴릴 주사위를 하나 이상 풀어 주세요</p>}
              {status === "expired" && <p role="status">도전 시간이 끝났어요 (한국 시간 자정 + 30분). 공식 기록으로 남지 않아요.</p>}
            </div>
          </section>
          {busy && <p className="daily-sync" role="status">서버에 기록하는 중…</p>}
          {error && <p role="alert" className="error">{error}</p>}
        </div>
        <div className="multi-scores solo-scores">
          <MultiScoreboard state={game} labels={[name]} select={canAct && !hidden && view.rolls > 0 ? (c) => void record(c) : undefined} />
          <p className="daily-fair-note">주사위는 서버가 굴리고 점수도 서버가 계산해요. 같은 날 모든 참가자는 같은 위치에서 같은 눈을 만나요.</p>
          {view.done && <p className="daily-final" role="status">최종 {score}점 · {Object.entries(view.card).filter(([, v]) => v === 0).map(([c]) => categoryNames[c as Category]).join(", ") || "0점 칸 없음"}</p>}
        </div>
      </div>
    </div>
  );
}
