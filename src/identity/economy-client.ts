import type { DrawPool, DrawReceipt, DrawStatus } from "../economy/live/draw";
import { authHeader, session } from "./account-client";
import type { Loadout, PublicLook, Slots } from "../economy/live/catalog";
import type { QuestSlot } from "../economy/live/rewards";

/**
 * Browser side of coins, gems, quests, achievements, inventory and the shop (Phase 5/6).
 * Display only: every number comes from the server; every action is decided by the server.
 * Purchases carry a random request id so a retry after a lost reply is applied once.
 */
export type Snapshot = {
  config: string;
  serverTime?: number;
  wallet: { coins: number; gems: number };
  inventory: { id: string; level: number; via: string; at: number }[];
  slots: Slots;
  loadout: Loadout;
  look: PublicLook;
  state: { day: number; week: number; daily: QuestSlot[]; weekly: QuestSlot[]; dailyAll: boolean; weeklyAll: boolean; rerolls: number; weeklyRerolls?: number; rewarded: number; counters: Record<string, number>; achievements: string[]; streak: number };
  ledger: { id: string; at: number; kind: string; coins: number; gems: number; coinsAfter: number; gemsAfter: number; label: string }[];
};
export class EconomyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
async function call<T>(server: string, path: string, body?: unknown): Promise<T> {
  const account = session();
  let res: Response;
  try {
    res = await fetch(server + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...authHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new EconomyError("NETWORK", "서버에 연결할 수 없어요.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new EconomyError(data?.error?.code ?? "SERVER", data?.error?.message ?? "요청을 처리하지 못했어요.");
  if (body !== undefined && account && account === session() && "snapshot" in data) {
    window.dispatchEvent(new CustomEvent("yachtlab-economy", { detail: { account, server, snapshot: data.snapshot } }));
  }
  return data;
}
export const economyRequestId = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
/** Same request id for retries of one tap (kept until the server answered). */
async function once<T>(fn: (requestId: string) => Promise<T>): Promise<T> {
  const id = economyRequestId();
  try {
    return await fn(id);
  } catch (e) {
    if (e instanceof EconomyError && e.code === "NETWORK") return fn(id); // one retry with the same id
    throw e;
  }
}

export const signedIn = () => !!session();
export const economy = (server: string) => call<{ snapshot: Snapshot }>(server, "/api/me/economy").then((r) => r.snapshot);
export const buy = (server: string, itemId: string, currency: "coins" | "gems") => once((requestId) => call<{ snapshot: Snapshot }>(server, "/api/me/shop/buy", { itemId, currency, requestId })).then((r) => r.snapshot);
export const upgrade = (server: string, itemId: string) => once((requestId) => call<{ snapshot: Snapshot }>(server, "/api/me/shop/upgrade", { itemId, requestId })).then((r) => r.snapshot);
export const buySlot = (server: string, kind: "emote" | "chat", currency: "coins" | "gems") => once((requestId) => call<{ snapshot: Snapshot }>(server, "/api/me/shop/slot", { kind, currency, requestId })).then((r) => r.snapshot);
export const saveLoadout = (server: string, loadout: Loadout) => call<{ snapshot: Snapshot }>(server, "/api/me/loadout", { loadout }).then((r) => r.snapshot);
export const rerollQuest = (server: string, index: number | "all", period: "daily" | "weekly", expected: number) =>
  call<{ snapshot: Snapshot }>(server, "/api/me/quests/reroll", { index, period, expected }).then((r) => r.snapshot);
export const drawStatus = (server: string) => call<{ snapshot: Snapshot; draw: DrawStatus }>(server, "/api/me/shop/draw");
export const submitDraw = (server: string, pool: DrawPool, requestId: string) =>
  call<{ snapshot: Snapshot; draw: DrawStatus; receipt: DrawReceipt }>(server, "/api/me/shop/draw", { pool, requestId });
export const startServerAi = (server: string, name: string) => call<{ code: string; playerId: string; token: string }>(server, "/api/ai/start", { name });
