import { useSettings } from "../settings";
import { BonusMoments } from "../bonus-moment";
import { MatchResult } from "../ui/MatchResult";
import { FirstTurnGuide } from "./Tutorial";
import { MatchMilestones, nearYacht, ScoreTotal } from "../ui/GameMoments";
import { useRef, useState } from "react";
import { Check, Crown, Dices, Flag, Play, RotateCcw, Timer, Wifi, WifiOff } from "lucide-react";
import { categories, type Category } from "../engine";
import type { MultiGame } from "../multi-engine";
import "./multi-compact.css";
import { MultiScoreboard } from "../MultiScoreboard";
import { DiceArea } from "../DiceArea";
import type { PlayerView } from "../online/server-engine";
import type { LobbyState, RematchState } from "../online/wire";
import { ROUND_LIMITS, TURN_LIMITS } from "../online/wire";
import type { PublicLook } from "../economy/live/catalog";
import { BoardFx } from "./BoardFx";
import { PlayerTag, useStageLook, stagePlayer, diceLookOf, diceMaterialOf } from "./Looks";
import { Celebrate } from "../ui/Celebrate";
import type { Celebration } from "../game-feel";
import { QuickPicks } from "../QuickPicks";
import { BrandMark } from "../ui/BrandLoading";

type ViewPlayer = PlayerView["players"][number];
const secs = (ms: number | null) => (ms === null ? "없음" : `${ms / 1000}초`);

/**
 * Lobby of a friend room (2–20 players): who is in, who is ready, the host's settings (turn-by-turn
 * or simultaneous rounds, time limit), host transfer and start. The server enforces every rule
 * (host only, ready, limits); this shows its state.
 */
