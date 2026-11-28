import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Puzzle, ShieldCheck, Trophy } from "lucide-react";
import { serverFeatures } from "../online/client";
import { useNickname } from "../identity/display-name";
import { archiveDates, dailyStreak, kstDate } from "./calendar";
import { archiveDriver, archiveResults, saveArchiveResult } from "./archive";
import * as api from "./client";
import type { DailyView } from "./game";
import DailyGame, { type Driver } from "./DailyGame";
import DailyPuzzles from "./DailyPuzzles";
import { DailyShareButton } from "./DailyShare";
import { LEVEL_NAMES, type PuzzleLevel } from "./puzzles/types";
import "./daily.css";

/**
 * 오늘의 요트 · 오늘의 전략 퍼즐 (LIVE-1). An independent page at `#daily`. It shows nothing unless the
 * server reports `features.daily` (production: off). Placing its cards on the home lobby and in the
 * common navigation is left to the shell owner (01): `DailyHomeCards` is exported for that.
 */
type Screen = { kind: "home" } | { kind: "game"; driver: Driver; initial: Pick<api.AttemptView, "status" | "ranked" | "state"> } | { kind: "puzzles"; date: string; closed: boolean };

const commitKey = "yachtlab-daily-commitments";
function rememberCommitment(date: string, c: string) {
  try {
    const m = JSON.parse(localStorage.getItem(commitKey) ?? "{}") as Record<string, string>;
    if (m[date] === c) return;
    m[date] = c;
    const recent = Object.fromEntries(Object.entries(m).sort().slice(-60));
    localStorage.setItem(commitKey, JSON.stringify(recent));
  } catch {
    /* ignore */
  }
}
function knownCommitment(date: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(commitKey) ?? "{}") as Record<string, string>)[date] ?? null;
  } catch {
    return null;
  }
}

function useCountdown(to: number | null, skew: number) {
  const [now, setNow] = useState(Date.now() + skew);
  useEffect(() => {
    setNow(Date.now() + skew);
    const t = setInterval(() => setNow(Date.now() + skew), 30_000);
    return () => clearInterval(t);
  }, [skew]);
  if (!to) return "";
  const left = Math.max(0, to - now);
  return `${Math.floor(left / 3600_000)}시간 ${Math.floor((left % 3600_000) / 60_000)}분`;
}

export default function DailyPage({ server, go }: { server: string | null; go: (route: "profile" | "home") => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!server) return setEnabled(false);
    void serverFeatures(server).then((f) => setEnabled(!!(f as { daily?: boolean }).daily));
  }, [server]);
  if (!server || enabled === false)
    return (
      <section className="econ-page daily-page" aria-labelledby="daily-title">
        <h1 id="daily-title">오늘의 요트</h1>
        <p className="econ-note">오늘의 요트와 오늘의 퍼즐은 준비 중이에요.</p>
        <button className="secondary" onClick={() => go("home")}>홈으로</button>
      </section>
    );
  if (enabled === null) return <p className="econ-note" role="status">불러오는 중…</p>;
  return <DailyHub server={server} go={go} />;
}

