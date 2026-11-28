import { DRAW_COST, DRAW_DAILY_LIMIT, DUPLICATE_COINS, HANDS, drawAvailable, drawHand, drawItems, drawOdds, type DrawPool, type DrawReceipt, type DrawStatus } from "../../src/economy/live/draw";
import { seasonActive } from "../../src/economy/live/seasons";
import type { MatchReceipt } from "../../src/economy/live/receipt";
import { ECONOMY, SLOTS, economyDay } from "../../src/economy/live/config";
import { CATALOG_REV, DEFAULT_LOADOUT, DEFAULT_SLOTS, isDefaultItem, itemById, priceOf, publicLook, sanitizeLoadout, slotPrice, upgradeCost, validateLoadout, type Loadout, type PublicLook, type Slots } from "../../src/economy/live/catalog";
import { applyMatch, loadEconState, replaceQuests, unlockAchievements, type EconState, type Grant, type RewardInput } from "../../src/economy/live/rewards";

/**
 * Coins, gems, inventory and progress of ONE account (Phase 5/6) — runs inside the account's own
 * SQLite Durable Object (`UserStore`), next to `AccountStore`. Runtime-free (any SQLite with `exec`),
 * tested in Node with node:sqlite.
 *
 * Ledger invariants (docs/economy/LIVE-ECONOMY.md §원장):
 *  - Balances are integers ≥ 0, changed only here, only by the server.
 *  - Every change is one ledger row with a unique `event_id` (PRIMARY KEY): a match reward is
 *    `m:<matchId>`, a quest `q:<period>:<key>:<id>`, an achievement `a:<id>`, a purchase
 *    `buy:<requestId>`… A retried or replayed request finds its row and changes nothing.
 *  - Balance update + ledger rows + inventory/state changes of one action run in ONE transaction
 *    (`Sql.transaction`): all of it is stored, or none of it.
 *  - `verify()` re-adds the ledger and compares it with the balance.
 *  - Each ledger row records `funding` ("play" for everything earned by playing; "paid" is reserved
 *    for future cash purchases, none exist) and the config version it was granted under.
 * The per-account object is single-threaded, so two concurrent purchases are applied one after the
 * other: the second sees the first's balance.
 */
export interface EconSql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
  /** Run `fn` atomically (Durable Objects: `storage.transactionSync`). */
  transaction<T>(fn: () => T): T;
}

export type Wallet = { coins: number; gems: number };
export type LedgerRow = { id: string; at: number; kind: string; coins: number; gems: number; coinsAfter: number; gemsAfter: number; label: string };
export type InventoryEntry = { id: string; level: number; via: string; at: number };
export type EconomySnapshot = {
  config: string;
  catalogRev?: number;
  serverTime: number;
  wallet: Wallet;
  inventory: InventoryEntry[];
  slots: Slots;
  loadout: Loadout;
  look: PublicLook;
  state: Pick<EconState, "day" | "week" | "daily" | "weekly" | "dailyAll" | "weeklyAll" | "rerolls" | "weeklyRerolls" | "rewarded" | "counters" | "achievements" | "streak">;
  ledger: LedgerRow[];
};
export type MatchEconomyResult = { applied: boolean; grants: Grant[]; firstToday: boolean; reason: string; wallet?: Wallet; receipt: MatchReceipt };
/** Uniform Web Crypto output, including bounds that do not divide 2^32. */
function randomBelow(bound: number) {
  const sample = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % bound);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % bound;
}

type Fail = { ok: false; code: string; message: string };

/**
 * What the player saw when they confirmed (SEC-08 / SEC-10 / stale requests). Every field is optional so
 * older pages keep working; a page that sends a field gets it checked inside the same transaction as
 * the charge. A mismatch charges nothing and answers 409 so the page reloads and asks again.
 *  - expectedPrice: the coins/gems price (or upgrade cost, slot price, draw cost) shown
 *  - expectedLevel: upgrades — the level the item had when the player tapped (prevents a second tab or
 *    a late retry from upgrading twice)
 *  - configVersion: the economy version (`snapshot.config`) the page last read from this server
 *  - oddsVersion: draws — the version of the odds table shown (`drawOdds(pool).version`)
 */
