import { PlayerTag } from "../play/Looks";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReviewShortcuts } from "../ui/shortcuts";
import { useBgmScene } from "../audio/useBgm";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { DieIcon } from "../Dice";
import { grades } from "./quality";
import { LossLuckChart, ProgressChart, type Series } from "./ReviewChart";
import { categories, createGame, names, score, total, transition, upper, type Game } from "../engine";
import { actionName, productReviewModel, reviewAlgorithmVersion, type Assessment, type Position, type ReviewMatch, type Value } from "./model";
import { reviewSummaries } from "./cache";
import type { ReviewAnalysisStatus, ReviewedAction, ReviewedRoll, ReviewReport, ReviewTotals } from "./report";
import { useReviewAnalysis } from "./useAnalysis";
import type { ReviewSource } from "./sources";
import {
  choiceKey, choiceLabel, expectedSeries, filterLabels, goodMoments, gradeCounts, gradeOrder, matches, roundBars,
  scoreOf, scoreSeries, seatInfo, signed, timeline, unassessedReason, winSeries, type Filter, type SeatInfo, type TimelineItem,
} from "./view-model";
import "./review.css";

const fmt = (value: number) => value.toFixed(2);
const asGame = (position: Position): Game => ({ ...createGame(0), ...position });
type Chart = "value" | "score" | "swing";

export default function ReviewPage({ source, close, position }: { source: ReviewSource; close: () => void; position: { current: number } }) {
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
        {typeof source === "string" ? <p role="status">{source}</p> : <MatchAnalysis match={source} position={position} />}
      </main>
    </dialog>
  );
}

function AnalysisStatus({ status, fallback, cached, cancel, retry }: {
  status: ReviewAnalysisStatus; fallback: boolean; cached: boolean; cancel: () => void; retry: () => void;
}) {
  const running = status.state === "preparing" || status.state === "analyzing";
  const percent = status.state === "analyzing" && status.total ? Math.floor(100 * status.completed / status.total) : null;
  return <div className={"review-status state-" + status.state} aria-label="분석 상태">
    {running && <>
      <progress value={status.state === "analyzing" ? status.completed : undefined} max={status.total} aria-label="분석 진행률" />
      <span role="status">{status.state === "preparing" ? "분석 모델 준비 중" : `분석 중 ${status.completed}/${status.total} · ${percent}%`}</span>
      <button type="button" className="secondary" onClick={cancel}>분석 취소</button>
    </>}
    {status.state === "complete" && <span className="review-chip" role="status">{cached ? "저장된 분석" : "분석 완료"}</span>}
    {status.state === "failed" && <>
      <p role="alert">{status.message} <small>({status.completed}/{status.total}에서 중단)</small></p>
      <button type="button" className="secondary" onClick={retry}>분석 다시 시도</button>
    </>}
    {status.state === "cancelled" && <>
      <p role="status">분석을 취소했어요. <small>({status.completed}/{status.total})</small></p>
      <button type="button" className="secondary" onClick={retry}>분석 다시 시도</button>
    </>}
    {fallback && <p role="status" className="review-note">승리점수율 모델을 준비하지 못해 정확 종반만 평가해요.</p>}
  </div>;
}

