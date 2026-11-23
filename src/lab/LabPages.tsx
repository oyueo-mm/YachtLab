import { useEffect, useRef, useState } from "react";
import { Bot, Trophy, FlaskConical, Play, Pause, SkipBack, SkipForward, ChevronsLeft, Download, X, ChevronRight, Check } from "lucide-react";
import { createGame, total, categories, names, type Game, type Category } from "../engine";
import { algorithms, type Algorithm } from "../ai";
import { type Match, type Result, statistics } from "../match";
import { runJob } from "../client";
import { Dice, DieIcon } from "../Dice";
import { Scoreboard, CategoryIcon } from "../Scoreboard";
import ResearchResults from "../ResearchResults";
import ReplayViewer, { type AnalysisSource } from "../ReplayViewer";
import { newReplay, replayFromMatch, branchReplay, downloadReplay, clone, type Replay } from "../replay";
import AlgorithmSelect from "../AlgorithmDropdown";
import { errorText, saveFile, NumberField, Thinking, ErrorMessage, DecisionView } from "../ui/common";

/**
 * Research lab (advanced) screens: AI spectating, tournament and strategy analysis.
 * Kept separate from the regular game modes and loaded lazily, so they can later be
 * offered as an optional tier without touching the game code. No gating is applied now.
 */
