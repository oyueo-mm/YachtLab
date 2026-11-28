import { useCallback, useEffect, useState } from "react";
import { Check, Coins, Gem, Gift } from "lucide-react";
import { EconomyError, claimAttendance, claimReward, redeemCode, rewards, signedIn, type RewardsView } from "../identity/economy-client";
import { itemById } from "../economy/live/catalog";
import { BrandMark } from "../ui/BrandLoading";
import type { Route } from "../routes";
import "./rewards.css";

/**
 * C5-CORE rewards page (#rewards): attendance, activity streak, weekly best streak, the reward inbox and
 * redeem codes. Every number comes from the server (GET /api/me/rewards). Self-contained: it reuses the
 * economy page classes and adds no shared-shell or shop changes (menu entry: UI-1 / INT-1).
 */
type Go = (r: Route) => void;
const fmt = (n: number) => n.toLocaleString("ko-KR");
const reward = (coins: number, gems: number) => [coins ? `${fmt(coins)}코인` : "", gems ? `보석 ${gems}` : ""].filter(Boolean).join(" · ");

export default function RewardsPage({ server, go }: { server: string | null; go: Go }) {
  const [view, setView] = useState<RewardsView | null>(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    if (!server || !signedIn()) return;
    try {
      setView(await rewards(server));
      setOff(false);
    } catch (e) {
      if (e instanceof EconomyError && (e.code === "RETENTION_OFF" || e.code === "NOT_FOUND" || e.code === "ECONOMY_OFF")) setOff(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [server]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<RewardsView>, ok: (v: RewardsView) => string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await fn();
      setView(next);
      setNotice(ok(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!(e instanceof EconomyError && e.code === "NETWORK")) await load();
    } finally {
      setBusy(false);
    }
  };
  const got = (v: RewardsView) => {
    const g = v.granted ?? [];
    const c = g.reduce((a, x) => a + x.coins, 0), m = g.reduce((a, x) => a + x.gems, 0);
    return g.length ? `${reward(c, m)}을(를) 받았어요.` : "받을 보상이 없어요.";
  };

  return (
    <section className="econ-page rewards-page" aria-labelledby="rewards-title">
      <div className="econ-head">
        <h1 id="rewards-title">출석·보상</h1>
      </div>
      {!server ? <p className="econ-note">온라인 서버에 연결되어 있지 않아요.</p> : !signedIn() ? (
        <div className="econ-gate">
          <p>출석·연속 활동 보상은 로그인한 회원에게 쌓여요.</p>
          <button type="button" className="primary" onClick={() => go("profile")}>프로필에서 로그인하기</button>
        </div>
      ) : off ? <p className="econ-note" role="status">출석·연속 활동 보상은 준비 중이에요.</p> : (
        <>
          {error && <p className="error-message" role="alert">{error}</p>}
          {notice && <p className="econ-note rewards-notice" role="status">{notice}</p>}
          {!view ? <p className="econ-note" role="status"><BrandMark /> 불러오는 중…</p> : <Body view={view} busy={busy} code={code} setCode={setCode}
            onAttend={() => void act(() => claimAttendance(server), got)}
            onClaim={(tx) => void act(() => claimReward(server, tx), got)}
            onRedeem={() => void act(() => redeemCode(server, code), got)} />}
        </>
      )}
    </section>
  );
}

function Body({ view, busy, code, setCode, onAttend, onClaim, onRedeem }: {
  view: RewardsView; busy: boolean; code: string; setCode: (v: string) => void;
  onAttend: () => void; onClaim: (tx: string | "all") => void; onRedeem: () => void;
}) {
  const { attendance: att, activity: act, weeklyStreak: ws } = view.status;
  const nextAct = act.milestones.find((m) => !m.paid);
  const topTier = ws.tiers[ws.tiers.length - 1];
  return (
    <>
      <section className="rewards-card" aria-labelledby="att-title">
        <h2 id="att-title" className="econ-sub">출석 <small>{att.claimed}/{att.rewards.length} · 결석해도 이어져요 · 매일 00:00(한국 시간)</small></h2>
        <ol className="att-row" aria-label="출석 보상">
          {att.rewards.map((r, i) => {
            // right after the 7th claim the cycle restarts (claimed = 0): show the finished cycle today
            const done = i < att.claimed || (att.claimedToday && att.claimed === 0 && att.cycle > 0);
            const next = !att.claimedToday && i === att.claimed;
            return (
              <li key={i} className={"att-cell" + (done ? " done" : "") + (next ? " next" : "")} aria-current={next ? "step" : undefined}>
                <span className="att-day">{i + 1}일차</span>
                <span className="att-amount"><Coins size={13} aria-hidden="true" /> {r.coins}{r.gems ? <> <Gem size={13} aria-hidden="true" /> {r.gems}</> : null}</span>
                {done && <Check size={14} aria-label="받음" />}
              </li>
            );
          })}
        </ol>
        <button type="button" className="primary" disabled={busy || att.claimedToday} onClick={onAttend}>
          {att.claimedToday ? "오늘 출석 완료" : `오늘 출석 받기 · ${reward(att.rewards[att.claimed]?.coins ?? 0, att.rewards[att.claimed]?.gems ?? 0)}`}
        </button>
      </section>

      <section className="rewards-card" aria-labelledby="act-title">
        <h2 id="act-title" className="econ-sub">연속 활동 <small>현재 {act.current}일 · 최고 {act.best}일 · 이번 주 휴식 {act.restLeft}/{act.restPerWeek}</small></h2>
        {act.broken && <p className="econ-note">연속 기록이 끊겼어요. 오늘 경기를 마치면 1일부터 다시 시작해요.</p>}
        <ul className="quest-list" aria-label="연속 활동 이정표">
          {act.milestones.map((m) => {
            const title = m.title ? itemById(m.title)?.name : null;
            return (
              <li key={m.days} className={"quest" + (m.paid ? " done" : "")}>
                <span className="quest-diff">{m.days}일</span>
                <span className="quest-label">
                  <strong>{reward(m.coins, m.gems)}{title ? ` · 칭호 「${title}」` : ""}</strong>
                  {!m.paid && m === nextAct && <span className="quest-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (act.current / m.days) * 100)}%` }} /></span>}
                </span>
                {m.paid && <span className="shop-owned"><Check size={14} /> 받음</span>}
              </li>
            );
          })}
        </ul>
        <p className="econ-note">끝까지 마친 서버 경기와 오늘의 요트 완료만 활동으로 쳐요. 주 1회는 쉬어도 이어지고, 쉰 날은 일수에 넣지 않아요. 이정표는 계정당 한 번이에요.</p>
      </section>

      <section className="rewards-card" aria-labelledby="ws-title">
        <h2 id="ws-title" className="econ-sub">이번 주 최고 연승 <small>현재 {ws.current}연승 · 최고 {ws.best}연승 · 받은 {ws.paidCoins}/{topTier?.coins ?? 0}코인</small></h2>
        <ol className="ws-tiers" aria-label="주간 연승 단계">
          {ws.tiers.map((t) => (
            <li key={t.streak} className={t.paid ? "done" : ""}>
              <span>{t.streak}연승</span>
              <span>누적 {t.coins}코인</span>
              {t.paid && <Check size={14} aria-label="받음" />}
            </li>
          ))}
        </ol>
        <p className="econ-note">빠른 1:1 대전만 쳐요. 한 연승에서 같은 상대는 한 번만, 무승부·상대 기권승은 유지, 패배·기권은 0으로. 매주 월요일 00:00(한국 시간) 초기화.</p>
      </section>

      <section className="rewards-card" aria-labelledby="inbox-title">
        <h2 id="inbox-title" className="econ-sub"><Gift size={16} aria-hidden="true" /> 보상함 <small>{view.inbox.length}개</small></h2>
        {view.inbox.length === 0 ? <p className="econ-note">받을 보상이 없어요.</p> : (
          <>
            <ul className="quest-list" aria-label="받을 보상">
              {view.inbox.map((g) => (
                <li key={g.txId} className="quest">
                  <span className="quest-label">
                    <strong>{g.label}</strong>
                    <small>{reward(g.coins, g.gems)}{g.expiresAt ? ` · ${new Date(g.expiresAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}까지` : ""}</small>
                  </span>
                  <button type="button" className="secondary" disabled={busy} onClick={() => onClaim(g.txId)}>받기</button>
                </li>
              ))}
            </ul>
            {view.inbox.length > 1 && <button type="button" className="secondary" disabled={busy} onClick={() => onClaim("all")}>모두 받기</button>}
          </>
        )}
      </section>

      <section className="rewards-card" aria-labelledby="code-title">
        <h2 id="code-title" className="econ-sub">교환 코드</h2>
        <form className="code-form" onSubmit={(e) => { e.preventDefault(); if (view.redeem && code.trim()) onRedeem(); }}>
          <label className="sr-only" htmlFor="redeem-code">교환 코드</label>
          <input id="redeem-code" value={code} maxLength={40} autoComplete="off" spellCheck={false} placeholder={view.redeem ? "코드 입력" : "준비 중이에요"}
            disabled={!view.redeem || busy} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="secondary" disabled={!view.redeem || busy || !code.trim()}>사용</button>
        </form>
      </section>

      {view.history.length > 0 && (
        <details className="economy-ledger">
          <summary>최근 받은 보상</summary>
          <ul className="ledger" aria-label="받은 보상 내역">
            {view.history.filter((g) => g.status === "granted" || g.status === "claimed").map((g) => (
              <li key={g.txId}><span>{g.label}</span><span className="plus">{reward(g.coins, g.gems)}</span></li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
