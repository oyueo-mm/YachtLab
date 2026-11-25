import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Eye, LoaderCircle, LogIn, Plus, Search, Shuffle, UserRound, UsersRound, X } from "lucide-react";
import {
  QuickMatch,
  createRoom,
  joinRoom,
  pendingQuick,
  publicRooms,
  publicWatchKey,
  roomFromUrl,
  roomSummary,
  saveName,
  saveSeat,
  savedSeat,
  savedSeats,
  serverFeatures,
  setRoomInUrl,
  watchLink,
  type Features,
  type PublicRoom,
  type SavedSeat,
} from "../online/client";
import type { RoomSummary } from "../online/wire";
import { session } from "../identity/account-client";
import { startServerAi } from "../identity/economy-client";
import { PlayerTag } from "./Looks";
import { useNickname } from "../identity/display-name";
import { ROUND_LIMITS, TURN_LIMITS } from "../online/wire";
import type { RoomSettings } from "../online/room";
import "./online-entry.css";

/** The nickname this screen will use (edited on the profile page only). */
function NickLine({ name }: { name: string }) {
  return (
    <p className="online-nick">
      <UserRound size={14} aria-hidden="true" /> <strong>{name}</strong>(으)로 참가해요 · <a href="#profile">프로필에서 변경</a>
    </p>
  );
}

type Seat = { code: string; playerId: string; token: string };

/**
 * Invite link (`…/YachtLab/?room=CODE#online`): a screen for exactly that room — no code to type.
 * The saved nickname is filled in; one clear "입장하기" button joins. Rooms that cannot be joined
 * (missing/expired, full, already playing, finished) say so. The seat token never appears in the URL.
 */
