import { useEffect, useRef, useState } from "react";
import {
  Menu,
  Home,
  UserRound,
  Bot,
  Trophy,
  FlaskConical,
  Dices,
  RotateCcw,
  ArrowRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  Download,
  X,
  ChevronRight,
  Check,
  LoaderCircle,
} from "lucide-react";
import {
  createGame,
  transition,
  total,
  categories,
  names,
  type Game,
  type Category,
} from "./engine";
import { algorithms, type Algorithm, type Decision } from "./ai";
import { type Match, type Result, statistics } from "./match";
import { runJob, createDecisionSession } from "./client";
import { Dice, DieIcon } from "./Dice";
import { Scoreboard, CategoryIcon } from "./Scoreboard";
import HomeDemo from "./HomeDemo";
import ReplayViewer, { type AnalysisSource } from "./ReplayViewer";
import {
  newReplay,
  appendFrame,
  replayFromMatch,
  branchReplay,
  downloadReplay,
  clone,
  type Replay,
} from "./replay";
import AlgorithmSelect from "./AlgorithmDropdown";
import { useHumanTurn } from "./human-turn";
import benchmark from "./benchmark-summary.json";
import dpManifest from "./dp-manifest.json";
const verifiedBest =
  benchmark.gamesPerAlgorithm >= 1000 &&
  benchmark.dpTableSha256 === dpManifest.sha256
    ? algorithms.find((a) => a === benchmark.bestAlgorithm)
    : undefined;
