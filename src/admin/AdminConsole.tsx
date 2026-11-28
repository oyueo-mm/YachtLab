import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { session, signInAvailable, startSignIn } from "../identity/account-client";
import { AdminError, adminApi, adminSession, adminSignIn, adminSignOut, type AdminSession } from "./admin-client";
import "./admin.css";

/**
 * ADMIN-1 console (`#admin`, lazily loaded). Everything shown comes from /api/admin/* — numbers the
 * server does not collect are shown as "미집계", never invented. Write screens only DRAFT actions; an
 * approver executes them (server-enforced). No secret lives in this bundle.
 */
type Menu = "dashboard" | "users" | "matches" | "matching" | "economy" | "items" | "quests" | "system" | "rewards" | "codes" | "notices" | "reports" | "appeals" | "suggestions" | "actions" | "audit";
const MENUS: { id: Menu; label: string; group: string; perm: string }[] = [
  { id: "dashboard", label: "서비스 대시보드", group: "현황", perm: "stats.read" },
  { id: "users", label: "사용자", group: "현황", perm: "users.read" },
  { id: "matches", label: "경기 통계", group: "통계", perm: "stats.read" },
  { id: "matching", label: "매칭 통계", group: "통계", perm: "stats.read" },
  { id: "economy", label: "경제 통계", group: "통계", perm: "stats.read" },
  { id: "items", label: "상품 통계", group: "통계", perm: "stats.read" },
  { id: "quests", label: "퀘스트·업적", group: "통계", perm: "stats.read" },
  { id: "system", label: "시스템 상태", group: "통계", perm: "stats.read" },
  { id: "rewards", label: "보상 관리", group: "운영", perm: "rewards.write" },
  { id: "codes", label: "교환 코드", group: "운영", perm: "codes.write" },
  { id: "notices", label: "공지사항", group: "운영", perm: "notices.write" },
  { id: "reports", label: "신고·제재", group: "운영", perm: "reports.read" },
  { id: "appeals", label: "이의제기", group: "운영", perm: "reports.read" },
  { id: "suggestions", label: "사용자 제안", group: "운영", perm: "reports.read" },
  { id: "actions", label: "승인 대기", group: "운영", perm: "approve" },
  { id: "audit", label: "감사 로그", group: "운영", perm: "audit.read" },
];
const fmt = (n: unknown) => (n === null || n === undefined ? "미집계" : typeof n === "number" ? n.toLocaleString("ko-KR") : String(n));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "미집계" : (n * 100).toFixed(1) + "%");
const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString("ko-KR", { hour12: false }) : "—");
const toTime = (local: string) => (local ? new Date(local).getTime() : undefined);

export default function AdminConsole({ server }: { server: string | null }) {
  const [admin, setAdmin] = useState<AdminSession | null>(adminSession());
  const [menu, setMenu] = useState<Menu>("dashboard");
  const [error, setError] = useState("");
  const [canSignIn, setCanSignIn] = useState(false);
  useEffect(() => void signInAvailable(server).then(setCanSignIn), [server]);
  if (!server) return <section className="adm-gate"><h1>관리자</h1><p>온라인 서버가 설정되지 않았어요.</p></section>;
  if (!admin) {
    return (
      <section className="adm-gate">
        <h1>YachtLab 관리자</h1>
        <p>관리자 권한은 서버에 등록된 계정에만 있어요. 일반 회원 로그인 후 관리자 세션을 시작합니다(30분 미사용 또는 4시간 후 만료).</p>
        {!session() ? (
          canSignIn ? <button className="adm-btn primary" onClick={() => void startSignIn(server)}>Google로 로그인</button> : <p>로그인이 아직 설정되지 않았어요.</p>
        ) : (
          <button className="adm-btn primary" onClick={async () => {
            setError("");
            try { setAdmin(await adminSignIn(server)); } catch (e) { setError((e as Error).message); }
          }}>관리자 세션 시작</button>
        )}
        {error && <p className="adm-error" role="alert">{error}</p>}
      </section>
    );
  }
  const visible = MENUS.filter((m) => admin.permissions.includes(m.perm) || (m.id === "actions" && admin.permissions.some((p) => p.endsWith(".write"))));
  const groups = [...new Set(visible.map((m) => m.group))];
  const ctx: Ctx = { server, admin, refreshSession: async () => setAdmin(await adminSignIn(server)), lost: () => setAdmin(null) };
  return (
    <div className="adm">
      <aside className="adm-side" aria-label="관리 메뉴">
        <div className="adm-brand">YachtLab 관리<span className="adm-role">{admin.role}</span></div>
        <label className="adm-mobile-menu">메뉴
          <select value={menu} onChange={(e) => setMenu(e.target.value as Menu)}>{visible.map((m) => <option key={m.id} value={m.id}>{m.group} · {m.label}</option>)}</select>
        </label>
        <nav>
          {groups.map((g) => (
            <div key={g} className="adm-group"><h2>{g}</h2>
              {visible.filter((m) => m.group === g).map((m) => <button key={m.id} aria-current={menu === m.id ? "page" : undefined} onClick={() => setMenu(m.id)}>{m.label}</button>)}
            </div>
          ))}
        </nav>
        <div className="adm-side-foot">
          <span>쓰기 {admin.writes ? "켜짐" : "꺼짐"} · 승인 {admin.selfApprove ? "본인 가능" : "2인"}</span>
          <button className="adm-btn" onClick={async () => { await adminSignOut(server); setAdmin(null); }}>관리자 로그아웃</button>
        </div>
      </aside>
      <main className="adm-main">
        {!admin.writes && MENUS.find((m) => m.id === menu)?.group === "운영" && <p className="adm-banner">관리자 쓰기 기능(ADMIN_WRITES)이 꺼져 있어요. 조회·미리보기만 가능합니다.</p>}
        <Screen key={menu} menu={menu} ctx={ctx} />
      </main>
    </div>
  );
}

type Ctx = { server: string; admin: AdminSession; refreshSession(): Promise<void>; lost(): void };

