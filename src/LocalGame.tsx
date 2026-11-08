import { useRef, useState } from "react";
import { ArrowRight, Dices, Minus, Plus, RotateCcw, Trophy } from "lucide-react";
import { Dice } from "./Dice";
import { MultiScoreboard, MultiStandings } from "./MultiScoreboard";
import { createMultiGame, multiStandings, type MultiGame } from "./multi-engine";
import { appendMultiAction, newMultiReplay, type MultiReplay } from "./multi-replay";
import MultiReplayViewer from "./MultiReplayViewer";
import { total, type Action } from "./engine";

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const initialNames = () => Array.from({ length: 50 }, (_, i) => "플레이어 " + (i + 1));
const labelAt = (labels: string[], index: number) => labels[index]?.trim() || "플레이어 " + (index + 1);
const asPlayers = (labels: string[], count: number) =>
  Array.from({ length: count }, (_, i) => ({ type: "human" as const, name: labelAt(labels, i) }));

export default function LocalGame() {
  const [count, setCount] = useState(2);
  const [labels, setLabels] = useState(initialNames);
  const [state, setState] = useState<MultiGame>(() => createMultiGame(2, newSeed()));
  const [error, setError] = useState("");
  const [viewReplay, setViewReplay] = useState<MultiReplay | null>(null);
  const [allScores, setAllScores] = useState(false);
  const record = useRef<MultiReplay | null>(null);
  if (!record.current) record.current = newMultiReplay(state, asPlayers(labels, count), "사람 vs 사람");

  const started = state.actions > 0;
  const active = !state.done && !viewReplay;
  const names = labels.slice(0, count).map((_, i) => labelAt(labels, i));
  const current = names[state.player];
  const changeCount = (next: number) => {
    if (started || !Number.isFinite(next)) return;
    const n = Math.min(50, Math.max(2, Math.trunc(next)));
    if (n === count) return;
    const fresh = createMultiGame(n, newSeed());
    setCount(n); setState(fresh); setAllScores(false); setError("");
    record.current = newMultiReplay(fresh, asPlayers(labels, n), "사람 vs 사람");
  };
  const rename = (index: number, value: string) => {
    if (started) return;
    const next = [...labels];
    next[index] = value;
    setLabels(next);
    record.current = newMultiReplay(state, asPlayers(next, count), "사람 vs 사람");
  };
  const act = (action: Action) => {
    if (!active) return;
    try {
      const next = appendMultiAction(record.current!, action);
      record.current = next;
      setState(next.finalState);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const restart = () => {
    const fresh = createMultiGame(count, newSeed());
    record.current = newMultiReplay(fresh, asPlayers(labels, count), "사람 vs 사람");
    setState(fresh); setError(""); setViewReplay(null); setAllScores(false);
  };
  const standings = state.done ? multiStandings(state) : [];
  return (
    <div className="multi-local-game">
      <section className="multi-config panel" aria-label="다인전 설정">
        <div className="multi-config-head">
          <div><h2>사람 vs 사람</h2><span>한 기기에서 번갈아 플레이</span></div>
          <div className="multi-count-control">
            <span>참가 인원</span>
            <button className="icon-button" aria-label="인원 줄이기" onClick={() => changeCount(count - 1)} disabled={started || count <= 2}><Minus size={17} /></button>
            <input type="number" aria-label="참가 인원" min={2} max={50} step={1} value={count} disabled={started} onChange={(e) => { if (e.target.value !== "") changeCount(Number(e.target.value)); }} />
            <button className="icon-button" aria-label="인원 늘리기" onClick={() => changeCount(count + 1)} disabled={started || count >= 50}><Plus size={17} /></button>
          </div>
        </div>
        <div className="multi-config-bottom">
          <details className="multi-names" open={count <= 8 && !started ? true : undefined}>
            <summary>플레이어 이름 <span>({count}명)</span></summary>
            <div className="multi-names-grid">
              {names.map((_, i) => (
                <label key={i}><span>P{i + 1}</span>
                  <input aria-label={"플레이어 " + (i + 1) + " 이름"} value={labels[i]} maxLength={24} disabled={started} onChange={(e) => rename(i, e.target.value)} />
                </label>
              ))}
            </div>
          </details>
          <div className="multi-top-actions">
            <button className="text-button" onClick={() => setViewReplay(record.current!)}>기보 보기</button>
            <button className="text-button" onClick={restart}><RotateCcw size={15} /> 재대결</button>
          </div>
        </div>
      </section>
      <div className="multi-player-strip" aria-label="참가자 점수 요약">
        {state.cards.map((card, i) => (
          <div key={i} className={"multi-player-chip " + (!state.done && state.player === i ? "selected" : "")}>
            <span title={names[i]}>{names[i]}</span>
            <strong>{total(card)}<small>점</small></strong>
          </div>
        ))}
      </div>
      <div className={"game-grid multi-game-grid " + (count <= 4 ? "multi-small" : "multi-wide")}>
        <div className="game-left">
          <section className="game-board" aria-label="사람 vs 사람 게임 보드">
            <div className="board-top">
              <span className="turn-indicator"><i />{state.done ? "경기 종료" : current + "의 차례"}</span>
              <span>라운드 {state.round}/12 · 굴림 <b>{state.rolls}</b>/3</span>
            </div>
            <Dice
              state={state}
              interactive={active}
              onToggle={(id) => act({ type: "hold", ids: state.dice.filter((d) => d.id === id ? !d.held : d.held).map((d) => d.id) })}
              onOrder={(ids) => act({ type: "order", ids })}
            />
            <div className="roll-area">
              <button className="primary roll-button" disabled={!active || state.rolls >= 3} onClick={() => act({ type: "roll" })}>
                <Dices size={20} />{state.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}<span>{3 - state.rolls}회 남음</span>
              </button>
              <p>{state.done ? "" : !state.rolls ? current + ": 주사위를 굴려 시작하세요" : state.rolls === 3 ? "점수판에서 기록할 점수를 선택하세요" : "클릭하여 고정 · 드래그하여 순서 변경"}</p>
            </div>
            {state.done && (
              <div className="game-result" role="status">
                <Trophy size={25} />
                <h2>{state.winners.length === 1 ? names[state.winners[0]] + " 승리!" : state.winners.map((i) => names[i]).join(" · ") + " 공동 우승!"}</h2>
                <p>{standings.map((s) => names[s.player] + " " + s.points + "점").join(" · ")}</p>
                <button className="primary" onClick={restart}>한 번 더 플레이 <ArrowRight size={16} /></button>
              </div>
            )}
          </section>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="keyboard-note">주사위 클릭: 고정 · Alt + 좌우 방향키: 순서 변경</div>
          {(count >= 9 || state.done) && <MultiStandings state={state} labels={names} />}
        </div>
        <div className="multi-scores">
          {count >= 9 && (
            <div className="multi-view-switch">
              <button className={!allScores ? "active" : ""} onClick={() => setAllScores(false)}>내 점수판</button>
              <button className={allScores ? "active" : ""} onClick={() => setAllScores(true)}>전체 점수표</button>
            </div>
          )}
          <MultiScoreboard state={state} labels={names} focused={count >= 9 && !allScores} select={active ? (category) => act({ type: "score", category }) : undefined} />
        </div>
      </div>
      {viewReplay && <MultiReplayViewer replay={viewReplay} onClose={() => setViewReplay(null)} />}
    </div>
  );
}
