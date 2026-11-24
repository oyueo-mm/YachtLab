/**
 * Cloudflare usage model for the economy (Workers Free, shared account — D-021/D-022).
 * Free-plan limits are the values recorded in docs/online/SOCIAL-AND-ACCOUNTS.md §5. Write counts per
 * operation are DESIGN ESTIMATES (not measured on the live worker) and are parameters here.
 */
export const FREE_LIMITS = { rowWritesPerDay: 100_000, doRequestsPerDay: 100_000, workerRequestsPerDay: 100_000, rowReadsPerDay: 5_000_000 } as const;
export type UsageAssumptions = {
  /** Existing online PvP room: ≈120 row writes per match (D-022), shared by 2 players. */
  pvpRoomWritesPerMatch: number;
  /** Server-verified AI match: "room" design ≈ same as PvP; "signed transcript" design ≈ 1 final write. */
  serverAiWritesPerMatch: number;
  /** Economy writes per rewarded player-match: wallet/progress row + idempotency ledger row (+ index). */
  economyWritesPerRewardedMatch: number;
  writesPerPurchase: number;
  /** Inbound WebSocket messages per player per match (≈ actions); DO requests count inbound messages 20:1. */
  inboundMessagesPerPlayerMatch: number;
  /** Signed-transcript AI match: Worker requests per match (one per roll + start + finish). */
  serverAiWorkerRequestsPerMatch: number;
  /** Share of the shared account's free quota YachtLab may use (the account also hosts ideadock-auth). */
  quotaShare: number;
};
export const DEFAULT_USAGE: UsageAssumptions = {
  pvpRoomWritesPerMatch: 120,
  serverAiWritesPerMatch: 3,
  economyWritesPerRewardedMatch: 3,
  writesPerPurchase: 3,
  inboundMessagesPerPlayerMatch: 40,
  serverAiWorkerRequestsPerMatch: 40,
  quotaShare: 0.7,
};
/** Daily usage from per-day matches by mode (player-matches) and purchases. */
export function dailyUsage(playerMatchesByMode: { online_random: number; online_friend: number; server_ai: number }, rewardedPlayerMatches: number, purchases: number, u: UsageAssumptions = DEFAULT_USAGE) {
  const pvpMatches = (playerMatchesByMode.online_random + playerMatchesByMode.online_friend) / 2; // two players per match
  const rowWrites = pvpMatches * u.pvpRoomWritesPerMatch + playerMatchesByMode.server_ai * u.serverAiWritesPerMatch + rewardedPlayerMatches * u.economyWritesPerRewardedMatch + purchases * u.writesPerPurchase;
  const doRequests = ((playerMatchesByMode.online_random + playerMatchesByMode.online_friend) * u.inboundMessagesPerPlayerMatch) / 20 + rewardedPlayerMatches; // + 1 account RPC per rewarded match
  const workerRequests = playerMatchesByMode.server_ai * u.serverAiWorkerRequestsPerMatch + pvpMatches * 2;
  const limit = (x: number, l: number) => x / (l * u.quotaShare);
  return { rowWrites, doRequests, workerRequests, utilization: { rowWrites: limit(rowWrites, FREE_LIMITS.rowWritesPerDay), doRequests: limit(doRequests, FREE_LIMITS.doRequestsPerDay), workerRequests: limit(workerRequests, FREE_LIMITS.workerRequestsPerDay) } };
}
/**
 * Workers Paid list prices used for a rough monthly estimate. Checked 2026-11-24 via web search of the official
 * Durable Objects pricing page: $5/month minimum, SQLite rows written 50M/month included then $1.00 per million.
 * DO request and Worker request overage rates were NOT re-checked here — confirm before any decision.
 */
export const PAID_ASSUMPTIONS = { baseUsdPerMonth: 5, includedRowWritesPerMonth: 50_000_000, usdPerMillionRowWrites: 1, includedDoRequestsPerMonth: 1_000_000, usdPerMillionDoRequests: 0.15, includedWorkerRequestsPerMonth: 10_000_000, usdPerMillionWorkerRequests: 0.3 };
export function paidMonthlyUsd(rowWritesPerDay: number, doRequestsPerDay: number, workerRequestsPerDay: number) {
  const p = PAID_ASSUMPTIONS, m = 30;
  const over = (x: number, inc: number, usd: number) => (Math.max(0, x * m - inc) / 1e6) * usd;
  return p.baseUsdPerMonth + over(rowWritesPerDay, p.includedRowWritesPerMonth, p.usdPerMillionRowWrites) + over(doRequestsPerDay, p.includedDoRequestsPerMonth, p.usdPerMillionDoRequests) + over(workerRequestsPerDay, p.includedWorkerRequestsPerMonth, p.usdPerMillionWorkerRequests);
}
