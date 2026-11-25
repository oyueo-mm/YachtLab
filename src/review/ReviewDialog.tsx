import { PlayerTag } from "../play/Looks";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dice } from "../Dice";
import { Scoreboard } from "../Scoreboard";
import { categories, createGame, score, total, transition, upper, type Game } from "../engine";
import { actionName, reviewModel, type Assessment, type Position, type ReviewEvent, type ReviewMatch, type Value } from "./model";
import { cachedReview, reviewKey, reviewSummaries, saveAnalysis } from "./cache";
import type { ReviewSource } from "./sources";
import "./review.css";

const fmt = (value: number) => value.toFixed(2);
const history = new Map<string, Assessment[]>();
const asGame = (position: Position): Game => ({ ...createGame(0), ...position });

export default function ReviewDialog({ source, close }: { source: ReviewSource; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return (
    <dialog ref={dialog} className="review-dialog" aria-labelledby="review-title" onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="review-heading">
        <h1 id="review-title">AI 복기</h1>
        <button type="button" className="icon-button" aria-label="복기 닫기" onClick={close}><X size={20} /></button>
      </div>
      {typeof source === "string" ? <p role="status">{source}</p> : <MatchAnalysis match={source} />}
    </dialog>
  );
}

function MatchAnalysis({ match }: { match: ReviewMatch }) {
  const cacheKey = useMemo(() => JSON.stringify([reviewModel.version, match.id, match.steps]), [match]);
  const [values, setValues] = useState(() => history.get(cacheKey) ?? null);
  const [selected, setSelected] = useState(0);
  const [participant, setParticipant] = useState<0 | 1>(() => match.steps[0]?.before.player ?? 0);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const [run, setRun] = useState(0);
  const [active, setActive] = useState(!values);
  const [alternative, setAlternative] = useState<string | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [localSummaries, setLocalSummaries] = useState<Awaited<ReturnType<typeof reviewSummaries>>>([]);
  useEffect(() => {
    if (match.device) void reviewSummaries().then(setLocalSummaries).catch(() => {});
  }, [match, values]);
  useEffect(() => {
    if (!active || values) return;
    let worker: Worker | null = null;
    let timer = 0;
    let cancelled = false;
    const fail = (message: string) => { setError(message); setActive(false); };
    const start = async () => {
      const key = match.device ? await reviewKey(match, cacheKey).catch(() => null) : null;
      const stored = key ? await cachedReview(key).catch(() => undefined) : undefined;
      if (cancelled) return;
      if (stored?.length === match.steps.length) {
        setValues(stored);
        setActive(false);
        return;
      }
      try {
        worker = new Worker(new URL("./review-worker.ts", import.meta.url), { type: "module" });
        timer = window.setTimeout(() => fail("분석 시간이 길어졌어요. 다른 탭을 닫고 다시 시도할 수 있어요."), 60_000);
        worker.onerror = () => fail("분석 작업이 중단됐어요. 다시 시도할 수 있어요.");
        worker.onmessage = ({ data }: MessageEvent<ReviewEvent>) => {
          if (data.type === "progress") setCompleted(data.completed);
          else if (data.type === "error") fail(data.message);
          else {
            if (history.size >= 10) history.delete(history.keys().next().value!);
            history.set(cacheKey, data.values);
            setValues(data.values);
            setActive(false);
            if (key) void saveAnalysis(key, match, data.values).then(reviewSummaries).then(setLocalSummaries).catch(() => {});
          }
        };
        worker.postMessage(match.steps);
      } catch {
        fail("기기에서 분석 작업을 시작할 수 없어요.");
      }
    };
    void start();
    return () => { cancelled = true; clearTimeout(timer); worker?.terminate(); };
  }, [active, cacheKey, match, run, values]);

  function select(index: number) {
    setSelected(index);
    setParticipant(match.steps[index].before.player);
    setAlternative(null);
    setQuiz(false);
  }

  if (!match.steps.length) return <p>분석할 확정 행동이 없어요.</p>;
  const step = match.steps[selected];
  const state = asGame(step.before);
  const result = values?.[selected];
  const rows = values?.filter((entry) => match.steps[entry.index].before.player === participant) ?? [];
  const biggest = [...rows].filter((entry) => entry.loss > 0).sort((a, b) => b.loss - a.loss).slice(0, 3);
  const previous = localSummaries.filter((item) => item.model === reviewModel.version && JSON.stringify(item.players) === JSON.stringify(match.players))
    .sort((a, b) => a.at - b.at);
  const turnRolls = rows.filter((entry) => entry.actual.action.type === "score").map((entry) => match.steps[entry.index].before.rolls);
  const bestWin = result?.options.reduce((best, option) => (option.winCredit ?? -1) > (best.winCredit ?? -1) ? option : best);
  const bonusGap = Math.max(0, 63 - upper(state.cards[state.player]));
  const average = rows.length ? rows.reduce((sum, entry) => sum + entry.loss, 0) / rows.length : 0;
  const chooseAlternative = (option: Value) => {
    if (quiz) {
      const gap = Math.max(0, result!.options[0].expected - option.expected);
      setAlternative(gap <= 1e-8 ? "최선과 같은 기대점수예요." : `최선보다 기대점수 ${fmt(gap)}점 차이가 있어요.`);
      return;
    }
    const isolated: Game = { ...state, rng: [crypto.getRandomValues(new Uint32Array(1))[0], crypto.getRandomValues(new Uint32Array(1))[0]] };
    if (option.action.type === "score") {
      const category = option.action.category;
      const scored = transition(isolated, { type: "score", category });
      setAlternative(`${actionName(option.action, step.before)} ${score(state.dice.map((die) => die.value), category)}점, 기록 후 총점 ${total(scored.cards[state.player])}점`);
    } else {
      const held = transition(isolated, { type: "hold", ids: option.action.ids });
      const rolled = transition(held, { type: "roll" });
      setAlternative(`가상 재굴림 결과 ${rolled.dice.map((die) => die.value).join(" · ")}`);
    }
  };

  return (
    <>
      <div className="review-match"><PlayerTag name={match.players[0]} look={match.looks?.[0]} />
        <strong>{match.scores[0]} : {match.scores[1]}</strong>
        <PlayerTag name={match.players[1]} look={match.looks?.[1]} /></div>
      <p>{match.winners.length === 2 ? "무승부" : match.winners.length ? `${match.players[match.winners[0]]} 승리` : "경기 종료"}</p>
      <p className="review-model">{reviewModel.name} · {reviewModel.version}</p>
      {active && <div className="review-loading">
        <progress value={completed} max={match.steps.length} aria-label="분석 진행률" />
        <span role="status">{completed} / {match.steps.length}</span>
        <button type="button" className="secondary" onClick={() => setActive(false)}>분석 취소</button>
      </div>}
      {!active && !values && <div className="review-loading">
        {error && <p role="alert">{error}</p>}
        <button type="button" className="secondary" onClick={() => { setError(""); setCompleted(0); setRun(run + 1); setActive(true); }}>분석 다시 시도</button>
      </div>}
      {values && <section className="review-summary" aria-label="경기 전체 분석">
        <label>플레이어 <select value={participant} onChange={(e) => {
          const seat = Number(e.target.value) as 0 | 1;
          const index = match.steps.findIndex((entry) => entry.before.player === seat);
          if (index !== -1) select(index);
        }}><option value={0}>{match.players[0]}</option><option value={1}>{match.players[1]}</option></select></label>
        <p>평균 결정 손실 {fmt(average)}점 · 정확도 {rows.length ? fmt(rows.filter((entry) => entry.loss === 0).length / rows.length * 100) + "%" : "—"} <small>최선과 동률인 선택 비율</small></p>
        {turnRolls.length > 0 && <p>점수를 기록할 때 평균 {fmt(turnRolls.reduce((a, b) => a + b, 0) / turnRolls.length)}회 굴림</p>}
        {previous.length >= 5 && <details>
          <summary>이 기기의 같은 대진에서 평균 결정 손실 변화</summary>
          <ol>{previous.map((entry) => <li key={entry.key}>{new Date(entry.at).toLocaleDateString("ko-KR")} · {entry.meanLoss[participant] === null ? "기록 없음" : fmt(entry.meanLoss[participant]!) + "점"}</li>)}</ol>
        </details>}
        <Chart rows={rows} selected={selected} change={select} label="기대점수 그래프" value={(entry) => entry.actual.expected} />
        <Chart rows={rows} selected={selected} change={select} label="종반 승리점수율 그래프" value={(entry) => entry.actual.winCredit === undefined ? undefined : entry.actual.winCredit * 100} />
        {!quiz && biggest.length > 0 && <div className="review-mistakes">
          <strong>가장 큰 기대점수 손실</strong>
          {biggest.map((entry) => <button type="button" className="text-button" key={entry.index} onClick={() => select(entry.index)}>
            {match.steps[entry.index].before.round}라운드 · {actionName(entry.actual.action, match.steps[entry.index].before)} · {fmt(entry.loss)}점
          </button>)}
        </div>}
      </section>}
      <div className="review-actions">
        <button type="button" className="secondary" disabled={selected === 0} onClick={() => select(selected - 1)}>이전 행동</button>
        <select aria-label="라운드와 행동" value={selected} onChange={(e) => select(Number(e.target.value))}>
          {match.steps.map((item, index) => <option value={index} key={index}>{item.before.round}라운드 · {match.players[item.before.player]} · {item.before.rolls}번째 굴림</option>)}
        </select>
        <button type="button" className="secondary" disabled={selected === match.steps.length - 1} onClick={() => select(selected + 1)}>다음 행동</button>
      </div>
      <div className="review-position">
        <div className="review-dice">
          <Dice state={state} />
          <p>{quiz ? "당시 점수판을 보고 선택해 보세요." : `실제 행동 · ${actionName(step.action, step.before)}`}</p>
          {!quiz && result && <>
            <p>기대점수 추천 · {actionName(result.options[0].action, step.before)} · {fmt(result.options[0].expected)}점</p>
            {bestWin?.winCredit !== undefined && <p>종반 승리점수율 추천 · {actionName(bestWin.action, step.before)} · {fmt(bestWin.winCredit * 100)}%</p>}
            <p>{result.loss === 0 ? "최선과 동률" : "기대점수 손실"} · 결정 손실 {fmt(result.loss)}점{result.luck === undefined ? "" : ` · 굴림 운 ${result.luck >= 0 ? "+" : ""}${fmt(result.luck)}점`}</p>
          </>}
          {result && !quiz && <p>상단 보너스까지 {bonusGap}점 · 남은 상단 칸 {categories.slice(0, 6).filter((category) => state.cards[state.player][category] === undefined).length}개</p>}
          <Scoreboard state={state} labels={match.players} />
        </div>
        {result && <div className="review-options">
          <h2>대안 행동</h2>
          <button type="button" className="secondary" onClick={() => { setQuiz(!quiz); setAlternative(null); }}>{quiz ? "분석으로 돌아가기" : "이 국면 복습하기"}</button>
          {alternative && <p role="status">{alternative}</p>}
          <ol>{(quiz ? [...result.options].sort((a, b) => actionName(a.action, step.before).localeCompare(actionName(b.action, step.before))) : result.options).map((option, i) =>
            <li key={i}><button type="button" className="text-button" onClick={() => chooseAlternative(option)}>{actionName(option.action, step.before)}</button>
              {!quiz && <span>{fmt(option.expected)}점{option.winCredit === undefined ? "" : ` · ${fmt(option.winCredit * 100)}%`}</span>}
            </li>)}</ol>
        </div>}
      </div>
      {!quiz && result?.distribution && <details className="review-distribution">
        <summary>최종 점수차 분포</summary>
        <p>양측이 남은 차례를 DP Expert 정책으로 플레이하는 종반 추정입니다. 승리 1점, 무승부 0.5점으로 계산합니다.</p>
        <ul>{result.distribution.map((entry) => <li key={entry.difference}><span>{entry.difference}점</span><meter value={entry.mass} max={1} />{fmt(entry.mass * 100)}%</li>)}</ul>
      </details>}
    </>
  );
}

function Chart({ rows, selected, change, label, value }: {
  rows: Assessment[]; selected: number; change: (index: number) => void;
  label: string; value: (entry: Assessment) => number | undefined;
}) {
  const points = rows.flatMap((entry) => {
    const score = value(entry);
    return score === undefined ? [] : [{ index: entry.index, score }];
  });
  if (!points.length) return <p>{label}를 계산할 수 있는 선택이 없어요.</p>;
  const min = Math.min(...points.map((point) => point.score));
  const max = Math.max(...points.map((point) => point.score));
  return <div role="group" aria-label={label}>
    <strong>{label}</strong>
    <div className="review-plot">
      {points.map((point) => <button type="button" key={point.index} onClick={() => change(point.index)}
        title={fmt(point.score)} aria-label={`${point.index + 1}번째 행동 ${fmt(point.score)}`} aria-pressed={selected === point.index}
        style={{ "--point": (point.score - min) / (max - min || 1) } as React.CSSProperties} />)}
    </div>
  </div>;
}
