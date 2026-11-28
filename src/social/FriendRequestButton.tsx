import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Clock, UserPlus, Ban, LoaderCircle, KeyRound } from "lucide-react";
import { session } from "../identity/account-client";
import { accountKey, liveApi, loadRelation, peekRelation, sendFriendRequest, subscribeRelations, MANUAL_ADD_MESSAGE, type Resolved } from "./friend-relations";
import "./friend-request.css";

/**
 * "친구 추가" for a person known by account id (A4). One behaviour for every place: the opponent's
 * profile in a match, the recent opponents list, and (A3) the match result screen.
 *   shows   친구 추가 · 요청 보냄(대기 중) · 이미 친구 · 상대가 먼저 요청함 · 차단한 사용자 — ONLY for a person the server has bound to a friend code
 *           otherwise: how to add them by friend code (no button, nothing is sent, nothing is guessed from the nickname)
 *   never   sends twice, sends to a friend / blocked / pending person, or sends without a signed-in account.
 * Guests and AI opponents have no account id: pass `userId` only for members.
 */
export function FriendRequestButton({ server, userId, nickname, compact = false, onChange, room }: { server: string | null; userId?: string | null; nickname?: string; compact?: boolean; onChange?: (r: Resolved["relation"]) => void; /** SOC-1: the room both are seated in (in-match profile, before a record exists). */ room?: string | null }) {
  const signed = !!session();
  const account = useSyncExternalStore(subscribeRelations, accountKey, () => "");
  const shared = useSyncExternalStore(subscribeRelations, () => (server && userId ? peekRelation(server, userId) : null), () => null);
  const [rel, setRel] = useState<Resolved | null>(shared);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setRel(shared), [shared]);
  useEffect(() => {
    if (!server || !userId || !signed) return;
    let alive = true;
    setRel(null);
    setMessage("");
    loadRelation(server, userId, liveApi(server, room))
      .then((r) => alive && (setRel(r), onChange?.(r.relation)))
      .catch((e: Error) => alive && setMessage(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, userId, signed, account, room]);
  if (!server || !userId) return null;
  const cls = "friend-req" + (compact ? " compact" : "");
  if (!signed) return <p className={cls + " note"}>로그인하면 친구로 추가할 수 있어요.</p>;
  const relation = rel?.relation;
  if (!rel && !message) return <p className={cls + " note"} role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> 확인하는 중…</p>;
  if (relation === "self") return null;
  if (relation === "friend") return <p className={cls + " state friend"}><Check size={14} aria-hidden="true" /> 이미 친구예요</p>;
  if (relation === "outgoing") return <p className={cls + " state pending"} role="status"><Clock size={14} aria-hidden="true" /> 친구 요청을 보냈어요 · 응답 대기 중</p>;
  if (relation === "incoming") return <p className={cls + " state incoming"}><UserPlus size={14} aria-hidden="true" /> 상대가 먼저 요청했어요 · <a href="#friends">친구 화면에서 수락</a></p>;
  if (relation === "blocked") return <p className={cls + " state blocked"}><Ban size={14} aria-hidden="true" /> 차단한 사용자예요</p>;
  if (relation === "unresolved" || !rel)
    return (
      <p className={cls + " note manual"} data-friend-manual>
        <KeyRound size={14} aria-hidden="true" /> {message || MANUAL_ADD_MESSAGE} <a href="#friends">친구 화면 열기</a>
      </p>
    );
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const out = await sendFriendRequest(server, userId, liveApi(server, room));
    setBusy(false);
    if (!out.ok) setMessage(out.message);
    else onChange?.(out.relation);
  };
  return (
    <div className={cls}>
      <button type="button" className="secondary friend-req-button" disabled={busy} aria-label={`${nickname ?? rel.nickname} 친구 추가`} onClick={() => void send()}>
        {busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <UserPlus size={15} aria-hidden="true" />} 친구 추가
      </button>
      {message && <p className="friend-req-error" role="alert">{message}</p>}
    </div>
  );
}
