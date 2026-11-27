/**
 * A3 개발용 미리보기 (dev 서버 전용: /YachtLab/match-result-preview.html).
 * 운영 빌드 입력(index.html)에 포함되지 않으며, 예시 데이터는 실제 경기 기록이 아니다.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { categories, names, type Card, type Category } from "../engine";
import { installAudioUnlock } from "../sound";
import type { MotionLevel } from "../settings";
import { SCENARIOS } from "./fixtures";
import { MatchResultPanel } from "./MatchResultPanel";
import { ZeroScoreToast } from "./ZeroScoreToast";
import { zeroScoreNotice, type ZeroScoreNotice } from "./zero-score";
import "../styles.css";
import "../shell.css";

installAudioUnlock();

const SAMPLE_CARD: Card = { aces: 3, deuces: 6, threes: 9, choice: 22 };

function Preview() {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get("s") ?? SCENARIOS[0].id);
  const [motion, setMotion] = useState<MotionLevel | "auto">("auto");
  const [run, setRun] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [zero, setZero] = useState<ZeroScoreNotice | null>(null);
  const [friendSent, setFriendSent] = useState(false);
  const scenario = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  const note = (text: string) => setLog((l) => [text, ...l].slice(0, 5));
  const fireZero = (category: Category) => {
    const after: Card = { ...SAMPLE_CARD, [category]: 0 };
    setZero(zeroScoreNotice(category, after, `${category}-${Date.now()}`));
  };
  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto", display: "grid", gap: 12 }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>A3 경기 결과 미리보기 <small style={{ fontWeight: 400, color: "#6b6b6b" }}>개발용 · 예시 데이터</small></h1>
      <label>장면{" "}
        <select aria-label="장면" value={id} onChange={(e) => { setId(e.target.value); setRun((n) => n + 1); setFriendSent(false); }}>
          {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label>동작{" "}
        <select aria-label="동작" value={motion} onChange={(e) => { setMotion(e.target.value as MotionLevel | "auto"); setRun((n) => n + 1); }}>
          <option value="auto">설정 따름</option><option value="full">전체</option><option value="lite">가볍게</option><option value="none">동작 줄이기</option>
        </select>
      </label>
      <button type="button" className="secondary" onClick={() => setRun((n) => n + 1)}>결과 창 다시 띄우기</button>
      <section aria-label="0점 기록 미리보기" style={{ position: "relative", minHeight: 120, border: "1px dashed #ccc", borderRadius: 12, padding: 10 }}>
        <p style={{ margin: "0 0 6px" }}>0점 기록 팝업 (예시 카드: 에이스 3 · 듀스 6 · 트리플 9 · 초이스 22)</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {categories.filter((c) => SAMPLE_CARD[c] === undefined).map((c) => <button key={c} type="button" className="secondary" onClick={() => fireZero(c)}>{names[c]} 0점</button>)}
        </div>
        <ZeroScoreToast notice={zero} onDone={() => setZero(null)} sound motion={motion === "auto" ? undefined : motion} />
      </section>
      <ul aria-label="동작 기록">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <MatchResultPanel key={`${id}-${run}`} input={scenario.input} sound="full" motion={motion === "auto" ? undefined : motion}
        actions={{
          onRematch: scenario.input.seats.length > 1 ? () => note("재대결") : undefined,
          rematchLabel: scenario.input.mode === "solo" ? "다시 하기" : undefined,
          onReview: scenario.input.seats.length === 2 || scenario.input.mode === "solo" ? () => note("게임 리뷰") : undefined,
          addFriend: scenario.friend ? { name: scenario.input.seats.find((s) => !s.you)!.name, sent: friendSent, onClick: () => { setFriendSent(true); note("친구 요청"); } } : undefined,
          onShare: () => note("공유"),
          onHome: () => note("홈으로"),
        }} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