export type Quote = { expectedPrice?: number; expectedLevel?: number; configVersion?: string; oddsVersion?: string };
/** 409 codes: nothing was charged, the page should reload the snapshot and ask again. */
export const STALE_CODES: ReadonlySet<string> = new Set(["PRICE_CHANGED", "LEVEL_CHANGED", "POLICY_CHANGED", "ODDS_CHANGED", "REQUEST_REUSED"]);
function staleQuote(q: Quote, actual: { price: number; level?: number; odds?: string }): Fail | null {
  if (q.configVersion !== undefined && q.configVersion !== ECONOMY.version) return { ok: false, code: "POLICY_CHANGED", message: "상점 정보가 바뀌었어요. 새 가격을 확인하고 다시 시도해 주세요." };
  if (q.expectedLevel !== undefined && actual.level !== undefined && q.expectedLevel !== actual.level) return { ok: false, code: "LEVEL_CHANGED", message: "이미 강화 단계가 바뀌었어요. 현재 단계를 확인해 주세요." };
  if (q.expectedPrice !== undefined && q.expectedPrice !== actual.price) return { ok: false, code: "PRICE_CHANGED", message: "가격이 바뀌었어요. 새 가격을 확인하고 다시 시도해 주세요." };
  if (q.oddsVersion !== undefined && actual.odds !== undefined && q.oddsVersion !== actual.odds) return { ok: false, code: "ODDS_CHANGED", message: "뽑기 확률 정보가 바뀌었어요. 새로 고친 확률을 확인해 주세요." };
  return null;
}
const REUSED: Fail = { ok: false, code: "REQUEST_REUSED", message: "이미 다른 요청에 쓴 요청 번호예요. 다시 시도해 주세요." };

export class EconomyStore {
  constructor(private readonly sql: EconSql) {}

