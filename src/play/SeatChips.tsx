import { useEffect, useRef, useState, type ReactNode } from "react";
import { UserRound, WifiOff } from "lucide-react";
import type { Card } from "../engine";
import type { PublicLook } from "../economy/live/catalog";
import { BonusChip } from "../QuickPicks";
import { ScoreTotal } from "../ui/GameMoments";
import { PlayerTag, toneOf } from "./Looks";

export type SeatPlayer = { playerId: string; name: string; total: number; card: Card };

/**
 * 1:1 seats drawn on the board's top edge (D-060): avatar + name + total, the current turn, and chat
 * bubbles right under the sender's chip. Me on the left in red, the opponent on the right in blue —
 * also told apart by "(나)", the side and the ring, not colour alone. Details open in a small popover,
 * so nothing here takes a row of its own above the board.
 */
export function SeatChips({ players, me, turn, finished, looks, online, aiSeat, feed, onProfile }: {
  players: SeatPlayer[];
  me: string | null;
  turn: string | null;
  finished: boolean;
  looks: Record<string, PublicLook>;
  online?: string[];
  aiSeat?: string | null;
  /** Chat bubbles of one sender (rendered under that chip). */
  feed?: (playerId: string) => ReactNode;
  onProfile?: (playerId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const meIndex = Math.max(0, players.findIndex((p) => p.playerId === me));
  // My seat first (left), whatever the server's seat order is; data-seat keeps the server index.
  const order = players.map((p, i) => ({ p, i })).sort((a, b) => (a.p.playerId === me ? -1 : b.p.playerId === me ? 1 : a.i - b.i));
  return (
    <div className="score-summary seat-bar" ref={box}>
      {order.map(({ p, i }) => {
        const mine = p.playerId === me;
        const tone = toneOf(i, mine, meIndex);
        const current = !finished && turn === p.playerId;
        const away = online && !online.includes(p.playerId) && p.playerId !== aiSeat;
        return (
          <div key={p.playerId} className={`social-seat seat-chip tone-${tone}${current ? " selected" : ""}${away ? " away" : ""}`} data-seat={i} data-role={mine ? "human" : "opponent"} data-tone={tone}>
            <button type="button" className="seat-chip-main" aria-expanded={open === p.playerId} aria-label={`${p.name}${mine ? " (나)" : ""} 정보, ${p.total}점${current ? ", 차례" : ""}`}
              onClick={() => setOpen(open === p.playerId ? null : p.playerId)}>
              <PlayerTag name={p.name} look={looks[p.playerId]} me={mine} compact tone={tone} />
              <span className="seat-chip-meta" aria-hidden="true">
                {mine && <em>나</em>}
                {p.playerId === aiSeat && <em className="ai-badge">AI</em>}
                {away && <WifiOff size={12} />}
                {current && <i className="seat-turn">차례</i>}
              </span>
              <strong>
                <ScoreTotal value={p.total} />
                <small>점</small>
              </strong>
            </button>
            {feed?.(p.playerId)}
            {open === p.playerId && (
              <div className="seat-popover" role="dialog" aria-label={`${p.name} 정보`}>
                <PlayerTag name={p.name} look={looks[p.playerId]} me={mine} tone={tone} />
                <p className="seat-popover-line">
                  {mine ? "나" : p.playerId === aiSeat ? "서버 AI" : "상대"} · 총점 {p.total}점{away ? " · 연결 끊김" : ""}
                </p>
                <BonusChip card={p.card} />
                {!mine && onProfile && (
                  <button type="button" className="text-button" onClick={() => { setOpen(null); onProfile(p.playerId); }}>
                    <UserRound size={14} aria-hidden="true" /> 프로필 보기
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
