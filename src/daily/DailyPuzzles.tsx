import { useEffect, useState } from "react";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { DiceArea } from "../DiceArea";
import { MultiScoreboard } from "../MultiScoreboard";
import { categories, names, total, upper, type Category } from "../engine";
import type { MultiGame } from "../multi-engine";
import { answer as sendAnswer, puzzles as loadPuzzles, signedIn, type PuzzleItem } from "./client";
import { KIND_NAMES, LEVEL_NAMES, keepKey, scoreKey, type PuzzleLevel } from "./puzzles/types";

/**
 * 오늘의 전략 퍼즐. The question comes without its answer; the server grades the first answer of a
 * member (today) and only then sends the key. Every optimal action is accepted. Closed days: anyone
 * can answer, the key comes with the grade, nothing is recorded.
 */
const fmtValue = (v: number, unit: string) => (unit === "%" ? (v * 100).toFixed(1) + "%" : v.toFixed(2) + "점");

export default function DailyPuzzles({ server, date, closed, onBack, onAnswered }: { server: string; date: string; closed: boolean; onBack: () => void; onAnswered?: () => void }) {
  const [items, setItems] = useState<PuzzleItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    loadPuzzles(server, date).then((r) => setItems(r.puzzles)).catch((e: Error) => setError(e.message));
  }, [server, date]);
  if (error) return <p role="alert" className="error">{error}</p>;
  if (!items) return <p className="econ-note" role="status">퍼즐을 불러오는 중…</p>;
  if (!items.length) return <section className="econ-page daily-page"><p className="econ-note">이 날짜에는 퍼즐이 없어요.</p><button className="secondary" onClick={onBack}>돌아가기</button></section>;
  const item = items[index];
  return (
    <section className="econ-page daily-page daily-puzzles" aria-labelledby="daily-puzzle-title">
      <div className="econ-head">
        <h1 id="daily-puzzle-title">{closed ? `지난 퍼즐 ${date}` : "오늘의 전략 퍼즐"}</h1>
        <button className="secondary" onClick={onBack}>돌아가기</button>
      </div>
      <div role="tablist" aria-label="퍼즐 난이도" className="ui-tabs daily-level-tabs">
        {items.map((it, i) => (
          <button key={it.question.id} role="tab" aria-selected={i === index} className={i === index ? "active" : ""} onClick={() => setIndex(i)}>
            {it.result ? (it.result.correct ? <CheckCircle2 size={14} aria-label="정답" /> : <XCircle size={14} aria-label="오답" />) : <Circle size={14} aria-hidden="true" />}
            {LEVEL_NAMES[it.question.level as PuzzleLevel]}
          </button>
        ))}
      </div>
      <PuzzleCard key={item.question.id} server={server} date={date} closed={closed} item={item} onAnswered={(next) => {
        setItems((list) => list && list.map((x, i) => (i === index ? next : x)));
        onAnswered?.();
      }} />
    </section>
  );
}