function useLoad<T>(ctx: Ctx, path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setError("");
    adminApi<T>(ctx.server, path).then((d) => live && setData(d)).catch((e: AdminError) => {
      if (!live) return;
      if (e.status === 404 && !adminSession()) ctx.lost();
      setError(e.message);
    });
    return () => void (live = false);
  }, [ctx, path, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

function Screen({ menu, ctx }: { menu: Menu; ctx: Ctx }) {
  switch (menu) {
    case "dashboard": return <Dashboard ctx={ctx} />;
    case "users": return <Users ctx={ctx} />;
    case "matches": case "matching": case "economy": case "items": case "quests": return <Stats ctx={ctx} section={menu} />;
    case "system": return <System ctx={ctx} />;
    case "rewards": return <Rewards ctx={ctx} />;
    case "codes": return <Codes ctx={ctx} />;
    case "notices": return <Notices ctx={ctx} />;
    case "reports": return <Reports ctx={ctx} />;
    case "appeals": return <Appeals ctx={ctx} />;
    case "suggestions": return <Suggestions ctx={ctx} />;
    case "actions": return <Actions ctx={ctx} />;
    case "audit": return <Audit ctx={ctx} />;
  }
}

/* ---------------------------------------------------------------- pieces ---------------------------------------------------------------- */

function Head({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return <header className="adm-head"><div><h1>{title}</h1>{note && <p>{note}</p>}</div><div className="adm-tools">{children}</div></header>;
}
function Period({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="adm-seg" role="radiogroup" aria-label="기간">
      {[7, 14, 30, 90].map((d) => <button key={d} role="radio" aria-checked={value === d} onClick={() => onChange(d)}>{d}일</button>)}
    </div>
  );
}
function Tiles({ items }: { items: [string, ReactNode, string?][] }) {
  return <div className="adm-tiles">{items.map(([k, v, hint]) => <div key={k} className="adm-tile"><span>{k}</span><strong>{v}</strong>{hint && <small>{hint}</small>}</div>)}</div>;
}
function Msg({ error, loading }: { error: string; loading: boolean }) {
  if (error) return <p className="adm-error" role="alert">{error}</p>;
  return loading ? <p className="adm-muted" role="status">불러오는 중…</p> : null;
}
function Table({ cols, rows, empty = "데이터 없음" }: { cols: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead><tr>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={cols.length} className="adm-muted">{empty}</td></tr>}</tbody>
      </table>
    </div>
  );
}
/**
 * Single-series bar chart: one hue, recessive grid, hover/focus tooltip, and a table view (accessible
 * alternative). A null value is drawn as "미집계" (no bar), never as zero.
 */
function Bars({ title, data, unit = "" }: { title: string; data: { label: string; value: number | null }[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value ?? 0));
  const W = 640, H = 160, gap = 2, bw = Math.max(2, (W - gap * data.length) / Math.max(1, data.length));
  return (
    <figure className="adm-chart">
      <figcaption><span>{title}</span><button className="adm-link" onClick={() => setTable(!table)}>{table ? "차트 보기" : "표 보기"}</button></figcaption>
      {table || !data.length ? <Table cols={["구간", "값"]} rows={data.map((d) => [d.label, d.value === null ? "미집계" : fmt(d.value) + unit])} /> : (
        <div className="adm-chart-box">
          <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={title} preserveAspectRatio="none">
            {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="adm-grid" />)}
            {data.map((d, i) => {
              const h = d.value === null ? 0 : Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (H - 8));
              const x = i * (bw + gap);
              return (
                <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
                  <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
                  {d.value !== null && <path className={hover === i ? "adm-bar on" : "adm-bar"} d={`M${x},${H} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${Math.max(0, bw - 8)} q4,0 4,4 v${Math.max(0, h - 4)} z`} />}
                </g>
              );
            })}
            <line x1={0} x2={W} y1={H} y2={H} className="adm-axis" />
            <text x={0} y={H + 14} className="adm-tick">{data[0]?.label}</text>
            <text x={W} y={H + 14} className="adm-tick" textAnchor="end">{data[data.length - 1]?.label}</text>
          </svg>
          {hover !== null && <div className="adm-tip" style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}><b>{data[hover].label}</b> {data[hover].value === null ? "미집계" : fmt(data[hover].value) + unit}</div>}
        </div>
      )}
    </figure>
  );
}
const dist = (o: Record<string, number> | null | undefined) => (o ? Object.entries(o).sort(([a], [b]) => a.localeCompare(b, "ko", { numeric: true })).map(([label, value]) => ({ label, value })) : []);
function Unavailable({ items }: { items?: string[] }) {
  return items?.length ? <ul className="adm-missing">{items.map((x) => <li key={x}>미집계: {x}</li>)}</ul> : null;
}

/* ----------------------------------------------------------------- read ----------------------------------------------------------------- */

function Dashboard({ ctx }: { ctx: Ctx }) {
  const [days, setDays] = useState(30);
  const { data, error } = useLoad<any>(ctx, `/api/admin/overview?days=${days}`);
  const a = data?.activity;
  const last = a?.days?.at(-1);
  const signups = a?.days?.reduce((s: number, d: any) => s + d.signups, 0);
  return (
    <>
      <Head title="서비스 대시보드" note={a?.since ? `회원 활동 집계 시작 ${a.since} (UTC). 이전 가입자는 다음 접속부터 색인돼요.` : "회원 활동 집계가 아직 없어요."}><Period value={days} onChange={setDays} /></Head>
      <Msg error={error} loading={!data} />
      {data && <>
        <Tiles items={[
          ["색인된 회원", fmt(a.indexedMembers), "집계 시작 이후 활동한 계정"],
          ["전체 회원 수", "미집계", "계정별 저장소라 전체 합계 없음"],
          [`신규 가입(${days}일)`, fmt(signups)],
          ["DAU(오늘)", fmt(last?.dau)], ["WAU(이번 주)", fmt(last?.wau)], ["MAU(이번 달)", fmt(last?.mau)],
          ["대기 중(매칭)", fmt(data.live?.waiting)], ["진행 중 경기", data.live?.playing ? fmt(Object.values(data.live.playing as Record<string, number>).reduce((x, y) => x + y, 0)) : "미집계"],
          ["동시 접속자", "미집계", "사이트 접속 수는 세지 않음"],
          ["오늘 방 / 한도", `${fmt(data.usage?.roomsToday)} / ${fmt(data.usage?.dailyRoomLimit)}`],
        ]} />
        <Bars title="일간 활성 회원(DAU)" data={a.days.map((d: any) => ({ label: d.day.slice(5), value: d.dau }))} />
        <Bars title="신규 가입" data={a.days.map((d: any) => ({ label: d.day.slice(5), value: d.signups }))} />
        <h2 className="adm-h2">재방문 간격(기간 합계)</h2>
        <Table cols={["간격", "회원 일수"]} rows={Object.entries(a.days.reduce((acc: Record<string, number>, d: any) => { for (const [k, v] of Object.entries(d.returns)) acc[k] = (acc[k] ?? 0) + (v as number); return acc; }, {})).map(([k, v]) => [{ new: "첫 활동", "1d": "다음 날", "2-7d": "2~7일", "8-30d": "8~30일", "31d+": "31일 이상" }[k] ?? k, fmt(v)])} />
        <h2 className="adm-h2">서비스 상태</h2>
        <Table cols={["항목", "상태"]} rows={Object.entries(data.flags).map(([k, v]) => [k, String(v)])} />
      </>}
    </>
  );
}

