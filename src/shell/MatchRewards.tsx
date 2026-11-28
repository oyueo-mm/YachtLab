import { useEffect, useRef, useState } from "react";
import { Check, Coins, Gem, Trophy, X } from "lucide-react";
import { QUESTS } from "../economy/live/config";
import type { MatchReceipt } from "../economy/live/receipt";
import { AccountError, matchReward, session } from "../identity/account-client";
import { combineReceipts, markWalletShown, type PendingNotice } from "../match-result/reward-notices";
import "./match-rewards.css";

export type PendingReward = { matchId: string; account: string };

function useMatchReceipt(server: string, matchId: string, owner: string | null, onEmpty?: () => void) {
  const [receipt, setReceipt] = useState<MatchReceipt | null>(null);
  const [account, setAccount] = useState(session);
  const stillOwnsMatch = !!owner && account === owner;

  useEffect(() => {
    const change = () => setAccount(session());
    window.addEventListener("yachtlab-session", change);
    window.addEventListener("storage", change);
    return () => {
      window.removeEventListener("yachtlab-session", change);
      window.removeEventListener("storage", change);
    };
  }, []);

  useEffect(() => {
    if (!stillOwnsMatch) return;
    let active = true;
    let timer = 0;
    // A room can reach the result screen before the Worker delivers its record to the account.
    const read = async (attempt: number) => {
      try {
        const result = await matchReward(server, matchId);
        if (!active || session() !== owner) return;
        if (result) setReceipt(result);
        else onEmpty?.();
      } catch (error) {
        if (!active || session() !== owner) return;
        if (error instanceof AccountError && error.status === 404 && attempt < 3) {
          timer = window.setTimeout(() => void read(attempt + 1), 750 * (attempt + 1));
        }
      }
    };
    void read(0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [server, matchId, stillOwnsMatch, owner]);

  return stillOwnsMatch ? receipt : null;
}

export function MatchRewardSummary({ server, matchId }: { server: string; matchId: string }) {
  const [owner] = useState(session);
  const receipt = useMatchReceipt(server, matchId, owner);
  if (!receipt) return null;
  const coins = receipt.after.coins - receipt.before.coins;
  const gems = receipt.after.gems - receipt.before.gems;
  if (!(coins > 0 || gems > 0)) return null;
  markWalletShown(matchId);
  return <section className="match-reward-wallet" aria-label="이번 경기 보상">
    {coins > 0 && <span><Coins size={16} aria-hidden="true" /> +{coins.toLocaleString()}코인</span>}
    {gems > 0 && <span><Gem size={16} aria-hidden="true" /> +{gems.toLocaleString()}보석</span>}
  </section>;
}

/**
 * Receipts of several finished matches for the home notice (H-A3-3). Each match is read once with the same
 * 404 retry as a single receipt; a match whose receipt never arrives stays out of the notice (no amount shown).
 */
function useMatchReceipts(server: string, pending: readonly PendingNotice[], onSettled: (empty: string[]) => void) {
  const [receipts, setReceipts] = useState<Record<string, MatchReceipt | null>>({});
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const key = pending.map((n) => `${n.account}:${n.matchId}`).join(",");
  useEffect(() => {
    let active = true;
    const timers = new Set<number>();
    const empty: string[] = [];
    let open = pending.length;
    const finish = () => { if (--open === 0 && active && empty.length) settled.current(empty); };
    for (const { matchId, account } of pending) {
      const read = async (attempt: number) => {
        try {
          const result = await matchReward(server, matchId);
          if (!active || session() !== account) return;
          setReceipts((all) => ({ ...all, [matchId]: result }));
          if (!result) empty.push(matchId);
          finish();
        } catch (error) {
          if (!active || session() !== account) return;
          if (error instanceof AccountError && error.status === 404 && attempt < 3) {
            const t = window.setTimeout(() => { timers.delete(t); void read(attempt + 1); }, 750 * (attempt + 1));
            timers.add(t);
          } else {
            empty.push(matchId);
            finish();
          }
        }
      };
      void read(0);
    }
    return () => {
      active = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, key]);
  return receipts;
}

export default function MatchRewards({ server, pending, consume }: { server: string; pending: readonly PendingNotice[]; consume: (matchIds: string[]) => void }) {
  const receipts = useMatchReceipts(server, pending, (empty) => { if (empty.length === pending.length) consume(empty); });
  const ready = pending.filter((n) => receipts[n.matchId]);
  const combined = combineReceipts(ready.map((n) => ({ matchId: n.matchId, receipt: receipts[n.matchId] })));
  const receipt = ready.length ? combined : null;
  const ids = pending.map((n) => n.matchId);
  const [ratio, setRatio] = useState(0);
  const [paused, setPaused] = useState(false);
  const close = useRef(() => consume(ids));
  close.current = () => consume(ids);
  // A toast over the page (never a section in the home layout). It closes by itself; the reward
  // itself is already in the server ledger, so closing only hides the notice.
  useEffect(() => {
    if (!receipt || paused) return;
    const timer = window.setTimeout(() => close.current(), 12_000);
    return () => window.clearTimeout(timer);
  }, [!!receipt, paused]);
  useEffect(() => {
    if (!receipt) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRatio(1);
      return;
    }
    const started = performance.now();
    let frame = requestAnimationFrame(function animate(now) {
      const phase = Math.min(1, (now - started) / 750);
      setRatio(1 - (1 - phase) ** 3);
      if (phase < 1) frame = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(frame);
  }, [!!receipt]);

  const nothing = !!receipt && combined.coins === 0 && combined.gems === 0 && combined.quests.length === 0 && combined.grants.length === 0;
  const allRead = pending.every((n) => n.matchId in receipts);
  // Matches with nothing left to show (coins already seen on the result card, no quests) leave the list.
  useEffect(() => { if (nothing && allRead) close.current(); }, [nothing, allRead]);

  if (!receipt) return null;
  const { coins, gems } = combined;
  const last = receipts[ready.at(-1)!.matchId]!;
  const first = receipts[ready[0].matchId]!;
  // Balance after the newest settled match; the count-up starts from before the oldest one shown.
  const balance = (currency: "coins" | "gems") => Math.round(first.before[currency] + (last.after[currency] - first.before[currency]) * ratio).toLocaleString();
  const showWallet = coins > 0 || gems > 0;
  const grants = combined.grants;
  if (!showWallet && combined.quests.length === 0 && grants.length === 0) return null;
  return (
    <section className="match-rewards" aria-live="polite" aria-label={ready.length > 1 ? `최근 ${ready.length}경기 보상` : "이번 경기 보상"} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <header>
        <h2><Trophy size={18} aria-hidden="true" /> {ready.length > 1 ? `최근 ${ready.length}경기 보상` : "이번 경기 보상"}</h2>
        <button type="button" className="icon-button" aria-label="보상 알림 닫기" onClick={() => close.current()}><X size={18} aria-hidden="true" /></button>
      </header>
      {showWallet && (
        <div className="match-reward-wallet">
          {coins > 0 && <span><Coins size={16} aria-hidden="true" /> +{coins.toLocaleString()}코인</span>}
          {gems > 0 && <span><Gem size={16} aria-hidden="true" /> +{gems.toLocaleString()}보석</span>}
          <small>경기 직후 잔액 <span aria-hidden="true">{balance("coins")}코인 · {balance("gems")}보석</span><span className="sr-only">{last.after.coins}코인 · {last.after.gems}보석</span></small>
        </div>
      )}
      {combined.quests.length > 0 && (
        <ul className="match-reward-quests" aria-label="퀘스트 진행">
          {combined.quests.map((quest) => {
            const definition = QUESTS.find((entry) => entry.id === quest.id);
            if (!definition) return null;
            const progress = quest.previous + (quest.progress - quest.previous) * ratio;
            return (
              <li key={quest.id}>
                <span>{definition.period === "daily" ? "일일" : "주간"} · {definition.label}</span>
                <span className="match-reward-progress" role="progressbar" aria-label={definition.label} aria-valuemin={0} aria-valuemax={definition.count} aria-valuenow={quest.progress}>
                  <i style={{ width: `${100 * progress / definition.count}%` }} />
                </span>
                <small>{quest.previous} → {quest.progress}/{definition.count}</small>
                {quest.done && <span className="match-reward-done"><Check size={14} aria-hidden="true" /> 완료</span>}
              </li>
            );
          })}
        </ul>
      )}
      {grants.length > 0 && (
        <ul className="match-reward-grants" aria-label="새 업적 및 퀘스트 묶음 보상">
          {grants.map((grant) => (
            <li key={grant.label}><Check size={14} aria-hidden="true" /> {grant.label}{grant.coins > 0 && ` · +${grant.coins}코인`}{grant.gems > 0 && ` · +${grant.gems}보석`}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
