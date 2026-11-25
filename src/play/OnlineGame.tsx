import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Copy, Crown, Dices, Flag, Home, LogOut, Play, RotateCcw, Share2, Trophy, UserRound, Wifi, WifiOff, X } from "lucide-react";
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
import { BonusChip, QuickPicks } from "../QuickPicks";
import { playSfx } from "../sound";
import { useSettings } from "../settings";
import { OnlineConnection, forgetSeat, inviteLink, savedSeat, setRoomInUrl, watchLink, type ConnectionStatus } from "../online/client";
import type { OnlineAction } from "../online/protocol";
import type { PlayerView } from "../online/server-engine";
import type { LobbyState, RematchState, SeriesSummary, SpectateState } from "../online/wire";
import { LobbyPanel, MultiTable } from "./OnlineMulti";
import { SpectateControl } from "./Social";
import { SocialDock, TableFeed, useTableChat } from "./SocialDock";
import { PlayerTag, boardCssOf, boardOf, diceLookOf } from "./Looks";
import { GUEST_LOOK, itemById, type PublicLook } from "../economy/live/catalog";
import type { FxLook } from "../economy/live/content-items";
import { FxBurst } from "./FxBurst";
import { FriendInvite } from "../shell/Friends";
import { saveLocalRecord } from "../identity/local";
import { RULES_ID } from "../identity/records";
import { publicProfile, type PublicProfile } from "../identity/account-client";

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
/**
 * This device's copy of a finished online match (profile on this device / guests). The account copy
 * is written by the server itself (server-verified); this one is client-reported. Idempotent by matchId.
 */
function recordOnDevice(view: PlayerView, me: string) {
  const mine = view.players.find((p) => p.playerId === me);
  const other = view.players.find((p) => p.playerId !== me);
  if (!mine || !other) return;
  const started = view.events.find((e) => e.type === "matchStarted")?.at;
  const finished = view.events.find((e) => e.type === "matchFinished")?.at;
  const forfeit = [...view.events].reverse().find((e) => e.type === "playerForfeited");
  saveLocalRecord({
    recordId: view.matchId,
    mode: "online",
    rules: RULES_ID,
    source: "device",
    verification: "client-reported",
    startedAt: started ?? finished ?? Date.now(),
    endedAt: finished ?? Date.now(),
    name: mine.name,
    score: mine.total,
    card: { ...mine.card },
    outcome: view.winners.length !== 1 ? "draw" : view.winners[0] === me ? "win" : "loss",
    endReason: forfeit && forfeit.type === "playerForfeited" ? forfeit.reason : "completed",
    opponent: { name: other.name, kind: "guest", score: other.total },
  });
}

