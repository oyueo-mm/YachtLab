/**
 * SOC-1 (2026-11-28): friend presence, privacy settings, showcase achievements (대표 업적) and the
 * sender's view of room invites. Runtime-free (node:sqlite in tests, Durable Object SQLite in the Worker).
 *
 *  - `PresenceHub` lives in the ONE global `FriendIndex` object. A friend list asks it for every friend's
 *    status in ONE call (no per-friend account object reads). Heartbeats are the page's existing inbox
 *    check (once a minute while visible), per browser tab/device, so closing one tab or one device does
 *    not hide the others. "Online" is memory only (no storage write per heartbeat); "playing" and the
 *    "hidden" setting are stored, because they change rarely (match start/end, a settings change) and
 *    must survive the object being evicted. Right after the object (re)starts, a friend without a
 *    heartbeat yet is "unknown" (상태 확인 불가), never a guessed "offline".
 *  - `SocialStore` lives in each account's `UserStore` SQLite: presence visibility, pins and their
 *    visibility, sent room invites (accepted / declined / expired / cancelled, for the sender's screen).
 *    Tables are created lazily, so an account deletion (which drops every table) needs nothing extra.
 */
import { FRIEND_LIMITS, type PublicPeer } from "./friends";
import { achievementById } from "../../src/economy/live/config";

export type FriendStatus = "online" | "offline" | "playing" | "unknown";
export type PresenceVisibility = "friends" | "hidden";
export type PinsVisibility = "public" | "friends" | "private";
export type SocialSettings = { presence: PresenceVisibility; pinsVisibility: PinsVisibility };
export type SentInviteState = "pending" | "accepted" | "declined" | "expired" | "cancelled";
export type SentInvite = { id: string; to: PublicPeer; room: string; at: number; expires: number; state: SentInviteState; kind: "room" | "challenge" };

export const SOCIAL_LIMITS = {
  maxPins: 3,
  /** Distinct tabs / devices remembered per account (oldest dropped). */
  devicesPerUser: 8,
  /** A "playing" mark expires on its own (a lost "match ended" never leaves a friend playing forever). */
  playingMaxMs: 3 * 3600_000,
  /** Direct challenges (방 만들기 + 초대) per inviter per minute. */
  challengesPerMinute: 6,
  /** Sent invites are shown to the sender for this long after they were sent. */
  sentShownMs: 30 * 60_000,
  maxSent: 50,
  /** Accounts kept in presence memory before the oldest silent ones are dropped. */
  memoryUsers: 20_000,
} as const;

export const DEVICE_ID = /^[A-Za-z0-9_-]{8,40}$/;
export type SocialSql = { exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] } };

/* ---------------------------------------------------------------- presence hub ---------------------------------------------------------------- */

export class PresenceHub {
  private beats = new Map<string, Map<string, number>>();
  private playing = new Map<string, { room: string; until: number }>();
  private hidden = new Set<string>();

  constructor(
    private readonly sql: SocialSql,
    private readonly bootAt: number,
  ) {}

  init(now: number) {
    this.sql.exec("CREATE TABLE IF NOT EXISTS presence_playing (user_id TEXT PRIMARY KEY, room TEXT NOT NULL, until INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS presence_hidden (user_id TEXT PRIMARY KEY)");
    this.sql.exec("DELETE FROM presence_playing WHERE until <= ?", now);
    for (const r of this.sql.exec<{ user_id: string; room: string; until: number }>("SELECT user_id, room, until FROM presence_playing").toArray()) this.playing.set(r.user_id, { room: r.room, until: r.until });
    for (const r of this.sql.exec<{ user_id: string }>("SELECT user_id FROM presence_hidden").toArray()) this.hidden.add(r.user_id);
  }

  /** A heartbeat (online) or a goodbye (offline) of one tab / device of one account. Memory only. */
  beat(userId: string, device: string, now: number, state: "online" | "offline" = "online") {
    const dev = DEVICE_ID.test(device) ? device : "legacy";
    let m = this.beats.get(userId);
    if (state === "offline") {
      // An explicit goodbye is a known "offline" (an empty entry), never "unknown" after a restart.
      if (!m) this.beats.set(userId, new Map());
      else m.delete(dev);
      return;
    }
    if (!m) {
      if (this.beats.size >= SOCIAL_LIMITS.memoryUsers) this.sweep(now, true);
      m = new Map();
      this.beats.set(userId, m);
    }
    m.delete(dev);
    m.set(dev, now);
    while (m.size > SOCIAL_LIMITS.devicesPerUser) m.delete(m.keys().next().value as string);
  }

  /** From a room at match start (room code) and end (null). Stored: one row write per player per change. */
  setPlaying(userIds: string[], room: string | null, now: number) {
    for (const id of userIds.slice(0, 40)) {
      if (room) {
        const until = now + SOCIAL_LIMITS.playingMaxMs;
        this.playing.set(id, { room, until });
        this.sql.exec("INSERT OR REPLACE INTO presence_playing (user_id, room, until) VALUES (?, ?, ?)", id, room, until);
      } else if (this.playing.has(id)) {
        this.playing.delete(id);
        this.sql.exec("DELETE FROM presence_playing WHERE user_id = ?", id);
      }
    }
  }