function MatchAnalysis({ match, position }: { match: ReviewMatch; position: { current: number } }) {
  const { model: analysisModel, values, status, fallback, cached, cancel, retry } = useReviewAnalysis(match);
  const report = status.state === "complete" ? status.report : undefined;
  const seats = useMemo(() => seatInfo(match), [match]);
  const actions = useMemo(() => new Map(report?.players.flatMap(({ rounds }) =>
    rounds.flatMap(({ actions }) => actions.map((action) => [action.index, action] as const)))), [report]);
  const byIndex = useMemo(() => new Map(values?.map((row) => [row.index, row])), [values]);
  const rounds = useMemo(() => timeline(match, report), [match, report]);
  const unit = match.solo ? "점" : "%p";
  const [selected, setSelected] = useState(position.current);
  useEffect(() => { position.current = selected; }, [position, selected]);
  const [filter, setFilter] = useState<Filter>("all");
  const [seatFilter, setSeatFilter] = useState<0 | 1 | "all">("all");
  const [focus, setFocus] = useState<0 | 1>(() => match.me ?? 0);
  const [chart, setChart] = useState<Chart>("value");
  const [alternative, setAlternative] = useState<string | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [playing, setPlaying] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const [localSummaries, setLocalSummaries] = useState<Awaited<ReturnType<typeof reviewSummaries>>>([]);
  useEffect(() => {
    if (match.device) void reviewSummaries().then(setLocalSummaries).catch(() => {});
  }, [match, values]);

  function select(index: number) {
    setSelected(index);
    setAlternative(null);
    setQuiz(false);
  }
  const lastStep = Math.max(0, match.steps.length - 1);
  const move = (index: number) => { setPlaying(false); select(Math.min(lastStep, Math.max(0, index))); };

  useEffect(() => {
    if (!playing || selected === lastStep) return;
    const timer = window.setTimeout(() => {
      select(selected + 1);
      if (selected + 1 === lastStep) setPlaying(false);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [lastStep, playing, selected]);

  // Keep the current action visible inside the timeline's own scroll area without moving the page.
  useEffect(() => {
    const container = list.current;
    const item = container?.querySelector<HTMLElement>("[aria-current=step]");
    if (!container || !item) return;
    const top = item.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    if (top < container.scrollTop) container.scrollTop = top - 28;
    else if (top + item.offsetHeight > container.scrollTop + container.clientHeight)
      container.scrollTop = top + item.offsetHeight - container.clientHeight + 8;
  }, [selected, filter, seatFilter, report]);

  const togglePlay = () => {
    if (match.steps.length < 2) return;
    if (!playing && selected === lastStep) select(0);
    setPlaying(!playing);
  };
  useReviewShortcuts({
    prev: () => move(selected - 1), next: () => move(selected + 1), first: () => move(0), last: () => move(lastStep), toggle: togglePlay,
  }, !quiz && match.steps.length > 0);

  const statusBar = <AnalysisStatus status={status} fallback={fallback} cached={cached} cancel={cancel} retry={retry} />;
  if (!match.steps.length) return <>
    <Summary match={match} seats={seats} report={report} status={status} unit={unit} />
    {statusBar}
    <p>분석할 확정 행동이 없어요.</p>
  </>;

  const step = match.steps[selected];
  const state = asGame(step.before);
  const row = byIndex.get(selected);
  const reviewed = actions.get(selected);
  const evaluation = reviewed?.evaluation;
  const recommendation = evaluation?.state === "assessed" ? evaluation.recommended : undefined;
  const best = row && recommendation ? row.options.find((option) => choiceKey(option.action, step.before) === choiceKey(recommendation, step.before)) : undefined;
  const actor = seats[step.before.player] ?? seats[0];
  const roundStarts = [...new Map(match.steps.map(({ before }, index) => [before.round, index] as const)).entries()]
    .map(([round]) => ({ round, index: match.steps.findIndex(({ before }) => before.round === round) }));
  const reference = (match.me ?? 0) as 0 | 1;
  const optionValue = (option: Value) => match.solo ? option.expected : option.winCredit === undefined ? undefined : option.winCredit * 100;

  const chooseAlternative = (option: Value) => {
    if (quiz) {
      const top = best ? optionValue(best) : undefined, mine = optionValue(option);
      if (top !== undefined && mine !== undefined) {
        const gap = top - mine;
        setAlternative(gap <= 1e-8 ? "최선과 같은 평가예요." : `최선과 ${fmt(gap)}${unit} 차이가 있어요.`);
      }
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

  const valueSeries: Series[] = !values ? [] : match.solo
    ? [{ key: "expected", label: "기대 최종점수", tone: "me", points: expectedSeries(match, values) }]
    : [{ key: "win", label: seats[reference].display, tone: seats[reference].tone, points: winSeries(match, values, reference) }];
  const scoreLines: Series[] = seats.map(({ seat, display, tone }) => ({ key: "s" + seat, label: display, tone, points: scoreSeries(match, seat) }));
  const previous = localSummaries.filter((item) => item.model === analysisModel.version + ":" + reviewAlgorithmVersion &&
    JSON.stringify(item.players) === JSON.stringify(match.players)).sort((a, b) => a.at - b.at);
  const seatSwitch = !match.solo && <div className="review-seg" role="radiogroup" aria-label="기준 플레이어">
    {seats.map((seat) => <button key={seat.seat} type="button" role="radio" aria-checked={focus === seat.seat}
      className={"tone-" + seat.tone} onClick={() => setFocus(seat.seat)}><i className="review-dot" aria-hidden="true" />{seat.display}</button>)}
  </div>;
  const waiting = status.state === "preparing" || status.state === "analyzing" ? "분석이 끝나면 표시돼요." : "분석 결과가 없어요.";

  return (
    <>
      <Summary match={match} seats={seats} report={report} status={status} unit={unit} />
      {statusBar}
      <div className="review-layout">
        <section className="review-position" aria-label="선택한 행동">
          <header className={"review-current tone-" + actor.tone}>
            <span className="review-dot" aria-hidden="true" />
            <strong>{step.before.round}라운드 · {step.before.rolls}번째 굴림</strong>
            <span>{actor.display}{match.solo ? "" : ` · ${actor.role}`}</span>
            {!quiz && <GradeMark action={reviewed} withLabel />}
          </header>
          {quiz ? <>
            <p className="review-note">당시 점수판을 보고 선택해 보세요.</p>
            <div className="review-dice-line">{state.dice.map((die) => <DieIcon key={die.id} value={die.value} />)}</div>
          </> : <>
            <div className="review-choices">
              <ChoiceCard label="실제 선택" kind="actual" choice={step.action} position={step.before}
                value={evaluation?.state === "assessed" ? evaluation.actualValue : undefined} solo={!!match.solo} />
              {recommendation ? <ChoiceCard label="AI 추천" kind="suggested" choice={recommendation} position={step.before}
                value={evaluation?.state === "assessed" ? evaluation.bestValue : undefined} solo={!!match.solo}
                same={choiceKey(recommendation, step.before) === choiceKey(step.action, step.before)} />
                : <div className="review-choice empty"><strong>AI 추천</strong><small>{evaluation?.state === "unassessed" ? unassessedReason[evaluation.reason] : waiting}</small></div>}
            </div>
            <div className="review-split">
              <div className="review-judgement" aria-label="판단 평가">
                <h3>판단</h3>
                {evaluation?.state === "assessed" ? <>
                  <p className="review-big">{evaluation.loss <= 1e-8 ? "손실 없음" : `−${fmt(evaluation.loss)}${unit}`}</p>
                  <small>정확도 {evaluation.accuracy.toFixed(1)} · <Exactness exact={evaluation.exactness === "exact"} solo={!!match.solo} /></small>
                </> : <p className="review-muted">{evaluation ? "미평가 · " + unassessedReason[evaluation.reason] : waiting}
                  {!match.solo && row?.exactness === "exact" && <> <Exactness exact solo={false} /></>}</p>}
              </div>
              <div className="review-luck" aria-label="주사위 운">
                <h3>주사위 운</h3>
                {reviewed?.rolls.length ? reviewed.rolls.map((roll) => <RollLine key={roll.kind} roll={roll} unit={unit} solo={!!match.solo} />)
                  : <p className="review-muted">{reviewed ? "이 행동에 평가된 굴림이 없어요." : waiting}</p>}
              </div>
            </div>
          </>}
          <table className="review-scoreboard" aria-label="당시 점수판">
            <thead><tr><th scope="col">족보</th>{seats.map(({ seat, display, tone, me }) => <th scope="col" key={seat} className={"tone-" + tone}>
              <span className="review-dot" aria-hidden="true" />{display}{me ? " (나)" : ""}</th>)}</tr></thead>
            <tbody>
              {categories.map((category) => <tr key={category}>
                <th scope="row">{names[category]}</th>
                {seats.map(({ seat }) => {
                  const card = state.cards[seat];
                  const actual = !quiz && seat === step.before.player && step.action.type === "score" && step.action.category === category;
                  const suggested = !quiz && seat === step.before.player && recommendation?.type === "score" && recommendation.category === category;
                  return <td key={seat} data-actual={actual || undefined} data-suggested={suggested || undefined}>
                    {actual || suggested ? <>
                      {scoreOf(step.before, category)} <small>{actual && suggested ? "선택·추천" : actual ? "선택" : "추천"}</small>
                    </> : card[category] ?? "—"}
                  </td>;
                })}
              </tr>)}
              <tr><th scope="row">상단 보너스</th>{seats.map(({ seat }) => <td key={seat}>{upper(state.cards[seat]) >= 63 ? "+35" : `${63 - upper(state.cards[seat])} 남음`}</td>)}</tr>
              <tr className="review-total"><th scope="row">총점</th>{seats.map(({ seat }) => <td key={seat}>{total(state.cards[seat])}</td>)}</tr>
            </tbody>
          </table>
          {row && best && <details className="review-options" open={quiz || undefined}>
            <summary>대안 행동</summary>
            <button type="button" className="secondary" onClick={() => { setQuiz(!quiz); setAlternative(null); setPlaying(false); }}>{quiz ? "분석으로 돌아가기" : "다시 도전"}</button>
            {alternative && <p role="status">{alternative}</p>}
            <ol>{(quiz ? [...row.options].sort((a, b) => actionName(a.action, step.before).localeCompare(actionName(b.action, step.before)))
              : [...row.options].sort((a, b) => (optionValue(b) ?? -Infinity) - (optionValue(a) ?? -Infinity))).map((option, i) =>
              <li key={i}><button type="button" className="text-button" onClick={() => chooseAlternative(option)}>{actionName(option.action, step.before)}</button>
                {!quiz && optionValue(option) !== undefined && <span>{match.solo ? `${fmt(option.expected)}점` : `${fmt(optionValue(option)!)}%`}</span>}
              </li>)}</ol>
          </details>}
          <div className="review-actions" role="group" aria-label="행동 탐색">
            <button type="button" className="secondary" aria-label="처음" disabled={!selected} onClick={() => move(0)}><SkipBack size={17} /></button>
            <button type="button" className="secondary" aria-label="이전" disabled={!selected} onClick={() => move(selected - 1)}><ChevronLeft size={17} /></button>
            <button type="button" className="secondary" aria-label={playing ? "재생 중지" : "자동 재생"} disabled={match.steps.length === 1} onClick={togglePlay}>
              {playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <span className="review-step-count">{selected + 1}/{match.steps.length}</span>
            <button type="button" className="secondary" aria-label="다음" disabled={selected === lastStep} onClick={() => move(selected + 1)}><ChevronRight size={17} /></button>
            <button type="button" className="secondary" aria-label="마지막" disabled={selected === lastStep} onClick={() => move(lastStep)}><SkipForward size={17} /></button>
          </div>
        </section>

        <section className="review-summary" aria-label="경기 전체 분석">
          <div className="review-seg review-chart-tabs" role="radiogroup" aria-label="그래프">
            {([["value", match.solo ? "기대 최종점수" : "승리점수율"], ["score", "점수"], ["swing", "손실·운"]] as const).map(([key, label]) =>
              <button key={key} type="button" role="radio" aria-checked={chart === key} onClick={() => setChart(key)}>{label}</button>)}
          </div>
          {chart === "value" && (values ? <ProgressChart label={match.solo ? "기대 최종점수" : "승리점수율"} unit={match.solo ? "점" : "%"}
            series={valueSeries} steps={match.steps.length} rounds={roundStarts} selected={selected} change={move}
            domain={match.solo ? undefined : [0, 100]} midline={match.solo ? undefined : 50} /> : <p className="review-no-data">{waiting}</p>)}
          {chart === "score" && <ProgressChart label="라운드별 점수" unit="점" series={scoreLines} steps={match.steps.length}
            rounds={roundStarts} selected={selected} change={move} domain={[0, Math.max(50, ...scoreLines.flatMap(({ points }) => points.map(({ value }) => Math.ceil(value / 50) * 50)))]} />}
          {chart === "swing" && <>
            {seatSwitch}
            {report ? <LossLuckChart label={`${seats[focus]?.display ?? ""} 라운드별 판단 손실과 주사위 운`} unit={unit}
              bars={roundBars(match, report, focus)} selectedRound={step.before.round} change={move} /> : <p className="review-no-data">{waiting}</p>}
          </>}

          <div className="review-filters">
            <div className="review-seg" role="radiogroup" aria-label="장면 필터">
              {(Object.keys(filterLabels) as Filter[]).map((key) => <button key={key} type="button" role="radio" aria-checked={filter === key}
                disabled={key !== "all" && !report} onClick={() => setFilter(key)}>{filterLabels[key]}</button>)}
            </div>
            {!match.solo && <label>플레이어 <select value={seatFilter} onChange={(event) =>
              setSeatFilter(event.target.value === "all" ? "all" : event.target.value === "0" ? 0 : 1)}>
              <option value="all">모두</option>
              {seats.map(({ seat, display, role }) => <option key={seat} value={seat}>{display} · {role}</option>)}
            </select></label>}
          </div>
          <ol className="review-timeline" aria-label="행동 타임라인" ref={list}>
            {rounds.map(({ round, items }) => {
              const shown = items.filter((item) => matches(item, filter, seatFilter));
              return shown.length ? <li key={round} className="review-round">
                <h3>{round}라운드</h3>
                <ol>{shown.map((item) => <TimelineRow key={item.kind === "action" ? item.index : "o" + item.seat + item.round} item={item}
                  seat={seats[item.seat] ?? seats[0]} selected={selected} change={move} solo={!!match.solo} />)}</ol>
              </li> : null;
            })}
            {!rounds.some(({ items }) => items.some((item) => matches(item, filter, seatFilter))) &&
              <li className="review-muted">{filterLabels[filter]} 항목이 없어요.</li>}
          </ol>
        </section>
      </div>

      <section className="review-moments" aria-label="주요 장면">
        <header><h2>주요 장면</h2>{seatSwitch}</header>
        {report && values ? <Moments match={match} report={report} values={values} seat={focus} unit={unit} change={move} />
          : <p className="review-no-data">{waiting}</p>}
      </section>

      <details className="review-legend-box">
        <summary>평가 기호</summary>
        <ul>{gradeOrder.map((symbol) => <li key={symbol}><span className={"review-grade " + grades[symbol].tone}>{symbol}</span>{grades[symbol].label}</li>)}</ul>
        <p>{match.solo ? "기준: DP Expert 기대 최종점수(점)." : "기준: 승리점수율(승 1·무 0.5·패 0). 차이는 %p."} 운은 0~100점으로 바꾸지 않은 가치 차이예요.</p>
      </details>
      {previous.length >= 5 && <details>
        <summary>이 기기의 같은 대진 평균 가치 손실</summary>
        <ol>{previous.map((entry) => <li key={entry.key}>{new Date(entry.at).toLocaleDateString("ko-KR")} · {entry.meanLoss[focus] === null ? "기록 없음" : fmt(entry.meanLoss[focus]!) + unit}</li>)}</ol>
      </details>}
      {!quiz && row?.distribution && <details className="review-distribution">
        <summary>최종 점수차 분포</summary>
        <p>양측이 남은 차례를 DP Expert 정책으로 플레이한다고 가정한 분포예요.</p>
        <ul>{row.distribution.map((entry) => <li key={entry.difference}><span>{entry.difference}점</span><meter value={entry.mass} max={1} />{fmt(entry.mass * 100)}%</li>)}</ul>
      </details>}
      {values && <details className="review-model">
        <summary>분석 정보</summary>
        <p>{analysisModel.name} · {analysisModel.version} · {reviewAlgorithmVersion}</p>
        <p>{match.solo ? "DP Expert로 기대 최종점수를 계산해요." : analysisModel === productReviewModel ? "추정치는 이후 양측이 DP Expert 정책을 쓴다는 가정에 기반해요. 순차 대전에서 양측의 남은 칸이 1개 이하인 종반은 정확히 계산해요." : "지원되는 순차 대전 종반만 승리점수율을 계산해요."}</p>
        {!quiz && row?.preRollValue !== undefined && <p>첫 굴림 전 승리점수율 {fmt(row.preRollValue * 100)}%</p>}
        {!quiz && row?.actual.winOutcomes && <p>내 선택의 예상 승리 {fmt(row.actual.winOutcomes.win * 100)}% · 무승부 {fmt(row.actual.winOutcomes.tie * 100)}% · 패배 {fmt(row.actual.winOutcomes.loss * 100)}%</p>}
        {!quiz && row?.actual.winExpected !== undefined && <p>승리 우선으로 이번 굴림을 이어갔을 때 예상 최종점수 {fmt(row.actual.winExpected)}점</p>}
      </details>}
    </>
  );
}

function Summary({ match, seats, report, status, unit }: { match: ReviewMatch; seats: SeatInfo[]; report?: ReviewReport; status: ReviewAnalysisStatus; unit: string }) {
  const outcome = match.solo ? "1인 플레이 · 기대점수 기준" : match.winners.length === 2 ? "무승부 · 승리점수율 기준"
    : match.winners.length ? `${seats[match.winners[0]]?.display} 승리 · 승리점수율 기준` : "경기 종료";
  const pending = status.state === "preparing" || status.state === "analyzing";
  return <section className={"review-match" + (match.solo ? " solo" : "")} aria-label="최종 결과">
    {seats.map((info) => <PlayerSummary key={info.seat} info={info} match={match} totals={report?.players[info.seat]?.totals}
      counts={report ? gradeCounts(report, info.seat) : undefined} pending={pending} unit={unit} />)}
    <p className="review-outcome">{outcome}</p>
  </section>;
}

function PlayerSummary({ info, match, totals, counts, pending, unit }: {
  info: SeatInfo; match: ReviewMatch; totals?: ReviewTotals; counts?: ReturnType<typeof gradeCounts>; pending: boolean; unit: string;
}) {
  const missing = pending ? "분석 중" : "—";
  return <div className={"review-player tone-" + info.tone} data-tone={info.tone}>
    <div className="review-player-id">
      <PlayerTag name={info.display} look={match.looks?.[info.seat]} tone={info.tone} me={info.me} compact />
      <span className="review-role">{info.role}{info.me ? " · 나" : ""}</span>
    </div>
    <strong className="review-final">{match.scores[info.seat]}<small>점</small></strong>
    <dl className="review-metrics">
      <div>
        <dt>판단 정확도</dt>
        <dd>{!totals ? missing : totals.accuracy === null ? <span className="review-muted">미평가</span> : totals.accuracy.toFixed(1)}</dd>
        {totals && <small>{totals.accuracy === null ? `평가 0건` : totals.estimatedActions
          ? <><b className="review-flag estimate">추정</b> {totals.estimatedActions}/{totals.assessedActions}건</>
          : <><b className="review-flag exact">{match.solo ? "DP" : "정확"}</b> {totals.assessedActions}건</>}
          {totals.unassessedActions > 0 && ` · 미평가 ${totals.unassessedActions}`}</small>}
      </div>
      <div>
        <dt>누적 주사위 운</dt>
        <dd>{!totals ? missing : totals.luck === null ? <span className="review-muted">미평가</span> : signed(totals.luck) + unit}</dd>
        {totals && totals.luck !== null && <small>
          {totals.estimatedRolls > 0 && <b className="review-flag estimate">추정</b>} 첫 굴림 {totals.firstLuck === null ? "—" : signed(totals.firstLuck)}
          {" · "}재굴림 {totals.rerollLuck === null ? "—" : signed(totals.rerollLuck)}</small>}
      </div>
      <div>
        <dt>누적 판단 손실</dt>
        <dd>{!totals ? missing : totals.loss === null ? <span className="review-muted">미평가</span> : (totals.loss <= 1e-8 ? "0" : "−" + fmt(totals.loss)) + unit}</dd>
      </div>
    </dl>
    {counts && <ul className="review-counts" aria-label={`${info.display} 평가 기호 분포`}>
      {gradeOrder.filter((symbol) => counts[symbol] > 0).map((symbol) => <li key={symbol}>
        <span className={"review-grade " + grades[symbol].tone} title={grades[symbol].label}>{symbol}</span>{counts[symbol]}</li>)}
    </ul>}
  </div>;
}

function Exactness({ exact, solo }: { exact: boolean; solo: boolean }) {
  if (solo) return <b className="review-flag exact">DP Expert</b>;
  return exact ? <b className="review-flag exact">정확 종반</b> : <b className="review-flag estimate">모델 추정</b>;
}

function RollLine({ roll, unit, solo }: { roll: ReviewedRoll; unit: string; solo: boolean }) {
  const level = (value: number) => solo ? `${value.toFixed(1)}점` : `${value.toFixed(1)}%`;
  return <div className="review-roll">
    <span>{roll.kind === "first" ? "첫 굴림" : "재굴림 결과"}{roll.exactness === "estimate" && <b className="review-flag estimate">추정</b>}</span>
    <span className="review-dice-line small">{roll.dice.map((value, i) => <DieIcon key={i} value={value} />)}</span>
    <small>기대 {level(roll.expectedValue)} → {level(roll.realizedValue)}</small>
    <strong className={roll.swing > 0 ? "luck-plus" : roll.swing < 0 ? "luck-minus" : ""}>{signed(roll.swing)}{unit}</strong>
  </div>;
}

function TimelineRow({ item, seat, selected, change, solo }: {
  item: TimelineItem; seat: SeatInfo; selected: number; change: (index: number) => void; solo: boolean;
}) {
  const luck = (rolls: readonly (ReviewedRoll | null)[]) => {
    const swings = rolls.flatMap((roll) => roll ? [roll.swing] : []);
    if (!swings.length) return null;
    const sum = swings.reduce((a, b) => a + b, 0);
    const text = signed(sum), sign = text.startsWith("+") ? 1 : text.startsWith("-") ? -1 : 0;
    return <span className={"review-luck-tag " + (sign > 0 ? "luck-plus" : sign < 0 ? "luck-minus" : "")}><small>운</small>{sign > 0 ? "▲" : sign < 0 ? "▼" : ""}{text}</span>;
  };
  const who = <span className={"review-who tone-" + seat.tone}>{!solo && <><i className="review-dot" aria-hidden="true" />{seat.display}</>}</span>;
  if (item.kind === "opening") return <li className="review-opening">
    {who}<span className="review-grade" aria-hidden="true">·</span><span>첫 굴림만 · 확정 행동 없음</span>{luck([item.roll])}
  </li>;
  const evaluation = item.reviewed?.evaluation;
  return <li>
    <button type="button" aria-current={item.index === selected ? "step" : undefined}
      aria-label={`${item.index + 1}번째 행동 · ${item.round}라운드 · ${seat.display} · ${actionName(item.choice, item.position)}`}
      onClick={() => change(item.index)}>
      {who}
      <GradeMark action={item.reviewed} />
      <span className="review-choice-label">{item.position.rolls}회 · {choiceLabel(item.choice, item.position)}
        {item.choice.type === "score" && <small> {scoreOf(item.position, item.choice.category)}점</small>}</span>
      <span className="review-row-meta">
        {evaluation?.state === "assessed" && evaluation.loss > 1e-8 && <span className="review-loss-tag"><small>손실</small>−{fmt(evaluation.loss)}</span>}
        {item.reviewed && luck(item.reviewed.rolls)}
      </span>
    </button>
  </li>;
}

function Moments({ match, report, values, seat, unit, change }: {
  match: ReviewMatch; report: ReviewReport; values: Assessment[]; seat: number; unit: string; change: (index: number) => void;
}) {
  const player = report.players[seat];
  if (!player) return null;
  const reviewed = new Map(player.rounds.flatMap(({ actions }) => actions.map((action) => [action.index, action] as const)));
  const good = goodMoments(match, report, values, seat);
  const jump = (index: number | null, round: number) => {
    const target = index ?? match.steps.findIndex(({ before }) => before.round === round && before.player === seat);
    if (target !== -1) change(target);
  };
  const decision = (index: number, detail: string) => {
    const action = reviewed.get(index);
    const { before, action: choice } = match.steps[index];
    const suggestion = action?.evaluation.state === "assessed" ? action.evaluation.recommended : undefined;
    const differs = suggestion && choiceKey(suggestion, before) !== choiceKey(choice, before);
    // UI-1: the actual choice and the AI's recommendation are separate labelled lines (no inline arrow that wraps).
    return <li key={index}><button type="button" className="review-moment-row" onClick={() => change(index)}>
      <GradeMark action={action} />
      <span className="review-moment-text">
        <span className="review-moment-line"><b>{before.round}R</b> <span className="review-moment-tag mine">내 선택</span> {choiceLabel(choice, before)}</span>
        {differs && <span className="review-moment-line suggest"><span className="review-moment-tag ai">AI 추천</span> {choiceLabel(suggestion, before)}</span>}
      </span>
      <span className="review-row-meta">{detail}</span>
    </button></li>;
  };
  const luckRow = ({ index, round, roll }: { index: number | null; round: number; roll: ReviewedRoll }, i: number) =>
    <li key={i}><button type="button" className="review-moment-row luck" onClick={() => jump(index, round)}>
      <span className="review-dice-line small">{roll.dice.map((value, d) => <DieIcon key={d} value={value} />)}</span>
      <span className="review-moment-text"><span className="review-moment-line"><b>{round}R</b> {roll.kind === "first" ? "첫 굴림" : "재굴림"}{roll.exactness === "estimate" && <b className="review-flag estimate">추정</b>}</span></span>
      <span className={"review-row-meta " + (roll.swing > 0 ? "luck-plus" : "luck-minus")}>{signed(roll.swing)}{unit}</span>
    </button></li>;
  const group = (title: string, className: string, rows: ReactNode[], empty: string) =>
    <div className={"review-moment " + className}><h3>{title}</h3>{rows.length ? <ol>{rows}</ol> : <p className="review-muted">{empty}</p>}</div>;
  return <div className="review-moment-grid">
    {group("주요 실수", "mistakes", player.highlights.mistakes.map(({ index, loss }) => decision(index, `−${fmt(loss)}${unit}`)), "?!·?·?? 판단이 없어요.")}
    {group("좋은 판단", "good", good.map(({ index, margin }) => decision(index, `차선 대비 +${fmt(margin)}${unit}`)), "차선과 차이가 난 최선 판단이 없어요.")}
    {group("행운", "lucky", player.highlights.lucky.map(luckRow), "양의 운이 없어요.")}
    {group("불운", "unlucky", player.highlights.unlucky.map(luckRow), "음의 운이 없어요.")}
  </div>;
}

function GradeMark({ action, withLabel = false }: { action?: ReviewedAction; withLabel?: boolean }) {
  if (action?.evaluation.state !== "assessed") return <span className="review-grade none" aria-label="미평가">·</span>;
  const symbol = action.evaluation.grade;
  const { label, tone } = grades[symbol];
  return <span className={`review-grade ${tone}`} title={label} aria-label={label}>{symbol}{withLabel && <small>{label}</small>}</span>;
}

function ChoiceCard({ label, kind, choice, position, value, solo, same }: {
  label: string; kind: "actual" | "suggested"; choice: Value["action"]; position: Position; value?: number; solo: boolean; same?: boolean;
}) {
  const kept = (id: number) => choice.type === "reroll" && choice.ids.includes(id);
  return <div className={"review-choice " + kind}>
    <strong>{label}{same && <span className="review-chip">같은 선택</span>}</strong>
    <span className="review-choice-name">{choice.type === "score" ? `${names[choice.category]} ${scoreOf(position, choice.category)}점` : choiceLabel(choice, position) + " 후 재굴림"}</span>
    <div className="review-dice-line">{position.dice.map(({ id, value: eye }) =>
      <DieIcon key={id} value={eye} className={kept(id) ? "kept" : choice.type === "reroll" ? "rerolled" : ""} aria-label={`주사위 ${eye}${kept(id) ? ", 킵" : ""}`} />)}</div>
    {value !== undefined && <small>{solo ? `기대 최종 ${value.toFixed(2)}점` : `승리점수율 ${value.toFixed(2)}%`}</small>}
  </div>;
}