export function Spectator({
  initial,
  clearInitial,
  source,
  onBranch,
  onAnalyze,
}: {
  initial: Match | null;
  clearInitial: () => void;
  source: { replay: Replay; index: number } | null;
  onBranch: (r: Replay, index: number) => void;
  onAnalyze: (s: AnalysisSource) => void;
}) {
  const [a, setA] = useState<Algorithm>(initial?.algorithms[0] ?? "Greedy"),
    [b, setB] = useState<Algorithm>(initial?.algorithms[1] ?? "Expectimax"),
    [seed, setSeed] = useState(initial?.seed ?? 42),
    [iterations, setIterations] = useState(600),
    [match, setMatch] = useState<Match | null>(initial),
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState("1"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fullReplay, setFullReplay] = useState<Replay | null>(() =>
      initial ? replayFromMatch(initial) : null,
    ),
    [viewReplay, setViewReplay] = useState(false);
  const branchState = source?.replay.frames[source.index].state;
  const task = useRef<ReturnType<typeof runJob<Match>> | null>(null);
  useEffect(() => {
    if (!source) return;
    task.current?.cancel();
    setMatch(null);
    setFullReplay(null);
    setIndex(0);
    setPlaying(false);
    setViewReplay(false);
    setBusy(false);
  }, [source]);
  useEffect(() => {
    clearInitial();
    return () => task.current?.cancel();
  }, []);
  useEffect(() => {
    if (!playing || !match) return;
    if (index >= match.frames.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setIndex((i) => Math.min(match.frames.length - 1, i + 1)),
      speed === "instant" ? 0 : 700 / Number(speed),
    );
    if (speed === "instant") {
      clearTimeout(timer);
      setIndex(match.frames.length - 1);
      setPlaying(false);
    }
    return () => clearTimeout(timer);
  }, [playing, index, match, speed]);
  const start = async () => {
    setBusy(true);
    setPlaying(false);
    setError("");
    try {
      task.current = runJob<Match>({
        type: "match",
        algorithms: [a, b],
        seed,
        initialState: branchState,
        pendingRoll:
          source?.replay.frames[source.index].action?.type === "hold" &&
          !!branchState &&
          branchState.rolls < 3,
        options: { iterations },
      });
      const m = await task.current.promise;
      setMatch(m);
      setFullReplay(
        source
          ? branchReplay(source.replay, source.index, m)
          : replayFromMatch(m),
      );
      setIndex(0);
      setPlaying(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const state = match?.frames[index].state ?? branchState ?? createGame(seed),
    labels = match?.algorithms ?? [a, b],
    frame = match?.frames[index];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>AI 대전 관전</h1>
          <p>두 알고리즘의 선택을 한 수씩 살펴보세요.</p>
        </div>
        <Bot size={25} />
      </div>
      {source && (
        <p className="small-note">
          기보 {source.index}수 · {branchState?.round}라운드 상태에서
          이어갑니다. 양쪽 AI를 선택하세요.
        </p>
      )}
      <div className="config-bar panel">
        <AlgorithmSelect label="AI 1" value={a} set={setA} />
        <span className="versus">vs</span>
        <AlgorithmSelect label="AI 2" value={b} set={setB} />
        <NumberField label="난수 시드" value={seed} set={setSeed} />
        {(a === "MCTS" || b === "MCTS") && (
          <NumberField
            label="MCTS 시뮬레이션"
            value={iterations}
            set={setIterations}
            min={50}
            max={50000}
          />
        )}
        <button className="primary" disabled={busy} onClick={start}>
          <Play size={16} />
          {busy ? "경기 계산 중" : source ? "이 상태부터 시작" : "새 경기 시작"}
        </button>
        {busy && (
          <button
            className="text-button"
            onClick={() => task.current?.cancel()}
          >
            취소
          </button>
        )}
      </div>
      <button
        className="text-button"
        onClick={() => {
          setPlaying(false);
          setViewReplay(true);
        }}
      >
        기보 보기 · 저장 · 불러오기
      </button>
      <ErrorMessage message={error} />
      <div className="game-grid spectator">
        <div className="game-left">
          <div className="score-summary">
            <div className={state.player === 0 ? "selected" : ""}>
              <span>{labels[0]}</span>
              <strong>
                {total(state.cards[0])}
                <small>점</small>
              </strong>
            </div>
            <div className={state.player === 1 ? "selected" : ""}>
              <span>{labels[1]}</span>
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
          <section className="game-board">
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {state.done ? "경기 종료" : `${labels[state.player]}의 차례`}
              </span>
              <span>굴림 {state.rolls} / 3</span>
            </div>
            <Dice state={state} />
            <div className="action-caption" aria-live="polite">
              {busy ? (
                <Thinking />
              ) : match ? (
                `${labels[frame!.actor]} · ${frame!.label}${frame?.action?.type === "score" ? ` · ${names[frame.action.category]}` : ""}`
              ) : (
                "경기를 시작해보세요"
              )}
              {state.done && (
                <strong>
                  {state.winner === "draw"
                    ? "무승부"
                    : `${labels[state.winner!]} 승리`}
                </strong>
              )}
            </div>
          </section>
          <div className="playback panel">
            <div className="playback-buttons">
              <button
                className="icon-button"
                title="처음부터"
                aria-label="처음부터"
                disabled={!match}
                onClick={() => {
                  setIndex(0);
                  setPlaying(false);
                }}
              >
                <ChevronsLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="이전 행동"
                disabled={!match || index === 0}
                onClick={() => {
                  setPlaying(false);
                  setIndex((i) => i - 1);
                }}
              >
                <SkipBack size={18} />
              </button>
              <button
                className="primary circle"
                aria-label={playing ? "일시정지" : "재생"}
                disabled={!match}
                onClick={() => {
                  if (match && index === match.frames.length - 1) setIndex(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button
                className="icon-button"
                aria-label="다음 행동"
                disabled={!match || index >= match.frames.length - 1}
                onClick={() => {
                  setPlaying(false);
                  setIndex((i) => i + 1);
                }}
              >
                <SkipForward size={18} />
              </button>
              <select
                aria-label="재생 속도"
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
              >
                {["0.25", "0.5", "1", "2", "4", "8", "16"].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
                <option value="instant">즉시 완료</option>
              </select>
            </div>
            <input
              type="range"
              aria-label="리플레이 위치"
              min={0}
              max={match ? match.frames.length - 1 : 0}
              value={index}
              disabled={!match}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
            />
            <div className="playback-bottom">
              <span>
                행동 {index} / {match ? match.frames.length - 1 : 0}
              </span>
              <button
                className="text-button"
                disabled={!match}
                onClick={() => fullReplay && downloadReplay(fullReplay)}
              >
                <Download size={14} />
                리플레이 저장
              </button>
            </div>
          </div>
          {frame?.decision && (
            <details open className="decision-details">
              <summary>
                이 행동의 판단
                <ChevronRight size={14} />
              </summary>
              <DecisionView decision={frame.decision} />
            </details>
          )}
        </div>
        <Scoreboard state={state} labels={labels as [string, string]} />
      </div>
      {viewReplay && (
        <ReplayViewer
          replay={
            fullReplay ??
            source?.replay ??
            newReplay(createGame(seed), [
              { type: "ai", name: a, algorithm: a },
              { type: "ai", name: b, algorithm: b },
            ])
          }
          initialIndex={
            fullReplay && source
              ? source.index + index
              : (source?.index ?? index)
          }
          onClose={() => setViewReplay(false)}
          onBranch={onBranch}
          onAnalyze={onAnalyze}
        />
      )}
    </>
  );
}
export function Tournament({ openReplay }: { openReplay: (m: Match) => void }) {
  const [selected, setSelected] = useState<Algorithm[]>(["Random", "Greedy"]),
    [games, setGames] = useState(10),
    [seed, setSeed] = useState(42),
    [iterations, setIterations] = useState(300),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState<Result[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("yachtlab-results") ?? "[]");
      } catch {
        return [];
      }
    }),
    [error, setError] = useState(""),
    [replaying, setReplaying] = useState(false);
  const task = useRef<{ cancel: () => void } | null>(null),
    replayTask = useRef<{ cancel: () => void } | null>(null);
  const [runConfig, setRunConfig] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("yachtlab-config") ?? '{"iterations":300}',
      );
    } catch {
      return { iterations: 300 };
    }
  });
  useEffect(
    () => () => {
      task.current?.cancel();
      replayTask.current?.cancel();
    },
    [],
  );
  const start = async () => {
    setBusy(true);
    setProgress(0);
    setResults([]);
    setError("");
    const config = { iterations };
    setRunConfig(config);
    localStorage.setItem("yachtlab-config", JSON.stringify(config));
    try {
      const job = runJob<Result[]>(
        {
          type: "tournament",
          algorithms: selected,
          games,
          seed,
          options: config,
        },
        (p, r) => {
          setProgress(p);
          setResults(r as Result[]);
          localStorage.setItem("yachtlab-results", JSON.stringify(r));
        },
      );
      task.current = job;
      await job.promise;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const replay = async (r: Result) => {
    setReplaying(true);
    setError("");
    try {
      const job = runJob<Match>({
        type: "match",
        algorithms: r.algorithms,
        seed: r.seed,
        options: runConfig,
      });
      replayTask.current = job;
      openReplay(await job.promise);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReplaying(false);
    }
  };
  const participants = [...new Set(results.flatMap((r) => r.algorithms))];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>AI 토너먼트</h1>
          <p>같은 조건에서 반복하고, 실제 결과로 비교하세요.</p>
        </div>
        <Trophy size={25} />
      </div>
      <section className="panel tournament-config">
        <div className="field">
          참가 알고리즘
          <div className="algorithm-pills">
            {algorithms.map((a) => (
              <label key={a} className={selected.includes(a) ? "chosen" : ""}>
                <input
                  type="checkbox"
                  checked={selected.includes(a)}
                  disabled={busy}
                  onChange={() =>
                    setSelected((s) =>
                      s.includes(a) ? s.filter((x) => x !== a) : [...s, a],
                    )
                  }
                />
                {selected.includes(a) ? (
                  <Check size={15} />
                ) : (
                  <span className="check-placeholder" />
                )}
                {a}
              </label>
            ))}
            <span className="disabled-pill">PPO는 초기 학습 모델입니다</span>
          </div>
        </div>
        <div className="config-bar">
          <NumberField
            label="조합별 경기 수"
            value={games}
            set={setGames}
            min={1}
            max={500}
          />
          <NumberField label="난수 시드" value={seed} set={setSeed} />
          {selected.includes("MCTS") && (
            <NumberField
              label="MCTS 시뮬레이션"
              value={iterations}
              set={setIterations}
              min={50}
              max={50000}
            />
          )}
          <button
            className="primary"
            onClick={start}
            disabled={busy || selected.length < 2}
          >
            <Play size={16} />
            토너먼트 시작
          </button>
          {busy && (
            <button
              className="secondary"
              onClick={() => task.current?.cancel()}
            >
              <X size={15} />
              중단
            </button>
          )}
        </div>
        <p className="small-note">
          선택한 AI의 모든 두 조합이 대결합니다. 양측은 동일한 초기 난수 시드를
          사용하며 경기마다 선후공을 바꿉니다. 무승부는 0.5승으로 계산합니다.
        </p>
        {(busy || progress > 0) && (
          <div className="progress-row">
            <progress max={1} value={progress} />
            <span>
              {Math.round(progress * 100)}% · {results.length}경기
            </span>
          </div>
        )}
      </section>
      <ErrorMessage message={error} />
      {results.length === 0 ? (
        <div className="empty-state">
          <Trophy size={32} />
          <h2>아직 경기 결과가 없습니다</h2>
          <p>참가할 AI를 선택하고 토너먼트를 시작하세요.</p>
        </div>
      ) : (
        <>
          <div className="section-heading">
            <h2>
              실험 결과 <small>{results.length}경기</small>
            </h2>
            <button
              className="text-button"
              onClick={() =>
                saveFile(
                  { results, options: runConfig },
                  "yachtlab-tournament.json",
                )
              }
            >
              <Download size={15} />
              결과 저장
            </button>
          </div>
          <div className="stats-chart panel" aria-label="평균 점수 그래프">
            {participants.map((a) => {
              const s = statistics(results, a)!;
              return (
                <div className="chart-row" key={a} data-algorithm={a}>
                  <span>{a}</span>
                  <div>
                    <i style={{ width: `${(s.mean / 323) * 100}%` }} />
                  </div>
                  <strong>{s.mean.toFixed(1)}</strong>
                </div>
              );
            })}
            <p>평균 최종 점수 · 가로축 0~323점</p>
          </div>
          <div className="table-scroll panel">
            <table className="stats-table">
              <thead>
                <tr>
                  {[
                    "알고리즘",
                    "경기",
                    "평균",
                    "중앙값",
                    "최저 / 최고",
                    "표준편차",
                    "승률",
                    "요트 달성률",
                    "보너스 달성률",
                    "판단 시간 / 경기",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {participants.map((a) => {
                  const s = statistics(results, a)!;
                  return (
                    <tr key={a}>
                      <th>{a}</th>
                      <td>{s.n}</td>
                      <td>{s.mean.toFixed(1)}</td>
                      <td>{s.median.toFixed(1)}</td>
                      <td>
                        {s.min} / {s.max}
                      </td>
                      <td>{s.sd.toFixed(1)}</td>
                      <td>{(s.win * 100).toFixed(1)}%</td>
                      <td>{(s.yacht * 100).toFixed(1)}%</td>
                      <td>{(s.bonus * 100).toFixed(1)}%</td>
                      <td>{s.ms.toFixed(0)}ms</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="section-heading">
            <h2>경기 기록</h2>
            <span className="small-note">시드로 동일한 행동을 재현합니다</span>
          </div>
          <div className="match-list panel">
            {results.map((r, i) => (
              <div key={i}>
                <span className="match-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  {r.algorithms[0]} <b>{r.scores[0]}</b>
                </span>
                <span className="versus">:</span>
                <span>
                  <b>{r.scores[1]}</b> {r.algorithms[1]}
                </span>
                <span className="small-note">시드 {r.seed}</span>
                <button
                  className="text-button"
                  disabled={busy || replaying}
                  onClick={() => replay(r)}
                >
                  리플레이
                  <ChevronRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
export function Analysis({ initial }: { initial: AnalysisSource | null }) {
  const [values, setValues] = useState(
      initial?.state.dice.map((d) => d.value) ?? [1, 2, 3, 4, 5],
    ),
    [left, setLeft] = useState(initial ? 3 - initial.state.rolls : 2),
    [card, setCard] = useState<Partial<Record<Category, number>>>(
      initial ? clone(initial.state.cards[initial.state.player]) : {},
    ),
    [selected, setSelected] = useState<Algorithm[]>(["Greedy", "Expectimax"]),
    [seed, setSeed] = useState(42),
    [iterations, setIterations] = useState(1000),
    [answers, setAnswers] = useState<import("../strategy").Comparison["rows"]>(
      [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [comparison, setComparison] = useState<
    import("../strategy").Comparison | null
  >(null);
  const [answerValues, setAnswerValues] = useState(values);
  const choiceLabel = (d: import("../dp").Choice) =>
    d.type === "score"
      ? `${names[d.category]} 기록`
      : `고정 ${d.ids.map((id) => answerValues[id]).join("·") || "없음"} 후 재굴림`;
  const sourceUnchanged =
    !!initial &&
    JSON.stringify(values) ===
      JSON.stringify(initial.state.dice.map((d) => d.value)) &&
    left === 3 - initial.state.rolls &&
    JSON.stringify(card) ===
      JSON.stringify(initial.state.cards[initial.state.player]);
  const tasks = useRef<{ cancel: () => void }[]>([]),
    version = useRef(0);
  useEffect(() => {
    version.current++;
    tasks.current.forEach((t) => t.cancel());
    tasks.current = [];
    setBusy(false);
    setAnswers([]);
    setComparison(null);
  }, [values, left, card, seed, iterations, selected]);
  useEffect(
    () => () => {
      version.current++;
      tasks.current.forEach((t) => t.cancel());
    },
    [],
  );
  const analyze = async () => {
    setBusy(true);
    setAnswers([]);
    setError("");
    const v = ++version.current;
    const state = sourceUnchanged
      ? clone(initial!.state)
      : {
          ...createGame(seed),
          rolls: 3 - left,
          cards: [card, {}] as Game["cards"],
          dice: values.map((value, id) => ({ id, value, held: false })),
        };
    try {
      setComparison(null);
      const job = runJob<import("../strategy").Comparison>({
        type: "compare",
        state,
        algorithms: selected,
        options: { iterations, seed },
        actual: sourceUnchanged ? initial?.actual : undefined,
      });
      tasks.current.push(job);
      const result = await job.promise;
      if (v !== version.current) return;
      setAnswers(result.rows);
      setComparison(result);
      setAnswerValues([...values]);
    } catch (e) {
      if (v === version.current) setError(errorText(e));
    } finally {
      if (v === version.current) setBusy(false);
      tasks.current = [];
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>전략 분석실</h1>
          <p>같은 주사위, 서로 다른 선택. 알고리즘의 판단을 비교해보세요.</p>
        </div>
        <FlaskConical size={25} />
      </div>
      <div className="analysis-grid">
        <section className="panel analysis-input">
          <h2>분석할 상태</h2>
          {initial && (
            <p className="small-note">
              {sourceUnchanged
                ? `기보의 실제 선택 · ${initial.label}`
                : "기보 상태를 수정한 가상 분석입니다."}
            </p>
          )}
          <div className="analysis-dice">
            {values.map((value, i) => (
              <label key={i}>
                <DieIcon value={value} />
                <select
                  aria-label={`분석 주사위 ${i + 1}`}
                  value={value}
                  disabled={busy}
                  onChange={(e) =>
                    setValues((v) =>
                      v.map((n, j) => (j === i ? Number(e.target.value) : n)),
                    )
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="config-bar">
            <NumberField
              label="남은 굴림"
              value={left}
              set={setLeft}
              min={0}
              max={2}
            />
            <NumberField label="난수 시드" value={seed} set={setSeed} />
            <NumberField
              label="MCTS 시뮬레이션"
              value={iterations}
              set={setIterations}
              min={50}
              max={50000}
            />
          </div>
          <h3>이미 기록한 점수</h3>
          <p className="small-note">
            체크한 카테고리는 사용한 칸으로 처리합니다.
          </p>
          <div className="used-categories">
            {categories.map((c) => (
              <div key={c}>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={card[c] !== undefined}
                    onChange={(e) =>
                      setCard((old) => {
                        const next = { ...old };
                        if (e.target.checked) next[c] = 0;
                        else delete next[c];
                        return next;
                      })
                    }
                  />
                  <CategoryIcon category={c} />
                  {names[c]}
                </label>
                {card[c] !== undefined && (
                  <input
                    type="number"
                    aria-label={`${names[c]} 기록 점수`}
                    min={0}
                    max={c === "yacht" ? 50 : 30}
                    value={card[c]}
                    onChange={(e) =>
                      setCard((old) => ({
                        ...old,
                        [c]: Math.max(
                          0,
                          Math.min(
                            c === "yacht" ? 50 : 30,
                            Math.floor(Number(e.target.value) || 0),
                          ),
                        ),
                      }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <div className="analysis-total">
            현재 총점 <strong>{total(card)}점</strong>
          </div>
        </section>
        <div>
          <section className="panel analysis-options">
            <h2>알고리즘 선택</h2>
            <div className="algorithm-pills">
              {algorithms.map((a) => (
                <label key={a} className={selected.includes(a) ? "chosen" : ""}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(a)}
                    onChange={() =>
                      setSelected((s) =>
                        s.includes(a) ? s.filter((x) => x !== a) : [...s, a],
                      )
                    }
                  />
                  {a}
                </label>
              ))}
            </div>
            <button
              className="primary"
              onClick={analyze}
              disabled={
                busy ||
                !selected.length ||
                categories.every((c) => card[c] !== undefined)
              }
            >
              <FlaskConical size={17} />
              {busy ? "분석 중" : "전략 비교하기"}
            </button>
            {busy && (
              <button
                className="text-button"
                onClick={() => tasks.current.forEach((t) => t.cancel())}
              >
                취소
              </button>
            )}
            <p className="small-note">
              Expectimax는 남은 굴림의 모든 결과를 확률로 합산합니다. 기회비용과
              상단 보너스를 반영한 근사 효용이며 최종 경기 점수 예측값은
              아닙니다.
            </p>
          </section>
          <ErrorMessage message={error} />
          {comparison && (
            <section className="panel analysis-comparison">
              <h2>공통 DP 기준 비교</h2>
              <p>
                최선의 기대 최종점수 {comparison.best.toFixed(3)}점. 선택 후에는
                DP 최적 정책을 따른다는 가정입니다.
              </p>
              <p>DP 최선: {choiceLabel(comparison.optimal)}</p>
              {comparison.actual && (
                <p>
                  기보의 실제 선택: {choiceLabel(comparison.actual.choice)} ·{" "}
                  {comparison.actual.q.toFixed(3)}점 · 최선 대비 손실{" "}
                  {comparison.actual.loss.toFixed(3)}점 ·{" "}
                  {comparison.actual.sameChoice
                    ? "DP와 같은 선택"
                    : "DP와 다른 선택"}
                </p>
              )}
              <p className="small-note">
                단독 게임의 기대 총점 기준이며 상대 승률의 손실을 뜻하지
                않습니다. 손실 0은 동가 최적 행동입니다. 아래 정책 확률·근사
                효용은 AI 자체 지표입니다.
              </p>
              {comparison.rows.map((r, i) => (
                <div className="comparison-row" key={r.algorithm}>
                  <span>
                    {i + 1}. {r.algorithm}
                  </span>
                  <span>{choiceLabel(r.decision)}</span>
                  <meter
                    aria-label={`${r.algorithm} DP 가치 손실`}
                    min={0}
                    max={Math.max(1, ...comparison.rows.map((x) => x.loss))}
                    value={r.loss}
                  />
                  <strong>{r.q.toFixed(2)}점</strong>
                  <span>
                    손실 {r.loss.toFixed(3)}
                    {r.loss < 1e-6 ? " · 최적" : ""}
                  </span>
                </div>
              ))}
              <details>
                <summary>합법 행동의 DP 가치 순위</summary>
                {comparison.optimal.candidates.map((c, i) => (
                  <p key={i}>
                    {i + 1}. {names[c.label as Category] ?? c.label} ·{" "}
                    {c.value.toFixed(3)}점 · 손실{" "}
                    {Math.max(0, comparison.best - c.value).toFixed(3)}
                  </p>
                ))}
              </details>
            </section>
          )}
          {answers.map(({ algorithm, decision, ms, q, loss }) => (
            <section
              className="panel analysis-answer"
              key={algorithm}
              data-algorithm={algorithm}
            >
              <div className="section-heading">
                <h2>{algorithm}</h2>
                <span>{ms.toFixed(1)}ms · 판단 연산</span>
              </div>
              <p>
                DP 기대 최종점수 {q.toFixed(3)} · 최선 대비 손실{" "}
                {loss.toFixed(3)}
              </p>
              <div className="recommended-dice">
                {answerValues.map((value, id) => (
                  <div
                    key={id}
                    className={
                      decision.type === "reroll" && decision.ids.includes(id)
                        ? "keep"
                        : ""
                    }
                  >
                    <DieIcon value={value} />
                    <span>
                      {decision.type === "score"
                        ? "기록"
                        : decision.ids.includes(id)
                          ? "고정"
                          : "재굴림"}
                    </span>
                  </div>
                ))}
              </div>
              <DecisionView decision={decision} />
            </section>
          ))}
          <ResearchResults />
        </div>
      </div>
    </>
  );
}