type Page = "home" | "play" | "watch" | "tournament" | "analysis";
const navigation = [
  { id: "home", name: "홈", icon: Home },
  { id: "play", name: "사람 vs AI", icon: UserRound },
  { id: "watch", name: "AI 대전 관전", icon: Bot },
  { id: "tournament", name: "AI 토너먼트", icon: Trophy },
  { id: "analysis", name: "전략 분석실", icon: FlaskConical },
] as const;
const currentPage = (): Page => {
  const id = location.hash.slice(1);
  return navigation.some((n) => n.id === id) ? (id as Page) : "home";
};
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function saveFile(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function NumberField({
  label,
  value,
  set,
  min = 0,
  max = 4294967295,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) =>
          set(
            Math.max(
              min,
              Math.min(max, Math.floor(Number(e.target.value) || 0)),
            ),
          )
        }
      />
    </label>
  );
}
function Thinking() {
  return (
    <span className="thinking">
      <LoaderCircle size={15} className="spin" /> AI가 계산하고 있습니다
    </span>
  );
}
function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="error">
      {message}
    </p>
  ) : null;
}
export default function App() {
  const [page, setPage] = useState<Page>(currentPage),
    [open, setOpen] = useState(() => window.innerWidth > 760),
    [replay, setReplay] = useState<Match | null>(null);
  const [arenaSource, setArenaSource] = useState<{
      replay: Replay;
      index: number;
    } | null>(null),
    [analysisSource, setAnalysisSource] = useState<AnalysisSource | null>(null);
  const branch = (r: Replay, index: number) => {
    setArenaSource({ replay: r, index });
    setReplay(null);
    navigate("watch");
  };
  const analyze = (source: AnalysisSource) => {
    setAnalysisSource(source);
    navigate("analysis");
  };
  useEffect(() => {
    const fn = () => setPage(currentPage());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  const navigate = (p: Page) => {
    location.hash = p;
    setPage(p);
    if (window.innerWidth <= 760) setOpen(false);
  };
  return (
    <div className={`app ${open ? "nav-open" : "nav-closed"}`}>
      <header className="topbar">
        <button
          className="icon-button"
          aria-label="메뉴 열기/닫기"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Menu size={22} />
        </button>
      </header>
      {open && (
        <button
          className="nav-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className="sidebar">
        <nav aria-label="주 메뉴">
          {navigation.map(({ id, name, icon: Icon }) => (
            <a
              href={`#${id}`}
              key={id}
              onClick={() => {
                if (id === "watch") {
                  setArenaSource(null);
                  setReplay(null);
                }
                if (id === "analysis") setAnalysisSource(null);
                navigate(id);
              }}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              title={name}
            >
              <Icon size={20} />
              <span>{name}</span>
              {page === id && <i />}
            </a>
          ))}
        </nav>
      </aside>
      <main className={`main page-${page}`}>
        {page === "home" && (
          <section className="hero">
            <div className="hero-intro">
              <h1>
                요트다이스를
                <br /> 플레이해보세요
              </h1>
              <div className="home-shortcuts">
                <a
                  href="#play"
                  className="primary"
                  onClick={() => navigate("play")}
                >
                  <Dices size={18} />
                  사람 vs AI
                </a>
                <a
                  href="#watch"
                  className="secondary"
                  onClick={() => navigate("watch")}
                >
                  <Bot size={18} />
                  AI vs AI
                </a>
              </div>
              <div className="hero-dice" aria-label="장식용 주사위 세 개">
                <DieIcon value={3} className="hero-die one" />
                <DieIcon value={5} className="hero-die two" />
                <DieIcon value={2} className="hero-die three" />
              </div>
            </div>
            <HomeDemo />
          </section>
        )}
        {page === "play" && <HumanGame onBranch={branch} onAnalyze={analyze} />}
        {page === "watch" && (
          <Spectator
            initial={replay}
            source={arenaSource}
            onBranch={branch}
            onAnalyze={analyze}
            clearInitial={() => setReplay(null)}
          />
        )}
        {page === "tournament" && (
          <Tournament
            openReplay={(match) => {
              setArenaSource(null);
              setReplay(match);
              navigate("watch");
            }}
          />
        )}
        {page === "analysis" && <Analysis initial={analysisSource} />}
      </main>
    </div>
  );
}
function HumanGame({
  onBranch,
  onAnalyze,
}: {
  onBranch: (r: Replay, index: number) => void;
  onAnalyze: (s: AnalysisSource) => void;
}) {
  const [state, setState] = useState(() => createGame(newSeed())),
    [algorithm, setAlgorithm] = useState<Algorithm>(verifiedBest ?? "Greedy"),
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
  const pausedRef = useRef(false);
  const record = useRef(
    newReplay(state, [
      { type: "human", name: "나" },
      { type: "ai", name: algorithm, algorithm },
    ]),
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
    [caption, setCaption] = useState("");
  const commit = (
    action: Parameters<typeof transition>[1],
    decision?: Decision,
  ) => {
    const before = stateRef.current;
    const updated = appendFrame(record.current, action, decision);
    record.current = updated;
    const next = updated.finalState;
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
    const fresh = createGame(newSeed());
    stateRef.current = fresh;
    record.current = newReplay(fresh, [
      { type: "human", name: "나" },
      { type: "ai", name: algorithm, algorithm },
    ]);
    setState(fresh);
    setAiTurn(0);
    setCaption("");
  };
  const can = state.player === 0 && !state.done && !busy;
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
              기보 보기
            </button>
            <div className="opponent-picker">
              <AlgorithmSelect
                label="상대 AI"
                value={algorithm}
                set={setAlgorithm}
                disabled={state.actions > 0}
              />
              {algorithm === verifiedBest && (
                <a
                  className="best-ai-label"
                  href="https://github.com/oyueo-mm/YachtLab/blob/main/benchmarks/REPORT.md"
                  target="_blank"
                  rel="noreferrer"
                  title={`${benchmark.gamesPerAlgorithm.toLocaleString("ko-KR")}경기 평균 총점 기준`}
                >
                  최고 성능 · 벤치마크 기준
                </a>
              )}
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
              <span>{algorithm}</span>
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
          <section className="game-board" aria-label="게임 보드">
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {state.done
                  ? "경기 종료"
                  : can
                    ? "나의 차례"
                    : `${algorithm}의 차례`}
              </span>
              <span>
                굴림 <b>{state.rolls}</b> / 3
              </span>
            </div>
            <Dice
              state={state}
              interactive={can}
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
        <Scoreboard
          state={state}
          select={can ? (c) => act({ type: "score", category: c }) : undefined}
        />
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
function DecisionView({ decision: d }: { decision: Decision }) {
  const probability = d.note.includes("정책 확률"),
    fullGame = d.note.startsWith("전체 게임 DP"),
    format = (value: number) =>
      probability ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
  return (
    <div className="decision-view">
      <strong>
        {d.type === "score"
          ? `${names[d.category]} 기록`
          : `${d.ids.length}개 고정, ${5 - d.ids.length}개 다시 굴리기`}
      </strong>
      <p>{d.note}</p>
      {d.candidates.length > 0 && (
        <>
          <div className="value-label">
            {fullGame
              ? "전체 게임 기대 최종점수"
              : probability
                ? "정책 확률"
                : d.note.includes("기댓점수") || d.note.includes("현재 얻는")
                  ? "점수 / 기댓점수"
                  : "근사 효용"}{" "}
            <b>{format(d.value)}</b>
          </div>
          <div className="candidates">
            {d.candidates.slice(0, 5).map((c, i) => (
              <div key={i}>
                <span>{names[c.label as Category] ?? c.label}</span>
                <strong>{format(c.value)}</strong>
                {fullGame && (
                  <small className="candidate-gap">
                    최선 대비 −{Math.max(0, d.value - c.value).toFixed(2)}
                  </small>
                )}
                {c.visits !== undefined && <small>{c.visits}회 방문</small>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function Spectator({
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
          기보 {source.index}수 · {branchState?.round}라운드 상태에서 이어갑니다. 양쪽 AI를 선택하세요.
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
function Tournament({ openReplay }: { openReplay: (m: Match) => void }) {
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
function Analysis({ initial }: { initial: AnalysisSource | null }) {
  const [values, setValues] = useState(initial?.state.dice.map(d => d.value) ?? [1, 2, 3, 4, 5]),
    [left, setLeft] = useState(initial ? 3-initial.state.rolls : 2),
    [card, setCard] = useState<Partial<Record<Category, number>>>(initial ? clone(initial.state.cards[initial.state.player]) : {}),
    [selected, setSelected] = useState<Algorithm[]>(["Greedy", "Expectimax"]),
    [seed, setSeed] = useState(42),
    [iterations, setIterations] = useState(1000),
    [answers, setAnswers] = useState<
      import("./strategy").Comparison["rows"]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [comparison, setComparison] = useState<import("./strategy").Comparison | null>(null);
  const [answerValues, setAnswerValues] = useState(values);
  const choiceLabel = (d: import("./dp").Choice) => d.type === "score" ? `${names[d.category]} 기록` : `고정 ${d.ids.map(id=>answerValues[id]).join("·") || "없음"} 후 재굴림`;
  const sourceUnchanged = !!initial && JSON.stringify(values) === JSON.stringify(initial.state.dice.map(d=>d.value)) && left === 3-initial.state.rolls && JSON.stringify(card) === JSON.stringify(initial.state.cards[initial.state.player]);
  const tasks = useRef<{ cancel: () => void }[]>([]),
    version = useRef(0);
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
    const state = sourceUnchanged ? clone(initial!.state) : {
      ...createGame(seed),
      rolls: 3 - left,
      cards: [card, {}] as Game["cards"],
      dice: values.map((value, id) => ({ id, value, held: false })),
    };
    try {
      setComparison(null);
      const job = runJob<import("./strategy").Comparison>({type:"compare", state, algorithms:selected, options:{iterations,seed}, actual:sourceUnchanged ? initial?.actual : undefined});
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
          {initial && <p className="small-note">{sourceUnchanged ? `기보의 실제 선택 · ${initial.label}` : "기보 상태를 수정한 가상 분석입니다."}</p>}
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
          {comparison && <section className="panel analysis-comparison">
            <h2>공통 DP 기준 비교</h2>
            <p>최선의 기대 최종점수 {comparison.best.toFixed(3)}점. 선택 후에는 DP 최적 정책을 따른다는 가정입니다.</p>
            <p>DP 최선: {choiceLabel(comparison.optimal)}</p>
            {comparison.actual && <p>기보의 실제 선택: {choiceLabel(comparison.actual.choice)} · {comparison.actual.q.toFixed(3)}점 · 최선 대비 손실 {comparison.actual.loss.toFixed(3)}점 · {comparison.actual.sameChoice ? "DP와 같은 선택" : "DP와 다른 선택"}</p>}
            <p className="small-note">단독 게임의 기대 총점 기준이며 상대 승률의 손실을 뜻하지 않습니다. 손실 0은 동가 최적 행동입니다. 아래 정책 확률·근사 효용은 AI 자체 지표입니다.</p>
            {comparison.rows.map((r,i)=><div className="comparison-row" key={r.algorithm}><span>{i+1}. {r.algorithm}</span><span>{choiceLabel(r.decision)}</span><meter aria-label={`${r.algorithm} DP 가치 손실`} min={0} max={Math.max(1,...comparison.rows.map(x=>x.loss))} value={r.loss}/><strong>{r.q.toFixed(2)}점</strong><span>손실 {r.loss.toFixed(3)}{r.loss<1e-6 ? " · 최적" : ""}</span></div>)}
            <details><summary>합법 행동의 DP 가치 순위</summary>{comparison.optimal.candidates.map((c,i)=><p key={i}>{i+1}. {names[c.label as Category] ?? c.label} · {c.value.toFixed(3)}점 · 손실 {Math.max(0,comparison.best-c.value).toFixed(3)}</p>)}</details>
          </section>}
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
              <p>DP 기대 최종점수 {q.toFixed(3)} · 최선 대비 손실 {loss.toFixed(3)}</p>
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
        </div>
      </div>
    </>
  );
}
