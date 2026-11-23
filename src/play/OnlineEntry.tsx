import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LogIn, Plus } from "lucide-react";
import { createRoom, joinRoom, roomFromUrl, roomSummary, saveName, saveSeat, savedName, savedSeat, savedSeats, setRoomInUrl, type SavedSeat } from "../online/client";
import type { RoomSummary } from "../online/wire";

const statusText = { lobby: "대기 중", playing: "경기 중", finished: "종료" } as const;

/**
 * Online start screen: a guest nickname, then "create a room" or "join with a code".
 * An invite link (`?room=CODE`) pre-fills the code and shows whose room it is.
 */
export default function OnlineEntry({ server, onEnter, onBack }: { server: string; onEnter: (code: string) => void; onBack: () => void }) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(() => roomFromUrl() ?? "");
  const [invite, setInvite] = useState<RoomSummary | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const [resume] = useState<SavedSeat[]>(savedSeats);

  // Invite link: if this browser already sits in that room, go straight back in.
  useEffect(() => {
    const fromUrl = roomFromUrl();
    if (!fromUrl) return;
    if (savedSeat(fromUrl)) return onEnter(fromUrl);
    roomSummary(server, fromUrl)
      .then(setInvite)
      .catch(() => setError("초대받은 방을 찾을 수 없어요. 코드를 확인해 주세요."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = name.trim();
  const enter = (seat: { code: string; playerId: string; token: string }) => {
    saveName(trimmed);
    saveSeat({ ...seat, name: trimmed, at: Date.now() });
    setRoomInUrl(seat.code);
    onEnter(seat.code);
  };
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
        {invite && (
          <p className="online-invite" role="status">
            <strong>{invite.players[0] ?? "친구"}</strong> 님의 방에 초대받았어요 · {statusText[invite.status]}
          </p>
        )}
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
            <button type="submit" className={invite ? "primary" : "secondary"} disabled={!!busy}>
              <LogIn size={16} /> {busy === "join" ? "입장 중…" : "입장하기"}
            </button>
          </form>
          <div className="online-card">
            <strong>새 방 만들기</strong>
            <span>방을 만들고 친구에게 코드나 링크를 보내요.</span>
            <button type="button" className={invite ? "secondary" : "primary"} disabled={!!busy} onClick={() => void run("create")}>
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
