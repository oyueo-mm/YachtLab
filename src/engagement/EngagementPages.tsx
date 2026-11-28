import { useCallback, useEffect, useState } from "react";
import { api, AccountError, session, signInAvailable, startSignIn } from "../identity/account-client";
import "./engagement.css";

/**
 * FEEDBACK-1 member pages: 서비스 제안 (`#suggestions`) and 알림함 (`#mailbox`: 공지, 운영 메시지,
 * 제재 안내·이의제기 — 보상 수령·쿠폰은 `#rewards` 한 곳). Lazily loaded; navigation entries are added by the shell owner (01).
 *
 * Stored-XSS rule (SEC-1): every user or admin text is rendered as a React TEXT node. There is no raw-HTML
 * injection anywhere, no Markdown, and links in posts are shown as plain text (never anchors).
 */
const CATEGORY = { feature: "신규 기능", uiux: "UI/UX 개선", item: "상품 아이디어", mode: "게임 모드", bug: "버그 제보", security: "보안 취약점 제보(비공개)", privacy: "개인정보·민감 문의(비공개)" } as const;
const STATUS = { received: "접수", reviewing: "검토 중", adopted: "채택", in_progress: "개발 중", done: "구현 완료", on_hold: "보류", declined: "미채택" } as const;
type Cat = keyof typeof CATEGORY;
type Suggestion = { id: string; category: Cat; title: string; body?: string; status: keyof typeof STATUS; votes: number; voted?: boolean; mine?: boolean; author: string; private: boolean; createdAt: number; answer: string | null; answeredAt: number | null; credit?: boolean };
const date = (t: number | null) => (t ? new Date(t).toLocaleDateString("ko-KR") : "");

function useSignIn(server: string | null) {
  const [can, setCan] = useState(false);
  useEffect(() => void signInAvailable(server).then(setCan), [server]);
  return can && server ? () => void startSignIn(server) : null;
}

