import { useEffect, useState } from "react";
import { savedSeat } from "../online/client";
import type { MatchController } from "../online/useBackgroundMatch";

export function MatchPopup({ match, onAi, onRoom, offerAfterMs }: {
  match: MatchController;
  onAi: () => void;
  onRoom: (code: string) => void;
  offerAfterMs?: number;
}) {
  const { state, display, setDisplay } = match;
  const since = "since" in state ? state.since : null;
  const [now, clock] = useState(Date.now);
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    setOffer(false);
    if (since === null || offerAfterMs === undefined) return;
    const timer = setTimeout(() => setOffer(true), Math.max(0, since + offerAfterMs - Date.now()));
    return () => clearTimeout(timer);
  }, [since, offerAfterMs]);

  useEffect(() => {
    if (since === null || display !== "expanded") return;
    clock(Date.now());
    const timer = setInterval(() => clock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since, display]);
  const elapsed = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
  if (display === "hidden" || state.phase === "idle") return null;
  if (display === "minimized") return (
    <button className="secondary" type="button" onClick={() => setDisplay("expanded")}>빠른 대전 상태 보기</button>
  );
  const room = state.phase === "error" ? state.room : undefined;
  const labels = {
    connecting: "빠른 대전에 연결 중이에요.",
    reconnecting: "매칭에 다시 연결 중이에요.",
    waiting: "상대를 찾는 중이에요",
    cancelling: "매칭 취소를 확인 중이에요.",
    pairing: "두 플레이어의 연결을 확인하고 있어요.",
    matched: "상대를 찾았어요.",
    entering: "경기에 입장 중이에요.",
    error: "",
  };
  return (
    <aside className="quick-wait" aria-label="빠른 대전 상태">
      <span role="status">{state.phase === "error" ? state.message : labels[state.phase]}</span>
      {state.phase === "waiting" && <span role="timer" aria-label="매칭 경과 시간">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
      <button type="button" className="secondary" onClick={() => setDisplay("minimized")}>최소화</button>
      {since !== null && state.phase !== "cancelling" && (
        <button type="button" className="secondary" onClick={match.cancel}>매칭 취소</button>
      )}
      {state.phase === "waiting" && offer && (
        <button type="button" className="secondary" onClick={onAi}>기다리는 동안 오프라인 AI와 대전하기</button>
      )}
      {state.phase === "error" && state.code === "NETWORK" && (
        <button type="button" className="secondary" onClick={match.reconnect}>매칭 다시 확인</button>
      )}
      {room && savedSeat(room) && (
        <button type="button" className="secondary" onClick={() => onRoom(room)}>진행 중인 경기로 돌아가기</button>
      )}
    </aside>
  );
}