function InviteJoin({ server, code, onJoined, onOther }: { server: string; code: string; onJoined: (seat: Seat, name: string) => void; onOther: () => void }) {
  const name = useNickname();
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "error" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => {
    setState("loading");
    roomSummary(server, code)
      .then((summary) => {
        setRoom(summary);
        setState("ready");
      })
      .catch((e: unknown) => setState((e as { code?: string })?.code === "ROOM_NOT_FOUND" ? "missing" : "error"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [code]);
  const trimmed = name.trim();
  const joinable = !!room && room.status === "lobby" && room.players.length < room.seats;
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      onJoined(await joinRoom(server, code, trimmed), trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if ((e as { code?: string })?.code !== "NAME_TAKEN") load(); // the room may have changed meanwhile
    } finally {
      setBusy(false);
    }
  };
  const blocked =
    state === "missing"
      ? "방을 찾을 수 없어요. 링크가 만료되었거나 방이 삭제되었어요."
      : state === "error"
        ? "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."
        : room && room.status === "playing"
          ? "이미 경기가 진행 중인 방이에요."
          : room && room.status === "finished"
            ? "이미 끝난 경기예요."
            : room && !joinable
              ? room.seats > 2 ? "방이 가득 찼어요." : "이미 두 명이 모두 들어온 방이에요."
              : "";
  return (
    <section className="setup online-entry online-invite-join" aria-labelledby="online-title">
      <h1 id="online-title" className="sr-only">온라인 대전 초대</h1>
      <div className="setup-body">
        {state === "loading" ? (
          <p className="online-lead" role="status">
            <LoaderCircle size={15} className="spin" /> 방 정보를 불러오는 중…
          </p>
        ) : (
          <>
            <div className="online-invite-card">
              <span>초대 코드 {code}</span>
              <strong>{room?.players[0] ? `${room.players[0]} 님의 방에 초대받았어요` : "온라인 대전 방"}</strong>
              {room && room.seats > 2 && (
                <span className="invite-size">
                  {room.players.length}/{room.seats}명 · {room.mode === "simultaneous" ? "동시 진행" : "순서대로"}
                </span>
              )}
            </div>
            {blocked ? (
              <p className="online-invite-blocked" role="alert">
                {blocked}
              </p>
            ) : (
              <div className="online-invite-form">
                <button type="button" className="primary online-start" disabled={busy} onClick={() => void join()}>
                  <LogIn size={17} /> {busy ? "입장 중…" : "입장하기"}
                </button>
                <NickLine name={trimmed} />
              </div>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <button type="button" className="text-button online-leave" onClick={onOther}>
          다른 방 만들기 · 코드로 입장
        </button>
      </div>
    </section>
  );
}

type Tab = "quick" | "friend" | "watch";
const TAB_KEY = "yachtlab.online.tab";
const readTab = (): Tab => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === "friend" || t === "watch" || t === "quick" ? t : "quick";
  } catch {
    return "quick";
  }
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Online start screen with three tabs: 빠른 대전 (random opponent), 친구 대전 (invite code), 관전방
 * (public matches). An invite link (`?room=CODE`) opens InviteJoin for that room instead.
 * A server without quick match (older Worker, local Node dev server) shows the friend tab only.
 */
export default function OnlineEntry({ server, onEnter, onBack, onAi }: { server: string; onEnter: (code: string, quick?: boolean) => void; onBack: () => void; onAi?: () => void }) {
  const name = useNickname();
  const [inviteCode, setInviteCode] = useState<string | null>(roomFromUrl);
  const [features, setFeatures] = useState<Features | null>(null);
  const [tab, setTabState] = useState<Tab>(() => (pendingQuick() ? "quick" : readTab()));
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    let live = true;
    void serverFeatures(server).then((f) => live && setFeatures(f));
    return () => {
      live = false;
    };
  }, [server]);

  // Invite link: if this browser already sits in that room, go straight back in (refresh / second tab).
  useEffect(() => {
    if (inviteCode && savedSeat(inviteCode)) onEnter(inviteCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = name.trim();
  const enter = (seat: Seat, as = trimmed, quick = false) => {
    saveName(as);
    saveSeat({ ...seat, name: as, at: Date.now() });
    setRoomInUrl(seat.code);
    onEnter(seat.code, quick);
  };
  if (inviteCode && !savedSeat(inviteCode))
    return (
      <InviteJoin
        server={server}
        code={inviteCode}
        onJoined={(seat, as) => enter(seat, as)}
        onOther={() => {
          setRoomInUrl(null);
          setInviteCode(null);
          // "다른 방 만들기 · 코드로 입장" means the friend tab.
          setTab("friend");
        }}
      />
    );
  const quickOn = !!features?.quickMatch;
  const shown: Tab = !features ? tab : !quickOn && tab !== "friend" ? "friend" : tab;
  return (
    <section className="setup online-entry" aria-labelledby="online-title">
      <h1 id="online-title" className="sr-only">온라인 대전</h1>
      <div className="setup-body">
        {quickOn && (
          <div className="online-tabs" role="tablist" aria-label="온라인 대전 메뉴">
            {(
              [
                ["quick", "빠른 대전", Shuffle],
                ["friend", "친구 대전", UsersRound],
                ["watch", "관전방", Eye],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={shown === id} className={shown === id ? "active" : ""} onClick={() => setTab(id)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        )}
        {shown !== "watch" && <NickLine name={trimmed} />}
        {!features ? (
          <p className="online-lead" role="status">
            <LoaderCircle size={15} className="spin" /> 서버 정보를 불러오는 중…
          </p>
        ) : shown === "quick" ? (
          <QuickPanel server={server} name={trimmed} serverAi={!!features.serverAi} onMatched={enter} onAi={onAi} onReturn={(code) => (setRoomInUrl(code), onEnter(code))} />
        ) : shown === "watch" ? (
          <WatchRooms server={server} />
        ) : (
          <FriendPanel createSettings={!!features.createSettings} server={server} name={trimmed} enter={enter} onEnter={onEnter} />
        )}
      </div>
    </section>
  );
}

/** Invite a friend: create a room or join with a code (the original online screen). */
function FriendPanel({ server, name, enter, onEnter, createSettings }: { createSettings: boolean; server: string; name: string; enter: (seat: Seat) => void; onEnter: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [size, setSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem("yachtlab.online.size"));
      return Number.isInteger(n) && n >= 2 && n <= 20 ? n : 2;
    } catch {
      return 2;
    }
  });
  const [settings, setSettings] = useState<RoomSettings>({ mode: "turns", timeoutMs: null });
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const [resume] = useState<SavedSeat[]>(savedSeats);
  const run = async (kind: "create" | "join") => {
    const target = code.trim().toUpperCase();
    if (kind === "join" && !/^[A-Z2-9]{6}$/.test(target)) return setError("초대 코드 6자리를 입력해 주세요.");
    setBusy(kind);
    setError("");
    try {
      try {
        if (kind === "create") localStorage.setItem("yachtlab.online.size", String(size));
      } catch {
        /* ignore */
      }
      enter(kind === "create" ? await createRoom(server, name, size, createSettings ? settings : undefined) : await joinRoom(server, target, name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="online-actions friend-entry-choices">
        <form className="online-card" aria-labelledby="create-room-title" onSubmit={(event) => {
          event.preventDefault();
          void run("create");
        }}>
          <h2 id="create-room-title"><Plus size={18} aria-hidden="true" /> 새 방 만들기</h2>
          <label className="room-size">
            최대 인원
            <select aria-label="최대 인원" value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>{n === 2 ? "2명 (1:1)" : `${n}명`}</option>
              ))}
            </select>
          </label>
          {createSettings && (
            <>
              <label className="room-size">
                진행 방식
                <select value={settings.mode} onChange={(event) => {
                  const simultaneous = event.target.value === "simultaneous";
                  setSettings(simultaneous ? { mode: "simultaneous", timeoutMs: 90_000 } : { mode: "turns", timeoutMs: null });
                }}>
                  <option value="turns">순서대로</option>
                  <option value="simultaneous">동시 진행</option>
                </select>
              </label>
              <label className="room-size">
                {settings.mode === "simultaneous" ? "라운드 제한 시간" : "턴 제한 시간"}
                <select value={String(settings.timeoutMs)} onChange={(event) => {
                  const timeoutMs = event.target.value === "null" ? null : Number(event.target.value);
                  setSettings({ ...settings, timeoutMs });
                }}>
                  {(settings.mode === "simultaneous" ? ROUND_LIMITS : TURN_LIMITS).map((ms) => (
                    <option key={String(ms)} value={String(ms)}>{ms === null ? "없음" : `${ms / 1000}초`}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button type="submit" className="primary" disabled={!!busy}>
            {busy === "create" ? "만드는 중…" : "방 만들기"}
          </button>
        </form>
        <form className="online-card" aria-labelledby="join-room-title" onSubmit={(event) => {
          event.preventDefault();
          void run("join");
        }}>
          <h2 id="join-room-title"><LogIn size={18} aria-hidden="true" /> 방 참가하기</h2>
          <label className="friend-entry-code">
            초대 코드
            <input
              className="online-code-input"
              value={code}
              maxLength={6}
              placeholder="ABC234"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          </label>
          <button type="submit" className="secondary" disabled={!!busy}>
            {busy === "join" ? "입장 중…" : "입장하기"}
          </button>
        </form>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {resume.length > 0 && (
        <div className="online-resume">
          <span className="setup-label">참가 중인 방</span>
          {resume.slice(0, 3).map((seat) => (
            <button
              key={seat.code}
              type="button"
              className="online-resume-item"
              onClick={() => {
                setRoomInUrl(seat.code);
                onEnter(seat.code);
              }}
            >
              <span>
                <strong>{seat.code}</strong> · {seat.name}
              </span>
              <span>
                다시 들어가기 <ArrowRight size={14} />
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Quick match: wait for a random real player. The public-spectating choice is asked before waiting
 * (off by default; only matches both players allowed are listed). After 20 s without an opponent the
 * player may keep waiting or play an AI match instead — an AI is always shown as an AI.
 */
function QuickPanel({ server, name, serverAi, onMatched, onAi, onReturn }: { server: string; name: string; serverAi: boolean; onMatched: (seat: Seat, as: string, quick?: boolean) => void; onAi?: () => void; onReturn: (code: string) => void }) {
  const [aiBusy, setAiBusy] = useState(false);
  const member = !!session();
  /** Server-verified AI match (members): the server rolls the dice and plays the AI seat. */
  const startAi = async () => {
    qm.current?.cancel();
    qm.current = null;
    setSince(null);
    setAiBusy(true);
    setError("");
    try {
      const seat = await startServerAi(server, name);
      saveName(name);
      onMatched(seat, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState("");
  const [inMatch, setInMatch] = useState<string | null>(null);
  const qm = useRef<QuickMatch | null>(null);
  const start = (resume = pendingQuick()) => {
    setError("");
    setInMatch(null);
    const started = Date.now();
    setNow(started);
    setSince(resume?.at ?? started);
    const as = resume?.name ?? name;
    if (!resume) saveName(as);
    const q = new QuickMatch(
      server,
      { name: as, spectate: true, resume },
      {
        onQueued: () => undefined,
        onMatched: (m) => {
          qm.current = null;
          onMatched({ code: m.code, playerId: m.playerId, token: m.token }, m.name, true);
        },
        onEnd: (code, message, room) => {
          qm.current = null;
          setSince(null);
          setError(message);
          if (code === "IN_MATCH" && room && savedSeat(room)) setInMatch(room);
        },
      },
    );
    qm.current = q;
    q.start();
  };
  // A refresh while waiting continues the same wait (same ticket, same place).
  useEffect(() => {
    if (pendingQuick()) start();
    return () => qm.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [since]);
  const cancel = () => {
    qm.current?.cancel();
    qm.current = null;
    setSince(null);
  };
  const waited = since === null ? 0 : now - since;
  if (since !== null)
    return (
      <div className="quick-wait">
        <div className="quick-search-visual" aria-hidden="true">
          <Search size={26} className="quick-wait-icon" />
        </div>
        <strong role="status">상대를 찾는 중이에요</strong>
        <span className="quick-wait-time" role="timer" aria-label="매칭 경과 시간">{clock(waited)}</span>
        <span className="quick-wait-note">{session() ? "회원으로 매칭돼요." : "게스트로 매칭돼요."} 상대를 찾으면 바로 경기 화면으로 이동해요.</span>
        {waited >= 20_000 && (
          <div className="quick-wait-alt">
            <span>상대가 아직 없어요. 계속 기다리거나 AI와 대전할 수 있어요.</span>
            {serverAi && member && (
              <button type="button" className="secondary" disabled={aiBusy} onClick={() => void startAi()}>
                <Bot size={16} /> 서버 AI와 대전하기
              </button>
            )}
            {onAi && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  cancel();
                  onAi();
                }}
              >
                <Bot size={16} /> {serverAi && member ? "로컬 AI와 대전하기" : "AI와 대전하기"}
              </button>
            )}
          </div>
        )}
        <button type="button" className="secondary" onClick={cancel}>
          <X size={15} /> 매칭 취소
        </button>
      </div>
    );
  return (
    <>
      <button type="button" className="primary online-start" onClick={() => start(null)}>
        <Shuffle size={17} /> 빠른 대전 시작
      </button>
      <p className="quick-public-note">
        <Eye size={13} aria-hidden="true" /> 빠른 대전은 관전방에 공개돼요(보기 전용).
      </p>
      {serverAi && member && (
        <button type="button" className="secondary" disabled={aiBusy} onClick={() => void startAi()}>
          <Bot size={16} /> {aiBusy ? "AI 대전 준비 중…" : "서버 AI와 대전 (보통)"}
        </button>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {inMatch && (
        <button type="button" className="secondary" onClick={() => onReturn(inMatch)}>
          진행 중인 경기로 돌아가기 <ArrowRight size={15} />
        </button>
      )}
    </>
  );
}

/** Public spectating list: refreshed every 10 s while this tab is visible; the live connection opens only on 관전하기. */
function WatchRooms({ server }: { server: string }) {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      publicRooms(server)
        .then((r) => live && (setRooms(r), setError("")))
        .catch((e: Error) => live && setError(e.message));
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [server]);
  const watch = async (code: string) => {
    setBusy(code);
    setError("");
    try {
      const { key } = await publicWatchKey(server, code);
      location.assign(watchLink(code, key));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  return (
    <div className="watch-rooms">
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {rooms === null ? (
        <p className="online-lead" role="status">
          <LoaderCircle size={15} className="spin" /> 불러오는 중…
        </p>
      ) : rooms.length === 0 ? (
        <p className="watch-empty">지금 공개된 경기가 없어요.</p>
      ) : (
        <ul className="watch-list" aria-label="공개 경기">
          {rooms.map((r) => (
            <li key={r.code}>
              <div className="watch-players">
                {r.players.map((p, i) => (
                  <span key={i} className="watch-player">
                    <PlayerTag name={p.name} look={p.look} compact />
                    <strong>{p.score}</strong>
                  </span>
                ))}
              </div>
              <span className="watch-meta">
                {r.round}/12 라운드 · 관전 {r.spectators}/{r.max}
              </span>
              <button type="button" className="secondary" disabled={busy !== null || r.spectators >= r.max} onClick={() => void watch(r.code)}>
                <Eye size={15} /> {r.spectators >= r.max ? "가득 참" : busy === r.code ? "연결 중…" : "관전하기"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