export function SuggestionsPage({ server }: { server: string | null }) {
  const [q, setQ] = useState({ q: "", category: "", status: "", sort: "latest", mine: false, page: 0 });
  const [text, setText] = useState("");
  const [data, setData] = useState<{ total: number; pageSize: number; items: Suggestion[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");
  const signIn = useSignIn(server);
  const load = useCallback(async () => {
    if (!server) return;
    const qs = new URLSearchParams({ q: q.q, category: q.category, status: q.status, sort: q.sort, page: String(q.page), ...(q.mine ? { mine: "1" } : {}) });
    try {
      setData(await api(server, "/api/suggestions?" + qs));
      setError("");
    } catch (e) {
      setError((e as AccountError).message);
    }
  }, [server, q]);
  useEffect(() => void load(), [load]);
  if (!server) return <section className="eng"><h1>서비스 제안</h1><p>온라인 서버가 준비되면 열려요.</p></section>;
  if (open) return <SuggestionDetail server={server} id={open} back={() => { setOpen(null); void load(); }} />;
  if (writing) return <SuggestionForm server={server} done={(id) => { setWriting(false); if (id) setOpen(id); else void load(); }} />;
  return (
    <section className="eng">
      <header className="eng-head">
        <h1>서비스 제안</h1>
        <p>YachtLab을 함께 만들어 주세요. 운영진이 검토해 답변하고, 유용한 제안은 채택해 감사 보상을 드릴 수 있어요(작성만으로는 보상이 없어요).</p>
        {session() ? <button className="eng-btn primary" onClick={() => setWriting(true)}>제안 쓰기</button> : signIn && <button className="eng-btn primary" onClick={signIn}>로그인하고 제안하기</button>}
      </header>
      <form className="eng-filters" onSubmit={(e) => { e.preventDefault(); setQ({ ...q, q: text.trim(), page: 0 }); }}>
        <input aria-label="검색" placeholder="제목·내용 검색" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} />
        <select aria-label="분류" value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value, page: 0 })}><option value="">전체 분류</option>{Object.entries(CATEGORY).filter(([k]) => k !== "security" && k !== "privacy").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="상태" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value, page: 0 })}><option value="">전체 상태</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <div className="eng-seg" role="radiogroup" aria-label="정렬">
          <button type="button" role="radio" aria-checked={q.sort === "latest"} onClick={() => setQ({ ...q, sort: "latest", page: 0 })}>최신순</button>
          <button type="button" role="radio" aria-checked={q.sort === "top"} onClick={() => setQ({ ...q, sort: "top", page: 0 })}>추천순</button>
        </div>
        {session() && <label className="eng-check"><input type="checkbox" checked={q.mine} onChange={(e) => setQ({ ...q, mine: e.target.checked, page: 0 })} />내 제안</label>}
        <button className="eng-btn">검색</button>
      </form>
      {error && <p className="eng-error" role="alert">{error}</p>}
      <ul className="eng-list">
        {data?.items.map((s) => (
          <li key={s.id}>
            <button className="eng-item" onClick={() => setOpen(s.id)}>
              <span className={"eng-status s-" + s.status}>{STATUS[s.status]}</span>
              <strong>{s.title}</strong>
              <span className="eng-meta">{CATEGORY[s.category]} · {s.author} · {date(s.createdAt)}{s.private ? " · 비공개" : ""}{s.answer ? " · 답변 있음" : ""}</span>
              <span className="eng-votes" aria-label={`추천 ${s.votes}`}>▲ {s.votes}</span>
            </button>
          </li>
        ))}
      </ul>
      {data && !data.items.length && <p className="eng-muted">아직 제안이 없어요.</p>}
      {data && data.total > data.pageSize && (
        <nav className="eng-pager" aria-label="페이지">
          <button className="eng-btn" disabled={q.page === 0} onClick={() => setQ({ ...q, page: q.page - 1 })}>이전</button>
          <span>{q.page + 1} / {Math.ceil(data.total / data.pageSize)}</span>
          <button className="eng-btn" disabled={(q.page + 1) * data.pageSize >= data.total} onClick={() => setQ({ ...q, page: q.page + 1 })}>다음</button>
        </nav>
      )}
      <Contributors server={server} />
    </section>
  );
}

function Contributors({ server }: { server: string }) {
  const [list, setList] = useState<{ id: string; title: string; nickname: string }[]>([]);
  useEffect(() => void api<{ contributors: typeof list }>(server, "/api/suggestions/contributors").then((r) => setList(r.contributors)).catch(() => undefined), [server]);
  if (!list.length) return null;
  return <aside className="eng-credits"><h2>업데이트 기여자</h2><ul>{list.map((c) => <li key={c.id}>{c.nickname} — {c.title}</li>)}</ul></aside>;
}

function SuggestionForm({ server, done }: { server: string; done: (id: string | null) => void }) {
  const [f, setF] = useState({ category: "feature" as Cat, title: "", body: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const priv = f.category === "security" || f.category === "privacy";
  return (
    <section className="eng">
      <h1>제안 쓰기</h1>
      <form className="eng-form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { done((await api<{ id: string }>(server, "/api/suggestions", { body: f })).id); } catch (err) { setError((err as AccountError).message); } finally { setBusy(false); }
      }}>
        <label>분류<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Cat })}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {priv && <p className="eng-note">이 분류는 비공개로 접수돼요. 작성자와 운영진만 볼 수 있어요. 비밀번호·인증 코드 같은 비밀 정보는 적지 마세요.</p>}
        <label>제목<input required minLength={4} maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label>내용<textarea required minLength={10} maxLength={4000} rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <p className="eng-muted">글자만 저장돼요(HTML·서식 없음). 링크는 3개까지, 누를 수 없는 글자로 표시돼요. 스크린샷 첨부는 안전한 저장소가 정해질 때까지 준비 중이에요. 하루 5개까지 쓸 수 있어요.</p>
        {error && <p className="eng-error" role="alert">{error}</p>}
        <div className="eng-row"><button type="button" className="eng-btn" onClick={() => done(null)}>취소</button><button className="eng-btn primary" disabled={busy}>등록</button></div>
      </form>
    </section>
  );
}