function PuzzleCard({ server, date, closed, item, onAnswered }: { server: string; date: string; closed: boolean; item: PuzzleItem; onAnswered: (next: PuzzleItem) => void }) {
  const q = item.question;
  const pos = q.position;
  const [held, setHeld] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answered = !!item.result && !!item.key;
  const canAnswer = !answered && !busy && (closed || signedIn());
  const submit = async (key: string) => {
    if (!canAnswer) return;
    setBusy(true);
    setError("");
    try {
      const r = await sendAnswer(server, date, q.id, key);
      onAnswered({ ...item, result: r.result, key: r.key });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const turn = q.objective !== "probability" && pos;
  const game: MultiGame | null = turn ? {
    dice: pos.dice.map((value, id) => ({ id, value, held: !!(held & (1 << id)) })), order: [0, 1, 2, 3, 4], cards: [pos.card], player: 0,
    round: Math.max(1, pos.round), rolls: 3 - pos.rollsLeft, done: false, winners: [], seed: 0, rng: [0], actions: 0,
  } : null;
  const keptKey = turn ? keepKey(pos.dice.filter((_, i) => held & (1 << i))) : "";
  return (
    <article className="daily-puzzle-card">
      <header>
        <span className="daily-chip">{KIND_NAMES[q.kind]}</span>
        <span className="daily-chip">{LEVEL_NAMES[q.level]}</span>
        <span className="daily-chip daily-chip-exact">{q.method === "exact" ? "정확 계산" : "확률적 추정"}</span>
      </header>
      <h2>{q.prompt}</h2>
      {turn && game && (
        <>
          <ul className="daily-facts">
            <li>라운드 {pos.round} / 12 · 다시 굴릴 수 있는 횟수 {pos.rollsLeft}회</li>
            <li>현재 {total(pos.card)}점 · 상단 {upper(pos.card)}/63</li>
            {pos.opponent && <li>상대 {pos.opponent.total}점{pos.opponent.finished ? " (경기 종료)" : " (진행 중)"}</li>}
          </ul>
          <div className="game-board throw-tray daily-puzzle-board">
            <DiceArea state={game} interactive={canAnswer && pos.rollsLeft > 0} animate={false} onToggle={(id) => setHeld((m) => m ^ (1 << id))} forceRenderer="2.5d" />
            {pos.rollsLeft > 0 && (
              <div className="roll-area">
                <button className="primary" disabled={!canAnswer || held === 31} onClick={() => void submit(keptKey)}>
                  {held ? "고른 주사위를 남기고 다시 굴리기" : "모두 다시 굴리기"}
                </button>
                <p>남길 주사위를 누르거나, 점수표에서 바로 기록할 칸을 고르세요.</p>
              </div>
            )}
          </div>
          <MultiScoreboard state={game} labels={["나"]} select={canAnswer ? (c: Category) => void submit(scoreKey(c)) : undefined} />
        </>
      )}
      {q.objective === "probability" && q.choices && (
        <div className="daily-choices">
          {pos && <p className="daily-kept">남긴 주사위: {pos.dice.filter((v) => v > 0).join(" · ")}</p>}
          {q.choices.map((c) => (
            <button key={c.id} className={"secondary" + (item.result?.answer === "o:" + c.id ? " chosen" : "")} disabled={!canAnswer} onClick={() => void submit("o:" + c.id)}>{c.id}. {c.label}</button>
          ))}
        </div>
      )}
      {!answered && !closed && !signedIn() && <p className="econ-note">오늘의 퍼즐 답과 해설은 로그인하면 볼 수 있어요. 지난 퍼즐은 누구나 풀 수 있어요.</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {answered && item.key && item.result && <Explanation item={item} />}
    </article>
  );
}

function Explanation({ item }: { item: PuzzleItem }) {
  const key = item.key!, r = item.result!;
  const chosen = key.values.find((v) => v.key === r.answer);
  const expected = key.expected;
  return (
    <section className={"daily-explain " + (r.correct ? "is-correct" : "is-wrong")} aria-label="해설">
      <h3>{r.correct ? "정답이에요" : "아쉬워요"}</h3>
      {chosen && !r.correct && <p>고른 행동: {chosen.label} — {fmtValue(chosen.value, key.unit)} (최선보다 {key.unit === "%" ? ((r.loss ?? 0) * 100).toFixed(1) + "%p" : (r.loss ?? 0).toFixed(2) + "점"} 낮음)</p>}
      <ul>{key.explanation.map((line) => <li key={line}>{line}</li>)}</ul>
      {item.question.objective !== "probability" && (
        <table className="daily-values">
          <caption>행동별 {item.question.objective === "win" ? "승리 확률" : "기대 최종점수"} (상위 6개)</caption>
          <thead><tr><th>행동</th><th>{item.question.objective === "win" ? "승리 확률" : "기대점수"}</th>{expected && <th>기대점수</th>}</tr></thead>
          <tbody>
            {key.values.slice(0, 6).map((v) => (
              <tr key={v.key} className={(key.best.includes(v.key) ? "best " : "") + (v.key === r.answer ? "mine" : "")}>
                <td>{v.label}{key.best.includes(v.key) ? " ★" : ""}</td>
                <td>{fmtValue(v.value, key.unit)}</td>
                {expected && <td>{fmtValue(expected.find((e) => e.key === v.key)?.value ?? NaN, "점")}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="daily-model">계산 방식: {key.model}. ★ 표시는 모두 정답이에요.</p>
    </section>
  );
}

export const categoryLabel = (c: Category) => names[c];
export const allCategories = categories;
