import { PlayerTag } from "../play/Looks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReviewShortcuts } from "../ui/shortcuts";
import { useBgmScene } from "../audio/useBgm";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { DieIcon } from "../Dice";
import { accuracy, grade, grades, winLoss } from "./quality";
import { metrics, ReviewChart, type Metric } from "./ReviewChart";
import { categories, createGame, names, score, total, transition, upper, type Game } from "../engine";
import { actionName, productReviewModel, reviewModel, type Assessment, type Position, type ReviewEvent, type ReviewMatch, type Value } from "./model";
import { cachedReview, reviewKey, reviewSummaries, saveAnalysis } from "./cache";
import type { ReviewSource } from "./sources";
import { v5TrialEnabled } from "../product-ai/models";
import { reviewV5 } from "../product-ai/worker-client";
import "./review.css";

const fmt = (value: number) => value.toFixed(2);
const history = new Map<string, Assessment[]>();
const asGame = (position: Position): Game => ({ ...createGame(0), ...position });

export default function ReviewPage({ source, close }: { source: ReviewSource; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useBgmScene("review", 2);
  useEffect(() => {
    const previous = document.activeElement;
    const surface = dialog.current;
    surface?.showModal();
    return () => {
      surface?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="review-page" aria-labelledby="review-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <main className="review-content">
        <header className="review-heading">
          <button type="button" className="secondary" onClick={close}><ArrowLeft size={18} /> 돌아가기</button>
          <h1 id="review-title">게임 리뷰</h1>
        </header>
        {typeof source === "string" ? <p role="status">{source}</p> : <MatchAnalysis match={source} />}
      </main>
    </dialog>
  );
}

function MatchAnalysis({ match }: { match: ReviewMatch }) {
  const [analysisModel, setAnalysisModel] = useState(() =>
    v5TrialEnabled() && match.steps.some(({ before }) => !before.simultaneous) ? productReviewModel : reviewModel);
  const cacheKey = useMemo(() => JSON.stringify([analysisModel.version, match.id, match.steps]), [analysisModel, match]);
  const [values, setValues] = useState(() => history.get(cacheKey) ?? null);
  const [selected, setSelected] = useState(0);
  const [detailed, setDetailed] = useState(false);
  const [basicSeat, setBasicSeat] = useState<0 | 1>(() => match.me ?? match.steps[0]?.before.player ?? 0);
  // Seat colours (D-060): me red, opponent blue; without a known seat, seat 0 red / seat 1 blue.
  const tone = (seat: number) => (match.me === undefined ? (seat === 0 ? "me" : "opp") : seat === match.me ? "me" : "opp");
  const [participant, setParticipant] = useState<0 | 1>(() => match.steps[0]?.before.player ?? 0);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const [run, setRun] = useState(0);
  const [active, setActive] = useState(!values);
  const [alternative, setAlternative] = useState<string | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [metric, setMetric] = useState<Metric>(() => analysisModel === productReviewModel ? "win" : "score");
  const [preparing, setPreparing] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState(false);
  const [localSummaries, setLocalSummaries] = useState<Awaited<ReturnType<typeof reviewSummaries>>>([]);
  useEffect(() => {
    if (match.device) void reviewSummaries().then(setLocalSummaries).catch(() => {});
  }, [match, values]);
  useEffect(() => {
    if (!active || values) return;
    const controller = new AbortController();
    const { signal } = controller;
    let worker: Worker | null = null;
    let timer = 0;
    const fail = (message: string) => { setError(message); setActive(false); };
    const start = async () => {
      const key = match.device ? await reviewKey(match, cacheKey, analysisModel.version).catch(() => null) : null;
      const stored = history.get(cacheKey) ?? (key ? await cachedReview(key).catch(() => undefined) : undefined);
      if (signal.aborted) return;
      const done = (result: Assessment[]) => {
        if (signal.aborted) return;
        if (history.size >= 10) history.delete(history.keys().next().value!);
        history.set(cacheKey, result);
        setValues(result);
        setActive(false);
        if (key && !stored) {
          void saveAnalysis(key, match, result, analysisModel.version).then(reviewSummaries).then(setLocalSummaries).catch(() => {});
        }
      };
      if (stored?.length === match.steps.length) {
        done(stored);
        return;
      }
      if (analysisModel === productReviewModel) {
        try {
          const result = await reviewV5(match.steps, (message) => {
            if ("phase" in message) setPreparing(true);
            else { setPreparing(false); setCompleted(message.completed); }
          }, signal);
          done(result.values);
        } catch {
          if (signal.aborted) return;
          setFallbackNotice(true);
          setPreparing(false);
          setCompleted(0);
          setMetric("score");
          setAnalysisModel(reviewModel);
        }
        return;
      }
      try {
        worker = new Worker(new URL("./review-worker.ts", import.meta.url), { type: "module" });
        timer = window.setTimeout(() => fail("분석 시간이 길어졌어요. 다른 탭을 닫고 다시 시도할 수 있어요."), 60_000);
        worker.onerror = () => fail("분석 작업이 중단됐어요. 다시 시도할 수 있어요.");
        worker.onmessage = ({ data }: MessageEvent<ReviewEvent>) => {
          if (data.type === "progress") setCompleted(data.completed);
          else if (data.type === "error") fail(data.message);
          else done(data.values);
        };
        worker.postMessage(match.steps);
      } catch {
        fail("기기에서 분석 작업을 시작할 수 없어요.");
      }
    };
    void start();
    return () => { controller.abort(); clearTimeout(timer); worker?.terminate(); };
  }, [active, analysisModel, cacheKey, match, run, values]);

  function select(index: number) {
    setSelected(index);
    setParticipant(match.steps[index].before.player);
    setAlternative(null);
    setQuiz(false);
  }

  useEffect(() => {
    if (!playing || selected === match.steps.length - 1) return;
    const timer = window.setTimeout(() => {
      const next = selected + 1;
      setSelected(next);
      setParticipant(match.steps[next].before.player);
      setAlternative(null);
      setQuiz(false);
      if (next === match.steps.length - 1) setPlaying(false);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [match, playing, selected]);

  const lastStep = Math.max(0, match.steps.length - 1);
  useReviewShortcuts({
    prev: () => { setPlaying(false); if (match.steps.length) select(Math.max(0, selected - 1)); },
    next: () => { setPlaying(false); if (match.steps.length) select(Math.min(lastStep, selected + 1)); },
    first: () => { setPlaying(false); if (match.steps.length) select(0); },
    last: () => { setPlaying(false); if (match.steps.length) select(lastStep); },
    toggle: () => {
      if (match.steps.length < 2) return;
      if (!playing && selected === lastStep) select(0);
      setPlaying(!playing);
    },
  }, !quiz);
  if (!match.steps.length) return <p>분석할 확정 행동이 없어요.</p>;
  const step = match.steps[selected];
  const state = asGame(step.before);
  const result = values?.[selected];
  const rows = values?.filter((entry) => match.steps[entry.index].before.player === participant) ?? [];
  const biggest = [...rows].filter((entry) => ["?!", "?", "??"].includes(grade(entry)))
    .sort((a, b) => relativeLoss(b) - relativeLoss(a)).slice(0, 3);
  const highlights = values?.filter(({ index }) => match.steps[index].before.player === basicSeat) ?? [];
  const mistakes = [...highlights].filter((row) => ["?!", "?", "??"].includes(grade(row)))
    .sort((a, b) => relativeLoss(b) - relativeLoss(a)).slice(0, 2);
  const good = [...highlights].filter((row) => ["!!", "!", "★", "✓"].includes(grade(row)))
    .sort((a, b) => (b.options.length > 1 ? 1 : 0) - (a.options.length > 1 ? 1 : 0) || relativeLoss(a) - relativeLoss(b))[0];
  const previous = localSummaries.filter((item) => item.model === analysisModel.version && JSON.stringify(item.players) === JSON.stringify(match.players))
    .sort((a, b) => a.at - b.at);
  const recommendation = result?.options.reduce((best, option) => (option.winCredit ?? -1) > (best.winCredit ?? -1) ? option : best);
  const rounds = [...new Set(match.steps.map(({ before }) => before.round))];
  const scoreLoss = result?.loss;
  const winGap = result && winLoss(result);
  const availableMetrics = Object.keys(metrics) as Metric[];
  const move = (index: number) => { setPlaying(false); select(index); };
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

  const openDetail = (index: number, retry = false) => {
    move(index);
    setQuiz(retry);
    setDetailed(true);
  };
  const highlight = (entry: Assessment) => {
    const { before, action } = match.steps[entry.index];
    const position = asGame(before);
    const recommendation = entry.options.reduce((best, option) =>
      (option.winCredit ?? -1) > (best.winCredit ?? -1) ? option : best);
    const gap = winLoss(entry);
    const explanation = gap === undefined
      ? `추천대로 하면 남은 경기에서 평균 ${fmt(entry.loss)}점 차이가 날 것으로 계산했어요.`
      : `추천 선택의 ${entry.exactness === "exact" ? "종반" : "추정"} 승리점수율이 ${fmt(gap)}%p 높아요.`;
    return <article className="review-highlight" key={entry.index}>
      <h3>{before.round}라운드 <GradeMark row={entry} /></h3>
      <div className="review-choices">
        <ChoiceDice label="실제 선택" choice={action} state={position} />
        <ChoiceDice label="AI 추천" choice={recommendation.action} state={position} />
      </div>
      <p>{relativeLoss(entry) <= 1e-8 ? "AI가 계산한 최선의 선택과 같은 평가예요." : explanation}</p>
      <button type="button" className="secondary" onClick={() => openDetail(entry.index, true)}>다시 도전</button>
    </article>;
  };

  return (
    <>
      <section className="review-match" aria-label="최종 결과">
        {match.players.map((name, seat) => {
          const assessments = values?.filter(({ index }) => match.steps[index].before.player === seat) ?? [];
          const byScore = accuracy(assessments, "score");
          const byWin = accuracy(assessments, "win");
          return <div key={seat} className={"tone-" + tone(seat)} data-tone={tone(seat)}>
            <PlayerTag name={name} look={match.looks?.[seat]} tone={tone(seat)} me={seat === match.me} />
            <strong>{match.scores[seat]}점</strong>
            {values && <small>판단 정확도 {byScore === undefined ? "—" : fmt(byScore) + "%"}</small>}
            {detailed && values && <small>승리 정확도 {byWin === undefined ? "—" : fmt(byWin) + "%"}</small>}
          </div>;
        })}
        <strong className="review-outcome">{match.winners.length === 2 ? "무승부" : match.winners.length ? `${match.players[match.winners[0]]} 승리` : "경기 종료"}</strong>
      </section>
      {fallbackNotice && <p role="status">확장 분석을 준비하지 못해 기본 분석으로 계속합니다.</p>}
      {active && <div className="review-loading">
        <progress value={completed} max={match.steps.length} aria-label="분석 진행률" />
        <span role="status">{preparing ? "분석 모델 준비 중…" : `${completed} / ${match.steps.length}`}</span>
        <button type="button" className="secondary" onClick={() => { setPreparing(false); setActive(false); }}>분석 취소</button>
      </div>}
      {!active && !values && <div className="review-loading">
        {error && <p role="alert">{error}</p>}
        <button type="button" className="secondary" onClick={() => { setError(""); setCompleted(0); setRun(run + 1); setActive(true); }}>분석 다시 시도</button>
      </div>}
      <div className="review-modes" role="tablist" aria-label="리뷰 방식">
        <button type="button" role="tab" aria-selected={!detailed} className={!detailed ? "primary" : "secondary"} onClick={() => { setDetailed(false); setPlaying(false); }}>기본 리뷰</button>
        <button type="button" role="tab" aria-selected={detailed} className={detailed ? "primary" : "secondary"} onClick={() => setDetailed(true)}>상세 분석</button>
      </div>
      {!detailed && <section role="tabpanel" aria-label="기본 리뷰" className="review-basic">
        <details>
          <summary>판단 정확도와 평가 기호</summary>
          <p>판단 정확도는 실제 선택이 AI가 찾은 최대 기대점수에 얼마나 가까웠는지를 0~100%로 나타내요.</p>
          <p>★는 최선, ✓는 좋은 판단, ?!·?·??는 차이가 커지는 순서예요. !·!!는 정확한 종반에서 승리에 도움이 된 선택에 붙어요.</p>
        </details>
        {values && <>
          <label>플레이어 <select value={basicSeat} onChange={(event) => setBasicSeat(event.target.value === "0" ? 0 : 1)}>
            <option value={0}>{match.players[0]}</option><option value={1}>{match.players[1]}</option>
          </select></label>
          <h2>주요 판단 실수</h2>
          {mistakes.length ? mistakes.map(highlight) : <p>이 플레이어의 분석에서 큰 차이가 난 판단이 없어요.</p>}
          <h2>잘한 선택</h2>
          {good ? highlight(good) : <p>이 플레이어의 기록에서 보여 줄 좋은 판단이 없어요.</p>}
        </>}
      </section>}
      {detailed && <div className="review-layout" role="tabpanel" aria-label="상세 분석">
        <section className="review-position" aria-label="선택한 행동">
          <div className="review-actions" role="group" aria-label="행동 탐색">
            <button type="button" className="secondary" aria-label="처음" disabled={!selected} onClick={() => move(0)}><SkipBack size={17} /></button>
            <button type="button" className="secondary" aria-label="이전" disabled={!selected} onClick={() => move(selected - 1)}><ChevronLeft size={17} /></button>
            <button type="button" className="secondary" aria-label={playing ? "재생 중지" : "자동 재생"} disabled={match.steps.length === 1} onClick={() => {
              if (!playing && selected === match.steps.length - 1) select(0);
              setPlaying(!playing);
            }}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <button type="button" className="secondary" aria-label="다음" disabled={selected === match.steps.length - 1} onClick={() => move(selected + 1)}><ChevronRight size={17} /></button>
            <button type="button" className="secondary" aria-label="마지막" disabled={selected === match.steps.length - 1} onClick={() => move(match.steps.length - 1)}><SkipForward size={17} /></button>
          </div>
          <p className="review-current">{step.before.round}라운드 · {step.before.rolls}번째 굴림 · {match.players[participant]} {!quiz && <GradeMark row={result} />}</p>
          {quiz ? <p>당시 점수판을 보고 선택해 보세요.</p> : <div className="review-choices">
            <ChoiceDice label="내 선택" choice={step.action} state={state} />
            {recommendation && <ChoiceDice label="AI 추천" choice={recommendation.action} state={state} />}
          </div>}
          {quiz && <div className="review-dice-line">{state.dice.map((die) => <DieIcon key={die.id} value={die.value} />)}</div>}
          {!quiz && result && <div className="review-losses">
            <span>점수 손실 {fmt(scoreLoss!)}점</span>
            {winGap !== undefined && <span>승리 가능성 손실 {fmt(winGap)}%p</span>}
            {result.luck !== undefined && <span>굴림 운 {result.luck >= 0 ? "+" : ""}{fmt(result.luck)}점</span>}
          </div>}
          {!quiz && result?.exactness && <div className="review-losses">
            <span>{result.exactness === "exact" ? "정확 종반" : "모델 추정"}</span>
            <span>승리점수율 {fmt(result.actual.winCredit! * 100)}%</span>
            {result.winLuck !== undefined && <span>승리점수율 굴림 운 {result.winLuck >= 0 ? "+" : ""}{fmt(result.winLuck * 100)}%p</span>}
          </div>}
          <table className="review-scoreboard" aria-label="당시 점수판">
            <thead><tr><th scope="col">족보</th>{match.players.map((name, seat) => <th scope="col" key={seat} className={"tone-" + tone(seat)}>{name}{seat === match.me ? " (나)" : ""}</th>)}</tr></thead>
            <tbody>
              {categories.map((category) => <tr key={category}>
                <th scope="row">{names[category]}</th>
                {state.cards.map((card, seat) => {
                  const actual = !quiz && seat === participant && step.action.type === "score" && step.action.category === category;
                  const suggested = !quiz && seat === participant && recommendation?.action.type === "score" && recommendation.action.category === category;
                  return <td key={seat} data-actual={actual || undefined} data-suggested={suggested || undefined}>
                    {actual || suggested ? <>
                      {score(state.dice.map(({ value }) => value), category)} <small>{actual && suggested ? "선택·추천" : actual ? "선택" : "추천"}</small>
                    </> : card[category] ?? "—"}
                  </td>;
                })}
              </tr>)}
              <tr><th scope="row">상단 보너스</th>{state.cards.map((card, seat) => <td key={seat}>{upper(card) >= 63 ? "+35점 달성" : `${63 - upper(card)}점 남음`}</td>)}</tr>
              <tr className="review-total"><th scope="row">총점</th>{state.cards.map((card, seat) => <td key={seat}>{total(card)}점</td>)}</tr>
            </tbody>
          </table>
          {result && <details className="review-options" open={quiz || undefined}>
            <summary>대안 행동</summary>
            <button type="button" className="secondary" onClick={() => { setQuiz(!quiz); setAlternative(null); setPlaying(false); }}>{quiz ? "분석으로 돌아가기" : "다시 도전"}</button>
            {alternative && <p role="status">{alternative}</p>}
            <ol>{(quiz ? [...result.options].sort((a, b) => actionName(a.action, step.before).localeCompare(actionName(b.action, step.before))) : result.options).map((option, i) =>
              <li key={i}><button type="button" className="text-button" onClick={() => chooseAlternative(option)}>{actionName(option.action, step.before)}</button>
                {!quiz && <span>{fmt(option.expected)}점 예상{option.winCredit === undefined ? "" : ` · ${fmt(option.winCredit * 100)}%`}</span>}
              </li>)}</ol>
          </details>}
        </section>
        <section className="review-summary" aria-label="경기 전체 분석">
          <div className="review-filters">
            <label>플레이어 <select value={participant} onChange={(event) => {
              const seat = Number(event.target.value);
              const index = match.steps.findIndex(({ before }) => before.player === seat && before.round === step.before.round);
              const first = match.steps.findIndex(({ before }) => before.player === seat);
              if (first !== -1) move(index === -1 ? first : index);
            }}><option value={0}>{match.players[0]}</option><option value={1}>{match.players[1]}</option></select></label>
            <label>라운드 <select value={step.before.round} onChange={(event) => {
              const round = Number(event.target.value);
              const index = match.steps.findIndex(({ before }) => before.round === round && before.player === participant);
              move(index === -1 ? match.steps.findIndex(({ before }) => before.round === round) : index);
            }}>{rounds.map((round) => <option key={round} value={round}>{round}라운드</option>)}</select></label>
          </div>
          <ol className="review-timeline" aria-label="행동 타임라인">
            {match.steps.map(({ before, action }, index) => <li key={index}>
              <button type="button" aria-current={index === selected ? "step" : undefined}
                aria-label={`${index + 1}번째 행동 · ${before.round}라운드 · ${match.players[before.player]} · ${actionName(action, before)}`}
                onClick={() => move(index)}>
                <small>{before.round}R</small><GradeMark row={values?.[index]} />
              </button>
            </li>)}
          </ol>
          {values && !quiz && <>
            <label className="review-metric">그래프 <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>
              {availableMetrics.map((key) => <option key={key} value={key}>{metrics[key].label}</option>)}
            </select></label>
            <ReviewChart rows={rows} rounds={match.steps.map(({ before }) => before.round)} metric={metric} selected={selected} change={move} />
            {biggest.length > 0 && <div className="review-mistakes">
              <h2>주요 실수</h2>
              {biggest.map((entry) => <button type="button" className="text-button" key={entry.index} onClick={() => move(entry.index)}>
                <GradeMark row={entry} /> {match.steps[entry.index].before.round}라운드 · {actionName(entry.actual.action, match.steps[entry.index].before)}
              </button>)}
            </div>}
          </>}
          {previous.length >= 5 && <details>
            <summary>이 기기의 같은 대진에서 평균 점수 손실 변화</summary>
            <ol>{previous.map((entry) => <li key={entry.key}>{new Date(entry.at).toLocaleDateString("ko-KR")} · {entry.meanLoss[participant] === null ? "기록 없음" : fmt(entry.meanLoss[participant]!) + "점"}</li>)}</ol>
          </details>}
          {!quiz && result?.distribution && <details className="review-distribution">
            <summary>최종 점수차 분포</summary>
            <p>양측이 남은 차례를 DP Expert 정책으로 플레이한다고 가정한 분포예요.</p>
            <ul>{result.distribution.map((entry) => <li key={entry.difference}><span>{entry.difference}점</span><meter value={entry.mass} max={1} />{fmt(entry.mass * 100)}%</li>)}</ul>
          </details>}
          {values && <details className="review-model">
            <summary>분석 정보</summary>
            <p>{analysisModel.name} · {analysisModel.version}</p>
            <p>승리점수율은 승리 1점, 무승부 0.5점, 패배 0점으로 계산해요.</p>
            <p>{analysisModel === productReviewModel ? "초·중반은 이후 양측이 DP Expert 정책을 쓴다고 가정한 추정치예요. 정확 종반은 양측의 남은 칸이 1개 이하일 때 계산해요." : "지원되는 순차 대전 종반만 승리점수율을 계산해요."}</p>
            {!quiz && result?.preRollValue !== undefined && <p>첫 굴림 전 승리점수율 {fmt(result.preRollValue * 100)}%</p>}
            {!quiz && result?.actual.winOutcomes && <p>내 선택의 예상 승리 {fmt(result.actual.winOutcomes.win * 100)}% · 무승부 {fmt(result.actual.winOutcomes.tie * 100)}% · 패배 {fmt(result.actual.winOutcomes.loss * 100)}%</p>}
            {!quiz && result?.actual.winExpected !== undefined && <p>승리 우선으로 이번 굴림을 이어갔을 때 예상 최종점수 {fmt(result.actual.winExpected)}점</p>}

          </details>}
        </section>
      </div>}
    </>
  );
}

function relativeLoss(row: Assessment) {
  const loss = winLoss(row);
  return loss === undefined ? row.loss / 8 : loss / 10;
}

function GradeMark({ row }: { row?: Assessment }) {
  if (!row) return <span className="review-grade" aria-label="미평가">·</span>;
  const symbol = grade(row);
  const { label, tone } = grades[symbol];
  return <span className={`review-grade ${tone}`} title={label} aria-label={label}>{symbol}</span>;
}

function ChoiceDice({ label, choice, state }: { label: string; choice: PositionChoice; state: Game }) {
  return <div>
    <strong>{label}</strong>
    <small>{choice.type === "score" ? `${names[choice.category]} · 기록 ${score(state.dice.map(({ value }) => value), choice.category)}점` : "재굴림"}</small>
    <div className="review-dice-line">{state.dice.map(({ id, value }) =>
      <DieIcon key={id} value={value} className={choice.type === "reroll" && choice.ids.includes(id) ? "kept" : ""} aria-label={`주사위 ${value}${choice.type === "reroll" && choice.ids.includes(id) ? ", 킵" : ""}`} />)}</div>
  </div>;
}

type PositionChoice = Value["action"];