  /** The account's own setting (written only when it changes). */
  setHidden(userId: string, hidden: boolean) {
    if (hidden === this.hidden.has(userId)) return;
    if (hidden) {
      this.hidden.add(userId);
      this.sql.exec("INSERT OR IGNORE INTO presence_hidden (user_id) VALUES (?)", userId);
    } else {
      this.hidden.delete(userId);
      this.sql.exec("DELETE FROM presence_hidden WHERE user_id = ?", userId);
    }
  }

  /** The raw status (hidden players read "offline"; callers check friendship). */
  status(userId: string, now: number): FriendStatus {
    if (this.hidden.has(userId)) return "offline";
    const p = this.playing.get(userId);
    if (p && p.until > now) return "playing";
    const m = this.beats.get(userId);
    if (m) for (const at of m.values()) if (now - at < FRIEND_LIMITS.onlineMs) return "online";
    // Memory was lost recently (object start): a friend may well be online but has not beaten yet.
    if (now - this.bootAt < FRIEND_LIMITS.onlineMs && !m) return "unknown";
    return "offline";
  }
  statuses(userIds: string[], now: number): FriendStatus[] {
    return userIds.slice(0, FRIEND_LIMITS.maxFriends + 20).map((id) => this.status(id, now));
  }

  /** A deleted account: nothing about it is shown any more. */
  forget(userId: string, now: number) {
    this.beats.delete(userId);
    this.setPlaying([userId], null, now);
    this.setHidden(userId, false);
  }

  /** Drop silent accounts from memory (and, when full, the oldest ones). */
  sweep(now: number, force = false) {
    for (const [id, m] of this.beats) {
      for (const [d, at] of m) if (now - at >= FRIEND_LIMITS.onlineMs) m.delete(d);
      // empty entries are known "offline": kept through the start-up window, then forgotten
      if (!m.size && now - this.bootAt >= FRIEND_LIMITS.onlineMs) this.beats.delete(id);
    }
    if (force) while (this.beats.size >= SOCIAL_LIMITS.memoryUsers) this.beats.delete(this.beats.keys().next().value as string);
    for (const [id, p] of this.playing) if (p.until <= now) this.playing.delete(id);
    this.sql.exec("DELETE FROM presence_playing WHERE until <= ?", now);
  }
}

/* ---------------------------------------------------------------- account side ---------------------------------------------------------------- */

/** Validate a pin list against what this account has actually earned (server state, never the client's). */
export function checkPins(raw: unknown, earned: readonly string[]): { ok: true; pins: string[] } | { ok: false; code: string; message: string } {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return { ok: false, code: "PINS", message: "대표 업적 형식이 올바르지 않아요." };
  const ids = raw as string[];
  if (new Set(ids).size !== ids.length) return { ok: false, code: "PINS_DUPLICATE", message: "같은 업적을 두 번 고를 수 없어요." };
  if (ids.length > SOCIAL_LIMITS.maxPins) return { ok: false, code: "PINS_TOO_MANY", message: `대표 업적은 ${SOCIAL_LIMITS.maxPins}개까지예요.` };
  const have = new Set(earned);
  if (ids.some((id) => !achievementById(id) || !have.has(id))) return { ok: false, code: "PINS_NOT_EARNED", message: "달성한 업적만 대표로 고를 수 있어요." };
  return { ok: true, pins: ids };
}

export class SocialStore {
  constructor(private readonly sql: SocialSql) {}