export function LobbyPanel(p: {
  lobby: LobbyState | null;
  seats: number;
  players: ViewPlayer[];
  me: string;
  online: string[];
  renderTag: (player: ViewPlayer) => React.ReactNode;
  disabled: boolean;
  onReady: (ready: boolean) => void;
  /** C3.1: present only with a Worker that reports `lobby.intent` (participate / watch / undecided). */
  onIntent?: (value: "ready" | "watch" | "idle") => void;
  onSettings: (mode: "turns" | "simultaneous", timeoutMs: number | null) => void;
  onTransfer: (to: string) => void;
  onStart: () => void;
}) {
  const lobby = p.lobby;
  const hostId = lobby?.hostId ?? p.players[0]?.playerId;
  const isHost = hostId === p.me;
  const ready = lobby?.ready ?? {};
  const settings = lobby?.settings ?? { mode: "turns" as const, timeoutMs: null };
  const intent = lobby?.intent;
  const watchMode = !!intent && !!p.onIntent;
  const watching = (id: string) => intent?.[id] === "watch";
  const roster = p.players.filter((x) => !watching(x.playerId));
  const others = roster.filter((x) => x.playerId !== hostId);
  const allReady = others.every((x) => ready[x.playerId]);
  const needReady = p.seats > 2 || (watchMode && roster.length !== p.players.length);
  const canStart = roster.length >= (lobby?.minPlayers ?? 2) && (!needReady || allReady);
  const mine = intent?.[p.me] ?? "idle";
  const limits = settings.mode === "simultaneous" ? ROUND_LIMITS : TURN_LIMITS;
  return (
    <div className="lobby-panel">
      <div className="lobby-count">
        참가자 <strong>{p.players.length}</strong> / {p.seats}명
      </div>
      {p.players.length < 2 && <p className="online-wait" role="status"><BrandMark /> 상대가 들어오기를 기다리는 중이에요.</p>}
      <ul className="online-players" aria-label="참가자">
        {p.players.map((x) => (
          <li key={x.playerId} data-player={x.playerId}>
            <span className={"online-dot" + (p.online.includes(x.playerId) ? " on" : "")} aria-hidden="true" />
            {p.renderTag(x)}
            {x.playerId === p.me && <span className="online-tag">나</span>}
            {x.playerId === hostId ? (
              <span className="online-tag host">
                <Crown size={12} /> 방장
              </span>
            ) : watching(x.playerId) ? (
              <span className="online-tag watch">관전</span>
            ) : needReady || watchMode ? (
              <span className={"online-tag ready" + (ready[x.playerId] ? " on" : "")}>{ready[x.playerId] ? "준비 완료" : "준비 중"}</span>
            ) : null}
            {x.playerId === hostId && watching(x.playerId) && <span className="online-tag watch">관전</span>}
            {isHost && x.playerId !== p.me && (
              <button type="button" className="text-button lobby-transfer" disabled={p.disabled} onClick={() => p.onTransfer(x.playerId)} aria-label={`${x.name} 님에게 방장 넘기기`}>
                방장 넘기기
              </button>
            )}
          </li>
        ))}
        {Array.from({ length: Math.min(3, p.seats - p.players.length) }, (_, i) => (
          <li key={"empty" + i} className="empty">
            <span>친구를 기다리는 중…</span>
          </li>
        ))}
      </ul>
      <fieldset className="lobby-settings" disabled={!isHost || p.disabled}>
        <legend>경기 방식{isHost ? "" : " (방장이 정해요)"}</legend>
        <div className="segmented-choice" role="radiogroup" aria-label="진행 방식">
          {(
            [
              ["turns", "순서대로"],
              ["simultaneous", "동시 진행"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className={settings.mode === mode ? "on" : ""}>
              <input
                type="radio"
                name="mode"
                checked={settings.mode === mode}
                onChange={() => p.onSettings(mode, mode === "simultaneous" ? (settings.timeoutMs && ROUND_LIMITS.includes(settings.timeoutMs) ? settings.timeoutMs : 90_000) : settings.timeoutMs)}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="lobby-time">
          <Timer size={15} /> {settings.mode === "simultaneous" ? "라운드 제한 시간" : "턴 제한 시간"}
          <select aria-label="제한 시간" value={String(settings.timeoutMs)} onChange={(e) => p.onSettings(settings.mode, e.target.value === "null" ? null : Number(e.target.value))}>
            {limits.map((ms) => (
              <option key={String(ms)} value={String(ms)}>
                {secs(ms)}
              </option>
            ))}
          </select>
        </label>
        <p className="lobby-note">
          {settings.mode === "simultaneous" ? "모두가 각자의 주사위로 같은 라운드를 동시에 해요. 시간 안에 기록하지 않으면 자동 기록되고, 3번 연속이면 기권 처리돼요." : "한 사람씩 차례대로 해요."}
        </p>
      </fieldset>
      {watchMode && (
        <div className="lobby-intent" role="group" aria-label="이번 경기 참가 방식">
          {!isHost && needReady && (
            <button type="button" className={mine === "ready" ? "primary" : "secondary"} aria-pressed={mine === "ready"} disabled={p.disabled} onClick={() => p.onIntent!(mine === "ready" ? "idle" : "ready")}>
              <Check size={15} /> {mine === "ready" ? "준비 취소" : "준비 완료"}
            </button>
          )}
          <button type="button" className={mine === "watch" ? "primary" : "secondary"} aria-pressed={mine === "watch"} disabled={p.disabled} onClick={() => p.onIntent!(mine === "watch" ? "idle" : "watch")} data-intent-watch>
            {mine === "watch" ? "관전 취소" : "이번 경기 관전"}
          </button>
          <p className="lobby-note">관전을 고르면 참가 인원·준비 조건에서 빠지고, 점수·보상·전적이 기록되지 않아요. 참가자가 최소 {lobby?.minPlayers ?? 2}명이어야 시작해요.</p>
        </div>
      )}
      {isHost ? (
        <button type="button" className="primary online-start" disabled={!canStart || p.disabled} onClick={p.onStart}>
          <Play size={17} /> 게임 시작{needReady && !allReady ? " (모두 준비하면)" : ""}
        </button>
      ) : watchMode && needReady ? null : needReady ? (
        <button type="button" className={ready[p.me] ? "secondary online-start" : "primary online-start"} disabled={p.disabled} onClick={() => p.onReady(!ready[p.me])} aria-pressed={!!ready[p.me]}>
          <Check size={17} /> {ready[p.me] ? "준비 취소" : "준비 완료"}
        </button>
      ) : (
        <p className="online-wait">방장이 게임을 시작하면 바로 시작돼요.</p>
      )}
    </div>
  );
}

/** Live ranking: rank, name, score, cards filled, and this round's state (simultaneous) or whose turn it is. */
export function OnlineStandings({ view, me, online, looks, final = false, selected, onSelect }: { view: PlayerView; me: string; online: string[]; looks: Record<string, PublicLook>; final?: boolean; selected?: string | null; onSelect?: (playerId: string) => void }) {
  const rows = [...view.players].sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || b.total - a.total || a.seat - b.seat);
  let rank = 0;
  let prev: ViewPlayer | null = null;
  return (
    <section className="panel online-standings" aria-label={final ? "최종 순위" : "실시간 순위"}>
      <div className="multi-standing-title">
        <h2>{final ? "최종 순위" : "실시간 순위"}</h2>
        <span>
          {view.players.length}명 · {Math.min(12, view.round || 12)}/12 라운드
        </span>
      </div>
      <ol className="online-standing-list">
        {rows.map((p, i) => {
          if (!prev || prev.total !== p.total || prev.status !== p.status) rank = i + 1;
          prev = p;
          const filled = categories.filter((c) => p.card[c] !== undefined).length;
          const playing = view.mode === "simultaneous" ? !!view.progress?.[p.playerId] : view.turn?.playerId === p.playerId;
          const state =
            p.status !== "active" ? "기권" : view.status !== "playing" ? "" : view.mode === "simultaneous" ? (playing ? `진행 중 · 굴림 ${view.progress![p.playerId].rolls}` : "기록 완료") : playing ? "차례" : "";
          return (
            <li
              key={p.playerId}
              className={(p.playerId === me ? "me " : "") + (playing && view.status === "playing" ? "active " : "") + (p.status !== "active" ? "out " : "") + (onSelect ? "pickable " : "") + (selected === p.playerId ? "picked" : "")}
              data-player={p.playerId}
              {...(onSelect ? { role: "button", tabIndex: 0, "aria-pressed": selected === p.playerId, "aria-label": `${p.name} 점수판 보기`, onClick: () => onSelect(p.playerId), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(p.playerId)) } : {})}
            >
              <span className="multi-rank">{p.status === "active" ? `${rank}위` : "-"}</span>
              <span className={"online-dot" + (online.includes(p.playerId) ? " on" : "")} aria-hidden="true" />
              <span className="online-standing-name">
                <PlayerTag name={p.name} look={looks[p.playerId]} me={p.playerId === me} compact />
                {p.playerId === me ? " (나)" : ""}
              </span>
              <span className="online-standing-state">{state}</span>
              <span className="multi-standing-progress">{filled}/12</span>
              <strong><ScoreTotal value={p.total} />점</strong>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The table of a match with more than two players, or any simultaneous match: my dice (or the
 * current player's, turn by turn), live ranking, the adaptive score sheet (all players up to 8, one
 * player at a time above), final ranking and rematch.
 */
export function MultiTable(p: {
  view: PlayerView;
  code: string;
  me: string;
  online: string[];
  looks: Record<string, PublicLook>;
  social: React.ReactNode;
  status: "connecting" | "online" | "reconnecting" | "closed";
  tools: React.ReactNode;
  review?: React.ReactNode;
  reward?: React.ReactNode;
  banner: React.ReactNode;
  dice: { id: number; value: number; held: boolean }[];
  keep: number[];
  rolls: number;
  rollEvent: number;
  can: boolean;
  canRoll: boolean;
  remaining: number | null;
  feedback: string;
  showGuide: boolean;
  milestones: { best: boolean; comeback: boolean };
  celebration: Celebration;
  error: React.ReactNode;
  rematch: RematchState | null;
  isHost: boolean;
  onToggle: (id: number) => void;
  onRoll: () => void;
  onScore: (c: Category) => void;
  selectedScore: Category | null;
  onSelectScore: (c: Category | null) => void;
  onRematch: (op: "request" | "cancel" | "start") => void;
  onHome: () => void;
}) {
  const { opponentFx } = useSettings();
  const { view } = p;
  const players = view.players;
  const meIndex = Math.max(0, players.findIndex((x) => x.playerId === p.me));
  const simultaneous = view.mode === "simultaneous";
  const turnIndex = simultaneous ? meIndex : Math.max(0, players.findIndex((x) => x.playerId === view.turn?.playerId));
  const dicePlayer = simultaneous ? p.me : view.turn?.playerId ?? "";
  // Sequential: the table (board, dice skin, fx) follows the player on turn on every screen.
  // Simultaneous: everyone plays their own board, so each screen shows its own look.
  const stageId = stagePlayer(view.turn?.playerId, p.me, simultaneous);
  const stage = useStageLook(stageId ? p.looks[stageId] : undefined, stageId === p.me, p.looks[p.me]);
  const theme = stage.theme;
  const boardRef = useRef<HTMLElement | null>(null);
  const finished = view.status === "finished";
  const [all, setAll] = useState(false);
  const game: MultiGame = { dice: p.dice, order: [0, 1, 2, 3, 4], cards: players.map((x) => x.card), player: turnIndex, round: view.round || 12, rolls: p.rolls, done: finished, winners: [], seed: 0, rng: [], actions: view.version };
  const labels = players.map((x) => x.name);
  const myTurn = !!view.legal;
  const iAmOut = players[meIndex]?.status !== "active";
  const waiting = simultaneous && !finished && !myTurn && !iAmOut;
  const turnName = players[turnIndex]?.name ?? "";
  const timer = p.remaining !== null && view.status === "playing" ? `${Math.floor(Math.max(0, p.remaining) / 60000)}:${String(Math.ceil(Math.max(0, p.remaining) / 1000) % 60).padStart(2, "0")}` : null;
  const mine = rematchMine(p.rematch, p.me);
  return (
    <div className="game-grid online-game online-multi" style={{ "--np": players.length } as React.CSSProperties}>
      <div className="game-left">
        <div className="game-tools online-tools">
          <span className="online-code-chip">
            {p.status === "online" ? <Wifi size={14} /> : <WifiOff size={14} />} 방 {p.code}
          </span>
          {p.tools}
        </div>
        {p.banner}
        <div className="table-chat multi-profile-chat">
          <PlayerTag name={players[meIndex]?.name ?? "나"} look={p.looks[p.me]} me compact />
          {p.social}
        </div>
        <section
          className={"game-board throw-tray" + (p.canRoll && nearYacht(game.dice, p.rolls, players[meIndex]?.card) ? " yacht-near" : "") + (p.rolls === 0 ? " dice-ready" : "") + theme.className}
          style={theme.style}
          ref={boardRef}
          aria-label="게임 보드"
        >
          <BoardFx itemId={stage.look?.board} level={stage.look?.boardLv ?? 1} host={boardRef} />
          <Celebrate value={p.celebration} />
          <BonusMoments scope={view.matchId} players={players.map((x) => ({ id: x.playerId, name: x.name, card: x.card, mine: x.playerId === p.me, look: p.looks[x.playerId] }))} />
          <div className="board-top">
            <span className="turn-indicator">
              <i />
              {finished ? "경기 종료" : iAmOut ? "기권했어요 · 관전 중" : simultaneous ? (myTurn ? `${view.round}라운드 · 나의 주사위` : `${view.round}라운드 · 다른 사람을 기다리는 중`) : myTurn ? "나의 차례" : `${turnName}의 차례`}
            </span>
            <span>
              굴림 <b>{p.rolls}</b> / 3{timer && <span className="turn-timer"> · 남은 시간 {timer}</span>}
            </span>
          </div>
          <DiceArea state={game} colors={diceLookOf(stage.look, stage.showFx)} material={diceMaterialOf(stage.look)} interactive={p.can && p.rolls > 0 && p.rolls < 3} animate rollEvent={p.rollEvent} onToggle={p.onToggle} holdOrder={p.rolls > 0 ? p.keep : []} />
          <div className="roll-area">
            <button className={"primary roll-button" + (myTurn ? "" : " waiting")} disabled={!p.canRoll} onClick={p.onRoll}>
              <Dices size={20} />
              {finished ? "경기 종료" : myTurn ? (p.rolls === 0 ? "주사위 굴리기" : "다시 굴리기") : waiting ? "이번 라운드 기록 완료" : iAmOut ? "기권함" : `${turnName} 님의 차례`}
              {myTurn && <span>{3 - p.rolls}회 남음</span>}
            </button>
            <FirstTurnGuide rolls={p.rolls} active={p.showGuide && myTurn} busy={false} />
            <p className="online-turn-line">{waiting ? `아직 기록하지 않은 ${Object.keys(view.progress ?? {}).length}명을 기다리고 있어요.` : myTurn && !p.showGuide && p.rolls === 3 ? "점수 칸을 선택하세요" : ""}</p>
            <QuickPicks values={p.dice.map((d) => d.value)} card={players[meIndex]?.card ?? {}} rolls={p.rolls} canScore={p.can} onScore={p.onScore} />
          </div>
          {finished && (
            <MatchResult key={view.matchId} className="online-result" title={resultTitle(view, p.me)} waiting={!!p.celebration}
              invitation={!!p.rematch?.requests.some((id) => id !== p.me)}
              actions={<>
                {p.review}
                <MultiRematch rematch={p.rematch} isHost={p.isHost} mine={mine} onOp={p.onRematch} />
                <button className="secondary" onClick={p.onHome}>나가기</button>
              </>}>
              <ol className="match-result-standings">
                {view.standings?.map(({ playerId, points, rank }) =>
                  <li key={playerId}><strong>{rank}위</strong><span>{players.find((player) => player.playerId === playerId)?.name}</span><strong>{points}점</strong></li>
                )}
              </ol>
              <MatchMilestones {...p.milestones} />
              {p.reward}
            </MatchResult>
          )}
        </section>
        {p.feedback && (
          <p className="game-feedback" role="status" key={p.feedback}>
            {p.feedback}
          </p>
        )}
        {p.error}
        <OnlineStandings view={view} me={p.me} online={p.online} looks={p.looks} final={finished} />
      </div>
      <div className="multi-scores online-multi-scores">
        {players.length > 8 && (
          <div className="multi-view-switch">
            <button type="button" className={!all ? "active" : ""} onClick={() => setAll(false)}>
              {simultaneous ? "내 점수판" : "현재 차례"}
            </button>
            <button type="button" className={all ? "active" : ""} onClick={() => setAll(true)}>
              전체 점수판
            </button>
          </div>
        )}
        <MultiScoreboard
          state={game}
          labels={labels}
          compact
          focused={players.length > 8 && !all}
          select={p.can ? p.onSelectScore : undefined}
          selected={p.can ? p.selectedScore : null}
          onConfirm={() => {
            if (p.selectedScore) p.onScore(p.selectedScore);
            p.onSelectScore(null);
          }}
          onClear={() => p.onSelectScore(null)}
        />
      </div>
    </div>
  );
}

function resultTitle(view: PlayerView, me: string) {
  const mine = view.standings?.find((s) => s.playerId === me);
  if (!mine) return "경기 종료";
  if (mine.rank === 1 && view.players.length === 2 && view.winners.length === 2) return "무승부";
  if (mine.rank === 1) return view.winners.length > 1 ? "공동 1위!" : "1위로 승리했습니다!";
  return `${mine.rank}위 · ${mine.points}점`;
}
const rematchMine = (r: RematchState | null, me: string) => !!r?.requests.includes(me);

function MultiRematch({ rematch, isHost, mine, onOp }: { rematch: RematchState | null; isHost: boolean; mine: boolean; onOp: (op: "request" | "cancel" | "start") => void }) {
  if (!rematch) return null;
  if (rematch.blocked) return <p className="rematch-status">{rematch.blocked}</p>;
  const n = rematch.requests.length;
  return (
    <div className="rematch">
      <p className="rematch-status" role="status">
        재대결을 원하는 사람 {n}명{isHost ? " · 방장은 원하는 사람들과 바로 시작할 수 있어요" : ""}
      </p>
      <div className="rematch-actions">
        {mine ? (
          <button type="button" className="secondary" onClick={() => onOp("cancel")}>
            재대결 취소
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => onOp("request")}>
            <RotateCcw size={16} /> 한 번 더 플레이
          </button>
        )}
        {isHost && (
          <button type="button" className="primary" disabled={n + (mine ? 0 : 1) < 2} onClick={() => onOp("start")}>
            <Play size={16} /> 지금 시작
          </button>
        )}
      </div>
    </div>
  );
}

export const ResignIcon = Flag;