function SuggestionDetail({ server, id, back }: { server: string; id: string; back: () => void }) {
  const [s, setS] = useState<Suggestion | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<{ suggestion: Suggestion }>(server, `/api/suggestions/${id}`).then((r) => setS(r.suggestion)).catch((e) => setMsg((e as Error).message)), [server, id]);
  useEffect(() => void load(), [load]);
  const act = async (path: string, body: unknown, ok: string) => {
    try { await api(server, path, { body }); setMsg(ok); void load(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="eng">
      <button className="eng-btn" onClick={back}>← 목록</button>
      {s && (
        <article className="eng-detail">
          <span className={"eng-status s-" + s.status}>{STATUS[s.status]}</span>
          <h1>{s.title}</h1>
          <p className="eng-meta">{CATEGORY[s.category]} · {s.author} · {date(s.createdAt)}{s.private ? " · 비공개" : ""}</p>
          <p className="eng-body">{s.body}</p>
          {s.answer && <div className="eng-answer"><b>운영진 답변</b> <span className="eng-muted">{date(s.answeredAt)}</span><p className="eng-body">{s.answer}</p></div>}
          {session() && !s.private && (
            <div className="eng-row">
              {!s.mine && <button className="eng-btn" aria-pressed={!!s.voted} onClick={() => void act(`/api/suggestions/${id}/vote`, { on: !s.voted }, s.voted ? "추천을 취소했어요." : "추천했어요.")}>{s.voted ? "추천 취소" : "추천"} · {s.votes}</button>}
              {!s.mine && <button className="eng-btn" onClick={() => void act(`/api/suggestions/${id}/report`, { reason: "inappropriate" }, "신고가 접수됐어요.")}>부적절한 글 신고</button>}
              {s.mine && ["adopted", "in_progress", "done"].includes(s.status) && <label className="eng-check"><input type="checkbox" checked={!!s.credit} onChange={(e) => void act(`/api/suggestions/${id}/credit`, { credit: e.target.checked }, "기여자 표시 설정을 바꿨어요.")} />업데이트 기여자로 닉네임 표시에 동의</label>}
            </div>
          )}
          {msg && <p className="eng-note" role="status">{msg}</p>}
        </article>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- 알림함 ----------------------------------------------------------------- */

type Notice = { id: string; kind: string; title: string; body: string; important: boolean; publishAt: number };
type Item = { id: string; kind: string; title: string; body: string; expiresAt: number | null; at: number };
export function MailboxPage({ server }: { server: string | null }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [box, setBox] = useState<{ items: Item[]; unclaimed: number } | null>(null);
  const [sanctions, setSanctions] = useState<{ id: string; kind: string; reason: string; until: number | null; liftedAt: number | null }[]>([]);
  const [appeals, setAppeals] = useState<{ id: string; sanction_id: string; status: string; answer: string }[]>([]);
  const [appeal, setAppeal] = useState<{ id: string; text: string } | null>(null);
  const [msg, setMsg] = useState("");
  const signIn = useSignIn(server);
  const load = useCallback(async () => {
    if (!server) return;
    api<{ notices: Notice[] }>(server, "/api/notices").then((r) => setNotices(r.notices)).catch(() => undefined);
    if (!session()) return;
    api<{ items: Item[]; unclaimed: number }>(server, "/api/me/mailbox").then(setBox).catch(() => undefined);
    api<{ sanctions: typeof sanctions }>(server, "/api/me/sanctions").then((r) => setSanctions(r.sanctions)).catch(() => undefined);
    api<{ appeals: typeof appeals }>(server, "/api/me/appeals").then((r) => setAppeals(r.appeals)).catch(() => undefined);
  }, [server]);
  useEffect(() => void load(), [load]);
  const act = async (path: string, body: unknown, ok: (r: any) => string) => {
    try { setMsg(ok(await api(server!, path, { body }))); void load(); } catch (e) { setMsg((e as Error).message); }
  };
  const KIND = { notice: "공지", maintenance: "점검", update: "업데이트", event: "이벤트" } as Record<string, string>;
  return (
    <section className="eng">
      <h1>알림함</h1>
      {msg && <p className="eng-note" role="status">{msg}</p>}
      <h2>공지사항</h2>
      {notices.length ? <ul className="eng-notices">{notices.map((n) => <li key={n.id} className={n.important ? "important" : ""}><b>[{KIND[n.kind] ?? "공지"}] {n.title}</b> <span className="eng-muted">{date(n.publishAt)}</span><p className="eng-body">{n.body}</p></li>)}</ul> : <p className="eng-muted">새 공지가 없어요.</p>}
      {!session() ? (signIn && <p><button className="eng-btn primary" onClick={signIn}>로그인하고 알림 확인</button></p>) : <>
        <h2>받은 알림</h2>
        {/* INT-1 (D-ADM-3 갱신): the mailbox holds messages only; coins and gems are claimed on the reward page (#rewards). */}
        {!!box?.unclaimed && <p className="eng-note">받을 보상 {box.unclaimed}개가 있어요. <a href="#rewards">출석·보상에서 받기</a></p>}
        {box?.items.length ? <ul className="eng-mail">{box.items.map((i) => (
          <li key={i.id}>
            <b>{i.title}</b> <span className="eng-muted">{date(i.at)}{i.expiresAt ? ` · ${date(i.expiresAt)}까지` : ""}</span>
            {i.body && <p className="eng-body">{i.body}</p>}
          </li>
        ))}</ul> : <p className="eng-muted">받은 알림이 없어요.</p>}
        {sanctions.length > 0 && <>
          <h2>이용 제한 안내</h2>
          <ul className="eng-mail">{sanctions.map((s) => {
            const a = appeals.filter((x) => x.sanction_id === s.id);
            return (
              <li key={s.id}>
                <b>{{ warning: "경고", nickname_reset: "닉네임 초기화", restrict: "이용 제한", suspend: "이용 정지" }[s.kind] ?? s.kind}</b> <span className="eng-muted">{s.liftedAt ? "해제됨" : s.until ? `${date(s.until)}까지` : s.kind === "suspend" ? "무기한" : ""}</span>
                <p className="eng-body">사유: {s.reason}</p>
                {a.map((x) => <p key={x.id} className="eng-note">이의제기 {({ submitted: "접수", reviewing: "검토 중", accepted: "인용", rejected: "기각" } as Record<string, string>)[x.status]}{x.answer ? ` — ${x.answer}` : ""}</p>)}
                {appeal?.id === s.id ? (
                  <form className="eng-form" onSubmit={(e) => { e.preventDefault(); void act("/api/me/appeals", { sanctionId: s.id, text: appeal.text }, () => { setAppeal(null); return "이의제기가 접수됐어요."; }); }}>
                    <textarea aria-label="이의제기 내용" required minLength={10} maxLength={2000} value={appeal.text} onChange={(e) => setAppeal({ id: s.id, text: e.target.value })} />
                    <div className="eng-row"><button type="button" className="eng-btn" onClick={() => setAppeal(null)}>취소</button><button className="eng-btn primary">제출</button></div>
                  </form>
                ) : !s.liftedAt && !a.some((x) => x.status === "submitted" || x.status === "reviewing") && <button className="eng-btn" onClick={() => setAppeal({ id: s.id, text: "" })}>이의제기</button>}
              </li>
            );
          })}</ul>
        </>}
      </>}
    </section>
  );
}

/** Member report (used from profiles / match results by the shell owner). */
export async function reportMember(server: string, targetId: string, reason: string, detail: string, matchId?: string) {
  return api<{ id: string }>(server, "/api/reports", { body: { targetType: "user", targetId, reason, detail, matchId } });
}
