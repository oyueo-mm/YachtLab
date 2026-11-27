import { useEffect, useMemo, useState } from "react";
import { AccountError, matchReview, serverRecords, session } from "../identity/account-client";
import { localRecords } from "../identity/local";
import { computeStats, type MatchRecord, type RecordMode } from "../identity/records";
import ReviewLauncher from "../review/ReviewLauncher";
import { offlineAIReview } from "../review/offline-history";
import { recentOnlineReview } from "../review/online-history";
import { names } from "../engine";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 1000) / 10}%`);
const num = (x: number | null, digits = 0) => (x === null ? "—" : x.toFixed(digits));
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

export default function MatchHistory({ server }: { server: string | null }) {
  const [owner, setOwner] = useState(session);
  const [local, setLocal] = useState(localRecords);
  const [remote, setRemote] = useState<{ owner: string; records: MatchRecord[] } | null>(null);
  const [mode, setMode] = useState<"all" | RecordMode>("all");
  useEffect(() => {
    const accountChanged = () => setOwner(session());
    const recordsChanged = () => setLocal(localRecords());
    window.addEventListener("yachtlab-session", accountChanged);
    window.addEventListener("yachtlab-records", recordsChanged);
    return () => {
      window.removeEventListener("yachtlab-session", accountChanged);
      window.removeEventListener("yachtlab-records", recordsChanged);
    };
  }, []);
  useEffect(() => {
    if (!owner || !server) return;
    let current = true;
    void serverRecords(server).then((records) => {
      if (current) setRemote({ owner, records });
    }).catch(() => {});
    return () => { current = false; };
  }, [owner, server]);
  const signedIn = !!owner;
  const records = remote && remote.owner === owner ? remote.records : local;
  const recoveryRecords = useMemo(() => [...new Map([...records, ...local].map((record) => [record.recordId, record])).values()], [records, local]);
  const filtered = useMemo(() => mode === "all" ? records : records.filter((r) => r.mode === mode), [mode, records]);
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  return <section className="records-overview" aria-labelledby="records-overview-title">
    <h2 id="records-overview-title">전적과 통계</h2>
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
                    {r.mode === "ai" && r.endReason === "completed" && <ReviewLauncher source={() => offlineAIReview(r, recoveryRecords)} />}
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

  </section>;
}