function Stats({ ctx, section }: { ctx: Ctx; section: "matches" | "matching" | "economy" | "items" | "quests" }) {
  const [days, setDays] = useState(30);
  const { data, error } = useLoad<any>(ctx, `/api/admin/stats?days=${days}`);
  const titles = { matches: "경기 통계", matching: "매칭 통계", economy: "경제 통계", items: "상품 통계", quests: "퀘스트·업적 통계" };
  const s = data?.[section];
  return (
    <>
      <Head title={titles[section]} note="운영 카운터(일 단위 UTC, 120일 보관) 기준. ADMIN-1 이후 추가된 항목은 배포일부터 집계돼요."><Period value={days} onChange={setDays} /></Head>
      <Msg error={error} loading={!data} />
      {s && section === "matches" && <>
        <Tiles items={[["경기 수", fmt(s.total)], ...Object.entries(s.byKind).map(([k, v]: [string, any]) => [{ random: "무작위", friend: "친구", ai: "AI" }[k] ?? k, fmt(v.total), `완료 ${pct(v.completionRate)} · 기권 ${pct(v.forfeitRate)} · 평균 ${v.avgDurationSec === null ? "미집계" : Math.round(v.avgDurationSec / 60) + "분"}`] as [string, ReactNode, string])]} />
        <Bars title="일별 종료 경기" data={s.daily.map((d: any) => ({ label: d.day.slice(5), value: d.value }))} />
        <Bars title={`참가 인원 분포${s.playersSince ? ` (${s.playersSince}부터)` : ""}`} data={dist(s.players)} unit="경기" />
        {!s.players && <p className="adm-muted">참가 인원 분포: 미집계(ADMIN-1 배포 이후부터 집계)</p>}
        <Unavailable items={s.missing} />
      </>}
      {s && section === "matching" && <>
        <Tiles items={[["매칭 요청", fmt(s.requests)], ["성사율", pct(s.successRate)], ["취소율", pct(s.cancelRate)], ["평균 대기", s.avgWaitMs === null ? "미집계" : (s.avgWaitMs / 1000).toFixed(1) + "초"], ["오늘 대기 p50 / p90", s.waitToday?.n ? `${(s.waitToday.p50 / 1000).toFixed(1)}초 / ${(s.waitToday.p90 / 1000).toFixed(1)}초` : "미집계"], ["시간 초과·이탈", `${fmt(s.expired)} · ${fmt(s.left)}`]]} />
        <Bars title="일별 매칭 요청" data={s.daily.map((d: any) => ({ label: d.day.slice(5), value: d.requests }))} />
        <Bars title={`시간대별 요청(UTC)${s.byHourSince ? ` · ${s.byHourSince}부터` : ""}`} data={s.byHour ? Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0") + "시", value: s.byHour[String(h).padStart(2, "0")] ?? 0 })) : []} />
        {!s.byHour && <p className="adm-muted">시간대별 수요: 미집계(ADMIN-1 배포 이후부터 집계)</p>}
        <Unavailable items={s.missing} />
      </>}
      {s && section === "economy" && <>
        <Tiles items={[["코인 발행(경기·퀘스트·업적)", fmt(s.issued.coins)], ["보석 발행", fmt(s.issued.gems)], ["운영 보상 지급(코인)", fmt(s.issued.adminCoins)], ["코인 소비", fmt(s.spent?.coins)], ["보석 소비", fmt(s.spent?.gems)], ["원장 불일치 발견", fmt(s.ledgerProblems)], ["한 계정 하루 최대 코인", fmt(s.maxCoinsOneAccountOneDay)]]} />
        <Bars title="일별 코인 발행" data={s.daily.map((d: any) => ({ label: d.day.slice(5), value: d.coinsIssued }))} />
        <Bars title="일별 코인 소비" data={s.daily.map((d: any) => ({ label: d.day.slice(5), value: d.coinsSpent }))} />
        <h2 className="adm-h2">보상 출처별 지급 횟수</h2>
        <Table cols={["출처", "횟수"]} rows={dist(s.rewardSources).map((r) => [r.label, fmt(r.value)])} />
        <Bars title="보유 잔액 구간(표본)" data={dist(s.balanceBuckets)} unit="명" />
        <Unavailable items={s.notes} />
      </>}
      {s && section === "items" && <>
        <Tiles items={[["강화", fmt(s.upgrades)], ["뽑기", fmt(s.draws)], ["뽑기 중복", fmt(s.drawDuplicates)]]} />
        <h2 className="adm-h2">등급·결제수단별 구매</h2>
        <Table cols={["등급.결제", "구매 수"]} rows={dist(s.purchasesByTier).map((r) => [r.label, fmt(r.value)])} />
        <h2 className="adm-h2">상품별 구매{s.since ? ` (${s.since}부터)` : ""}</h2>
        {s.purchasesByItem ? <Table cols={["상품 ID", "구매 수"]} rows={Object.entries(s.purchasesByItem as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k, v]) => [k, fmt(v)])} /> : <p className="adm-muted">미집계(ADMIN-1 배포 이후부터 집계)</p>}
        <Bars title="강화 후 단계 분포" data={dist(s.upgradeLevels)} unit="회" />
        <Bars title="뽑기 족보 분포" data={dist(s.drawHands)} unit="회" />
        <Unavailable items={s.missing} />
      </>}
      {s && section === "quests" && <>
        <Tiles items={[["퀘스트 완료", fmt(s.questsDone)], ["일일 전부 완료", fmt(s.dailyAllDone)], ["일일 전부 완료율(DAU 대비)", pct(s.dailyAllRate)], ["퀘스트 교체", fmt(s.rerolls)], ["업적 달성", fmt(s.achievements)]]} />
        <Bars title="일별 퀘스트 완료" data={s.daily.map((d: any) => ({ label: d.day.slice(5), value: d.done }))} />
        <h2 className="adm-h2">퀘스트별 완료</h2>
        {s.byQuest ? <Table cols={["퀘스트", "완료"]} rows={dist(s.byQuest).map((r) => [r.label, fmt(r.value)])} /> : <p className="adm-muted">미집계(ADMIN-1 배포 이후부터 집계)</p>}
        <h2 className="adm-h2">업적별 달성</h2>
        {s.byAchievement ? <Table cols={["업적", "달성"]} rows={dist(s.byAchievement).map((r) => [r.label, fmt(r.value)])} /> : <p className="adm-muted">미집계(ADMIN-1 배포 이후부터 집계)</p>}
        <Unavailable items={s.missing} />
      </>}
    </>
  );
}

function System({ ctx }: { ctx: Ctx }) {
  const { data, error, reload } = useLoad<any>(ctx, "/api/admin/system");
  return (
    <>
      <Head title="시스템 상태"><button className="adm-btn" onClick={reload}>새로고침</button></Head>
      <Msg error={error} loading={!data} />
      {data && <>
        <Tiles items={[["Worker", data.worker.ok ? "정상 응답" : "오류"], ["오늘 방", `${fmt(data.usage.roomsToday)} / ${fmt(data.usage.dailyRoomLimit)}`], ["AI 방", `${fmt(data.usage.aiRoomsToday)} / ${fmt(data.usage.dailyAiLimit)}`], ["동시 방", `${fmt(data.usage.liveRooms)} / ${fmt(data.usage.maxRooms)}`], ["7일 서버 오류", fmt(data.system.errors)], ["매칭 대기", fmt(data.hubNow?.waiting)]]} />
        <h2 className="adm-h2">기능 플래그</h2>
        <Table cols={["항목", "값"]} rows={Object.entries(data.flags).map(([k, v]) => [k, String(v)])} />
        <h2 className="adm-h2">탈퇴 정리 작업</h2>
        <Table cols={["항목", "수"]} rows={dist(data.system.cleanup).map((r) => [r.label, fmt(r.value)])} />
        {data.adminEvents && <><h2 className="adm-h2">최근 관리 이벤트</h2><AuditRows entries={data.adminEvents} /></>}
        <Unavailable items={data.system.missing} />
      </>}
    </>
  );
}