export default function OnlineGame({ server, code, onLeave, onProgress }: { server: string; code: string; onLeave: (message?: string) => void; onProgress?: (inProgress: boolean) => void }) {
  const seat = useMemo(() => savedSeat(code), [code]);
  const [view, setView] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [online, setOnline] = useState<string[]>([]);
  /** Absent players → when their seat is forfeited / freed (local clock). */
  const [away, setAway] = useState<Record<string, number>>({});
  // Held dice in selection order (= shelf order). The server shares it, so both screens match.
  const [keep, setKeep] = useState<number[]>([]);
  /** Number of hold messages this screen has sent; an echo older than the latest one is ignored. */
  const holdSent = useRef(0);
  /** My latest selection and the match version it was made at (to restore it if the server forgot it). */
  const mySelection = useRef<{ keep: number[]; v: number }>({ keep: [], v: -1 });
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
  const chat = useTableChat(seat?.playerId ?? null);
  const [rematch, setRematch] = useState<RematchState | null>(null);
  const [series, setSeries] = useState<SeriesSummary | null>(null);
  const [spectate, setSpectate] = useState<SpectateState | null>(null);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [looks, setLooks] = useState<Record<string, PublicLook>>({});
  const looksRef = useRef(looks);
  looksRef.current = looks;
  const [yachtFx, setYachtFx] = useState<{ fx: FxLook; level: number; seed: string } | null>(null);
  const [aiSeat, setAiSeat] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const settings = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [profileOf, setProfileOf] = useState<string | null>(null);

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
        const simultaneous = next.mode === "simultaneous";
        const applyHold = (fallback: (current: number[]) => number[]) => {
          const turn = next.turn;
          if (!turn || turn.rolls === 0 || next.status !== "playing") return setKeep([]);
          // Simultaneous rounds: my selection is mine alone (no shared shelf); other players' moves
          // must not touch it — only my own roll reorders it.
          if (simultaneous) return setKeep(fallback);
          if (hold === undefined) return setKeep(fallback);
          if (!hold && !live && turn.playerId === me && mySelection.current.v === next.version && mySelection.current.keep.length) {
            // The server lost my selection (e.g. restarted before the next command) but nothing happened
            // since I made it: keep it on screen and share it again (no storage write on the server).
            const keepNow = mySelection.current.keep;
            setKeep(keepNow);
            queueMicrotask(() => conn.current?.hold(keepNow, ++holdSent.current));
            return;
          }
          if (!hold || hold.playerId !== turn.playerId) return setKeep([]);
          if (hold.playerId === me) {
            // My own selection: a server value older than my latest toggle is ignored.
            if (hold.n < holdSent.current) return;
            holdSent.current = hold.n;
          }
          setKeep(hold.keep);
        };
        const nameOf = (id: string) => next.players.find((p) => p.playerId === id)?.name ?? "";
        if (prev && prev.matchId !== next.matchId) {
          // Rematch: a new match in the same room. Nothing from the previous match carries over.
          live = false;
          holdSent.current = 0;
          mySelection.current = { keep: [], v: -1 };
          lastDice.current = [1, 2, 3, 4, 5];
          for (const p of next.players) announced.current.add(p.playerId);
          clearScoreFx();
          setFeedback("");
          setError("");
          setMobileScoreOpen(false);
        }
        if (!live) setSyncKey((n) => n + 1);
        let rolled = false;
        let kept: number[] | null = null;
        if (live && prev) {
          for (const e of next.events) {
            if (e.seq < prev.version) continue;
            // Simultaneous rounds: only my own dice move on my table (others play their own dice).
            const mine = !simultaneous || ("playerId" in e && e.playerId === me);
            if (e.type === "diceRolled" && mine) {
              rolled = true;
              kept = e.kept;
            } else if (e.type === "categoryScored" && e.category === "yacht" && e.points === 50 && looksRef.current[e.playerId]?.fxLv && (looksRef.current[e.playerId]?.fxLv ?? 1) >= 2 && looksRef.current[e.playerId]?.fx !== "fx.none") {
              // Lv.2 special effects also play on that player's yacht (every screen, once per event).
              const lk = looksRef.current[e.playerId];
              const fxl = itemById(lk.fx)?.look.fx;
              if (fxl && (e.playerId === me || settingsRef.current.opponentFx)) setYachtFx({ fx: fxl, level: lk.fxLv, seed: `${next.matchId}-${e.seq}` });
              if (mine) announceScore(e.dice.map((value, id) => ({ id, value })), e.category);
              setFeedback(`${e.playerId === me ? "나" : nameOf(e.playerId)} · ${names[e.category]} ${e.points}점 기록`);
            } else if (e.type === "categoryScored" && mine) {
              // The dice that made the combination rise (3D) — same effect as offline play.
              announceScore(e.dice.map((value, id) => ({ id, value })), e.category);
              setFeedback(`${e.playerId === me ? "나" : nameOf(e.playerId)} · ${names[e.category]} ${e.points}점 기록${e.auto ? " (시간 초과 자동 기록)" : ""}`);
            } else if (e.type === "roundStarted" && e.round > 1) {
              setFeedback(`${e.round}라운드 시작`);
            } else if (e.type === "playerJoined" && e.playerId !== me && !announced.current.has(e.playerId)) {
              // A new player entered while this screen was open (not a reconnect, not the first load).
              announced.current.add(e.playerId);
              playSfx("join");
            } else if (e.type === "playerForfeited") {
              setFeedback(e.reason === "timeout" ? `${nameOf(e.playerId)} 님의 제한 시간이 지났어요.` : e.reason === "left" ? `${nameOf(e.playerId)} 님이 돌아오지 않아 기권 처리됐어요.` : `${nameOf(e.playerId)} 님이 기권했어요.`);
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
        if (next.status === "finished" && me && next.standings) recordOnDevice(next, me);
        viewRef.current = next;
        setView(next);
        const remainingMs = next.mode === "simultaneous" ? next.roundRemainingMs : next.turn?.remainingMs;
        setDeadline(remainingMs != null ? Date.now() + remainingMs : null);
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
      onPresence(list, awayAt) {
        setOnline(list);
        if (awayAt) setAway(awayAt);
      },
      onSaid: chat.received,
      onSpectate: setSpectate,
      onMembers: setMembers,
      onLooks: setLooks,
      onKind: (_kind, ai) => setAiSeat(ai?.playerId ?? null),
      onLobby: setLobby,
      onRematch(r, sr) {
        setRematch(r);
        setSeries(sr);
      },
      onNotice(code, message, extra) {
        // Chat refusals are shown on the chat bar itself, never as "sent".
        if (code === "SOCIAL_RATE_LIMITED" || code === "INVALID_SOCIAL") return chat.refused(code, message, extra?.retryMs);
        if (code === "LOBBY" || code === "REMATCH" || code === "SPECTATE") setError(message);
        // A refused toggle: show the server's state again (the switch moved optimistically).
        if (code === "SPECTATE") setSpectate((s) => (s ? { ...s } : s));
      },
      onStatus(next) {
        setStatus(next);
        // A new socket has a fresh server-side rate bucket; a pending send on the old one is lost.
        if (next === "online") chat.reset();
      },
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
    if (!yachtFx) return;
    const t = setTimeout(() => setYachtFx(null), 2400);
    return () => clearTimeout(t);
  }, [yachtFx]);
  const anyAway = Object.keys(away).length > 0;
  useEffect(() => {
    if (deadline === null && !anyAway) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline, anyAway]);

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
  const myLook = (me && looks[me.playerId]) || GUEST_LOOK;
  const nameMap = Object.fromEntries(players.map((p) => [p.playerId, p.name]));
  const say = (id: string) => conn.current?.say(id) ?? false;
  const feed = <TableFeed chat={chat} names={nameMap} looks={looks} me={me?.playerId ?? null} />;
  const dock = <SocialDock chat={chat} look={myLook} online={status === "online"} transport={say} />;
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
  /** PC score sheet headers (the top summary is phone-only): who I am, who is the server AI. */
  const scoreLabels = players.map((p) => p.name + (p.playerId === me?.playerId ? " (나)" : p.playerId === aiSeat ? " · AI" : "")) as [string, string];
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
    mySelection.current = { keep: next, v: view?.version ?? -1 };
    conn.current?.hold(next, ++holdSent.current);
  };
  const record = (category: Category) => {
    if (!can || rolls === 0 || players[meIndex]?.card[category] !== undefined) return;
    void send({ type: "score", category });
    setMobileScoreOpen(false);
  };
  const remaining = deadline !== null && playing ? deadline - now : null;
  // The winner's special effect (presentation only). Others' effects follow the "상대 아이템 효과" setting.
  const winnerLook = finished && winners.length === 1 ? looks[winners[0]] : undefined;
  const winnerFxItem = winnerLook && winnerLook.fx !== "fx.none" && (winners[0] === me?.playerId || settings.opponentFx) ? winnerLook : undefined;
  const winnerFx = winnerFxItem ? ` fx-confetti fx-lv${winnerFxItem.fxLv}` : "";
  const winnerFxLook = winnerFxItem ? itemById(winnerFxItem.fx)?.look.fx : undefined;
  const gesture = useThrowGesture(canRoll, roll);
  const yachtReady = useYachtReady(game.dice, rolls, myTurn && players[meIndex]?.card.yacht === undefined);
  // Result sound from my side: 1:1 win / loss / draw; larger rooms by rank (sole first = win, shared
  // first = shared win, any other place = the calm "finished" sound).
  const myRank = view?.standings?.find((x) => x.playerId === me?.playerId)?.rank;
  const soundOutcome = !finished ? null : players.length > 2 ? (myRank === 1 ? (winners.length > 1 ? "winShared" : "win") : "lose") : outcome;
  const celebration = useGameSounds(game.cards, finished, soundOutcome, syncKey);


  if (!seat) return null;
  if (!view)
    return (
      <p className="online-connecting" role="status">
        {status === "reconnecting" ? "서버에 다시 연결하는 중이에요…" : "방에 연결하는 중이에요…"}
      </p>
    );

  // Reconnect grace of absent players (server-decided; shown as a countdown, D-046).
  const awayNames = view.status === "finished" ? [] : Object.entries(away)
    .filter(([id]) => id !== me?.playerId && !online.includes(id))
    .map(([id, at]) => ({ name: players.find((p) => p.playerId === id)?.name ?? "", ms: at - now }))
    .filter((a) => a.name && a.ms > 0);
  const banner =
    status !== "online" ? (
      <p className="online-banner offline" role="status">
        <WifiOff size={15} /> 연결이 끊어졌어요. 다시 연결하는 중이에요…
      </p>
    ) : awayNames.length ? (
      <p className="online-banner" role="status">
        <WifiOff size={15} /> {awayNames.map((a) => `${a.name} 님 연결 끊김 (${clock(a.ms)} 안에 돌아오지 않으면 ${view.status === "lobby" ? "자리에서 나가요" : "기권 처리돼요"})`).join(" · ")}
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
            <FriendInvite server={server} room={code} freeSeats={view.seats - players.length} />
          </div>
          <input className="online-invite-link" aria-label="초대 링크" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <div className="online-lobby-tools">
          <SpectateControl state={spectate} me={me?.playerId ?? ""} onToggle={(allow) => conn.current?.spectate(allow)} linkFor={(key) => watchLink(code, key)} disabled={status !== "online"} />
        </div>
        <LobbyPanel
          lobby={lobby}
          seats={view.seats}
          players={players}
          me={me?.playerId ?? ""}
          online={online}
          renderTag={(p) => (
            <>
              <strong>
                <PlayerTag name={p.name} look={looks[p.playerId]} me={p.playerId === me?.playerId} />
              </strong>
            </>
          )}
          disabled={status !== "online" || sending}
          onReady={(r) => conn.current?.ready(r)}
          onSettings={(mode, t) => conn.current?.settings(mode, t)}
          onTransfer={(to) => conn.current?.transferHost(to)}
          onStart={() => void send({ type: "start" })}
        />
        <div className="lobby-chat">
          {feed}
          {dock}
        </div>
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

  const toolGroups = (
    <>
            {/* Room settings (chat and emotes are in the bar under the board). */}
            <div className="online-tool-group online-room-tools">
              {!aiSeat && <SpectateControl state={spectate} me={me?.playerId ?? ""} onToggle={(allow) => conn.current?.spectate(allow)} linkFor={(key) => watchLink(code, key)} disabled={status !== "online"} />}
              {playing && (
                <button
                  type="button"
                  className="text-button online-resign"
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
    </>
  );
  if (view.seats > 2 || view.mode === "simultaneous")
    return (
      <>
        <MultiTable
          view={view}
          code={code}
          me={me?.playerId ?? ""}
          online={online}
          looks={looks}
          social={
            <>
              {feed}
              {dock}
            </>
          }
          status={status}
          tools={toolGroups}
          banner={banner}
          dice={game.dice}
          keep={keep}
          rolls={rolls}
          rollEvent={rollEvent}
          can={can}
          canRoll={canRoll}
          remaining={remaining}
          feedback={feedback}
          error={<ErrorMessage message={error} />}
          rematch={rematch}
          isHost={(lobby?.hostId ?? players[0]?.playerId) === me?.playerId}
          onToggle={toggle}
          onRoll={roll}
          onScore={record}
          onRematch={(op) => conn.current?.rematch(op)}
          onHome={() => {
            conn.current?.bye();
            forgetSeat(code);
            setRoomInUrl(null);
            location.hash = "home";
          }}
        />
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
  return (
    <>
      <div className="game-grid online-game">
        <div className="game-left">
          <div className="game-tools online-tools">
            <span className="online-code-chip">
              {status === "online" ? <Wifi size={14} /> : <WifiOff size={14} />} 방 {code}
            </span>
            {toolGroups}
          </div>
          <div className="score-summary">
            {players.map((p, seatIndex) => (
              <div key={p.playerId} className={!finished && turnIndex === seatIndex ? "selected" : ""} data-seat={seatIndex} data-role={p.playerId === me?.playerId ? "human" : "opponent"}>
                <span>
                  <PlayerTag name={p.name} look={looks[p.playerId]} me={p.playerId === me?.playerId} compact />
                  {p.playerId === me?.playerId ? " (나)" : ""}
                  {p.playerId === aiSeat && <span className="ai-badge">서버 AI</span>}
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
            {me && <BonusChip card={players[meIndex]?.card ?? {}} />}
          </div>
          {banner}
          <section
            className={"game-board throw-tray" + (rolls === 0 ? " dice-ready" : "") + (boardOf(myLook) ? " board-themed" : "") + (boardCssOf(myLook) ? " " + boardCssOf(myLook) : "")}
            style={boardOf(myLook) ? ({ "--board-color": boardOf(myLook) } as React.CSSProperties) : undefined}
            aria-label="게임 보드"
            {...gesture}
          >
            <Celebrate value={celebration} />
            {yachtFx && <FxBurst key={yachtFx.seed} fx={yachtFx.fx} level={yachtFx.level} seed={yachtFx.seed} />}
            <div className="board-top">
              <span className="turn-indicator">
                <i />
                {finished ? "경기 종료" : myTurn ? "나의 차례" : `${players[turnIndex]?.name ?? "상대"}의 차례`}
              </span>
              <span>
                굴림 <b>{rolls}</b> / 3
              </span>
            </div>
            {/* The dice show the theme of the player whose turn it is — the same on both screens. */}
            <DiceArea state={game} colors={diceLookOf(looks[players[turnIndex]?.playerId ?? ""])} interactive={can && rolls > 0 && rolls < 3} animate rollEvent={rollEvent} onToggle={toggle} holdOrder={rolls > 0 ? keep : []} />
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
              <div className={"game-result online-result" + winnerFx} role="status">
                {winnerFxLook && winnerFxItem && <FxBurst fx={winnerFxLook} level={winnerFxItem.fxLv} seed={view.matchId} />}
                <Trophy size={25} />
                <h2>{outcome === "draw" ? "무승부입니다" : outcome === "win" ? "승리했습니다!" : `${players.find((p) => p.playerId === winners[0])?.name ?? "상대"} 님이 승리했습니다`}</h2>
                <p className="online-final">
                  {players[meIndex]?.total ?? 0} : {opponent?.total ?? 0}
                </p>
                {series && series.games > 1 && me && opponent && (
                  <p className="online-series">
                    이 방 전적 {series.wins[me.playerId] ?? 0}승 {series.wins[opponent.playerId] ?? 0}패{series.draws ? ` ${series.draws}무` : ""}
                  </p>
                )}
                {opponent && members[opponent.playerId] && (
                  <button type="button" className="text-button" onClick={() => setProfileOf(members[opponent.playerId])}>
                    <UserRound size={15} /> {opponent.name} 님 프로필
                  </button>
                )}
                <RematchControls rematch={rematch} me={me?.playerId ?? ""} opponentName={opponent?.name ?? "상대"} onOp={(op) => conn.current?.rematch(op)} />
                <div className="game-result-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      conn.current?.bye();
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
                      conn.current?.bye();
                      forgetSeat(code);
                      setRoomInUrl(null);
                      location.hash = "home";
                    }}
                  >
                    <Home size={15} /> 로비로
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
          {/* Messages and the send bar under the board: never over the dice or the roll button. */}
          <div className="table-chat">
            {feed}
            {dock}
          </div>
          {feedback && (
            <p className="game-feedback" role="status">
              {feedback}
            </p>
          )}
          <ErrorMessage message={error} />
        </div>
        <Scoreboard state={game} labels={scoreLabels} round={game.round} selectPlayer={meIndex} select={can ? record : undefined} />
      </div>
      {profileOf && <OpponentProfile server={server} userId={profileOf} onClose={() => setProfileOf(null)} />}
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

/** Rematch buttons on the result card. The server decides; this only shows its state. */
function RematchControls({ rematch, me, opponentName, onOp }: { rematch: RematchState | null; me: string; opponentName: string; onOp: (op: "request" | "cancel" | "decline") => void }) {
  const [pressed, setPressed] = useState(false);
  // A new server state re-enables the buttons (the press was answered).
  useEffect(() => setPressed(false), [rematch]);
  if (!rematch) return null;
  const mine = rematch.requests.includes(me);
  const theirs = rematch.requests.some((id) => id !== me);
  const press = (op: "request" | "cancel" | "decline") => {
    if (pressed) return;
    setPressed(true);
    onOp(op);
    setTimeout(() => setPressed(false), 1500);
  };
  if (rematch.blocked)
    return (
      <p className="rematch-status" role="status">
        {rematch.blocked}
      </p>
    );
  return (
    <div className="rematch">
      {theirs && !mine ? (
        <>
          <p className="rematch-status" role="status">
            {opponentName} 님이 재대결을 요청했어요.
          </p>
          <div className="rematch-actions">
            <button type="button" className="primary" disabled={pressed} onClick={() => press("request")}>
              <RotateCcw size={16} /> 수락
            </button>
            <button type="button" className="secondary" disabled={pressed} onClick={() => press("decline")}>
              <X size={15} /> 거절
            </button>
          </div>
        </>
      ) : mine ? (
        <>
          <p className="rematch-status" role="status">
            {opponentName} 님의 응답을 기다리는 중…
          </p>
          <button type="button" className="secondary" disabled={pressed} onClick={() => press("cancel")}>
            요청 취소
          </button>
        </>
      ) : (
        <>
          {rematch.declinedBy && rematch.declinedBy !== me && (
            <p className="rematch-status" role="status">
              {opponentName} 님이 재대결을 거절했어요.
            </p>
          )}
          <button type="button" className="primary" disabled={pressed} onClick={() => press("request")}>
            <RotateCcw size={16} /> 재대결
          </button>
        </>
      )}
    </div>
  );
}

/** An opponent's public profile: nickname, join month and server-verified online totals only. */
function OpponentProfile({ server, userId, onClose }: { server: string; userId: string; onClose: () => void }) {
  const [p, setP] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    publicProfile(server, userId)
      .then(setP)
      .catch((e) => setError(e.message));
  }, [server, userId]);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal opponent-profile" role="dialog" aria-label="상대 프로필" onClick={(e) => e.stopPropagation()}>
        {error ? (
          <p>{error}</p>
        ) : !p ? (
          <p>불러오는 중…</p>
        ) : (
          <>
            <h2>{p.nickname}</h2>
            <p className="profile-fine">{new Date(p.joinedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long" })} 가입 · 서버가 확인한 온라인 경기 기준</p>
            <p>
              {p.online.games}경기 · {p.online.wins}승 {p.online.losses}패{p.online.draws ? ` ${p.online.draws}무` : ""}
              {p.online.best !== null ? ` · 최고 ${p.online.best}점` : ""}
            </p>
          </>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
