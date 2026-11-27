import { useEffect, useState } from "react";
import { serverRecords } from "../identity/account-client";
import { FriendRequestButton } from "./FriendRequestButton";

type Opp = { userId: string; name: string; at: number };
/** Distinct account opponents of the latest server-verified online matches (AI and guests have no account). */
export const recentOpponents = (records: { endedAt: number; opponent: { name: string; kind: string; userId?: string }; mode?: string }[], limit = 5): Opp[] => {
  const out: Opp[] = [];
  for (const r of [...records].sort((a, b) => b.endedAt - a.endedAt)) {
    const id = r.opponent.userId;
    if (r.opponent.kind !== "member" || !id || out.some((o) => o.userId === id)) continue;
    out.push({ userId: id, name: r.opponent.name, at: r.endedAt });
    if (out.length >= limit) break;
  }
  return out;
};

/** "최근 대전 상대" with the same friend button as the in-match profile (A4). Rows load one after another to stay within the search limit. */
export function RecentOpponents({ server, onSent }: { server: string; onSent?: () => void }) {
  const [list, setList] = useState<Opp[] | null>(null);
  const [shown, setShown] = useState(1);
  useEffect(() => {
    let alive = true;
    serverRecords(server)
      .then((r) => alive && setList(recentOpponents(r)))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [server]);
  useEffect(() => {
    if (!list || shown >= list.length) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), 350);
    return () => window.clearTimeout(t);
  }, [list, shown]);
  if (!list || list.length === 0) return null;
  const date = (t: number) => new Date(t).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  return (
    <>
      <h2 className="econ-sub">최근 대전 상대</h2>
      <ul className="friend-list recent-opponents" aria-label="최근 대전 상대">
        {list.slice(0, shown).map((o) => (
          <li key={o.userId}>
            <span className="friend-name">
              <strong>{o.name}</strong>
              <small>{date(o.at)} 대전</small>
            </span>
            <FriendRequestButton server={server} userId={o.userId} nickname={o.name} compact onChange={(r) => (r === "outgoing" || r === "friend") && onSent?.()} />
          </li>
        ))}
      </ul>
    </>
  );
}