function Users({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState({ nickname: "", status: "", sort: "created", page: 0 });
  const [input, setInput] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ nickname: q.nickname, status: q.status, sort: q.sort, page: String(q.page), ...(/^u_/.test(q.nickname) ? { userId: q.nickname, nickname: "" } : {}) });
  const { data, error } = useLoad<any>(ctx, `/api/admin/members?${qs}`);
  if (open) return <Member ctx={ctx} userId={open} back={() => setOpen(null)} />;
  return (
    <>
      <Head title="사용자" note="회원 색인(집계 시작 이후 활동 계정). 이메일·실명·IP는 저장하지 않아요.">
        <form className="adm-search" onSubmit={(e) => { e.preventDefault(); setQ({ ...q, nickname: input.trim(), page: 0 }); }}>
          <input aria-label="닉네임 또는 회원 ID" placeholder="닉네임 또는 u_…" value={input} onChange={(e) => setInput(e.target.value)} />
          <select aria-label="상태" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value, page: 0 })}>
            <option value="">전체 상태</option><option value="ok">정상</option><option value="warned">경고</option><option value="restricted">제한</option><option value="suspended">정지</option>
          </select>
          <select aria-label="정렬" value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value })}><option value="created">가입 최신순</option><option value="active">최근 활동순</option></select>
          <button className="adm-btn">검색</button>
        </form>
      </Head>
      <Msg error={error} loading={!data} />
      {data && <>
        <Table cols={["닉네임", "회원 ID", "가입", "최근 활동(UTC)", "상태", ""]} rows={data.members.map((m: any) => [m.nickname ?? "(없음)", <code key="i">{m.userId}</code>, when(m.createdAt), m.lastActive, m.status + (m.statusUntil ? ` ~${new Date(m.statusUntil).toISOString().slice(0, 10)}` : ""), <button key="o" className="adm-link" onClick={() => setOpen(m.userId)}>상세</button>])} />
        <Pager page={q.page} total={data.total} size={data.pageSize} go={(page) => setQ({ ...q, page })} />
      </>}
    </>
  );
}
function Pager({ page, total, size, go }: { page: number; total?: number; size: number; go: (p: number) => void }) {
  const pages = total === undefined ? null : Math.max(1, Math.ceil(total / size));
  return (
    <nav className="adm-pager" aria-label="페이지">
      <button className="adm-btn" disabled={page === 0} onClick={() => go(page - 1)}>이전</button>
      <span>{page + 1}{pages ? ` / ${pages}` : ""}{total !== undefined ? ` · 총 ${fmt(total)}` : ""}</span>
      <button className="adm-btn" disabled={pages !== null && page + 1 >= pages} onClick={() => go(page + 1)}>다음</button>
    </nav>
  );
}
function Member({ ctx, userId, back }: { ctx: Ctx; userId: string; back: () => void }) {
  const { data, error } = useLoad<any>(ctx, `/api/admin/members/${userId}`);
  const rec = data?.account?.records as { mode: string; verification: string; outcome: string; n: number }[] | undefined;
  return (
    <>
      <Head title={data?.account?.nickname ?? "회원 상세"} note={userId}><button className="adm-btn" onClick={back}>목록</button></Head>
      <Msg error={error} loading={!data} />
      {data && <>
        <Tiles items={[["가입", when(data.account.createdAt)], ["최근 활동(UTC)", data.lastActiveDay ?? "미집계"], ["로그인 세션", fmt(data.account.liveSessions)], ["온라인 전적", data.account.online ? `${data.account.online.wins}승 ${data.account.online.losses}패 ${data.account.online.draws}무` : "—"], ["코인 / 보석", `${fmt(data.economy.wallet.coins)} / ${fmt(data.economy.wallet.gems)}`], ["보유 상품", fmt(data.economy.items)], ["업적", fmt(data.economy.achievements)], ["원장 점검", data.ledger.ok ? "일치" : "불일치 " + data.ledger.problems.join(", ")], ["이용 상태", data.standing.suspended ? "정지" : data.standing.restricted ? "제한" : "정상"]]} />
        <h2 className="adm-h2">경기 기록</h2>
        <Table cols={["모드", "검증", "결과", "수"]} rows={(rec ?? []).map((r) => [r.mode, r.verification === "server-verified" ? "서버 검증" : "기기 기록", r.outcome, fmt(r.n)])} />
        <h2 className="adm-h2">주요 상품(강화 단계순)</h2>
        <Table cols={["상품", "단계", "획득"]} rows={data.economy.topItems.map((i: any) => [i.id, i.level, i.via])} />
        <h2 className="adm-h2">제재 이력</h2>
        <Table cols={["ID", "종류", "사유", "기간", "상태"]} rows={data.sanctions.map((s: any) => [s.id, s.kind, s.reason, s.until ? `~${when(s.until)}` : "—", s.status])} />
        <h2 className="adm-h2">알림함(최근)</h2>
        <Table cols={["항목", "보상", "상태"]} rows={data.inbox.map((i: any) => [i.title, i.coins || i.gems ? `${i.coins}코인 ${i.gems}보석` : "—", i.claimedAt ? "수령" : i.revoked ? "회수" : i.expired ? "만료" : "대기"])} />
        <SanctionForm ctx={ctx} userId={userId} />
      </>}
    </>
  );
}

/* ----------------------------------------------------------------- write ----------------------------------------------------------------- */

function useAct(ctx: Ctx) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (path: string, body: unknown, ok: (r: any) => string) => {
    setBusy(true);
    setMsg("");
    try { setMsg(ok(await adminApi(ctx.server, path, body))); return true; } catch (e) { setMsg("⚠ " + (e as Error).message); return false; } finally { setBusy(false); }
  }, [ctx]);
  return { msg, busy, run };
}
const drafted = (r: any) => `초안이 만들어졌어요(작업 ${r.actionId}). 승인 권한자가 '승인 대기'에서 승인하면 실행돼요.`;

