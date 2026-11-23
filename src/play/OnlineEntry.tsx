import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, LogIn, Plus } from "lucide-react";
import { createRoom, joinRoom, roomFromUrl, roomSummary, saveName, saveSeat, savedName, savedSeat, savedSeats, setRoomInUrl, type SavedSeat } from "../online/client";
import type { RoomSummary } from "../online/wire";

type Seat = { code: string; playerId: string; token: string };

/**
 * Invite link (`…/YachtLab/?room=CODE#online`): a screen for exactly that room — no code to type.
 * The saved nickname is filled in; one clear "입장하기" button joins. Rooms that cannot be joined
 * (missing/expired, full, already playing, finished) say so. The seat token never appears in the URL.
 */
function InviteJoin({ server, code, onJoined, onOther }: { server: string; code: string; onJoined: (seat: Seat, name: string) => void; onOther: () => void }) {
  const [name, setName] = useState(savedName);
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
    if (!trimmed) return setError("닉네임을 입력해 주세요.");
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
              ? "이미 두 명이 모두 들어온 방이에요."
              : "";
  return (
    <section className="setup online-entry online-invite-join" aria-labelledby="online-title">
      <div className="setup-head">
        <h1 id="online-title">온라인 대전 초대</h1>
      </div>
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
            </div>
            {blocked ? (
              <p className="online-invite-blocked" role="alert">
                {blocked}
              </p>
            ) : (
              <form
                className="online-invite-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void join();
                }}
              >
                <label className="setup-field setup-text">
                  <span className="setup-label">닉네임</span>
                  <input aria-label="닉네임" value={name} maxLength={24} autoComplete="nickname" placeholder="예: 요트왕" onChange={(e) => setName(e.target.value)} />
                </label>
                <button type="submit" className="primary online-start" disabled={busy || !trimmed}>
                  <LogIn size={17} /> {busy ? "입장 중…" : "입장하기"}
                </button>
                {trimmed && <p className="online-invite-as">‘{trimmed}’(으)로 입장해요.</p>}
              </form>
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

/**
 * Online start screen: a guest nickname, then "create a room" or "join with a code".
 * An invite link (`?room=CODE`) opens InviteJoin for that room instead.
 */
export default function OnlineEntry({ server, onEnter, onBack }: { server: string; onEnter: (code: string) => void; onBack: () => void }) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(roomFromUrl);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const [resume] = useState<SavedSeat[]>(savedSeats);

  // Invite link: if this browser already sits in that room, go straight back in (refresh / second tab).
  useEffect(() => {
    if (inviteCode && savedSeat(inviteCode)) onEnter(inviteCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = name.trim();
  const enter = (seat: Seat, as = trimmed) => {
    saveName(as);
    saveSeat({ ...seat, name: as, at: Date.now() });
    setRoomInUrl(seat.code);
    onEnter(seat.code);
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
        }}
      />
    );
  const run = async (kind: "create" | "join") => {
    if (!trimmed) return setError("닉네임을 입력해 주세요.");
    const target = code.trim().toUpperCase();
    if (kind === "join" && !/^[A-Z2-9]{6}$/.test(target)) return setError("초대 코드 6자리를 입력해 주세요.");
    setBusy(kind);
    setError("");
    try {
      enter(kind === "create" ? await createRoom(server, trimmed) : await joinRoom(server, target, trimmed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="setup online-entry" aria-labelledby="online-title">
      <div className="setup-head">
        <button type="button" className="setup-back" onClick={onBack}>
          <ArrowLeft size={17} /> 뒤로
        </button>
        <h1 id="online-title">온라인 대전</h1>
      </div>
      <div className="setup-body">
        <p className="online-lead">친구에게 초대 코드를 보내 각자의 기기에서 1:1로 대결해요. 가입 없이 닉네임만 정하면 돼요.</p>
        <label className="setup-field setup-text">
          <span className="setup-label">닉네임</span>
          <input aria-label="닉네임" value={name} maxLength={24} autoComplete="nickname" placeholder="예: 요트왕" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="online-actions">
          <form
            className="online-card"
            onSubmit={(e) => {
              e.preventDefault();
              void run("join");
            }}
          >
            <strong>초대 코드로 입장</strong>
            <input
              aria-label="초대 코드"
              className="online-code-input"
              value={code}
              maxLength={6}
              placeholder="ABC234"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
            <button type="submit" className="secondary" disabled={!!busy}>
              <LogIn size={16} /> {busy === "join" ? "입장 중…" : "입장하기"}
            </button>
          </form>
          <div className="online-card">
            <strong>새 방 만들기</strong>
            <span>방을 만들고 친구에게 코드나 링크를 보내요.</span>
            <button type="button" className="primary" disabled={!!busy} onClick={() => void run("create")}>
              <Plus size={16} /> {busy === "create" ? "만드는 중…" : "방 만들기"}
            </button>
          </div>
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
      </div>
    </section>
  );
}