  private ready = false;
  private init() {
    if (this.ready) return;
    this.sql.exec("CREATE TABLE IF NOT EXISTS soc_settings (id INTEGER PRIMARY KEY CHECK (id = 1), presence TEXT NOT NULL DEFAULT 'friends', pins TEXT NOT NULL DEFAULT '[]', pins_vis TEXT NOT NULL DEFAULT 'public', updated_at INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS soc_sent (id TEXT PRIMARY KEY, to_id TEXT NOT NULL, to_code TEXT NOT NULL, to_name TEXT NOT NULL, room TEXT NOT NULL, at INTEGER NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL, kind TEXT NOT NULL)");
    this.ready = true;
  }
  /** After an account deletion dropped every table. */
  reset() {
    this.ready = false;
  }
  private row() {
    this.init();
    return this.sql.exec<{ presence: string; pins: string; pins_vis: string }>("SELECT presence, pins, pins_vis FROM soc_settings WHERE id = 1").toArray()[0] ?? null;
  }
  settings(): SocialSettings {
    const r = this.row();
    return { presence: r?.presence === "hidden" ? "hidden" : "friends", pinsVisibility: r?.pins_vis === "friends" || r?.pins_vis === "private" ? r.pins_vis : "public" };
  }
  /** Returns the new settings and whether presence visibility changed. Unknown values are refused. */
  setSettings(input: Record<string, unknown>, now: number): { ok: true; settings: SocialSettings; presenceChanged: boolean } | { ok: false; code: string; message: string } {
    const cur = this.settings();
    const presence = input.presence === undefined ? cur.presence : input.presence;
    const pinsVisibility = input.pinsVisibility === undefined ? cur.pinsVisibility : input.pinsVisibility;
    if (presence !== "friends" && presence !== "hidden") return { ok: false, code: "SETTINGS", message: "접속 상태 공개 설정을 확인해 주세요." };
    if (pinsVisibility !== "public" && pinsVisibility !== "friends" && pinsVisibility !== "private") return { ok: false, code: "SETTINGS", message: "대표 업적 공개 범위를 확인해 주세요." };
    if (presence === cur.presence && pinsVisibility === cur.pinsVisibility) return { ok: true, settings: cur, presenceChanged: false };
    this.sql.exec("INSERT INTO soc_settings (id, presence, pins_vis, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET presence = excluded.presence, pins_vis = excluded.pins_vis, updated_at = excluded.updated_at", presence, pinsVisibility, now);
    return { ok: true, settings: { presence, pinsVisibility }, presenceChanged: presence !== cur.presence };
  }
  /** Stored pins still earned (an achievement can not be lost today, but never show one that is not). */
  pins(earned?: readonly string[]): string[] {
    let ids: string[] = [];
    try {
      const v = JSON.parse(this.row()?.pins ?? "[]");
      ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!achievementById(x)).slice(0, SOCIAL_LIMITS.maxPins) : [];
    } catch {
      ids = [];
    }
    return earned ? ids.filter((id) => earned.includes(id)) : ids;
  }
  setPins(raw: unknown, earned: readonly string[], now: number): { ok: true; pins: string[] } | { ok: false; code: string; message: string } {
    const checked = checkPins(raw, earned);
    if (!checked.ok) return checked;
    if (JSON.stringify(checked.pins) === JSON.stringify(this.pins())) return checked; // no write
    this.init();
    this.sql.exec("INSERT INTO soc_settings (id, pins, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET pins = excluded.pins, updated_at = excluded.updated_at", JSON.stringify(checked.pins), now);
    return checked;
  }

  /* ---------------------------------------------------------- sent invites ---------------------------------------------------------- */

  recordSent(inv: Omit<SentInvite, "state">, toId: string) {
    this.init();
    this.sql.exec("DELETE FROM soc_sent WHERE at < ?", inv.at - SOCIAL_LIMITS.sentShownMs);
    this.sql.exec("INSERT OR REPLACE INTO soc_sent (id, to_id, to_code, to_name, room, at, expires, state, kind) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)", inv.id, toId, inv.to.code, inv.to.nickname, inv.room, inv.at, inv.expires, inv.kind);
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM soc_sent").toArray()[0].n;
    if (n > SOCIAL_LIMITS.maxSent) this.sql.exec("DELETE FROM soc_sent WHERE id IN (SELECT id FROM soc_sent ORDER BY at LIMIT ?)", n - SOCIAL_LIMITS.maxSent);
  }
  /** The recipient answered (only a pending invite changes; a late answer after cancel is ignored). */
  answerSent(id: string, state: "accepted" | "declined") {
    this.init();
    this.sql.exec("UPDATE soc_sent SET state = ? WHERE id = ? AND state = 'pending'", state, id);
  }
  /** The sender takes an invite back: returns the recipient id (to drop it there), once. */
  cancelSent(id: string): { toId: string } | null {
    this.init();
    const r = this.sql.exec<{ to_id: string }>("SELECT to_id FROM soc_sent WHERE id = ? AND state = 'pending'", id).toArray()[0];
    if (!r) return null;
    this.sql.exec("UPDATE soc_sent SET state = 'cancelled' WHERE id = ?", id);
    return { toId: r.to_id };
  }
  /** A deleted account: my sent invites to it go (its nickname is not kept). */
  forgetRecipient(toId: string) {
    this.init();
    this.sql.exec("DELETE FROM soc_sent WHERE to_id = ?", toId);
  }
  /** A pending, unexpired challenge to this friend (duplicate prevention). */
  pendingChallenge(toCode: string, now: number): SentInvite | null {
    return this.sent(now).find((s) => s.kind === "challenge" && s.to.code === toCode && s.state === "pending") ?? null;
  }
  sent(now: number): SentInvite[] {
    this.init();
    return this.sql
      .exec<{ id: string; to_code: string; to_name: string; room: string; at: number; expires: number; state: string; kind: string }>("SELECT id, to_code, to_name, room, at, expires, state, kind FROM soc_sent WHERE at >= ? ORDER BY at DESC", now - SOCIAL_LIMITS.sentShownMs)
      .toArray()
      .map((r) => ({ id: r.id, to: { code: r.to_code, nickname: r.to_name }, room: r.room, at: r.at, expires: r.expires, kind: r.kind === "challenge" ? "challenge" : "room", state: (r.state === "pending" && r.expires <= now ? "expired" : r.state) as SentInviteState }));
  }
}
