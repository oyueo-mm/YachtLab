import { useEffect, useState, useSyncExternalStore } from "react";
import { RecentOpponents } from "../social/RecentOpponents";
import { Ban, Check, Copy, LoaderCircle, Mail, Search, UserMinus, UserPlus, UserRound, X } from "lucide-react";
import { session } from "../identity/account-client";
import { acceptInvite, declineInvite, friendAction, friendProfile, friends, inbox, inviteFriends, searchFriends, type FriendData, type FriendProfile, type RoomInvite, type SearchResult } from "../identity/friends-client";
import { saveSeat, savedName } from "../online/client";
import { ConfirmDialog, type PendingAction } from "../ui/ConfirmDialog";
import type { Route } from "../routes";

/* ----------------------------------------------------------- inbox (shared store) ----------------------------------------------------------- */
/**
 * Requests and room invites for the signed-in member: checked once a minute while the site is visible
 * (and when it becomes visible again). That check is also what tells friends "online" — there is no other
 * presence traffic. Guests and signed-out pages never poll.
 */
type InboxState = { requests: number; invites: RoomInvite[] };
let state: InboxState = { requests: 0, invites: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let timer: ReturnType<typeof setInterval> | undefined;
let running: string | null = null;
export async function refreshInbox(server: string) {
  if (!session()) return;
  try {
    const r = await inbox(server);
    state = { requests: r.requests, invites: r.invites };
    emit();
  } catch {
    /* offline: try again on the next tick */
  }
}
export function startInbox(server: string | null) {
  if (!server || running === server) return;
  running = server;
  const tick = () => document.visibilityState === "visible" && session() && void refreshInbox(server);
  tick();
  timer = setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("yachtlab-session", tick);
}
export function stopInbox() {
  clearInterval(timer);
  running = null;
}
const dropInvite = (id: string) => {
  state = { ...state, invites: state.invites.filter((i) => i.id !== id) };
  emit();
};
export const useInbox = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state,
  );