  init() {
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS econ (id INTEGER PRIMARY KEY CHECK (id = 1), coins INTEGER NOT NULL CHECK (coins >= 0), gems INTEGER NOT NULL CHECK (gems >= 0), welcomed INTEGER NOT NULL, slots TEXT NOT NULL, loadout TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS ledger (event_id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, coins INTEGER NOT NULL, gems INTEGER NOT NULL, coins_after INTEGER NOT NULL, gems_after INTEGER NOT NULL, funding TEXT NOT NULL, label TEXT NOT NULL, config TEXT NOT NULL)",
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS draws (request_id TEXT PRIMARY KEY, day INTEGER NOT NULL, receipt TEXT NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS draws_by_day ON draws (day)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS inventory (item_id TEXT PRIMARY KEY, level INTEGER NOT NULL, via TEXT NOT NULL, at INTEGER NOT NULL)");
    // What each purchase / upgrade / slot request id was used for (additive, rollback-safe). Requests
    // stored before this table existed have no row and keep the old "duplicate" answer.
    this.sql.exec("CREATE TABLE IF NOT EXISTS econ_requests (event_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  /** "new" | "duplicate" (same request replayed) | "reused" (the id was used for something else). */
  private replay(eventId: string, fingerprint: string): "new" | "duplicate" | "reused" {
    if (!this.sql.exec("SELECT 1 FROM ledger WHERE event_id = ?", eventId).toArray().length) return "new";
    const row = this.sql.exec<{ fingerprint: string }>("SELECT fingerprint FROM econ_requests WHERE event_id = ?", eventId).toArray()[0];
    return row && row.fingerprint !== fingerprint ? "reused" : "duplicate";
  }
  private remember(eventId: string, fingerprint: string, now: number) {
    this.sql.exec("INSERT OR REPLACE INTO econ_requests (event_id, fingerprint, at) VALUES (?, ?, ?)", eventId, fingerprint, now);
  }

  private row() {
    return this.sql.exec<{ coins: number; gems: number; welcomed: number; slots: string; loadout: string; data: string }>("SELECT coins, gems, welcomed, slots, loadout, data FROM econ WHERE id = 1").toArray()[0] ?? null;
  }

  /** Create the economy row on first use (no grant here). */
  private ensure(userId: string, now: number) {
    if (this.row()) return;
    this.sql.exec(
      "INSERT INTO econ (id, coins, gems, welcomed, slots, loadout, data, updated_at) VALUES (1, 0, 0, 0, ?, ?, ?, ?)",
      JSON.stringify(DEFAULT_SLOTS),
      JSON.stringify(DEFAULT_LOADOUT),
      JSON.stringify(loadEconState(null, userId, now)),
      now,
    );
  }

  owned(): Map<string, number> {
    return new Map(this.sql.exec<{ item_id: string; level: number }>("SELECT item_id, level FROM inventory").toArray().map((r) => [r.item_id, r.level]));
  }
  private slots(raw: string): Slots {
    try {
      const s = JSON.parse(raw) as Slots;
      const ok = (n: unknown, k: "emote" | "chat") => Number.isInteger(n) && (n as number) >= SLOTS[k].base && (n as number) <= SLOTS[k].max;
      return { emote: ok(s.emote, "emote") ? s.emote : DEFAULT_SLOTS.emote, chat: ok(s.chat, "chat") ? s.chat : DEFAULT_SLOTS.chat };
    } catch {
      return { ...DEFAULT_SLOTS };
    }
  }
  private loadout(raw: string, owned: Map<string, number>, slots: Slots): Loadout {
    try {
      return sanitizeLoadout(JSON.parse(raw), owned, slots);
    } catch {
      return { ...DEFAULT_LOADOUT };
    }
  }

  /**
   * Append ledger rows and move the balance (inside a transaction). Rows whose id exists are skipped.
   * Returns the grants actually applied.
   */
  private post(entries: { id: string; kind: string; coins: number; gems: number; label: string; config?: string }[], now: number): { applied: typeof entries; wallet: Wallet } {
    const r = this.row()!;
    let coins = r.coins;
    let gems = r.gems;
    const applied: typeof entries = [];
    for (const e of entries) {
      if (!Number.isInteger(e.coins) || !Number.isInteger(e.gems)) throw Error("non-integer amount");
      if (this.sql.exec("SELECT 1 FROM ledger WHERE event_id = ?", e.id).toArray().length) continue;
      coins += e.coins;
      gems += e.gems;
      if (coins < 0 || gems < 0) throw Error("negative balance");
      this.sql.exec(
        "INSERT INTO ledger (event_id, at, kind, coins, gems, coins_after, gems_after, funding, label, config) VALUES (?, ?, ?, ?, ?, ?, ?, 'play', ?, ?)",
        e.id,
        now,
        e.kind,
        e.coins,
        e.gems,
        coins,
        gems,
        e.label.slice(0, 80),
        e.config ?? ECONOMY.version,
      );
      applied.push(e);
    }
    if (applied.length) this.sql.exec("UPDATE econ SET coins = ?, gems = ?, updated_at = ? WHERE id = 1", coins, gems, now);
    return { applied, wallet: { coins, gems } };
  }

  /**
   * C5: the ONE ledger writer for non-match rewards (`RewardGrants`: attendance, activity streak, weekly
   * streak, inbox claims, redeem codes, operator / suggestion rewards, daily content). Same `post` as
   * every other balance change, so `verify()` and the running totals hold. Must run inside the caller's
   * transaction. Returns null when the ledger already has `entry.id` (nothing is changed).
   * Items: achievement-only items are stored with `via = achievement` (like achievement titles, they do
   * not count toward the ownership achievements); others with `via = grant:<kind>`. Owned items are skipped.
   */
  grantCredit(userId: string, entry: { id: string; kind: string; coins: number; gems: number; label: string; config: string }, items: readonly string[], now: number): { wallet: Wallet; skipped: string[] } | null {
    this.ensure(userId, now);
    if (this.sql.exec("SELECT 1 FROM ledger WHERE event_id = ?", entry.id).toArray().length) return null;
    const wallet = entry.coins || entry.gems ? this.post([entry], now).wallet : this.balance();
    const skipped: string[] = [];
    const owned = this.owned();
    for (const id of items) {
      const item = itemById(id);
      if (!item) throw Error("unknown grant item");
      if (owned.has(id)) skipped.push(id);
      else this.sql.exec("INSERT INTO inventory (item_id, level, via, at) VALUES (?, 1, ?, ?)", id, item.acquisition === "achievement" ? "achievement" : `grant:${entry.kind}`, now);
    }
    if (items.length > skipped.length) this.itemsAchievements(userId, now);
    return { wallet, skipped };
  }
  /** Whether the ledger has a row (read only). */
  hasLedger(eventId: string) {
    return this.sql.exec("SELECT 1 FROM ledger WHERE event_id = ?", eventId).toArray().length > 0;
  }
  /** Current balance (no row is created). ADMIN-1 (#141) adds the same helper as `wallet()`: keep one at integration. */
  balance(): Wallet {
    const r = this.row();
    return { coins: r?.coins ?? 0, gems: r?.gems ?? 0 };
  }
  /** Whether the account used the economy (the welcome path created its row). */
  hasEconomy() {
    return this.row() !== null;
  }

  /** Items granted by achievements (never purchasable). */
  private grantItems(grants: Grant[], now: number) {
    for (const g of grants) if (g.item && itemById(g.item)) this.sql.exec("INSERT OR IGNORE INTO inventory (item_id, level, via, at) VALUES (?, 1, 'achievement', ?)", g.item, now);
  }

  private saveState(state: EconState, now: number) {
    this.sql.exec("UPDATE econ SET data = ?, updated_at = ? WHERE id = 1", JSON.stringify(state), now);
  }

  /**
   * New-member grant, once per account (ledger id `welcome`). An account re-created within the
   * cooldown after a deletion (`rejoinBlockedUntil`) gets none.
   */
  welcome(userId: string, now: number, rejoinBlockedUntil: number | null): Grant[] {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      if (this.row()!.welcomed) return [];
      this.sql.exec("UPDATE econ SET welcomed = 1 WHERE id = 1");
      if (rejoinBlockedUntil !== null && now < rejoinBlockedUntil) return [];
      const g: Grant = { key: "welcome", kind: "welcome", coins: ECONOMY.newUser.coins, gems: ECONOMY.newUser.gems, label: "신규 회원 보상" };
      return this.post([{ id: g.key, kind: g.kind, coins: g.coins, gems: g.gems, label: g.label }], now).applied.length ? [g] : [];
    });
  }

  /** A finished server-verified match (the caller already stored the record and skipped duplicates). */
  applyMatch(userId: string, createdAt: number, input: RewardInput, now: number): MatchEconomyResult {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      const r = this.row()!;
      const before = loadEconState(r.data, userId, input.endedAt);
      const firstToday = before.lastPlayDay !== economyDay(input.endedAt);
      const result = applyMatch(before, input, { userId, createdAt });
      this.saveState(result.state, now);
      const posted = this.post(
        result.grants.filter((g) => g.coins || g.gems).map((g) => ({ id: g.key, kind: g.kind, coins: g.coins, gems: g.gems, label: g.label })),
        now,
      );
      this.grantItems(result.grants, now);
      const questChanges = (period: "daily" | "weekly") => result.state[period].flatMap((slot) => {
        const previous = before[period].find((quest) => quest.id === slot.id)?.progress ?? 0;
        return slot.progress > previous ? [{ ...slot, previous }] : [];
      });
      const receipt: MatchReceipt = {
        before: { coins: r.coins, gems: r.gems },
        after: posted.wallet,
        quests: [...questChanges("daily"), ...questChanges("weekly")],
        grants: [
          ...posted.applied.map(({ kind, label, coins, gems }) => ({ kind, label, coins, gems })),
          ...result.grants.filter((grant) => grant.kind === "achievement" && !grant.coins && !grant.gems)
            .map(({ kind, label, coins, gems }) => ({ kind, label, coins, gems })),
        ],
      };
      return { applied: true, receipt, grants: result.grants, firstToday: firstToday && result.countable, reason: result.reason, wallet: posted.wallet };
    });
  }

