import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Copy, Crown, Dices, Flag, Home, LogOut, Play, Share2, Trophy, Wifi, WifiOff } from "lucide-react";
import { names, type Category, type Game } from "../engine";
import { DiceArea } from "../DiceArea";
import { Scoreboard } from "../Scoreboard";
import MobileQuickScore from "../MobileQuickScore";
import MobileScoreSheet, { MobileScoreButton } from "../MobileScoreSheet";
import { ErrorMessage } from "../ui/common";
import { ConfirmDialog, type PendingAction } from "../ui/ConfirmDialog";
import { Celebrate } from "../ui/Celebrate";
import { useGameSounds, useThrowGesture } from "../game-feel";
import { useDiceBusy } from "../useDiceBusy";
import { announceScore, clearScoreFx } from "../score-fx";
import { toggleHoldOrder } from "../hold-order";
import { useYachtReady } from "../yacht-moment";
import { QuickPicks } from "../QuickPicks";
import { playSfx } from "../sound";
import { OnlineConnection, forgetSeat, inviteLink, savedSeat, setRoomInUrl, type ConnectionStatus } from "../online/client";
import type { OnlineAction } from "../online/protocol";
import type { PlayerView } from "../online/server-engine";

/** Every screen shows the dice in the same row order (no local drag reordering online). */
const ROW = [0, 1, 2, 3, 4];
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Online room: waiting room, then the same game table as offline play (3D dice, score effects,
 * score sheet). Everything shown comes from server-confirmed state; the only local state is the
 * hold selection before a roll (sent with the roll, and as a live preview to the opponent).
 */
