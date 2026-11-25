import { useEffect, useRef, useState } from "react";
import { Eye, Home, Trophy, WifiOff } from "lucide-react";
import { names, type Game } from "../engine";
import { DiceArea } from "../DiceArea";
import { Scoreboard } from "../Scoreboard";
import { OnlineConnection, setRoomInUrl, type ConnectionStatus } from "../online/client";
import type { PlayerView } from "../online/server-engine";
import type { SeriesSummary } from "../online/wire";
import { announceScore, clearScoreFx } from "../score-fx";
import { ChipBubble, useBubbles } from "./Social";
import { PlayerTag, diceLookOf } from "./Looks";
import { OnlineStandings } from "./OnlineMulti";
import { MultiScoreboard } from "../MultiScoreboard";
import type { MultiGame } from "../multi-engine";
import type { PublicLook } from "../economy/live/catalog";

const ROW = [0, 1, 2, 3, 4];
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Spectator screen (read-only). Neutral view of both players: dice, holds (shared order), score sheet,
 * turn, timer and result. There is nothing to press but "leave": the server ignores any game message
 * from a spectator socket anyway. Players' chat bubbles are shown; spectators cannot send any.
 */
export default function OnlineWatch({ server, code, watchKey, onLeave }: { server: string; code: string; watchKey: string; onLeave: (message?: string) => void }) {
  const [view, setView] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [online, setOnline] = useState<string[]>([]);
  const [keep, setKeep] = useState<number[]>([]);
  const [rollEvent, setRollEvent] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [series, setSeries] = useState<SeriesSummary | null>(null);
  const [watchers, setWatchers] = useState(0);
  const [looks, setLooks] = useState<Record<string, PublicLook>>({});
  const [fatal, setFatal] = useState("");
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  /** Multi-player view: whose detailed score sheet is open (null = the leader / current player). */
  const [picked, setPicked] = useState<string | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const lastDice = useRef<number[]>([1, 2, 3, 4, 5]);
  const social = useBubbles();

  useEffect(() => {
    clearScoreFx();
    const c = new OnlineConnection(server, code, { watchKey }, {
      onView(next, live, hold) {
        const prev = viewRef.current;
        if (prev && prev.matchId !== next.matchId) live = false;
        let rolled = false;
        const nameOf = (id: string) => next.players.find((p) => p.playerId === id)?.name ?? "";
        if (live && prev)
          for (const e of next.events) {
            if (e.seq < prev.version) continue;
            if (e.type === "diceRolled" && next.mode !== "simultaneous") rolled = true;
            else if (e.type === "categoryScored") {
              announceScore(e.dice.map((value, id) => ({ id, value })), e.category);
              setFeedback(`${nameOf(e.playerId)} · ${names[e.category]} ${e.points}점 기록`);
            } else if (e.type === "playerForfeited") setFeedback(e.reason === "timeout" ? `${nameOf(e.playerId)} 님의 제한 시간이 지났어요.` : e.reason === "left" ? `${nameOf(e.playerId)} 님이 돌아오지 않아 기권 처리됐어요.` : `${nameOf(e.playerId)} 님이 기권했어요.`);
          }
        const turn = next.turn;
        if (!turn || turn.rolls === 0 || next.status !== "playing") setKeep([]);
        else if (hold !== undefined) setKeep(hold && hold.playerId === turn.playerId ? hold.keep : []);
        if (turn?.dice.length) lastDice.current = turn.dice;
        viewRef.current = next;
        setView(next);
        const remainingMs = next.mode === "simultaneous" ? next.roundRemainingMs : turn?.remainingMs;
        setDeadline(remainingMs != null ? Date.now() + remainingMs : null);
        if (rolled) setRollEvent((n) => n + 1);
      },
      onHold(hold) {
        const turn = viewRef.current?.turn;
        if (turn && turn.playerId === hold.playerId && turn.rolls > 0) setKeep(hold.keep);
      },
      onPresence: setOnline,
      onStatus: setStatus,
      onSaid: (from, id) => !social.hideOpponent && social.show(from, id),
      onRematch: (_r, s) => setSeries(s),
      onWatching: setWatchers,
      onLooks: setLooks,
      onFatal: (message) => setFatal(message),
    });
    c.start();
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, code, watchKey]);

  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);

  const leave = () => {
    setRoomInUrl(null);
    const url = new URL(location.href);
    url.searchParams.delete("watch");
    url.searchParams.delete("k");
    history.replaceState(history.state, "", url.toString());
    onLeave();
  };

  if (fatal)
    return (
      <section className="setup online-entry" aria-labelledby="watch-title">
        <div className="setup-head">
          <h1 id="watch-title">관전</h1>
        </div>
        <div className="setup-body">
          <p className="online-invite-blocked" role="alert">
            {fatal}
          </p>
          <button type="button" className="primary" onClick={leave}>
            <Home size={15} /> 홈으로
          </button>
        </div>
      </section>
    );
  if (!view)
    return (
      <p className="online-connecting" role="status">
        {status === "reconnecting" ? "서버에 다시 연결하는 중이에요…" : "경기에 연결하는 중이에요…"}
      </p>
    );

  const players = view.players;
  const turn = view.turn;
  const rolls = turn?.rolls ?? 0;
  const finished = view.status === "finished";
  const turnIndex = Math.max(0, players.findIndex((p) => p.playerId === turn?.playerId)) as 0 | 1;
  const values = turn?.dice.length ? turn.dice : lastDice.current;
  const game: Game = {
    dice: values.map((value, id) => ({ id, value, held: rolls > 0 && keep.includes(id) })),
    order: ROW,
    cards: [players[0]?.card ?? {}, players[1]?.card ?? {}],
    player: turnIndex,
    round: turn?.round ?? 12,
    rolls,
    done: finished,
    winner: finished ? (view.winners.length !== 1 ? "draw" : (players.findIndex((p) => p.playerId === view.winners[0]) as 0 | 1)) : null,
    seed: 0,
    rng: [0, 0],
    actions: view.version,
  };
  const labels = players.map((p) => p.name) as [string, string];
  const remaining = deadline !== null && view.status === "playing" ? deadline - now : null;
  const winner = players.find((p) => p.playerId === view.winners[0]);

  if (players.length > 2 || view.mode === "simultaneous") {
    const simultaneous = view.mode === "simultaneous";
    const leader = [...players].sort((a, b) => b.total - a.total)[0]?.playerId ?? null;
    const focus = picked && players.some((p) => p.playerId === picked) ? picked : simultaneous ? leader : (turn?.playerId ?? leader);
    const focusIndex = Math.max(0, players.findIndex((p) => p.playerId === focus));
    const sheet: MultiGame = { dice: game.dice, order: ROW, cards: players.map((p) => p.card), player: focusIndex, round: view.round || 12, rolls, done: finished, winners: [], seed: 0, rng: [], actions: view.version };
    const recorded = simultaneous ? players.filter((p) => p.status === "active" && !view.progress?.[p.playerId]).length : 0;
    const activeCount = players.filter((p) => p.status === "active").length;
    const top = view.standings?.filter((x) => x.rank === 1).map((x) => players.find((p) => p.playerId === x.playerId)?.name ?? "") ?? [];
    return (
      <div className="game-grid online-game online-watch online-multi watch-multi">
        <div className="game-left">
          <div className="game-tools">
            <span className="online-code-chip watch-chip">
              <Eye size={14} /> 관전 중{watchers > 0 ? ` · ${watchers}명` : ""} · {players.length}인 {simultaneous ? "동시 진행" : "순서대로"}
            </span>
            <button type="button" className="text-button" onClick={leave}>
              <Home size={15} /> 나가기
            </button>
          </div>
          {status !== "online" && (
            <p className="online-banner offline" role="status">
              <WifiOff size={15} /> 연결이 끊어졌어요. 다시 연결하는 중이에요…
            </p>
          )}
          <section className="game-board throw-tray watch-board" aria-label="게임 보드">
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {finished ? "경기 종료" : view.status === "lobby" ? "경기 시작 전" : simultaneous ? `${Math.min(12, view.round)}라운드 · ${recorded}/${activeCount}명 기록` : `${players[turnIndex]?.name ?? ""} 님의 차례`}
              </span>
              <span>
                {simultaneous ? `${Math.min(12, view.round)}/12 라운드` : <>굴림 <b>{rolls}</b> / 3</>}
                {remaining !== null && <span className="turn-timer"> · 남은 시간 {clock(remaining)}</span>}
              </span>
            </div>
            {simultaneous ? (
              <div className="watch-progress" role="status" aria-label="이번 라운드 진행">
                <div className="watch-progress-bar">
                  <i style={{ width: `${activeCount ? (recorded / activeCount) * 100 : 0}%` }} />
                </div>
                <p>
                  {finished ? "경기가 끝났어요" : `이번 라운드 ${recorded}/${activeCount}명 기록 완료`}
                </p>
              </div>
            ) : (
              <DiceArea state={game} colors={diceLookOf(looks[players[turnIndex]?.playerId ?? ""])} interactive={false} animate rollEvent={rollEvent} onToggle={() => {}} holdOrder={rolls > 0 ? keep : []} />
            )}
            {finished && (
              <div className="game-result" role="status">
                <Trophy size={25} />
                <h2>{top.length > 1 ? `공동 1위 · ${top.join(", ")}` : `${top[0] ?? ""} 님 1위`}</h2>
                <div className="game-result-actions">
                  <button className="secondary" onClick={leave}>
                    <Home size={15} /> 관전 종료
                  </button>
                </div>
              </div>
            )}
          </section>
          {feedback && (
            <p className="game-feedback" role="status">
              {feedback}
            </p>
          )}
          <OnlineStandings view={view} me="" online={online} looks={looks} bubbles={social.bubbles} final={finished} selected={focus} onSelect={setPicked} />
        </div>
        <div className="multi-scores online-multi-scores">
          <MultiScoreboard state={sheet} labels={players.map((p) => p.name)} focused />
        </div>
      </div>
    );
  }

  return (
    <div className="game-grid online-game online-watch">
      <div className="game-left">
        <div className="game-tools">
          <span className="online-code-chip watch-chip">
            <Eye size={14} /> 관전 중{watchers > 0 ? ` · ${watchers}명` : ""}
          </span>
          <button type="button" className="text-button" onClick={leave}>
            <Home size={15} /> 나가기
          </button>
        </div>
        <div className="score-summary">
          {players.map((p, seatIndex) => (
            <div key={p.playerId} className={!finished && turnIndex === seatIndex ? "selected" : ""} data-seat={seatIndex} data-role="player">
              <ChipBubble bubble={social.bubbles[p.playerId]} look={looks[p.playerId]} />
              <span>
                <PlayerTag name={p.name} look={looks[p.playerId]} compact />
                {!online.includes(p.playerId) && view.status === "playing" ? " (연결 끊김)" : ""}
              </span>
              <strong>
                {p.total}
                <small>점</small>
              </strong>
            </div>
          ))}
          <div className="round">
            <span>라운드</span>
            <strong>
              {Math.min(12, turn?.round ?? 12)}
              <small>/ 12</small>
            </strong>
          </div>
        </div>
        {status !== "online" && (
          <p className="online-banner offline" role="status">
            <WifiOff size={15} /> 연결이 끊어졌어요. 다시 연결하는 중이에요…
          </p>
        )}
        <section className="game-board throw-tray" aria-label="게임 보드">
          <div className="board-top">
            <span className="turn-indicator">
              <i />
              {finished ? "경기 종료" : view.status === "lobby" ? "경기 시작 전" : `${players[turnIndex]?.name ?? ""} 님의 차례`}
            </span>
            <span>
              굴림 <b>{rolls}</b> / 3
            </span>
          </div>
          <DiceArea state={game} colors={diceLookOf(looks[players[turnIndex]?.playerId ?? ""])} interactive={false} animate rollEvent={rollEvent} onToggle={() => {}} holdOrder={rolls > 0 ? keep : []} />
          <div className="roll-area">
            <p className="watch-turn" role="status">
              {finished ? "경기가 끝났어요" : view.status === "lobby" ? "경기가 곧 시작돼요" : `${players[turnIndex]?.name ?? ""} 님의 차례 · 굴림 ${rolls}/3`}
              {remaining !== null && <span className="turn-timer"> · 남은 시간 {clock(remaining)}</span>}
            </p>
          </div>
          {finished && (
            <div className="game-result" role="status">
              <Trophy size={25} />
              <h2>{view.winners.length !== 1 ? "무승부" : `${winner?.name ?? ""} 님 승리`}</h2>
              <p className="online-final">
                {players[0]?.total ?? 0} : {players[1]?.total ?? 0}
              </p>
              {series && series.games > 1 && <p className="online-series">이 방에서 {series.games}경기째예요. 재대결이 시작되면 이어서 볼 수 있어요.</p>}
              <div className="game-result-actions">
                <button className="secondary" onClick={leave}>
                  <Home size={15} /> 관전 종료
                </button>
              </div>
            </div>
          )}
        </section>
        {feedback && (
          <p className="game-feedback" role="status">
            {feedback}
          </p>
        )}
      </div>
      <Scoreboard state={game} labels={labels} selectPlayer={0} />
    </div>
  );
}