function SanctionForm({ ctx, userId, reportId }: { ctx: Ctx; userId: string; reportId?: string }) {
  const [f, setF] = useState({ kind: "warning", reason: "", days: "7" });
  const { msg, busy, run } = useAct(ctx);
  if (!ctx.admin.permissions.includes("sanctions.write")) return null;
  return (
    <form className="adm-form" onSubmit={(e) => { e.preventDefault(); void run("/api/admin/sanctions", { userId, kind: f.kind, reason: f.reason, days: f.kind === "restrict" || f.kind === "suspend" ? (f.days ? Number(f.days) : null) : null, reportId }, (r) => r.actionId ? drafted(r) : "경고를 보냈어요."); }}>
      <h2 className="adm-h2">제재</h2>
      <label>종류<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="warning">경고(즉시)</option><option value="nickname_reset">닉네임 초기화(승인)</option><option value="restrict">기간제 이용 제한(승인)</option><option value="suspend">이용 정지(승인)</option></select></label>
      {(f.kind === "restrict" || f.kind === "suspend") && <label>기간(일){f.kind === "suspend" && " · 비우면 무기한"}<input inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, "") })} /></label>}
      <label className="wide">사유(회원에게 통지됨)<textarea required minLength={4} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      <button className="adm-btn danger" disabled={busy || !ctx.admin.writes}>{f.kind === "warning" ? "경고 보내기" : "제재 초안 만들기"}</button>
      {msg && <p className="adm-note" role="status">{msg}</p>}
    </form>
  );
}

function Rewards({ ctx }: { ctx: Ctx }) {
  const [f, setF] = useState({ title: "", message: "", coins: "0", gems: "0", target: "users", userIds: "", joinedAfter: "", joinedBefore: "", activeWithinDays: "", scheduledAt: "", expiresAt: "" });
  const [preview, setPreview] = useState<any>(null);
  const { msg, busy, run } = useAct(ctx);
  const { data, reload } = useLoad<any>(ctx, "/api/admin/rewards");
  const body = () => ({
    title: f.title, message: f.message, coins: Number(f.coins) || 0, gems: Number(f.gems) || 0, scheduledAt: toTime(f.scheduledAt) ?? null, expiresAt: toTime(f.expiresAt),
    target: f.target === "users" ? { type: "users", userIds: f.userIds.split(/[\s,]+/).filter(Boolean) } : f.target === "all" ? { type: "all" } : { type: "segment", joinedAfter: toTime(f.joinedAfter), joinedBefore: toTime(f.joinedBefore), activeWithinDays: f.activeWithinDays ? Number(f.activeWithinDays) : undefined },
  });
  return (
    <>
      <Head title="보상 관리" note="지급은 알림함 → 회원이 수령할 때 경제 원장(admin:<id>)에 1회만 기록돼요. 금액 정책은 경제 담당(07) 연구 후 확정." />
      <form className="adm-form" onSubmit={(e) => e.preventDefault()}>
        <label>제목<input value={f.title} maxLength={60} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label>코인(1인)<input inputMode="numeric" value={f.coins} onChange={(e) => setF({ ...f, coins: e.target.value.replace(/\D/g, "") })} /></label>
        <label>보석(1인)<input inputMode="numeric" value={f.gems} onChange={(e) => setF({ ...f, gems: e.target.value.replace(/\D/g, "") })} /></label>
        <label className="wide">안내 문구<textarea maxLength={500} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
        <label>대상<select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="users">개별 회원</option><option value="segment">조건</option><option value="all">전체(색인된 회원)</option></select></label>
        {f.target === "users" && <label className="wide">회원 ID(쉼표·줄바꿈)<textarea value={f.userIds} onChange={(e) => setF({ ...f, userIds: e.target.value })} /></label>}
        {f.target === "segment" && <>
          <label>가입 이후<input type="datetime-local" value={f.joinedAfter} onChange={(e) => setF({ ...f, joinedAfter: e.target.value })} /></label>
          <label>가입 이전<input type="datetime-local" value={f.joinedBefore} onChange={(e) => setF({ ...f, joinedBefore: e.target.value })} /></label>
          <label>최근 N일 활동<input inputMode="numeric" value={f.activeWithinDays} onChange={(e) => setF({ ...f, activeWithinDays: e.target.value.replace(/\D/g, "") })} /></label>
        </>}
        <label>지급 예약(비우면 승인 즉시)<input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></label>
        <label>수령 만료<input type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></label>
        <div className="wide adm-row">
          <button className="adm-btn" disabled={busy} onClick={() => void run("/api/admin/rewards/preview", body(), (r) => { setPreview(r.preview); return "미리보기를 계산했어요."; })}>대상·총량 미리보기</button>
          <button className="adm-btn primary" disabled={busy || !preview || !ctx.admin.writes} onClick={() => void run("/api/admin/rewards", body(), (r) => { reload(); setPreview(null); return drafted(r); })}>지급 초안 만들기</button>
        </div>
        {preview && <p className="adm-note wide">대상 {fmt(preview.recipients)}명 · 1인 {fmt(preview.coinsEach)}코인 {fmt(preview.gemsEach)}보석 · 총 {fmt(preview.totalCoins)}코인 {fmt(preview.totalGems)}보석 · {preview.note}</p>}
        {msg && <p className="adm-note wide" role="status">{msg}</p>}
      </form>
      <h2 className="adm-h2">지급 이력</h2>
      <Table cols={["캠페인", "제목", "1인", "대상", "예약", "상태", "전달", ""]} rows={(data?.campaigns ?? []).map((c: any) => [c.id, c.title, `${c.coins}/${c.gems}`, c.target, when(c.scheduledAt), c.status, Object.entries(c.deliveries).map(([k, v]) => `${k} ${v}`).join(" · ") || "—",
        <span key="a" className="adm-row">{c.deliveries.failed ? <button className="adm-link" onClick={() => void run(`/api/admin/rewards/${c.id}/retry`, {}, () => { reload(); return "실패 건을 다시 보내요(중복 지급 없음)."; })}>실패 재시도</button> : null}{["scheduled", "sending"].includes(c.status) ? <button className="adm-link" onClick={() => void run(`/api/admin/rewards/${c.id}/cancel`, {}, (r) => { reload(); return `중단했어요. 이미 전달된 ${r.delivered}건은 회원별로 회수할 수 있어요.`; })}>중단</button> : null}</span>])} />
    </>
  );
}