export default function OnlineGame({ server, code, onLeave, onProgress }: { server: string; code: string; onLeave: (message?: string) => void; onProgress?: (inProgress: boolean) => void }) {
  const seat = useMemo(() => savedSeat(code), [code]);
  const [view, setView] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [online, setOnline] = useState<string[]>([]);
  // Held dice in selection order (= shelf order). The server shares it, so both screens match.
  const [keep, setKeep] = useState<number[]>([]);
  /** Number of hold messages this screen has sent; an echo older than the latest one is ignored. */
  const holdSent = useRef(0);
  /** Players whose arrival was announced with the join sound (each at most once). */
  const announced = useRef(new Set<string>());
  /** Bumped on every catch-up sync (welcome after load/reconnect): sounds stay silent for it. */
  const [syncKey, setSyncKey] = useState(0);
  const [rollEvent, setRollEvent] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);
  const [mobileScoreOpen, setMobileScoreOpen] = useState(false);
  const [confirm, setConfirm] = useState<PendingAction>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const conn = useRef<OnlineConnection | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const lastDice = useRef<number[]>([1, 2, 3, 4, 5]);
  const rolling = useDiceBusy();

  useEffect(() => {
    if (!seat) {
      onLeave("이 브라우저에는 이 방의 참가 정보가 없어요. 초대 코드로 다시 입장해 주세요.");
      return;
    }
    clearScoreFx();
    const c = new OnlineConnection(server, code, seat.token, {
      onView(next, live, hold) {
        const prev = viewRef.current;
        const me = next.you?.playerId;
        /** Shared hold order for this view (server value; for an older server, derived from the roll). */
        const applyHold = (fallback: (current: number[]) => number[]) => {
          const turn = next.turn;
          if (!turn || turn.rolls === 0 || next.status !== "playing") return setKeep([]);
          if (hold === undefined) return setKeep(fallback);
          if (!hold || hold.playerId !== turn.playerId) return setKeep([]);
          if (hold.playerId === me) {
            // My own selection: a server value older than my latest toggle is ignored.
            if (hold.n < holdSent.current) return;
            holdSent.current = hold.n;
          }
          setKeep(hold.keep);
        };
        const nameOf = (id: string) => next.players.find((p) => p.playerId === id)?.name ?? "";
        if (!live) setSyncKey((n) => n + 1);
        let rolled = false;
        let kept: number[] | null = null;
        if (live && prev) {
          for (const e of next.events) {
            if (e.seq < prev.version) continue;
            if (e.type === "diceRolled") {
              rolled = true;
              kept = e.kept;
            } else if (e.type === "categoryScored") {
              // The dice that made the combination rise (3D) — same effect as offline play.
              announceScore(e.dice.map((value, id) => ({ id, value })), e.category);
              setFeedback(`${e.playerId === me ? "나" : nameOf(e.playerId)} · ${names[e.category]} ${e.points}점 기록`);
            } else if (e.type === "playerJoined" && e.playerId !== me && !announced.current.has(e.playerId)) {
              // A new player entered while this screen was open (not a reconnect, not the first load).
              announced.current.add(e.playerId);
              playSfx("join");
            } else if (e.type === "playerForfeited") {
              setFeedback(e.reason === "timeout" ? `${nameOf(e.playerId)} 님의 제한 시간이 지났어요.` : `${nameOf(e.playerId)} 님이 기권했어요.`);
            }
          }
        }
        applyHold((current) => {
          if (!kept) return current;
          const ordered = current.filter((i) => kept!.includes(i));
          for (const i of kept) if (!ordered.includes(i)) ordered.push(i);
          return ordered;
        });
        if (next.turn?.dice.length) lastDice.current = next.turn.dice;
        viewRef.current = next;
        setView(next);
        setDeadline(next.turn?.remainingMs != null ? Date.now() + next.turn.remainingMs : null);
        if (rolled) setRollEvent((n) => n + 1);
      },
      onHold(hold) {
        const view = viewRef.current;
        const turn = view?.turn;
        if (!turn || turn.playerId !== hold.playerId || turn.rolls === 0) return;
        if (hold.playerId === view?.you?.playerId) {
          if (hold.n < holdSent.current) return; // an older echo of my own toggles
          holdSent.current = hold.n;
        }
        setKeep(hold.keep);
      },
      onPresence: setOnline,
      onStatus: setStatus,
      onFatal: (message) => onLeave(message),
    });
    conn.current = c;
    c.start();
    return () => {
      c.stop();
      conn.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, code]);

  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);

  const playing = view?.status === "playing";
  useEffect(() => onProgress?.(!!playing), [playing]);
  useEffect(() => () => onProgress?.(false), []);

  const send = async (action: OnlineAction, versioned = true) => {
    const c = conn.current;
    if (!c || !view) return null;
    setSending(true);
    setError("");
    try {
      const ack = await c.command(action, versioned ? view.version : undefined);
      // A stale view is refreshed by the server automatically; no message needed.
      if (!ack.ok && ack.error.code !== "STALE_VERSION") setError(ack.error.message);
      return ack;
    } finally {
      setSending(false);
    }
  };

  const me = view?.you ?? null;
  const players = view?.players ?? [];
  const opponent = players.find((p) => p.playerId !== me?.playerId) ?? null;
  /* ------------------------------------------------- derived game table (hooks stay above early returns) ------------------------------------------------- */
  const turn = view?.turn ?? null;
  const myTurn = !!me && turn?.playerId === me.playerId && view?.status === "playing";
  const meIndex = Math.max(0, players.findIndex((p) => p.playerId === me?.playerId)) as 0 | 1;
  const turnIndex = Math.max(0, players.findIndex((p) => p.playerId === turn?.playerId)) as 0 | 1;
  const rolls = turn?.rolls ?? 0;
  const values = turn?.dice.length ? turn.dice : lastDice.current;
  const finished = view?.status === "finished";
  const winners = view?.winners ?? [];
  const outcome = finished ? (winners.length !== 1 ? "draw" : winners[0] === me?.playerId ? "win" : "lose") : null;
  const game: Game = {
    dice: values.map((value, id) => ({ id, value, held: rolls > 0 && keep.includes(id) })),
    order: ROW,
    cards: [players[0]?.card ?? {}, players[1]?.card ?? {}],
    player: turnIndex,
    round: turn?.round ?? 12,
    rolls,
    done: finished,
    winner: finished ? (outcome === "draw" ? "draw" : (players.findIndex((p) => p.playerId === winners[0]) as 0 | 1)) : null,
    seed: 0,
    rng: [0, 0],
    actions: view?.version ?? 0,
  };
  const labels = players.map((p) => p.name) as [string, string];
  const can = myTurn && !sending && !rolling && status === "online";
  const allHeld = keep.length === 5;
  const canRoll = can && rolls < 3 && !(rolls > 0 && allHeld);
  const roll = () => {
    if (!canRoll) return;
    // Kept dice in selection order; the server keeps that order for both screens (the engine sorts its copy).
    void send({ type: "roll", keep: rolls > 0 ? keep : [] });
  };
  const toggle = (id: number) => {
    if (!can || rolls === 0 || rolls >= 3) return;
    const next = toggleHoldOrder(keep, id);
    setKeep(next);
    conn.current?.hold(next, ++holdSent.current);
  };
  const record = (category: Category) => {
    if (!can || rolls === 0 || players[meIndex]?.card[category] !== undefined) return;
    void send({ type: "score", category });
    setMobileScoreOpen(false);
  };
  const remaining = deadline !== null && playing ? deadline - now : null;
  const gesture = useThrowGesture(canRoll, roll);
  const yachtReady = useYachtReady(game.dice, rolls, myTurn && players[meIndex]?.card.yacht === undefined);
  const celebration = useGameSounds(game.cards, finished, outcome, syncKey);


  if (!seat) return null;
  if (!view)
    return (
      <p className="online-connecting" role="status">
        {status === "reconnecting" ? "서버에 다시 연결하는 중이에요…" : "방에 연결하는 중이에요…"}
      </p>
    );

  const banner =
    status !== "online" ? (
      <p className="online-banner offline" role="status">
        <WifiOff size={15} /> 연결이 끊어졌어요. 다시 연결하는 중이에요…
      </p>
    ) : opponent && view.status === "playing" && !online.includes(opponent.playerId) ? (
      <p className="online-banner" role="status">
        <WifiOff size={15} /> {opponent.name} 님의 연결이 끊어졌어요. 다시 들어오면 이어서 진행돼요.
      </p>
    ) : null;

  /* ---------------------------------------------------------------- lobby ---------------------------------------------------------------- */
  if (view.status === "lobby") {
    const link = inviteLink(code);
    const canShare = typeof navigator.share === "function";
    /** Copy the invite link; falls back to a selection copy for in-app browsers without the Clipboard API. */
    const copy = async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(link);
        ok = true;
      } catch {
        const field = document.createElement("textarea");
        field.value = link;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
        field.remove();
      }
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } else setError("복사하지 못했어요. 아래 링크를 길게 눌러 복사해 주세요.");
    };
    const share = async () => {
      try {
        await navigator.share({ title: "요트다이스 온라인 대전", text: "요트다이스 한 판 해요!", url: link });
      } catch {
        /* cancelled */
      }
    };
    return (
      <section className="online-lobby" aria-labelledby="online-lobby-title">
        <h1 id="online-lobby-title">대기실</h1>
        {banner}
        <div className="online-room-code">
          <span>초대 코드</span>
          <strong aria-label="초대 코드">{code}</strong>
          <div className="online-invite-actions">
            <button type="button" className="primary" onClick={() => void copy()}>
              <Copy size={15} /> {copied ? "링크를 복사했어요" : "초대 링크 복사"}
            </button>
            {canShare && (
              <button type="button" className="secondary" onClick={() => void share()}>
                <Share2 size={15} /> 공유
              </button>
            )}
          </div>
          <input className="online-invite-link" aria-label="초대 링크" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <ul className="online-players" aria-label="참가자">
          {[0, 1].map((i) => {
            const p = players[i];
            return (
              <li key={i} className={p ? "" : "empty"}>
                {p ? (
                  <>
                    <span className={"online-dot" + (online.includes(p.playerId) ? " on" : "")} aria-hidden="true" />
                    <strong>{p.name}</strong>
                    {p.playerId === me?.playerId && <span className="online-tag">나</span>}
                    {i === 0 && (
                      <span className="online-tag host">
                        <Crown size={12} /> 방장
                      </span>
                    )}
                  </>
                ) : (
                  <span>친구를 기다리는 중…</span>
                )}
              </li>
            );
          })}
        </ul>
        {me?.isHost ? (
          <button type="button" className="primary online-start" disabled={players.length < 2 || sending || status !== "online"} onClick={() => void send({ type: "start" })}>
            <Play size={17} /> 게임 시작
          </button>
        ) : (
          <p className="online-wait">방장이 게임을 시작하면 바로 시작돼요.</p>
        )}
        <ErrorMessage message={error} />
        <button
          type="button"
          className="text-button online-leave"
          onClick={async () => {
            const ack = await send({ type: "leave" }, false);
            if (ack?.ok) {
              forgetSeat(code);
              onLeave();
            }
          }}
        >
          <LogOut size={15} /> 방 나가기
        </button>
      </section>
    );
  }

  return (
    <>
      <div className="game-grid online-game">
        <div className="game-left">
          <div className="game-tools">
            <span className="online-code-chip">
              {status === "online" ? <Wifi size={14} /> : <WifiOff size={14} />} 방 {code}
            </span>
            {playing && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setConfirm({
                    title: "기권할까요?",
                    message: "기권하면 이 경기는 상대의 승리로 끝나요.",
                    confirmLabel: "기권",
                    run: () => void send({ type: "resign" }, false),
                  })
                }
              >
                <Flag size={15} /> 기권
              </button>
            )}
          </div>
          <div className="score-summary">
            {players.map((p, seatIndex) => (
              <div key={p.playerId} className={!finished && turnIndex === seatIndex ? "selected" : ""} data-seat={seatIndex} data-role={p.playerId === me?.playerId ? "human" : "opponent"}>
                <span>
                  {p.name}
                  {p.playerId === me?.playerId ? " (나)" : ""}
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
          {banner}
          <section className={"game-board throw-tray" + (rolls === 0 ? " dice-ready" : "")} aria-label="게임 보드" {...gesture}>
            <Celebrate value={celebration} />
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {finished ? "경기 종료" : myTurn ? "나의 차례" : `${players[turnIndex]?.name ?? "상대"}의 차례`}
              </span>
              <span>
                굴림 <b>{rolls}</b> / 3
              </span>
            </div>
            <DiceArea state={game} interactive={can && rolls > 0 && rolls < 3} animate rollEvent={rollEvent} onToggle={toggle} holdOrder={rolls > 0 ? keep : []} />
            <div className="roll-area">
              <button className={"primary roll-button" + (myTurn ? "" : " waiting")} disabled={!canRoll} onClick={roll}>
                <Dices size={20} />
                {myTurn ? (rolls === 0 ? "주사위 굴리기" : "다시 굴리기") : finished ? "경기 종료" : `${players[turnIndex]?.name ?? "상대"} 님의 차례`}
                {myTurn && <span>{3 - rolls}회 남음</span>}
              </button>
              <p className="online-turn-line">
                {remaining !== null && <span className="turn-timer">남은 시간 {clock(remaining)}</span>}
                {myTurn && !rolling && rolls === 3 ? " 점수 칸을 선택하세요" : ""}
              </p>
              <QuickPicks values={game.dice.map((d) => d.value)} card={players[meIndex]?.card ?? {}} rolls={rolls} canScore={can} onScore={record} />
            </div>
            {finished && (
              <div className="game-result" role="status">
                <Trophy size={25} />
                <h2>{outcome === "draw" ? "무승부입니다" : outcome === "win" ? "승리했습니다!" : `${players.find((p) => p.playerId === winners[0])?.name ?? "상대"} 님이 승리했습니다`}</h2>
                <p>
                  {players[meIndex]?.total ?? 0} : {opponent?.total ?? 0}
                </p>
                <div className="game-result-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      forgetSeat(code);
                      onLeave();
                    }}
                  >
                    새 방 만들기
                    <ArrowRight size={16} />
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      forgetSeat(code);
                      setRoomInUrl(null);
                      location.hash = "home";
                    }}
                  >
                    <Home size={15} /> 홈으로
                  </button>
                </div>
              </div>
            )}
          </section>
          <MobileScoreButton onClick={() => setMobileScoreOpen(true)} rolls={rolling ? 0 : rolls} canScore={can} yacht={yachtReady} />
          {mobileScoreOpen && (
            <MobileScoreSheet onClose={() => setMobileScoreOpen(false)}>
              <MobileQuickScore cards={game.cards} dice={game.dice} rolls={rolling ? 0 : rolls} current={turnIndex} labels={labels} canScore={can} onScore={record} />
            </MobileScoreSheet>
          )}
          {feedback && (
            <p className="game-feedback" role="status">
              {feedback}
            </p>
          )}
          <ErrorMessage message={error} />
        </div>
        <Scoreboard state={game} labels={labels} selectPlayer={meIndex} select={can ? record : undefined} />
      </div>
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "확인"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const run = confirm?.run;
          setConfirm(null);
          run?.();
        }}
      />
    </>
  );
}
