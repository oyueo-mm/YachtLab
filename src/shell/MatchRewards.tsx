import { useEffect, useState } from "react";
import { Check, Coins, Gem, Trophy, X } from "lucide-react";
import { QUESTS } from "../economy/live/config";
import type { MatchReceipt } from "../economy/live/receipt";
import { AccountError, matchReward, session } from "../identity/account-client";
import "./match-rewards.css";

export type PendingReward = { matchId: string; account: string };

export default function MatchRewards({ server, pending, consume }: { server: string; pending: PendingReward; consume: () => void }) {
  const [receipt, setReceipt] = useState<MatchReceipt | null>(null);
  const [ratio, setRatio] = useState(0);
  const [account, setAccount] = useState(session);
  const matchId = pending.matchId;
  const stillOwnsMatch = account === pending.account;

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
        if (!active || session() !== pending.account) return;
        if (result) setReceipt(result);
        else consume();
      } catch (error) {
        if (!active || session() !== pending.account) return;
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
  }, [server, matchId, stillOwnsMatch]);

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
  }, [receipt]);

  if (!receipt || !stillOwnsMatch) return null;
  const coins = receipt.after.coins - receipt.before.coins;
  const gems = receipt.after.gems - receipt.before.gems;
  const balance = (currency: "coins" | "gems") => Math.round(receipt.before[currency] + (receipt.after[currency] - receipt.before[currency]) * ratio).toLocaleString();
  return (
    <section className="match-rewards" aria-label="이번 경기 보상">
      <header>
        <h2><Trophy size={18} aria-hidden="true" /> 이번 경기 보상</h2>
        <button type="button" className="icon-button" aria-label="보상 알림 닫기" onClick={consume}><X size={18} aria-hidden="true" /></button>
      </header>
      {(coins > 0 || gems > 0) && (
        <div className="match-reward-wallet">
          {coins > 0 && <span><Coins size={16} aria-hidden="true" /> +{coins.toLocaleString()}코인</span>}
          {gems > 0 && <span><Gem size={16} aria-hidden="true" /> +{gems.toLocaleString()}보석</span>}
          <small>경기 직후 잔액 <span aria-hidden="true">{balance("coins")}코인 · {balance("gems")}보석</span><span className="sr-only">{receipt.after.coins}코인 · {receipt.after.gems}보석</span></small>
        </div>
      )}
      {receipt.quests.length > 0 && (
        <ul className="match-reward-quests" aria-label="퀘스트 진행">
          {receipt.quests.map((quest) => {
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
      {receipt.grants.some((grant) => grant.kind === "achievement" || grant.kind === "quest-bonus") && (
        <ul className="match-reward-grants" aria-label="새 업적 및 퀘스트 묶음 보상">
          {receipt.grants.filter((grant) => grant.kind === "achievement" || grant.kind === "quest-bonus").map((grant) => (
            <li key={grant.label}><Check size={14} aria-hidden="true" /> {grant.label}{grant.coins > 0 && ` · +${grant.coins}코인`}{grant.gems > 0 && ` · +${grant.gems}보석`}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