/** Room invites from friends, as small cards on any page (accept joins the room; decline removes it). */
export function InviteToasts({ server, onJoined }: { server: string | null; onJoined: (code: string) => void }) {
  const box = useInbox();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!box.invites.length) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [box.invites.length]);
  if (!server || !box.invites.length) return null;
  const live = box.invites.filter((i) => i.expires > now);
  if (!live.length) return null;
  const accept = async (inv: RoomInvite) => {
    setBusy(inv.id);
    setError("");
    try {
      const seat = await acceptInvite(server, inv.id);
      saveSeat({ code: seat.code, playerId: seat.playerId, token: seat.token, name: savedName(), at: Date.now() });
      dropInvite(inv.id);
      onJoined(seat.code);
    } catch (e) {
      dropInvite(inv.id);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="invite-toasts" role="region" aria-label="친구 초대">
      {live.slice(0, 3).map((inv) => (
        <div key={inv.id} className="invite-toast" role="alert">
          <Mail size={16} aria-hidden="true" />
          <span>
            <strong>{inv.from.nickname}</strong> 님이 친구 대전에 초대했어요
            <small>{Math.max(0, Math.ceil((inv.expires - now) / 60_000))}분 안에 응답해 주세요</small>
          </span>
          <button type="button" className="primary" disabled={!!busy} onClick={() => void accept(inv)}>
            {busy === inv.id ? "입장 중…" : "수락"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!!busy}
            onClick={() => {
              dropInvite(inv.id);
              void declineInvite(server, inv.id).catch(() => undefined);
            }}
          >
            거절
          </button>
        </div>
      ))}
      {error && (
        <p className="invite-error" role="alert">
          {error}
          <button type="button" className="icon-button" aria-label="닫기" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- friends page --------------------------------------------------------------- */

const STATUS = { online: "접속 중", playing: "경기 중", offline: "오프라인" } as const;

export function FriendsPage({ server, go }: { server: string | null; go: (r: Route) => void }) {
  const [data, setData] = useState<FriendData | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [confirm, setConfirm] = useState<PendingAction>(null);
  const signed = !!session();
  const load = () => {
    if (!server || !session()) return;
    friends(server)
      .then((d) => (setData(d), setError("")))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    load();
    if (!server || !signed) return;
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, signed]);
  if (!server) return <p className="econ-note">온라인 서버에 연결되어 있지 않아요.</p>;
  if (!signed)
    return (
      <section className="econ-page friends-page" aria-labelledby="friends-title">
        <h1 id="friends-title">친구</h1>
        <div className="econ-gate">
          <p>친구 목록과 친구 초대는 Google 로그인한 회원만 쓸 수 있어요. 게스트는 초대 코드·링크로 친구 대전에 들어갈 수 있어요.</p>
          <button type="button" className="primary" onClick={() => go("profile")}>
            프로필에서 로그인하기
          </button>
        </div>
      </section>
    );
  const act = async (fn: () => Promise<unknown>, message = "") => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (message) setNote(message);
      load();
      void refreshInbox(server);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      setResults(await searchFriends(server, query.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const openProfile = (code: string) =>
    friendProfile(server, code)
      .then(setProfile)
      .catch((e: Error) => setError(e.message));
  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.me.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code is shown on screen */
    }
  };
  const sorted = data ? [...data.friends].sort((a, b) => ["playing", "online", "offline"].indexOf(a.status) - ["playing", "online", "offline"].indexOf(b.status) || a.nickname.localeCompare(b.nickname)) : [];
  return (
    <section className="econ-page friends-page" aria-labelledby="friends-title">
      <div className="econ-head">
        <h1 id="friends-title">친구</h1>
        {data && (
          <button type="button" className="friend-code" onClick={() => void copy()} aria-label={`내 친구 코드 ${data.me.code} 복사`}>
            <span>내 친구 코드</span>
            <strong>{data.me.code}</strong>
            <Copy size={14} /> {copied ? "복사됨" : ""}
          </button>
        )}
      </div>
      {note && <p className="econ-ok" role="status">{note}</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <form
        className="friend-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input aria-label="친구 찾기" placeholder="닉네임 전체 또는 친구 코드" value={query} maxLength={24} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="primary" disabled={busy || !query.trim()}>
          <Search size={16} /> 찾기
        </button>
      </form>
      {results && (
        <ul className="friend-list" aria-label="검색 결과">
          {results.length === 0 && <li className="econ-note">찾는 사람이 없어요. 닉네임 전체를 정확히 입력하거나 친구 코드를 받아 보세요.</li>}
          {results.map((r) => (
            <li key={r.code}>
              <span className="friend-name">
                <strong>{r.nickname}</strong>
                <small>{r.code}</small>
              </span>
              {r.relation === "self" ? (
                <span className="friend-tag">나</span>
              ) : r.relation === "friend" ? (
                <span className="friend-tag">친구</span>
              ) : r.relation === "outgoing" ? (
                <span className="friend-tag">요청 보냄</span>
              ) : r.relation === "incoming" ? (
                <button type="button" className="primary" disabled={busy} onClick={() => void act(() => friendAction(server, "accept", r.code), `${r.nickname} 님과 친구가 됐어요.`)}>
                  수락
                </button>
              ) : r.relation === "blocked" ? (
                <span className="friend-tag">차단함</span>
              ) : (
                <button type="button" className="primary" disabled={busy} onClick={() => void act(() => friendAction(server, "request", r.code).then(() => setResults((rs) => rs?.map((x) => (x.code === r.code ? { ...x, relation: "outgoing" } : x)) ?? null)), "친구 요청을 보냈어요.")} aria-label={`${r.nickname} 친구 요청`}>
                  <UserPlus size={15} /> 요청
                </button>
              )}
              {r.relation !== "self" && (
                <button type="button" className="text-button" onClick={() => void openProfile(r.code)}>
                  프로필
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!data ? (
        <p className="econ-note" role="status">
          <LoaderCircle size={15} className="spin" /> 불러오는 중…
        </p>
      ) : (
        <>
          {data.incoming.length > 0 && (
            <>
              <h2 className="econ-sub">받은 요청 {data.incoming.length}</h2>
              <ul className="friend-list" aria-label="받은 친구 요청">
                {data.incoming.map((r) => (
                  <li key={r.code}>
                    <span className="friend-name">
                      <strong>{r.nickname}</strong>
                      <small>{r.code}</small>
                    </span>
                    <button type="button" className="primary" disabled={busy} onClick={() => void act(() => friendAction(server, "accept", r.code), `${r.nickname} 님과 친구가 됐어요.`)} aria-label={`${r.nickname} 수락`}>
                      <Check size={15} /> 수락
                    </button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void act(() => friendAction(server, "decline", r.code))} aria-label={`${r.nickname} 거절`}>
                      거절
                    </button>
                    <button type="button" className="text-button" disabled={busy} onClick={() => setConfirm({ title: "차단할까요?", message: `${r.nickname} 님의 요청과 초대를 더 받지 않아요.`, confirmLabel: "차단", run: () => void act(() => friendAction(server, "block", r.code), "차단했어요.") })}>
                      차단
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h2 className="econ-sub">친구 {data.friends.length}</h2>
          {data.friends.length === 0 ? (
            <p className="econ-note">아직 친구가 없어요. 친구 코드를 알려 주거나 닉네임으로 찾아 보세요.</p>
          ) : (
            <ul className="friend-list" aria-label="친구 목록">
              {sorted.map((f) => (
                <li key={f.code} data-status={f.status}>
                  <span className={"online-dot" + (f.status !== "offline" ? " on" : "")} aria-hidden="true" />
                  <span className="friend-name">
                    <strong>{f.nickname}</strong>
                    <small>{STATUS[f.status]}</small>
                  </span>
                  <button type="button" className="text-button" onClick={() => void openProfile(f.code)} aria-label={`${f.nickname} 프로필`}>
                    <UserRound size={15} /> 프로필
                  </button>
                  <button type="button" className="icon-button" aria-label={`${f.nickname} 친구 삭제`} onClick={() => setConfirm({ title: "친구를 삭제할까요?", message: `${f.nickname} 님이 친구 목록에서 빠져요.`, confirmLabel: "삭제", run: () => void act(() => friendAction(server, "remove", f.code), "친구를 삭제했어요.") })}>
                    <UserMinus size={16} />
                  </button>
                  <button type="button" className="icon-button" aria-label={`${f.nickname} 차단`} onClick={() => setConfirm({ title: "차단할까요?", message: `${f.nickname} 님이 친구에서 빠지고, 요청과 초대를 더 받지 않아요.`, confirmLabel: "차단", run: () => void act(() => friendAction(server, "block", f.code), "차단했어요.") })}>
                    <Ban size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <RecentOpponents server={server} />
          {data.outgoing.length > 0 && (
            <>
              <h2 className="econ-sub">보낸 요청</h2>
              <ul className="friend-list" aria-label="보낸 친구 요청">
                {data.outgoing.map((r) => (
                  <li key={r.code}>
                    <span className="friend-name">
                      <strong>{r.nickname}</strong>
                      <small>응답을 기다리는 중</small>
                    </span>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void act(() => friendAction(server, "cancel", r.code))} aria-label={`${r.nickname} 요청 취소`}>
                      요청 취소
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.blocked.length > 0 && (
            <details className="friend-blocked">
              <summary>차단한 사용자 {data.blocked.length}</summary>
              <ul className="friend-list" aria-label="차단 목록">
                {data.blocked.map((r) => (
                  <li key={r.code}>
                    <span className="friend-name">
                      <strong>{r.nickname}</strong>
                    </span>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void act(() => friendAction(server, "unblock", r.code), "차단을 풀었어요.")} aria-label={`${r.nickname} 차단 해제`}>
                      차단 해제
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="econ-note">친구 대전 대기실에서 &lsquo;친구 초대&rsquo;로 접속 중인 친구를 바로 부를 수 있어요. 이메일이나 계정 정보는 다른 사람에게 보이지 않아요.</p>
        </>
      )}
      {profile && (
        <div className="modal-backdrop" role="presentation" onClick={() => setProfile(null)}>
          <div className="modal opponent-profile" role="dialog" aria-label="친구 프로필" onClick={(e) => e.stopPropagation()}>
            <h2>{profile.nickname}</h2>
            <p className="profile-fine">
              {profile.code} · {new Date(profile.joinedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long" })} 가입 · 서버가 확인한 온라인 경기 기준
            </p>
            <p>
              {profile.online.games}경기 · {profile.online.wins}승 {profile.online.losses}패{profile.online.draws ? ` ${profile.online.draws}무` : ""}
              {profile.online.best !== null ? ` · 최고 ${profile.online.best}점` : ""}
            </p>
            <button type="button" className="secondary" onClick={() => setProfile(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "확인"}
        cancelLabel="취소"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const run = confirm?.run;
          setConfirm(null);
          run?.();
        }}
      />
    </section>
  );
}

/**
 * Waiting room (J): invite friends directly (members). Online friends first; several at once (up to the
 * free seats). The room code / link stay for guests. Results per friend come from the server.
 */
export function FriendInvite({ server, room, freeSeats }: { server: string; room: string; freeSeats: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FriendData | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!session()) return null;
  const show = () => {
    setOpen(true);
    setResult({});
    setError("");
    friends(server)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  };
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await inviteFriends(server, room, picked));
      setPicked([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const order = ["online", "playing", "offline"];
  const list = data ? [...data.friends].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)) : [];
  const label = (r?: string) => (r === "sent" ? "초대함" : r === "recent" ? "방금 초대함" : r === "not-friend" ? "친구 아님" : "");
  return (
    <>
      <button type="button" className="secondary" onClick={show} disabled={freeSeats <= 0}>
        <UserPlus size={15} /> 친구 초대
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="modal friend-invite" role="dialog" aria-label="친구 초대" onClick={(e) => e.stopPropagation()}>
            <div className="item-detail-head">
              <h2>친구 초대</h2>
              <button type="button" className="icon-button" aria-label="닫기" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="econ-note">빈자리 {freeSeats}석 · 초대는 10분 동안 유효해요.</p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            {!data ? (
              <p className="econ-note" role="status">
                <LoaderCircle size={15} className="spin" /> 불러오는 중…
              </p>
            ) : list.length === 0 ? (
              <p className="econ-note">친구가 없어요. 친구 메뉴에서 친구를 추가하거나 초대 링크를 보내 주세요.</p>
            ) : (
              <ul className="friend-list" aria-label="초대할 친구">
                {list.map((f) => (
                  <li key={f.code}>
                    <label className="friend-pick">
                      <input
                        type="checkbox"
                        checked={picked.includes(f.code)}
                        disabled={!picked.includes(f.code) && picked.length >= freeSeats}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.code] : p.filter((c) => c !== f.code)))}
                      />
                      <span className={"online-dot" + (f.status !== "offline" ? " on" : "")} aria-hidden="true" />
                      <span className="friend-name">
                        <strong>{f.nickname}</strong>
                        <small>{STATUS[f.status]}</small>
                      </span>
                    </label>
                    {result[f.code] && <span className="friend-tag">{label(result[f.code])}</span>}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="primary" disabled={busy || picked.length === 0} onClick={() => void send()}>
              {busy ? "보내는 중…" : `${picked.length}명 초대하기`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