  /** Count one server AI match start against today's limit. */
  startAi(userId: string, now: number): { ok: true } | Fail {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      const state = loadEconState(this.row()!.data, userId, now);
      if (state.aiStarts >= ECONOMY.daily.aiStarts) return { ok: false, code: "AI_LIMIT", message: `AI 대전은 하루 ${ECONOMY.daily.aiStarts}번까지 시작할 수 있어요.` } as Fail;
      this.saveState({ ...state, aiStarts: state.aiStarts + 1 }, now);
      return { ok: true } as const;
    });
  }

  rerollQuest(userId: string, index: number | "all", now: number, period: "daily" | "weekly" = "daily", expected?: number): { ok: true; snapshot: EconomySnapshot } | Fail {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      const state = loadEconState(this.row()!.data, userId, now);
      const r = replaceQuests(state, userId, period, expected ?? (period === "daily" ? state.day : state.week), index);
      if (!r.ok) return { ok: false, code: "QUEST", message: r.message } as Fail;
      this.saveState(r.state, now);
      return { ok: true, snapshot: this.snapshot(userId, now) } as const;
    });
  }

  private itemsAchievements(userId: string, now: number) {
    const state = loadEconState(this.row()!.data, userId, now);
    const items = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM inventory WHERE via != 'achievement'").toArray()[0]?.n ?? 0;
    const next = unlockAchievements({ ...state, counters: { ...state.counters, items } });
    this.saveState(next.state, now);
    this.post(next.grants.filter((g) => g.coins || g.gems).map((g) => ({ id: g.key, kind: g.kind, coins: g.coins, gems: g.gems, label: g.label })), now);
    this.grantItems(next.grants, now);
  }

  /** Buy an item. Idempotent by `requestId`; atomic (balance, inventory, ledger, achievements). */
  buy(userId: string, itemId: unknown, currency: unknown, requestId: string, now: number, quote: Quote = {}): { ok: true; duplicate: boolean; snapshot: EconomySnapshot } | Fail {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      const key = `buy:${requestId}`;
      const fingerprint = `buy|${String(itemId)}|${String(currency)}`;
      const seen = this.replay(key, fingerprint);
      if (seen === "reused") return REUSED;
      if (seen === "duplicate") return { ok: true, duplicate: true, snapshot: this.snapshot(userId, now) } as const;
      const item = itemById(itemId);
      if (!item || item.retired || (item.season && !seasonActive(item.season, now))) return { ok: false, code: "ITEM", message: "판매하지 않는 아이템이에요." } as Fail;
      if (item.acquisition === "achievement") return { ok: false, code: "NOT_FOR_SALE", message: "업적으로만 얻을 수 있는 아이템이에요." } as Fail;
      if (isDefaultItem(item)) return { ok: false, code: "OWNED", message: "기본으로 가진 아이템이에요." } as Fail;
      if (currency !== "coins" && currency !== "gems") return { ok: false, code: "CURRENCY", message: "결제 수단을 골라 주세요." } as Fail;
      const price = priceOf(item, currency);
      if (price === null) return { ok: false, code: "CURRENCY", message: currency === "coins" ? "코인으로 살 수 없는 아이템이에요." : "보석으로 살 수 없는 아이템이에요." } as Fail;
      if (this.owned().has(item.id)) return { ok: false, code: "OWNED", message: "이미 가진 아이템이에요." } as Fail;
      const stale = staleQuote(quote, { price });
      if (stale) return stale;
      const r = this.row()!;
      if ((currency === "coins" ? r.coins : r.gems) < price) return { ok: false, code: "INSUFFICIENT", message: currency === "coins" ? "코인이 부족해요." : "보석이 부족해요." } as Fail;
      this.remember(key, fingerprint, now);
      this.post([{ id: key, kind: "purchase", coins: currency === "coins" ? -price : 0, gems: currency === "gems" ? -price : 0, label: `구매 · ${item.name}` }], now);
      this.sql.exec("INSERT INTO inventory (item_id, level, via, at) VALUES (?, 1, ?, ?)", item.id, currency, now);
      this.itemsAchievements(userId, now);
      return { ok: true, duplicate: false, snapshot: this.snapshot(userId, now) } as const;
    });
  }

  private drawsToday(now: number) {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM draws WHERE day = ?", economyDay(now)).toArray()[0].n;
  }

  drawStatus(now: number): DrawStatus {
    return {
      now,
      remaining: Math.max(0, DRAW_DAILY_LIMIT - this.drawsToday(now)),
      odds: { standard: drawOdds("standard").version, ...Object.fromEntries((["christmas-2026"] as const).filter((p) => drawAvailable(p, now)).map((p) => [p, drawOdds(p).version])) },
      history: this.sql.exec<{ receipt: string }>("SELECT receipt FROM draws ORDER BY rowid DESC LIMIT 30").toArray()
        .map(({ receipt }) => JSON.parse(receipt) as DrawReceipt),
    };
  }

  /** The receipt, inventory, debit, duplicate compensation and related rewards commit together. */
  draw(userId: string, pool: DrawPool, requestId: string, now: number, quote: Quote = {}) {
    return this.sql.transaction(() => {
      const previous = this.sql.exec<{ receipt: string }>("SELECT receipt FROM draws WHERE request_id = ?", requestId).toArray()[0];
      if (previous) {
        const receipt = JSON.parse(previous.receipt) as DrawReceipt;
        if (receipt.pool !== pool) return { ok: false, code: "DRAW_REQUEST", message: "이미 사용한 뽑기 요청이에요." } as Fail;
        return { ok: true, duplicate: true, receipt, draw: this.drawStatus(now), snapshot: this.snapshot(userId, now) } as const;
      }
      if (!drawAvailable(pool, now)) return { ok: false, code: "DRAW_CLOSED", message: "시즌 뽑기 기간이 아니에요." } as Fail;
      const stale = staleQuote(quote, { price: DRAW_COST, odds: drawOdds(pool).version });
      if (stale) return stale;
      if (this.drawsToday(now) >= DRAW_DAILY_LIMIT) return { ok: false, code: "DRAW_LIMIT", message: "오늘의 뽑기 횟수를 모두 사용했어요." } as Fail;
      this.ensure(userId, now);
      if (this.row()!.coins < DRAW_COST) return { ok: false, code: "INSUFFICIENT", message: "코인이 부족해요." } as Fail;
      const dice = Array.from({ length: 5 }, () => 1 + randomBelow(6));
      const hand = drawHand(dice);
      const items = drawItems(pool, HANDS[hand].tier);
      if (!items.length) throw Error("Empty draw pool");
      const item = items[randomBelow(items.length)];
      const duplicateCoins = this.owned().has(item.id) ? DUPLICATE_COINS : 0;
      const receipt: DrawReceipt = { requestId, at: now, pool, dice, hand, itemId: item.id, cost: DRAW_COST, duplicateCoins };
      this.post([{ id: `draw:${requestId}`, kind: "draw", coins: -DRAW_COST, gems: 0, label: `뽑기 · ${item.name}` },
        ...(duplicateCoins ? [{ id: `draw-duplicate:${requestId}`, kind: "draw-duplicate", coins: duplicateCoins, gems: 0, label: `뽑기 중복 · ${item.name}` }] : []),
      ], now);
      if (!duplicateCoins) {
        this.sql.exec("INSERT INTO inventory (item_id, level, via, at) VALUES (?, 1, 'draw', ?)", item.id, now);
        this.itemsAchievements(userId, now);
      }
      this.sql.exec("INSERT INTO draws (request_id, day, receipt) VALUES (?, ?, ?)", requestId, economyDay(now), JSON.stringify(receipt));
      return { ok: true, duplicate: false, receipt, draw: this.drawStatus(now), snapshot: this.snapshot(userId, now) } as const;
    });
  }

  /** Upgrade an owned item by one level (coins only, no failure, no downgrade). Idempotent by `requestId`. */
  upgrade(userId: string, itemId: unknown, requestId: string, now: number, quote: Quote = {}): { ok: true; duplicate: boolean; snapshot: EconomySnapshot } | Fail {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      const key = `up:${requestId}`;
      const fingerprint = `up|${String(itemId)}`;
      const seen = this.replay(key, fingerprint);
      if (seen === "reused") return REUSED;
      if (seen === "duplicate") return { ok: true, duplicate: true, snapshot: this.snapshot(userId, now) } as const;
      const item = itemById(itemId);
      const level = item ? this.owned().get(item.id) : undefined;
      if (!item || level === undefined) return { ok: false, code: "NOT_OWNED", message: "가진 아이템만 강화할 수 있어요." } as Fail;
      const cost = upgradeCost(item, level);
      if (cost === null) return { ok: false, code: "MAX_LEVEL", message: item.maxLevel <= 1 ? "강화할 수 없는 아이템이에요." : "이미 최대 단계예요." } as Fail;
      const stale = staleQuote(quote, { price: cost, level });
      if (stale) return stale;
      if (this.row()!.coins < cost) return { ok: false, code: "INSUFFICIENT", message: "코인이 부족해요." } as Fail;
      this.remember(key, fingerprint, now);
      this.post([{ id: key, kind: "upgrade", coins: -cost, gems: 0, label: `강화 · ${item.name} Lv.${level + 1}` }], now);
      this.sql.exec("UPDATE inventory SET level = ? WHERE item_id = ?", level + 1, item.id);
      return { ok: true, duplicate: false, snapshot: this.snapshot(userId, now) } as const;
    });
  }

  /** Buy one more permanent equip slot (emote or chat), coins or gems. Idempotent by `requestId`. */
  buySlot(userId: string, kind: unknown, currency: unknown, requestId: string, now: number, quote: Quote = {}): { ok: true; duplicate: boolean; snapshot: EconomySnapshot } | Fail {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      const key = `slot:${requestId}`;
      const fingerprint = `slot|${String(kind)}|${String(currency)}`;
      const seen = this.replay(key, fingerprint);
      if (seen === "reused") return REUSED;
      if (seen === "duplicate") return { ok: true, duplicate: true, snapshot: this.snapshot(userId, now) } as const;
      if (kind !== "emote" && kind !== "chat") return { ok: false, code: "SLOT", message: "슬롯 종류가 올바르지 않아요." } as Fail;
      if (currency !== "coins" && currency !== "gems") return { ok: false, code: "CURRENCY", message: "결제 수단을 골라 주세요." } as Fail;
      const r = this.row()!;
      const slots = this.slots(r.slots);
      const price = slotPrice(kind, slots[kind], currency);
      if (price === null) return { ok: false, code: "MAX_SLOTS", message: "슬롯을 더 늘릴 수 없어요." } as Fail;
      const stale = staleQuote(quote, { price });
      if (stale) return stale;
      if ((currency === "coins" ? r.coins : r.gems) < price) return { ok: false, code: "INSUFFICIENT", message: currency === "coins" ? "코인이 부족해요." : "보석이 부족해요." } as Fail;
      this.remember(key, fingerprint, now);
      this.post([{ id: key, kind: "slot", coins: currency === "coins" ? -price : 0, gems: currency === "gems" ? -price : 0, label: `${kind === "emote" ? "이모티콘" : "채팅"} 슬롯 ${slots[kind] + 1}칸` }], now);
      this.sql.exec("UPDATE econ SET slots = ? WHERE id = 1", JSON.stringify({ ...slots, [kind]: slots[kind] + 1 }));
      return { ok: true, duplicate: false, snapshot: this.snapshot(userId, now) } as const;
    });
  }

  /** Equip: validated against inventory, unlocked levels and slots (the client's copy is never trusted). */
  setLoadout(userId: string, raw: unknown, now: number): { ok: true; snapshot: EconomySnapshot } | Fail {
    return this.sql.transaction(() => {
      this.ensure(userId, now);
      const r = this.row()!;
      const checked = validateLoadout(raw, this.owned(), this.slots(r.slots));
      if (!checked.ok) return { ok: false, code: "LOADOUT", message: checked.message } as Fail;
      this.sql.exec("UPDATE econ SET loadout = ?, updated_at = ? WHERE id = 1", JSON.stringify(checked.loadout), now);
      return { ok: true, snapshot: this.snapshot(userId, now) } as const;
    });
  }

  /** What other players see (read when a seat is taken; no write). */
  look(): PublicLook | null {
    const r = this.row();
    if (!r) return null;
    const owned = this.owned();
    return publicLook(this.loadout(r.loadout, owned, this.slots(r.slots)), owned);
  }

  snapshot(userId: string, now: number, ledgerLimit = 30): EconomySnapshot {
    this.ensureReadOnly();
    const r = this.row();
    const owned = this.owned();
    const slots = r ? this.slots(r.slots) : { ...DEFAULT_SLOTS };
    const loadout = r ? this.loadout(r.loadout, owned, slots) : { ...DEFAULT_LOADOUT };
    const state = loadEconState(r?.data, userId, now);
    return {
      config: ECONOMY.version,
      serverTime: now,
      catalogRev: CATALOG_REV,
      wallet: { coins: r?.coins ?? 0, gems: r?.gems ?? 0 },
      inventory: this.sql.exec<{ item_id: string; level: number; via: string; at: number }>("SELECT item_id, level, via, at FROM inventory ORDER BY at").toArray().map((x) => ({ id: x.item_id, level: x.level, via: x.via, at: x.at })),
      slots,
      loadout,
      look: publicLook(loadout, owned),
      state: { day: state.day, week: state.week, daily: state.daily, weekly: state.weekly, dailyAll: state.dailyAll, weeklyAll: state.weeklyAll, rerolls: state.rerolls, weeklyRerolls: state.weeklyRerolls ?? 0, rewarded: state.rewarded, counters: state.counters, achievements: state.achievements, streak: state.streak },
      ledger: this.sql
        .exec<{ event_id: string; at: number; kind: string; coins: number; gems: number; coins_after: number; gems_after: number; label: string }>(
          "SELECT event_id, at, kind, coins, gems, coins_after, gems_after, label FROM ledger ORDER BY rowid DESC LIMIT ?",
          Math.max(1, Math.min(200, ledgerLimit)),
        )
        .toArray()
        .map((x) => ({ id: x.event_id, at: x.at, kind: x.kind, coins: x.coins, gems: x.gems, coinsAfter: x.coins_after, gemsAfter: x.gems_after, label: x.label })),
    };
  }
  private ensureReadOnly() {
    /* snapshot never creates rows: an account that never used the economy reads as all zeros */
  }

  /** Ledger ↔ balance consistency (sum of all rows equals the stored balance; running totals chain). */
  verify(): { ok: boolean; wallet: Wallet; ledger: Wallet; rows: number; problems: string[] } {
    const r = this.row();
    const sum = this.sql.exec<{ c: number | null; g: number | null; n: number }>("SELECT sum(coins) AS c, sum(gems) AS g, count(*) AS n FROM ledger").toArray()[0];
    const rows = this.sql.exec<{ coins: number; gems: number; coins_after: number; gems_after: number; event_id: string }>("SELECT event_id, coins, gems, coins_after, gems_after FROM ledger ORDER BY rowid").toArray();
    const problems: string[] = [];
    let c = 0,
      g = 0;
    for (const x of rows) {
      c += x.coins;
      g += x.gems;
      if (c !== x.coins_after || g !== x.gems_after) problems.push(`running total mismatch at ${x.event_id}`);
      if (c < 0 || g < 0) problems.push(`negative running balance at ${x.event_id}`);
    }
    const wallet = { coins: r?.coins ?? 0, gems: r?.gems ?? 0 };
    const ledger = { coins: sum?.c ?? 0, gems: sum?.g ?? 0 };
    if (wallet.coins !== ledger.coins || wallet.gems !== ledger.gems) problems.push("balance differs from ledger sum");
    return { ok: problems.length === 0, wallet, ledger, rows: sum?.n ?? 0, problems };
  }

  /** Daily coin issuance of this account today (abuse signal for operations metrics). */
  earnedToday(now: number): Wallet {
    const start = (economyDay(now) * 86_400_000) - 9 * 3600_000;
    const s = this.sql.exec<{ c: number | null; g: number | null }>("SELECT sum(coins) AS c, sum(gems) AS g FROM ledger WHERE at >= ? AND coins >= 0 AND gems >= 0", start).toArray()[0];
    return { coins: s?.c ?? 0, gems: s?.g ?? 0 };
  }
}
