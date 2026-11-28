import { useEffect, useState } from "react";
import { publicProfile, type PublicProfile } from "../identity/account-client";
import { FriendRequestButton } from "./FriendRequestButton";

/** The opponent's public profile during/after an online match, with the shared friend-request button. */
export function OpponentProfile({ server, userId, onClose }: { server: string; userId: string; onClose: () => void }) {
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
            <FriendRequestButton server={server} userId={userId} nickname={p.nickname} />
          </>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