function Codes({ ctx }: { ctx: Ctx }) {
  const [f, setF] = useState({ code: "", title: "", coins: "0", gems: "0", startsAt: "", endsAt: "", maxTotal: "100", perAccount: "1", joinedBefore: "" });
  const [open, setOpen] = useState<string | null>(null);
  const { msg, busy, run } = useAct(ctx);
  const { data, reload } = useLoad<any>(ctx, "/api/admin/codes");
  const red = useLoad<any>(ctx, open ? `/api/admin/codes/${open}/redemptions` : null);
  return (
    <>
      <Head title="교환 코드" note="코드는 초안으로 만들어지고 승인 후에만 활성화돼요. 비활성화는 즉시." />
      <form className="adm-form" onSubmit={(e) => { e.preventDefault(); void run("/api/admin/codes", { code: f.code || undefined, title: f.title, coins: Number(f.coins) || 0, gems: Number(f.gems) || 0, startsAt: toTime(f.startsAt), endsAt: toTime(f.endsAt), maxTotal: Number(f.maxTotal), perAccount: Number(f.perAccount), joinedBefore: toTime(f.joinedBefore) ?? null }, (r) => { reload(); return drafted(r); }); }}>
        <label>코드(비우면 자동)<input value={f.code} maxLength={24} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
        <label>이름<input value={f.title} maxLength={60} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label>코인<input inputMode="numeric" value={f.coins} onChange={(e) => setF({ ...f, coins: e.target.value.replace(/\D/g, "") })} /></label>
        <label>보석<input inputMode="numeric" value={f.gems} onChange={(e) => setF({ ...f, gems: e.target.value.replace(/\D/g, "") })} /></label>
        <label>시작<input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></label>
        <label>종료<input type="datetime-local" required value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>
        <label>전체 사용 횟수<input inputMode="numeric" value={f.maxTotal} onChange={(e) => setF({ ...f, maxTotal: e.target.value.replace(/\D/g, "") })} /></label>
        <label>계정별 횟수<input inputMode="numeric" value={f.perAccount} onChange={(e) => setF({ ...f, perAccount: e.target.value.replace(/\D/g, "") })} /></label>
        <label>대상: 이 시각 이전 가입자만<input type="datetime-local" value={f.joinedBefore} onChange={(e) => setF({ ...f, joinedBefore: e.target.value })} /></label>
        <button className="adm-btn primary" disabled={busy || !ctx.admin.writes}>코드 초안 만들기</button>
        {msg && <p className="adm-note wide" role="status">{msg}</p>}
      </form>
      <Table cols={["코드", "이름", "보상", "기간", "사용", "상태", ""]} rows={(data?.codes ?? []).map((c: any) => [<code key="c">{c.code}</code>, c.title, `${c.coins}/${c.gems}`, `${when(c.starts_at)} ~ ${when(c.ends_at)}`, `${c.used} / ${c.max_total} (계정당 ${c.per_account})`, c.status,
        <span key="a" className="adm-row"><button className="adm-link" onClick={() => setOpen(c.id)}>사용 이력</button>{c.status !== "inactive" && <button className="adm-link" onClick={() => void run(`/api/admin/codes/${c.id}/deactivate`, {}, () => { reload(); return "비활성화했어요."; })}>비활성화</button>}</span>])} />
      {open && <><h2 className="adm-h2">사용 이력 · {open}</h2><Table cols={["회원", "회차", "상태", "시각"]} rows={(red.data?.redemptions ?? []).map((r: any) => [<code key="u">{r.user_id}</code>, r.n, r.status, when(r.at)])} /></>}
    </>
  );
}

function Notices({ ctx }: { ctx: Ctx }) {
  const blank = { id: "", kind: "notice", title: "", body: "", important: false, publishAt: "", endAt: "" };
  const [f, setF] = useState(blank);
  const { msg, busy, run } = useAct(ctx);
  const { data, reload } = useLoad<any>(ctx, "/api/admin/notices");
  const local = (t: number | null) => (t ? new Date(t - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
  const save = (status: "draft" | "published") => void run("/api/admin/notices", { ...f, id: f.id || undefined, status, publishAt: toTime(f.publishAt), endAt: toTime(f.endAt) ?? null }, () => { reload(); setF(blank); return status === "published" ? "게시(예약)했어요." : "초안으로 저장했어요."; });
  return (
    <>
      <Head title="공지사항" note="게시된 공지는 /api/notices로 회원 화면(알림·공지)에 나가요. 중요 공지는 상단 배너 후보입니다." />
      <form className="adm-form" onSubmit={(e) => e.preventDefault()}>
        <label>분류<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="notice">공지</option><option value="maintenance">점검</option><option value="update">업데이트</option><option value="event">이벤트</option></select></label>
        <label>제목<input value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="adm-check"><input type="checkbox" checked={f.important} onChange={(e) => setF({ ...f, important: e.target.checked })} />중요 공지</label>
        <label>게시 시작(비우면 즉시)<input type="datetime-local" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} /></label>
        <label>게시 종료<input type="datetime-local" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} /></label>
        <label className="wide">내용(텍스트만)<textarea rows={6} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <div className="wide adm-row">
          <button className="adm-btn" disabled={busy || !ctx.admin.writes} onClick={() => save("draft")}>초안 저장</button>
          <button className="adm-btn primary" disabled={busy || !ctx.admin.writes} onClick={() => save("published")}>게시</button>
          {f.id && <button className="adm-btn" onClick={() => setF(blank)}>새 공지</button>}
        </div>
        {msg && <p className="adm-note wide" role="status">{msg}</p>}
      </form>
      <Table cols={["분류", "제목", "중요", "게시", "상태", ""]} rows={(data?.notices ?? []).map((n: any) => [n.kind, n.title, n.important ? "중요" : "", `${when(n.publishAt)}${n.endAt ? " ~ " + when(n.endAt) : ""}`, n.status,
        <span key="a" className="adm-row">{n.status !== "ended" && <button className="adm-link" onClick={() => setF({ id: n.id, kind: n.kind, title: n.title, body: n.body, important: n.important, publishAt: local(n.publishAt), endAt: local(n.endAt) })}>수정</button>}{n.status !== "ended" && <button className="adm-link" onClick={() => void run(`/api/admin/notices/${n.id}/end`, {}, () => { reload(); return "종료했어요."; })}>종료</button>}</span>])} />
    </>
  );
}

