import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Clock, UserPlus, Ban, LoaderCircle } from "lucide-react";
import { session } from "../identity/account-client";
import { ensureSelfRegistered, loadRelation, peekRelation, sendFriendRequest, subscribeRelations, type Resolved } from "./friend-relations";
import "./friend-request.css";

/**
 * "친구 추가" for a person known by account id (A4). One behaviour for every place: the opponent's
 * profile in a match, the recent opponents list, and (A3) the match result screen.
 *   shows   친구 추가 · 요청 보냄(대기 중) · 이미 친구 · 상대가 먼저 요청함(친구 화면에서 수락) · 차단한 사용자 · (본인/확인 불가는 안내)
 *   never   sends twice, sends to a friend / blocked / pending person, or sends without a signed-in account.
 * Guests and AI opponents have no account id: pass `userId` only for members.
 */
export function FriendRequestButton({ server, userId, nickname, compact = false, onChange }: { server: string | null; userId?: string | null; nickname?: string; compact?: boolean; onChange?: (r: Resolved["relation"]) => void }) {
  const signed = !!session();
  const shared = useSyncExternalStore(subscribeRelations, () => (server && userId ? peekRelation(server, userId) : null), () => null);
  const [rel, setRel] = useState<Resolved | null>(shared);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setRel(shared), [shared]);
  useEffect(() => {
    if (!server || !userId || !signed) return;
    let alive = true;
    ensureSelfRegistered(server);
    loadRelation(server, userId)
      .then((r) => alive && (setRel(r), onChange?.(r.relation)))
      .catch((e: Error) => alive && setMessage(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, userId, signed]);
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
  if (relation === "unresolved" || !rel) return <p className={cls + " note"}>{message || "이 사람은 친구 화면에서 친구 코드로 추가할 수 있어요."}</p>;
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const out = await sendFriendRequest(server, userId);
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
