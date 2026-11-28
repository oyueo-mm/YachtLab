import { useEffect, useState } from "react";
import { savedSeat } from "../online/client";
import type { MatchController } from "../online/useBackgroundMatch";

/**
 * Minimal quick-match popup (behaviour only). Drag / minimise / restore and the visual design belong to
 * the global UI owner (01); the states and actions are the MatchController contract (docs/online/SOC-1-SOCIAL.md).
 */
export function MatchPopup({ match, onAi, onRoom, offerAfterMs, practicePaused = false }: {
  match: MatchController;
  onAi: () => void;
  onRoom: (code: string) => void;
  offerAfterMs?: number;
  /** A local (offline) AI game is open: it is kept and can be resumed after the online match. */
  practicePaused?: boolean;
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

  const until = state.phase === "matched" ? state.until : null;
  useEffect(() => {
    if ((since === null && until === null) || display !== "expanded") return;
    clock(Date.now());
    const timer = setInterval(() => clock(Date.now()), until !== null ? 250 : 1000);
    return () => clearInterval(timer);
  }, [since, until, display]);
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
    matched: "상대를 찾았어요!",
    entering: "경기에 입장 중이에요.",
    elsewhere: "다른 탭에서 이미 매칭 중이에요.",
    error: "",
  };
  if (state.phase === "matched") {
    const left = Math.max(0, Math.ceil((state.until - now) / 1000));
    return (
      <aside className="quick-wait quick-found" aria-label="빠른 대전 상태" data-match-found>
        <span role="alert">상대를 찾았어요! <strong>{state.match.opponent}</strong> 님과의 경기</span>
        <span role="timer" aria-label="입장까지 남은 시간">{left}초 뒤 입장</span>
        {practicePaused && <small>진행 중인 오프라인 AI 대전은 그대로 저장돼요. 온라인 경기가 끝나면 ‘이전 활동으로 돌아가기’로 이어서 할 수 있어요.</small>}
        <small>경기는 이미 시작됐어요. 들어가지 않으면 시간 초과로 기권 처리될 수 있어요.</small>
        <button type="button" className="primary" onClick={match.enterNow}>지금 입장</button>
      </aside>
    );
  }
  return (
    <aside className="quick-wait" aria-label="빠른 대전 상태">
      <span role="status">{state.phase === "error" ? state.message : labels[state.phase]}</span>
      {state.phase === "waiting" && <span role="timer" aria-label="매칭 경과 시간">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
      <button type="button" className="secondary" onClick={() => setDisplay("minimized")}>최소화</button>
      {since !== null && state.phase !== "cancelling" && state.phase !== "elsewhere" && (
        <button type="button" className="secondary" onClick={match.cancel}>매칭 취소</button>
      )}
      {state.phase === "elsewhere" && (
        <>
          <button type="button" className="secondary" onClick={match.cancelOther}>다른 탭의 매칭 취소</button>
          <button type="button" className="secondary" onClick={match.cancel}>닫기</button>
        </>
      )}
      {state.phase === "waiting" && offer && (
        <button type="button" className="secondary" onClick={onAi}>기다리는 동안 오프라인 AI와 대전하기 (매칭은 계속돼요)</button>
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
