import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Puzzle, ShieldCheck, Trophy, Users } from "lucide-react";
import { serverFeatures } from "../online/client";
import { useNickname } from "../identity/display-name";
import { archiveDates, dailyStreak, kstDate } from "./calendar";
import { archiveDriver, archiveResults, saveArchiveResult } from "./archive";
import * as api from "./client";
import type { DailyView } from "./game";
import { isVisibility, type RankedEntry, type Visibility } from "./ranking";
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
        <p className="econ-note">오늘의 요트와 오늘의 퍼즐은 준비 중이에요. 공식 랭킹의 신뢰성 검증이 끝나면 열려요.</p>
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
          <RankingPanel server={server} date={today.date} member={member} visibility={today.me?.visibility ?? null} onVisibility={reload} />
          {member && history && <MyRecords history={history} />}
          <ArchivePanel now={Date.now() + skew} onPlay={(d) => void openArchive(d)} onPuzzles={(d) => setScreen({ kind: "puzzles", date: d, closed: true })} />
          <details className="daily-fairness">
            <summary><ShieldCheck size={15} aria-hidden="true" /> 공정성 확인</summary>
            <p>오늘의 주사위는 서버만 아는 비밀 키로 정해져요. 키는 하루가 끝난 뒤(한국 시간 자정 + 30분) 공개되고, 오늘 아침 공개한 확인값과 맞는지, 내 기록이 그 키로 그대로 재현되는지 누구나 검사할 수 있어요.</p>
            <p>오늘의 확인값: <code>{today.commitment.slice(0, 16)}…</code></p>
            <p>같은 날 연습은 공식 도전을 마친 뒤에만 열려요. 결과 공유에는 주사위 눈이 들어가지 않아요.</p>
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
        <p>모든 참가자가 같은 주사위로 겨뤄요. 첫 공식 도전만 순위에 들어가요.</p>
        {!member ? (
          <button className="primary" onClick={onSignIn}>로그인하고 도전하기</button>
        ) : !o ? (
          <button className="primary" onClick={onOfficial}>공식 도전 시작</button>
        ) : o.status === "playing" ? (
          <button className="primary" onClick={onOfficial}>이어서 하기 · 라운드 {Math.min(12, o.state.round)}</button>
        ) : (
          <>
            <p className="daily-score"><strong>{o.state.score}</strong>점 <span className="daily-badge daily-badge-official">{o.status === "finished" ? "공식 기록" : "시간 종료"}</span>{!o.ranked && <small> · 오늘 가입한 계정은 내일부터 순위 반영</small>}</p>
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

/** Shown under a finished official game: server score, current rank (one request), share, practice. */
function OfficialAfter({ server, date, view, ranked, onPractice }: { server: string; date: string; view: DailyView; ranked: boolean; onPractice: () => void }) {
  const [me, setMe] = useState<RankedEntry | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (ranked) api.ranking(server, date, 0, 1).then((p) => (setMe(p.me), setTotal(p.total))).catch(() => undefined);
  }, [server, date, ranked]);
  return (
    <section className="daily-after" aria-label="공식 도전 결과">
      <p><strong>{view.score}점</strong> · 공식 기록{me ? ` · 지금 ${me.rank}위 / ${total}명` : ranked ? "" : " · 오늘 가입한 계정은 내일부터 순위에 들어가요"}</p>
      <DailyShareButton input={{ date, score: view.score, card: view.card, rank: me?.rank, players: total || null }} />
      <button className="secondary" onClick={onPractice}>같은 주사위로 연습</button>
    </section>
  );
}

function RankingPanel({ server, date, member, visibility, onVisibility }: { server: string; date: string; member: boolean; visibility: Visibility | null; onVisibility: () => void }) {
  const [tab, setTab] = useState<"all" | "friends">("all");
  const [page, setPage] = useState<api.RankingPage | null>(null);
  const [friends, setFriends] = useState<api.FriendsRanking | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    if (tab === "all") api.ranking(server, date).then(setPage).catch((e: Error) => setError(e.message));
    else api.friendsRanking(server, date).then(setFriends).catch((e: Error) => setError(e.message));
  }, [server, date, tab]);
  const more = () => page && api.ranking(server, date, page.offset + page.limit, page.limit).then((next) => setPage({ ...next, entries: [...page.entries, ...next.entries], offset: next.offset }));
  const rows = tab === "all" ? page?.entries ?? [] : friends?.entries ?? [];
  return (
    <section className="daily-ranking" aria-labelledby="daily-ranking-title">
      <div className="econ-head">
        <h2 id="daily-ranking-title"><Users size={18} aria-hidden="true" /> 오늘의 순위</h2>
        <div role="tablist" aria-label="순위 범위" className="ui-tabs">
          <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>전체</button>
          <button role="tab" aria-selected={tab === "friends"} className={tab === "friends" ? "active" : ""} disabled={!member} onClick={() => setTab("friends")}>친구</button>
        </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {tab === "all" && page?.me && <p className="daily-me-rank">내 순위 {page.me.rank}위 / {page.total}명 · {page.me.score}점</p>}
      {rows.length ? (
        <ol className="daily-rank-list">
          {rows.map((e, i) => (
            <li key={i + e.nickname + e.finishedAt} className={e.me ? "me" : ""}>
              <span className="rank">{e.rank}</span>
              <span className="name">{e.nickname}{e.yacht ? " ⭐" : ""}</span>
              <span className="score">{e.score}점</span>
              {"globalRank" in e && <small>전체 {(e as { globalRank: number }).globalRank}위</small>}
            </li>
          ))}
        </ol>
      ) : <p className="econ-note">{tab === "friends" ? "오늘 도전한 친구가 아직 없어요." : "아직 기록이 없어요. 첫 기록을 남겨 보세요."}</p>}
      {tab === "all" && page && page.offset + page.limit < page.total && <button className="secondary" onClick={() => void more()}>더 보기</button>}
      <p className="daily-rank-note">같은 점수는 같은 순위예요(먼저 끝낸 사람이 위에 표시). 날짜와 규칙 버전({"yacht-12@1"})마다 따로 집계해요.</p>
      {member && visibility && (
        <label className="daily-visibility">내 기록 공개 범위
          <select value={visibility} onChange={(e) => isVisibility(e.target.value) && api.setVisibility(server, e.target.value).then(onVisibility)}>
            <option value="public">전체 공개</option>
            <option value="friends">친구에게만</option>
            <option value="private">나만 보기</option>
          </select>
        </label>
      )}
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
        <li><span>평균</span><strong>{h.average === null ? "—" : h.average.toFixed(1)}</strong></li>
        <li><span>연속 참여</span><strong>{streak}일</strong></li>
        <li><span>퍼즐</span><strong>{h.puzzles.correct}/{h.puzzles.answered}</strong><small>정답/참여</small></li>
      </ul>
      {h.records.length > 0 && (
        <ol className="daily-history">
          {h.records.slice(0, 14).map((r) => <li key={r.date}><span>{r.date}</span><span>{r.status === "finished" ? `${r.score}점` : r.status === "playing" ? "진행 중" : "시간 종료"}</span>{!r.ranked && <small>순위 제외</small>}</li>)}
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
      <p className="daily-rank-note">지난 도전은 공개된 그날의 주사위로 이 기기에서 연습해요. 순위에는 들어가지 않아요.</p>
    </section>
  );
}