function Reports({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { data, reload } = useLoad<any>(ctx, `/api/admin/reports?status=${status}&page=${page}`);
  if (open) return <ReportDetail ctx={ctx} id={open} back={() => { setOpen(null); reload(); }} />;
  return (
    <>
      <Head title="신고·제재">
        <select aria-label="상태" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">전체</option><option value="open">접수</option><option value="reviewing">검토 중</option><option value="resolved">조치 완료</option><option value="dismissed">기각</option></select>
      </Head>
      <Table cols={["접수", "대상", "유형", "내용", "상태", ""]} rows={(data?.reports ?? []).map((r: any) => [when(r.created_at), `${r.target_type} ${r.target_id}`, r.reason, r.detail.slice(0, 60), r.status, <button key="o" className="adm-link" onClick={() => setOpen(r.id)}>검토</button>])} />
      <Pager page={page} size={50} go={setPage} />
    </>
  );
}
function ReportDetail({ ctx, id, back }: { ctx: Ctx; id: string; back: () => void }) {
  const { data, error } = useLoad<any>(ctx, `/api/admin/reports/${id}`);
  const [note, setNote] = useState("");
  const { msg, busy, run } = useAct(ctx);
  const r = data?.report;
  return (
    <>
      <Head title="신고 검토" note={id}><button className="adm-btn" onClick={back}>목록</button></Head>
      <Msg error={error} loading={!data} />
      {r && <>
        <Tiles items={[["대상", `${r.target_type} · ${r.target_id}`], ["유형", r.reason], ["상태", r.status], ["경기 ID", r.match_id ?? "—"]]} />
        <p className="adm-pre">{r.detail || "(상세 없음)"}</p>
        <h2 className="adm-h2">증거</h2>
        {r.match_id ? data.evidence ? <pre className="adm-pre">{JSON.stringify({ endedAt: when(data.evidence.endedAt), mode: data.evidence.mode, score: data.evidence.score, outcome: data.evidence.outcome, opponent: data.evidence.opponent, endReason: data.evidence.endReason }, null, 2)}</pre> : <p className="adm-muted">신고자 계정에서 이 경기의 서버 검증 기록을 찾지 못했어요. 채팅 원문은 서버에 저장되지 않아요.</p> : <p className="adm-muted">첨부된 경기 없음</p>}
        {data.suggestion && <p className="adm-pre">{data.suggestion.title}{"\n"}{data.suggestion.body}</p>}
        <h2 className="adm-h2">대상의 제재 이력</h2>
        <Table cols={["종류", "사유", "상태"]} rows={(data.history ?? []).map((s: any) => [s.kind, s.reason, s.status])} />
        {ctx.admin.permissions.includes("reports.write") && (
          <form className="adm-form" onSubmit={(e) => e.preventDefault()}>
            <label className="wide">처리 메모(내부)<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div className="wide adm-row">{["reviewing", "resolved", "dismissed"].map((s) => <button key={s} className="adm-btn" disabled={busy || !ctx.admin.writes} onClick={() => void run(`/api/admin/reports/${id}`, { status: s, note }, () => "상태를 바꿨어요.")}>{{ reviewing: "검토 중", resolved: "조치 완료", dismissed: "기각" }[s]}</button>)}</div>
            {msg && <p className="adm-note wide" role="status">{msg}</p>}
          </form>
        )}
        {r.target_type === "user" && <SanctionForm ctx={ctx} userId={r.target_id} reportId={id} />}
      </>}
    </>
  );
}

function Appeals({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState("submitted");
  const { data, reload } = useLoad<any>(ctx, `/api/admin/appeals?status=${status}`);
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const { msg, busy, run } = useAct(ctx);
  return (
    <>
      <Head title="이의제기"><select aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체</option><option value="submitted">접수</option><option value="reviewing">검토 중</option><option value="accepted">인용</option><option value="rejected">기각</option></select></Head>
      {msg && <p className="adm-note" role="status">{msg}</p>}
      {(data?.appeals ?? []).map((a: any) => (
        <article key={a.id} className="adm-card">
          <header><b>{a.sanction_kind}</b> · {a.sanction_reason} <span className="adm-muted">({a.sanction_status}) · {when(a.created_at)} · <code>{a.user_id}</code></span></header>
          <p className="adm-pre">{a.text}</p>
          {a.answer && <p className="adm-note">답변: {a.answer}</p>}
          {(a.status === "submitted" || a.status === "reviewing") && ctx.admin.permissions.includes("reports.write") && <>
            <textarea aria-label="답변" value={answer[a.id] ?? ""} onChange={(e) => setAnswer({ ...answer, [a.id]: e.target.value })} />
            <div className="adm-row">
              {[["reviewing", "검토 중"], ["accepted", "인용(제재 해제)"], ["rejected", "기각"]].map(([s, l]) => <button key={s} className="adm-btn" disabled={busy || !ctx.admin.writes} onClick={() => void run(`/api/admin/appeals/${a.id}`, { status: s, answer: answer[a.id] ?? "" }, () => { reload(); return "처리했어요."; })}>{l}</button>)}
            </div>
          </>}
        </article>
      ))}
      {data && !data.appeals.length && <p className="adm-muted">이의제기가 없어요.</p>}
    </>
  );
}

function Suggestions({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState({ status: "", category: "", sort: "latest", page: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const { data, reload } = useLoad<any>(ctx, `/api/admin/suggestions?${new URLSearchParams({ ...q, page: String(q.page) })}`);
  if (open) return <SuggestionAdmin ctx={ctx} id={open} back={() => { setOpen(null); reload(); }} />;
  return (
    <>
      <Head title="사용자 제안">
        <select aria-label="상태" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value, page: 0 })}><option value="">전체 상태</option>{Object.entries(SG_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="분류" value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value, page: 0 })}><option value="">전체 분류</option>{Object.entries(SG_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="정렬" value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value })}><option value="latest">최신순</option><option value="top">추천순</option></select>
      </Head>
      <Table cols={["작성", "분류", "제목", "추천", "신고", "상태", ""]} rows={(data?.items ?? []).map((s: any) => [when(s.createdAt), SG_CATEGORY[s.category as keyof typeof SG_CATEGORY] + (s.private ? " · 비공개" : ""), s.title, s.votes, s.reports + (s.hidden ? " (숨김)" : ""), SG_STATUS[s.status as keyof typeof SG_STATUS], <button key="o" className="adm-link" onClick={() => setOpen(s.id)}>열기</button>])} />
      {data && <Pager page={q.page} total={data.total} size={data.pageSize} go={(page) => setQ({ ...q, page })} />}
    </>
  );
}
export const SG_STATUS = { received: "접수", reviewing: "검토 중", adopted: "채택", in_progress: "개발 중", done: "구현 완료", on_hold: "보류", declined: "미채택" } as const;
export const SG_CATEGORY = { feature: "신규 기능", uiux: "UI/UX 개선", item: "상품 아이디어", mode: "게임 모드", bug: "버그 제보", security: "보안 취약점(비공개)", privacy: "개인정보·민감 문의(비공개)" } as const;
function SuggestionAdmin({ ctx, id, back }: { ctx: Ctx; id: string; back: () => void }) {
  const { data, reload } = useLoad<any>(ctx, `/api/admin/suggestions/${id}`);
  const s = data?.suggestion;
  const [f, setF] = useState<{ status: string; answer: string; adoptReason: string; coins: string; gems: string } | null>(null);
  const { msg, busy, run } = useAct(ctx);
  useEffect(() => { if (s && !f) setF({ status: s.status, answer: s.answer ?? "", adoptReason: "", coins: "0", gems: "0" }); }, [s, f]);
  const write = ctx.admin.permissions.includes("suggestions.write");
  return (
    <>
      <Head title={s?.title ?? "제안"} note={id}><button className="adm-btn" onClick={back}>목록</button></Head>
      {s && f && <>
        <p className="adm-muted">{s.author} · {when(s.createdAt)} · 추천 {s.votes} · 신고 {s.reports}{s.hidden ? " · 숨김" : ""}{s.private ? " · 비공개" : ""}</p>
        <p className="adm-pre">{s.body}</p>
        <form className="adm-form" onSubmit={(e) => e.preventDefault()}>
          <label>상태<select value={f.status} disabled={!write} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(SG_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {f.status === "adopted" && s.status !== "adopted" && <label className="wide">채택 사유(기록)<input value={f.adoptReason} onChange={(e) => setF({ ...f, adoptReason: e.target.value })} /></label>}
          <label className="wide">운영자 답변(공개)<textarea value={f.answer} disabled={!write} onChange={(e) => setF({ ...f, answer: e.target.value })} /></label>
          <div className="wide adm-row">
            {write && <button className="adm-btn primary" disabled={busy || !ctx.admin.writes} onClick={() => void run(`/api/admin/suggestions/${id}`, { status: f.status, answer: f.answer, ...(f.adoptReason ? { adoptReason: f.adoptReason } : {}) }, () => { reload(); return "저장했어요."; })}>저장</button>}
            <button className="adm-btn" disabled={busy || !ctx.admin.writes} onClick={() => void run(`/api/admin/suggestions/${id}`, { hidden: !s.hidden }, () => { reload(); return s.hidden ? "다시 보이게 했어요." : "숨겼어요."; })}>{s.hidden ? "숨김 해제" : "숨기기"}</button>
          </div>
          {write && ["adopted", "in_progress", "done"].includes(s.status) && <>
            <h2 className="adm-h2 wide">채택 감사 보상(1회, 승인 필요)</h2>
            <label>코인<input inputMode="numeric" value={f.coins} onChange={(e) => setF({ ...f, coins: e.target.value.replace(/\D/g, "") })} /></label>
            <label>보석<input inputMode="numeric" value={f.gems} onChange={(e) => setF({ ...f, gems: e.target.value.replace(/\D/g, "") })} /></label>
            <p className="adm-muted wide">금액은 경제 담당(07)의 연구 후 확정합니다. 작성만으로는 지급하지 않아요.</p>
            <button className="adm-btn" disabled={busy || !ctx.admin.writes} onClick={() => void run(`/api/admin/suggestions/${id}/reward`, { coins: Number(f.coins) || 0, gems: Number(f.gems) || 0 }, drafted)}>보상 초안 만들기</button>
          </>}
          {msg && <p className="adm-note wide" role="status">{msg}</p>}
        </form>
        <h2 className="adm-h2">처리 이력</h2>
        <Table cols={["시각", "관리자", "변경"]} rows={(data.history ?? []).map((h: any) => [when(h.at), <code key="b">{h.by}</code>, JSON.stringify(h.change)])} />
      </>}
    </>
  );
}

function Actions({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState("pending");
  const { data, reload } = useLoad<any>(ctx, `/api/admin/actions?status=${status}`);
  const { msg, busy, run } = useAct(ctx);
  const [confirm, setConfirm] = useState<Record<string, string>>({});
  const stale = Date.now() - ctx.admin.at > ctx.admin.freshMs;
  const approver = ctx.admin.permissions.includes("approve");
  const label = useMemo(() => ({ "reward.campaign": "보상 지급", "code.activate": "교환 코드 활성화", "sanction.apply": "제재 실행", "suggestion.reward": "제안 채택 보상" } as Record<string, string>), []);
  return (
    <>
      <Head title="승인 대기" note={`작성자가 아닌 승인 권한자가 승인해야 실행돼요${ctx.admin.selfApprove ? "(현재 본인 승인 허용 설정)" : ""}. 승인 전 관리자 로그인은 ${Math.round(ctx.admin.freshMs / 60_000)}분 이내여야 해요.`}>
        <select aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">대기</option><option value="executed">실행됨</option><option value="failed">실패</option><option value="rejected">반려</option><option value="cancelled">취소</option><option value="">전체</option></select>
        {approver && stale && <button className="adm-btn" onClick={() => void ctx.refreshSession()}>관리자 로그인 갱신</button>}
      </Head>
      {msg && <p className="adm-note" role="status">{msg}</p>}
      {(data?.actions ?? []).map((a: any) => (
        <article key={a.id} className="adm-card">
          <header><b>{label[a.kind] ?? a.kind}</b> · <code>{a.id}</code> <span className="adm-muted">{when(a.created_at)} · 작성 <code>{a.created_by}</code>{a.decided_by ? ` · 결정 ${a.decided_by}` : ""} · {a.status}</span></header>
          <pre className="adm-pre">{JSON.stringify(a.preview, null, 2)}</pre>
          {a.result && <pre className="adm-pre">{JSON.stringify(a.result, null, 2)}</pre>}
          {a.status === "pending" && <div className="adm-row">
            {approver && <>
              <input aria-label="확인용 작업 ID" placeholder="작업 ID를 그대로 입력" value={confirm[a.id] ?? ""} onChange={(e) => setConfirm({ ...confirm, [a.id]: e.target.value.trim() })} />
              <button className="adm-btn danger" disabled={busy || !ctx.admin.writes || confirm[a.id] !== a.id} onClick={() => void run(`/api/admin/actions/${a.id}/approve`, { confirm: a.id }, (r) => { reload(); return "승인·실행했어요: " + JSON.stringify(r); })}>승인·실행</button>
              <button className="adm-btn" disabled={busy || !ctx.admin.writes} onClick={() => void run(`/api/admin/actions/${a.id}/reject`, {}, () => { reload(); return "반려했어요."; })}>반려</button>
            </>}
            <button className="adm-btn" disabled={busy || !ctx.admin.writes} onClick={() => void run(`/api/admin/actions/${a.id}/cancel`, {}, () => { reload(); return "취소했어요."; })}>작성 취소</button>
          </div>}
        </article>
      ))}
      {data && !data.actions.length && <p className="adm-muted">해당하는 작업이 없어요.</p>}
    </>
  );
}

function AuditRows({ entries }: { entries: any[] }) {
  return <Table cols={["시각", "관리자", "역할", "작업", "대상", "결과", "상세"]} rows={entries.map((e) => [when(e.at), <code key="a">{e.actor}</code>, e.role, e.action, e.target, e.result, <code key="d">{JSON.stringify(e.detail).slice(0, 120)}</code>])} />;
}
function Audit({ ctx }: { ctx: Ctx }) {
  const [action, setAction] = useState("");
  const [cursor, setCursor] = useState<number[]>([]);
  const before = cursor.at(-1);
  const { data } = useLoad<any>(ctx, `/api/admin/audit?action=${encodeURIComponent(action)}${before ? `&before=${before}` : ""}`);
  return (
    <>
      <Head title="감사 로그" note="모든 쓰기, 회원 상세 조회, 권한 거부, 관리자 로그인이 기록돼요(삭제 기능 없음).">
        <select aria-label="작업 필터" value={action} onChange={(e) => { setAction(e.target.value); setCursor([]); }}>
          <option value="">전체</option><option value="session">로그인</option><option value="action">승인·실행</option><option value="member">회원 조회</option><option value="sanction">제재</option><option value="reward">보상</option><option value="code">코드</option><option value="notice">공지</option><option value="denied">권한 거부</option>
        </select>
      </Head>
      {data && <AuditRows entries={data.entries} />}
      <nav className="adm-pager"><button className="adm-btn" disabled={!cursor.length} onClick={() => setCursor(cursor.slice(0, -1))}>최신</button><button className="adm-btn" disabled={!data?.next} onClick={() => setCursor([...cursor, data.next])}>이전 기록</button></nav>
    </>
  );
}