function DailyHub({ server, go }: { server: string; go: (route: "profile" | "home") => void }) {
  const nickname = useNickname();
  const [today, setToday] = useState<api.Today | null>(null);
  const [history, setHistory] = useState<api.History | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [officialDone, setOfficialDone] = useState<DailyView | null>(null);
  const member = api.signedIn();
  const reload = () => setTick((n) => n + 1);
  useEffect(() => {
    api.today(server).then((t) => {
      setToday(t);
      rememberCommitment(t.date, t.commitment);
    }).catch((e: Error) => setError(e.message));
    if (member) api.history(server).then(setHistory).catch(() => undefined);
  }, [server, tick, member]);
  // Server clock (date boundaries are decided there): the device clock may be wrong or in another zone.
  const skew = today ? today.now - Date.now() : 0;
  const countdown = useCountdown(today ? Date.parse(today.nextDate + "T00:00:00+09:00") : null, skew);

  const serverDriver = (date: string, mode: api.Mode): Driver => ({ mode, date, step: (seq, step) => api.play(server, date, mode, seq, step) });
  const openOfficial = async (mode: api.Mode) => {
    if (!today) return;
    setError("");
    try {
      const r = await api.start(server, today.date, mode);
      setScreen({ kind: "game", driver: serverDriver(today.date, mode), initial: r.attempt });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const openArchive = async (date: string) => {
    setError("");
    try {
      const r = await api.reveal(server, date);
      const driver = archiveDriver(date, r.key, knownCommitment(date) ?? r.commitment);
      setScreen({ kind: "game", initial: { status: "playing", ranked: false, state: driver.view() }, driver: { mode: "archive", date, step: async (_seq, step) => ({ attempt: { status: "playing", ranked: false, state: driver.step(step) } }) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const finished = (driver: Driver, v: DailyView) => {
    if (driver.mode === "archive") saveArchiveResult({ date: driver.date, score: v.score, at: Date.now() });
    if (driver.mode === "official") setOfficialDone(v);
  };

  if (screen.kind === "game")
    return (
      <>
        <DailyGame key={screen.driver.mode + screen.driver.date + screen.initial.state.seq} driver={screen.driver} initial={screen.initial} name={nickname || "나"}
          onFinished={(v) => finished(screen.driver, v)} onExit={() => { setScreen({ kind: "home" }); setOfficialDone(null); reload(); }} />
        {screen.driver.mode === "official" && (officialDone || screen.initial.state.done) && (
          <OfficialAfter server={server} date={screen.driver.date} view={officialDone ?? screen.initial.state} ranked={screen.initial.ranked} onPractice={() => { setOfficialDone(null); void openOfficial("practice"); }} />
        )}
      </>
    );
  if (screen.kind === "puzzles") return <DailyPuzzles server={server} date={screen.date} closed={screen.closed} onBack={() => { setScreen({ kind: "home" }); reload(); }} onAnswered={reload} />;

  return (
    <section className="econ-page daily-page" aria-labelledby="daily-title">
      <div className="econ-head">
        <h1 id="daily-title"><CalendarDays size={22} aria-hidden="true" /> 오늘의 요트</h1>
        {today && <span className="daily-date">{today.date} (한국 시간) · 다음 도전까지 {countdown}</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!today ? <p className="econ-note" role="status">불러오는 중…</p> : (
        <>
          <DailyHomeCards today={today} member={member} onOfficial={() => void openOfficial("official")} onPractice={() => void openOfficial("practice")} onPuzzles={() => setScreen({ kind: "puzzles", date: today.date, closed: false })} onSignIn={() => go("profile")} />
          {member && history && <MyRecords history={history} />}
          <ArchivePanel now={Date.now() + skew} onPlay={(d) => void openArchive(d)} onPuzzles={(d) => setScreen({ kind: "puzzles", date: d, closed: true })} />
          <details className="daily-fairness">
            <summary><ShieldCheck size={15} aria-hidden="true" /> 공정성 확인</summary>
            <p>오늘의 주사위는 서버만 아는 비밀 키로 정해져요. 키는 하루가 끝난 뒤(한국 시간 자정 + 30분) 공개되고, 오늘 아침 공개한 확인값과 맞는지, 내 기록이 그 키로 그대로 재현되는지 누구나 검사할 수 있어요.</p>
            <p>오늘의 확인값: <code>{today.commitment.slice(0, 16)}…</code></p>
            <p>같은 날 연습은 공식 도전을 마친 뒤에만 열려요. 결과 공유에는 주사위 눈이 들어가지 않아요.</p>
            <p>오늘의 요트는 경쟁 순위가 없는 개인 기록 콘텐츠예요. 점수에 따라 달라지는 보상도 없어요.</p>
          </details>
        </>
      )}
    </section>
  );
}

/** Home cards: 오늘의 도전 and 오늘의 퍼즐 (exported for the shell owner to place on the lobby). */
export function DailyHomeCards({ today, member, onOfficial, onPractice, onPuzzles, onSignIn }: { today: api.Today; member: boolean; onOfficial: () => void; onPractice: () => void; onPuzzles: () => void; onSignIn: () => void }) {
  const o = today.me?.official ?? null;
  const solved = today.me?.puzzleResults ?? [];
  return (
    <div className="daily-cards">
      <article className={"daily-card" + (o?.status === "finished" ? " is-done" : "")} aria-labelledby="daily-card-yacht">
        <h2 id="daily-card-yacht"><Trophy size={18} aria-hidden="true" /> 오늘의 도전</h2>
        <p>모든 참가자가 같은 주사위로 하루 한 번 도전해요. 순위 없이 내 기록만 남아요.</p>
        {!member ? (
          <button className="primary" onClick={onSignIn}>로그인하고 도전하기</button>
        ) : !o ? (
          <button className="primary" onClick={onOfficial}>공식 도전 시작</button>
        ) : o.status === "playing" ? (
          <button className="primary" onClick={onOfficial}>이어서 하기 · 라운드 {Math.min(12, o.state.round)}</button>
        ) : (
          <>
            <p className="daily-score"><strong>{o.state.score}</strong>점 <span className="daily-badge daily-badge-official">{o.status === "finished" ? "공식 기록" : "시간 종료"}</span></p>
            <div className="daily-card-actions">
              {o.status === "finished" && <DailyShareButton input={{ date: today.date, score: o.state.score, card: o.state.card }} />}
              <button className="secondary" disabled={!today.me?.practiceLeft} onClick={onPractice}>같은 주사위로 연습 ({today.me?.practiceLeft ?? 0}회 남음)</button>
            </div>
          </>
        )}
      </article>
      <article className="daily-card" aria-labelledby="daily-card-puzzle">
        <h2 id="daily-card-puzzle"><Puzzle size={18} aria-hidden="true" /> 오늘의 퍼즐</h2>
        <p>DP 엔진으로 정확히 계산한 판단 문제 {today.puzzles.length}개.</p>
        <ul className="daily-puzzle-list">
          {today.puzzles.map((p) => {
            const r = solved.find((x) => x.puzzleId === p.id);
            return <li key={p.id} className={r ? (r.correct ? "ok" : "no") : ""}>{LEVEL_NAMES[p.level as PuzzleLevel]} · {p.title.split(" · ")[0]} {r ? (r.correct ? "✓" : "✗") : ""}</li>;
          })}
        </ul>
        <button className="primary" disabled={!today.puzzles.length} onClick={onPuzzles}>{solved.length >= today.puzzles.length && today.puzzles.length ? "해설 다시 보기" : "퍼즐 풀기"}</button>
      </article>
    </div>
  );
}

/**
 * D-141: an AI reference score for the player's own comparison only (not a ranking, no rewards by score).
 * DP Expert's average on the daily dice (LIVE-1 measurement over 200 days: 191.98).
 */
export const AI_REFERENCE_SCORE = 192;

/** Shown under a finished official game: server score, AI reference (personal), share, practice. */
function OfficialAfter({ date, view, onPractice }: { server: string; date: string; view: DailyView; ranked: boolean; onPractice: () => void }) {
  return (
    <section className="daily-after" aria-label="공식 도전 결과">
      <p><strong>{view.score}점</strong> · 오늘의 공식 기록</p>
      <p className="daily-rank-note">참고: AI(DP Expert)는 같은 방식의 주사위에서 평균 약 {AI_REFERENCE_SCORE}점이에요. 순위나 점수별 보상은 없어요.</p>
      <DailyShareButton input={{ date, score: view.score, card: view.card }} />
      <button className="secondary" onClick={onPractice}>같은 주사위로 연습</button>
    </section>
  );
}

function MyRecords({ history }: { history: api.History }) {
  const h = history.history;
  const streak = useMemo(() => dailyStreak(h.records.map((r) => r.date), history.today), [h.records, history.today]);
  return (
    <section className="daily-records" aria-labelledby="daily-records-title">
      <h2 id="daily-records-title">내 기록</h2>
      <ul className="daily-stats">
        <li><span>개인 최고</span><strong>{h.best ? `${h.best.score}점` : "—"}</strong>{h.best && <small>{h.best.date}</small>}</li>
        <li><span>참여</span><strong>{h.played}일</strong><small>완료 {h.completed}</small></li>
        <li><span>평균</span><strong>{h.average === null ? "—" : h.average.toFixed(1)}</strong><small>AI 참고 약 {AI_REFERENCE_SCORE}</small></li>
        <li><span>연속 참여</span><strong>{streak}일</strong></li>
        <li><span>퍼즐</span><strong>{h.puzzles.correct}/{h.puzzles.answered}</strong><small>정답/참여</small></li>
      </ul>
      {h.records.length > 0 && (
        <ol className="daily-history">
          {h.records.slice(0, 14).map((r) => <li key={r.date}><span>{r.date}</span><span>{r.status === "finished" ? `${r.score}점` : r.status === "playing" ? "진행 중" : "시간 종료"}</span></li>)}
        </ol>
      )}
    </section>
  );
}

function ArchivePanel({ now, onPlay, onPuzzles }: { now: number; onPlay: (date: string) => void; onPuzzles: (date: string) => void }) {
  const dates = archiveDates(now, 30);
  const local = archiveResults();
  return (
    <section className="daily-archive" aria-labelledby="daily-archive-title">
      <h2 id="daily-archive-title">지난 도전</h2>
      {!dates.length ? <p className="econ-note">아직 지난 날짜가 없어요.</p> : (
        <ul>
          {dates.map((d) => {
            const best = local.filter((r) => r.date === d).reduce<number | null>((b, r) => (b === null || r.score > b ? r.score : b), null);
            return (
              <li key={d}>
                <span>{d}{d === kstDate(now) ? " (오늘)" : ""}</span>
                {best !== null && <small>연습 최고 {best}점</small>}
                <button className="secondary" onClick={() => onPlay(d)}>다시 플레이</button>
                <button className="secondary" onClick={() => onPuzzles(d)}>퍼즐</button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="daily-rank-note">지난 도전은 공개된 그날의 주사위로 이 기기에서 연습해요. 공식 기록과 보상에는 들어가지 않아요.</p>
    </section>
  );
}
