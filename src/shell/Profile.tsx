import { AccountError, matchReview } from "../identity/account-client";
import ReviewLauncher from "../review/ReviewLauncher";
import { recentOnlineReview } from "../review/online-history";
import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Pencil, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { names } from "../engine";
import { graphemes, validateNickname } from "../identity/nickname";
import { computeStats, type MatchRecord, type RecordMode } from "../identity/records";
import { guest, importedIds, localRecords, markImported } from "../identity/local";
import { deleteAccount, importRecords, me, serverRecords, session, setNickname as saveRemoteNickname, signInAvailable, signOut, startSignIn, type Profile as AccountProfile } from "../identity/account-client";
import { saveName } from "../online/client";
import { useNickname } from "../identity/display-name";
import { PlayerTag } from "../play/Looks";
import { WalletBar } from "./EconomyPages";
import { useProfileEconomy } from "./HomeProfile";
import { ConfirmDialog, type PendingAction } from "../ui/ConfirmDialog";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 1000) / 10}%`);
const num = (x: number | null, digits = 0) => (x === null ? "—" : x.toFixed(digits));
const date = (t: number) => new Date(t).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
const outcomeText = { win: "승", loss: "패", draw: "무" } as const;

/** Small trend line of the last scores (no chart library; drawn only with ≥ 2 games). */
function Trend({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null;
  const max = Math.max(...scores, 1),
    w = 240,
    h = 56;
  const pts = scores.map((s, i) => `${(i / (scores.length - 1)) * w},${h - (s / max) * (h - 6) - 3}`).join(" ");
  return (
    <svg className="profile-trend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`최근 ${scores.length}경기 점수 추이, 마지막 ${scores.at(-1)}점`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Profile (Phase 4): the player's own name, results and statistics, and — only if the server has
 * sign-in configured — the account controls. Guests get everything that this device knows, with a
 * plain note that clearing browser data removes it. No invented numbers: empty states say so.
 */
export default function Profile({ server, notice }: { server: string | null; notice?: string }) {
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [signedIn, setSignedIn] = useState(() => !!session());
  const [loginReady, setLoginReady] = useState(false);
  const [remote, setRemote] = useState<MatchRecord[] | null>(null);
  const [local, setLocal] = useState<MatchRecord[]>(localRecords);
  const [mode, setMode] = useState<"all" | RecordMode>("all");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState(notice ?? "");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingAction>(null);
  const g = useMemo(guest, []);
  /** In-app browsers (KakaoTalk, Instagram, Facebook, LINE, NAVER…) — Google refuses OAuth inside them. */
  const inApp = typeof navigator !== "undefined" && /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|; wv\)/i.test(navigator.userAgent);

  useEffect(() => {
    void signInAvailable(server).then(setLoginReady);
    const sync = () => setSignedIn(!!session());
    const records = () => setLocal(localRecords());
    window.addEventListener("yachtlab-session", sync);
    window.addEventListener("yachtlab-records", records);
    return () => {
      window.removeEventListener("yachtlab-session", sync);
      window.removeEventListener("yachtlab-records", records);
    };
  }, [server]);
  useEffect(() => {
    if (!signedIn || !server) {
      setAccount(null);
      setRemote(null);
      return;
    }
    me(server)
      .then(setAccount)
      .catch((e) => setMessage(e.message));
    serverRecords(server)
      .then(setRemote)
      .catch(() => setRemote(null));
  }, [signedIn, server]);

  const { snapshot } = useProfileEconomy(server);
  const localName = useNickname();
  const nickname = account?.nickname ?? localName;
  const shownName = nickname || "이름 없음";
  const records = signedIn && remote ? remote : local;
  const filtered = mode === "all" ? records : records.filter((r) => r.mode === mode);
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const firstPlay = signedIn && account ? account.createdAt : Math.min(g.createdAt, ...local.map((r) => r.startedAt));
  const notImported = signedIn ? local.filter((r) => !importedIds().has(r.recordId)) : [];

  const saveNick = async () => {
    const v = validateNickname(draft);
    if (!v.ok) return setMessage(v.message);
    setBusy(true);
    try {
      if (signedIn && server) {
        const r = await saveRemoteNickname(server, v.name);
        setAccount((a) => (a ? { ...a, nickname: r.nickname } : a));
      }
      saveName(v.name);
      setEditing(false);
      setMessage("닉네임을 바꿨어요.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const linkLocal = async () => {
    if (!server) return;
    setBusy(true);
    try {
      const r = await importRecords(server, notImported, g.key);
      markImported(notImported.map((x) => x.recordId));
      setMessage(`이 기기 기록 ${r.added}개를 계정에 연결했어요${r.skipped ? ` (이미 있던 ${r.skipped}개 제외)` : ""}. 기기 기록은 '기기 기록'으로 표시돼요.`);
      setRemote(await serverRecords(server));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile" aria-labelledby="profile-title">
      <header className="profile-head">
        {!snapshot && <span className="profile-avatar" aria-hidden="true">
          {nickname ? graphemes(nickname)[0] : <UserRound size={26} />}
        </span>}
        <div className="profile-id">
          {editing ? (
            <form
              className="profile-edit"
              onSubmit={(e) => {
                e.preventDefault();
                void saveNick();
              }}
            >
              <input aria-label="닉네임" value={draft} maxLength={40} autoFocus onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" className="primary" disabled={busy}>
                저장
              </button>
              <button type="button" className="secondary" onClick={() => setEditing(false)}>
                취소
              </button>
            </form>
          ) : (
            <h1 id="profile-title">
              <span className="profile-name">{snapshot ? <PlayerTag name={shownName} look={snapshot.look} me /> : shownName}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="닉네임 바꾸기"
                onClick={() => {
                  setDraft(nickname);
                  setEditing(true);
                }}
              >
                <Pencil size={15} />
              </button>
            </h1>
          )}
          <p className="profile-meta">
            <span className={"profile-badge" + (signedIn ? " member" : "")}>{signedIn ? "회원" : "게스트"}</span>
            <span className="profile-nick-note">{signedIn ? "계정 닉네임 · 모든 대전에 쓰여요" : "이 기기 닉네임 · 모든 대전에 쓰여요"}</span>
            {Number.isFinite(firstPlay) && <span>{signedIn ? "가입" : "처음 플레이"} {date(firstPlay)}</span>}
          </p>
        </div>
      </header>
      {snapshot && <WalletBar snap={snapshot} />}
      {message && (
        <p className="profile-message" role="status">
          {message}
        </p>
      )}

      {!signedIn && <section className="profile-account" aria-label="로그인">
        {loginReady && server && inApp ? (
          <>
            <p className="profile-note">이 앱 안의 브라우저에서는 Google 로그인이 막혀 있어요. Chrome·Safari 같은 기본 브라우저로 열어 로그인해 주세요. 게임은 여기서도 그대로 할 수 있어요.</p>
            {/KAKAOTALK/i.test(navigator.userAgent) && (
              <a className="secondary" href={"kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href.split("#")[0] + "#profile")}>
                기본 브라우저로 열기
              </a>
            )}
          </>
        ) : loginReady && server ? (
          <>
            <p className="profile-note">로그인하면 기록이 계정에 저장되고 다른 기기에서도 볼 수 있어요. 로그인하지 않아도 모든 게임을 할 수 있어요.</p>
            <button type="button" className="primary" onClick={() => void startSignIn(server).catch((e) => setMessage(e.message))}>
              <LogIn size={16} /> Google로 로그인
            </button>
            <p className="profile-fine">Google 계정의 식별자만 사용하고 이메일·이름·사진은 받지 않아요.</p>
          </>
        ) : (
          <p className="profile-note">회원 로그인은 준비 중이에요. 지금은 이 기기에만 기록이 저장돼요.</p>
        )}
        <p className="profile-fine">게스트 기록은 이 브라우저에만 있어요. 브라우저 데이터를 지우면 함께 사라져요.</p>
      </section>}

      <div className="segmented profile-modes" role="radiogroup" aria-label="기록 종류">
        {(
          [
            ["all", "전체"],
            ["online", "온라인"],
            ["ai", "AI 대전"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className={mode === v ? "checked" : ""}>
            <input type="radio" name="profile-mode" checked={mode === v} onChange={() => setMode(v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {stats.games === 0 ? (
        <p className="profile-empty">아직 기록이 없어요. 한 판 끝내면 여기에 결과가 쌓여요.</p>
      ) : (
        <>
          <dl className="profile-stats">
            <div>
              <dt>경기</dt>
              <dd>{stats.games}</dd>
            </div>
            <div>
              <dt>승 · 패 · 무</dt>
              <dd>
                {stats.wins} · {stats.losses} · {stats.draws}
              </dd>
            </div>
            <div>
              <dt>승률</dt>
              <dd>{pct(stats.winRate)}</dd>
            </div>
            <div>
              <dt>최고 점수</dt>
              <dd>{num(stats.best)}</dd>
            </div>
            <div>
              <dt>평균 점수</dt>
              <dd>{num(stats.average, 1)}</dd>
            </div>
            <div>
              <dt>요트 · 라지 스트레이트</dt>
              <dd>
                {stats.yachts} · {stats.largeStraights}
              </dd>
            </div>
          </dl>
          <details className="profile-details">
            <summary>상세 통계</summary>
            <h3>최근 점수 추이</h3>
            <Trend scores={stats.recentScores} />
            <h3>모드별 경기 수</h3>
            <p>
              온라인 {stats.byMode.online} · AI 대전 {stats.byMode.ai}
            </p>
            {stats.byAiLevel.length > 0 && (
              <>
                <h3>AI 난이도별</h3>
                <ul className="profile-table">
                  {stats.byAiLevel.map((l) => (
                    <li key={l.level}>
                      <span>{l.level}</span>
                      <span>
                        {l.wins}승 {l.losses}패{l.draws ? ` ${l.draws}무` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {stats.opponents.length > 0 && (
              <>
                <h3>온라인 상대별</h3>
                <ul className="profile-table">
                  {stats.opponents.map((o) => (
                    <li key={o.key}>
                      <span>{o.name}</span>
                      <span>
                        {o.wins}승 {o.losses}패{o.draws ? ` ${o.draws}무` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3>족보별 (평균 · 0점 아닌 기록)</h3>
            <ul className="profile-table">
              {stats.byCategory
                .filter((c) => c.filled > 0)
                .map((c) => (
                  <li key={c.category}>
                    <span>{names[c.category]}</span>
                    <span>
                      {c.average.toFixed(1)} · {c.hits}회
                    </span>
                  </li>
                ))}
            </ul>
          </details>
          <h2 className="profile-subtitle">최근 경기</h2>
          <ul className="profile-recent">
            {[...filtered]
              .sort((a, b) => b.endedAt - a.endedAt)
              .slice(0, 10)
              .map((r) => (
                <li key={r.recordId} className={"result-" + r.outcome}>
                  <strong>{outcomeText[r.outcome]}</strong>
                  <span className="profile-recent-vs">
                    {r.mode === "ai" ? r.aiLevel ?? "AI" : r.opponent.name}
                    <small>
                      {r.mode === "online" ? "온라인" : "AI"} · {new Date(r.endedAt).toLocaleDateString("ko-KR")}
                      {r.verification === "server-verified" ? " · 서버 확인" : " · 기기 기록"}
                      {r.endReason !== "completed" ? (r.endReason === "resign" ? " · 기권" : r.endReason === "left" ? " · 연결 끊김" : " · 시간 초과") : ""}
                    </small>
                  </span>
                  <span className="profile-recent-score">
                    {r.score} : {r.opponent.score}
                    {r.mode === "online" && (!r.field || r.field.players === 2) && <ReviewLauncher source={async () => {
                      const recent = recentOnlineReview(r.recordId);
                      if (typeof recent !== "string" || !server || !signedIn || r.verification !== "server-verified") return recent;
                      const owner = session();
                      try {
                        const archived = await matchReview(server, r.recordId);
                        return session() === owner ? archived ?? recent : "같은 계정으로 로그인한 뒤 게임 리뷰를 열어 주세요.";
                      } catch (error) {
                        if (error instanceof AccountError && error.status === 404) return recent;
                        return "서버 게임 리뷰를 불러올 수 없어요. 연결과 로그인 상태를 확인해 주세요.";
                      }
                    }} />}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}

      {signedIn && <section className="profile-account" aria-label="계정">
            <p className="profile-note">
              <ShieldCheck size={15} /> 온라인 경기 결과는 서버가 직접 기록해요. 다른 기기에서 로그인해도 같은 기록이 보여요.
            </p>
            {notImported.length > 0 && (
              <button type="button" className="secondary" disabled={busy} onClick={() => void linkLocal()}>
                이 기기 기록 {notImported.length}개 계정에 연결
              </button>
            )}
            <div className="profile-account-actions">
              <button type="button" className="secondary" onClick={() => server && void signOut(server).catch(() => undefined)}>
                <LogOut size={15} /> 로그아웃
              </button>
              <button type="button" className="text-button" onClick={() => server && void signOut(server, true).catch(() => undefined)}>
                모든 기기에서 로그아웃
              </button>
              <button
                type="button"
                className="text-button danger"
                onClick={() =>
                  setConfirm({
                    title: "계정을 삭제할까요?",
                    message: "계정, 닉네임, 서버에 저장된 모든 경기 기록이 바로 삭제되고 되돌릴 수 없어요. 이 기기의 기록은 남아요.",
                    confirmLabel: "계정 삭제",
                    run: () => server && void deleteAccount(server).then(() => setMessage("계정을 삭제했어요.")).catch((e) => setMessage(e.message)),
                  })
                }
              >
                <Trash2 size={15} /> 계정 삭제
              </button>
            </div>
      </section>}
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
    </section>
  );
}
