import { useRef, useState } from "react";
import { ArrowRight, Dices, RotateCcw, Trophy } from "lucide-react";
import { Dice } from "./Dice";
import { Scoreboard } from "./Scoreboard";
import { createGame, total, type Action, type Game } from "./engine";
import { appendFrame, clone, newReplay, type Player, type Replay } from "./replay";
import ReplayViewer, { type AnalysisSource } from "./ReplayViewer";

type Labels = [string, string];
const createSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const players = (labels: Labels): [Player, Player] => [
  { type: "human", name: labels[0].trim() || "플레이어 1" },
  { type: "human", name: labels[1].trim() || "플레이어 2" },
];
const playerName = (labels: Labels, index: 0 | 1) =>
  labels[index].trim() || `플레이어 ${index + 1}`;

export default function LocalGame({
  onBranch,
  onAnalyze,
}: {
  onBranch: (replay: Replay, index: number) => void;
  onAnalyze: (source: AnalysisSource) => void;
}) {
  const [state, setState] = useState<Game>(() => createGame(createSeed()));
  const [labels, setLabels] = useState<Labels>(["플레이어 1", "플레이어 2"]);
  const [error, setError] = useState("");
  const [viewReplay, setViewReplay] = useState<Replay | null>(null);
  const record = useRef<Replay | null>(null);
  if (!record.current) record.current = newReplay(state, players(labels), "사람 vs 사람");

  const rename = (index: 0 | 1, name: string) => {
    if (state.actions > 0) return;
    const next: Labels = [...labels];
    next[index] = name;
    setLabels(next);
    record.current = newReplay(state, players(next), "사람 vs 사람");
  };
  const act = (action: Action) => {
    if (viewReplay || state.done) return;
    try {
      const next = appendFrame(record.current!, action);
      record.current = next;
      setState(next.finalState);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const restart = () => {
    const next = createGame(createSeed());
    record.current = newReplay(next, players(labels), "사람 vs 사람");
    setState(next);
    setError("");
    setViewReplay(null);
  };
  const active = !state.done && !viewReplay;
  const current = playerName(labels, state.player);

  return (
    <>
      <div className="game-grid">
        <div className="game-left">
          <div className="game-tools pvp-tools">
            <div className="pvp-name-fields">
              {([0, 1] as const).map((index) => (
                <label key={index}>
                  <span>P{index + 1}</span>
                  <input
                    aria-label={`플레이어 ${index + 1} 이름`}
                    value={labels[index]}
                    onChange={(e) => rename(index, e.target.value)}
                    maxLength={24}
                    disabled={state.actions > 0}
                  />
                </label>
              ))}
            </div>
            <div className="pvp-actions">
              <button
                className="text-button"
                onClick={() => setViewReplay(clone(record.current!))}
              >
                기보 보기
              </button>
              <button className="text-button" onClick={restart}>
                <RotateCcw size={15} />
                재대결
              </button>
            </div>
          </div>
          <div className="score-summary">
            {([0, 1] as const).map((index) => (
              <div key={index} className={!state.done && state.player === index ? "selected" : ""}>
                <span>{playerName(labels, index)}</span>
                <strong>
                  {total(state.cards[index])}
                  <small>점</small>
                </strong>
              </div>
            ))}
            <div className="round">
              <span>라운드</span>
              <strong>{state.round}<small>/ 12</small></strong>
            </div>
          </div>
          <section className="game-board" aria-label="사람 vs 사람 게임 보드">
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {state.done ? "경기 종료" : `${current}의 차례`}
              </span>
              <span>굴림 <b>{state.rolls}</b> / 3</span>
            </div>
            <Dice
              state={state}
              interactive={active}
              onToggle={(id) =>
                act({
                  type: "hold",
                  ids: state.dice
                    .filter((die) => (die.id === id ? !die.held : die.held))
                    .map((die) => die.id),
                })
              }
              onOrder={(ids) => act({ type: "order", ids })}
            />
            <div className="roll-area">
              <button
                className="primary roll-button"
                disabled={!active || state.rolls >= 3}
                onClick={() => act({ type: "roll" })}
              >
                <Dices size={20} />
                {state.rolls === 0 ? "주사위 굴리기" : "다시 굴리기"}
                <span>{3 - state.rolls}회 남음</span>
              </button>
              <p>
                {state.done
                  ? ""
                  : !state.rolls
                    ? `${current}: 주사위를 굴려 시작하세요`
                    : state.rolls === 3
                      ? "점수판에서 기록할 점수를 선택하세요"
                      : "클릭하여 고정 · 드래그하여 순서 변경"}
              </p>
            </div>
            {state.done && (
              <div className="game-result" role="status">
                <Trophy size={25} />
                <h2>
                  {state.winner === "draw"
                    ? "무승부입니다"
                    : `${playerName(labels, state.winner!)} 승리!`}
                </h2>
                <p>{total(state.cards[0])} : {total(state.cards[1])}</p>
                <button className="primary" onClick={restart}>
                  한 번 더 플레이 <ArrowRight size={16} />
                </button>
              </div>
            )}
          </section>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="keyboard-note">
            키보드로 순서 변경: 주사위에 초점을 두고 Alt + 좌우 방향키
          </div>
        </div>
        <Scoreboard
          state={state}
          labels={[playerName(labels, 0), playerName(labels, 1)]}
          selectPlayer={state.player}
          select={active ? (category) => act({ type: "score", category }) : undefined}
        />
      </div>
      {viewReplay && (
        <ReplayViewer
          replay={viewReplay}
          onClose={() => setViewReplay(null)}
          onBranch={onBranch}
          onAnalyze={onAnalyze}
        />
      )}
    </>
  );
}
