import { validateNickname } from "../../src/identity/nickname";
import { sanitizeLook, type PublicLook } from "../../src/economy/live/catalog";
import type { HostSocket } from "./host";

/**
 * MatchHub (Phase 4.5) — one global Durable Object for quick-match queueing, the public spectating
 * list and privacy-light operations counters. Runtime-free logic (the `MatchHub` DO in index.ts is a
 * thin shell), tested in Node with fake sockets.
 *
 * Queue (docs/online/MATCHMAKING.md):
 *  - A waiting player is one hibernatable WebSocket; everything about the wait lives in the socket
 *    attachment (no storage write while waiting, survives hibernation).
 *  - Pairing is decided synchronously (no `await` between choosing two waiters and marking them
 *    "pairing"), so one player can never be handed to two matches, whatever arrives concurrently.
 *  - Never paired: the same ticket (tab), the same signed-in account, the same device (two tabs of
 *    one browser). The same IP is NOT a reason to refuse (shared Wi-Fi, carrier NAT).
 *  - The same two players are not paired again within 10 minutes unless both have waited ≥ 20 s.
 *  - Ghosts: a waiter must send `alive` every 15 s; silent for 45 s, or waiting for 5 min → removed.
 *  - The result (room code + seat token) is kept for 5 minutes keyed by the ticket hash (SQLite), so
 *    a refresh or a dropped socket at the moment of matching still gets its seat.
 * Public list: memory only (a loss-tolerant cache). Rooms push an entry when the round, scores or
 * spectator count change and remove it when the match ends; entries silent for 3 minutes expire.
 */

export const HUB_LIMITS = {
  waitMs: 5 * 60_000,
  aliveTimeoutMs: 45_000,
  resultTtlMs: 5 * 60_000,
  rePairAfterMs: 10 * 60_000,
  rePairPatienceMs: 20_000,
  publicTtlMs: 3 * 60_000,
  activeTtlMs: 40 * 60_000,
  maxWaiters: 200,
  maxPublic: 50,
  metricsFlushMs: 10 * 60_000,
} as const;

export type QueueSeat = { name: string; userId: string | null; key: string };
export type MatchResult = { ok: true; code: string; seats: [{ playerId: string; token: string }, { playerId: string; token: string }] } | { ok: false; message: string };
export type PublicEntry = {
  code: string;
  players: { name: string; score: number; look: PublicLook }[];
  round: number;
  spectators: number;
  max: number;
};
type Waiter = {
  kind: "waiter";
  /** SHA-256 of the client's ticket (the ticket itself never leaves the browser and this socket). */
  ticket: string;
  name: string;
  userId: string | null;
  /** Hash of the browser's device id (two tabs of one browser are never paired). */
  device: string | null;
  spectate: boolean;
  since: number;
  aliveAt: number;
  state: "waiting" | "pairing";
};
export type HubSql = { exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] } };
export type HubDeps = {
  now(): number;
  sockets(): HostSocket[];
  sql: HubSql;
  /** Session bearer → account id, or null (guests play too). */
  auth(session: string): Promise<string | null>;
  /** Create and start a two-player room (first seat moves first). */
  createMatch(a: QueueSeat, b: QueueSeat, options: { public: boolean }): Promise<MatchResult>;
  setAlarm?(at: number): void;
};

const encoder = new TextEncoder();
async function hash(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode("yachtlab-queue:" + text)));
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const TICKET = /^[A-Za-z0-9_-]{22,64}$/;
const SESSION = /^s1\.u_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

type Counters = Record<string, number>;

export class HubCore {
  private recent = new Map<string, number>();
  private active = new Map<string, { code: string; until: number }>();
  private codeKeys = new Map<string, string[]>();
  private publicList = new Map<string, PublicEntry & { at: number }>();
  private gone = new WeakSet<HostSocket>();
  /** Operations counters per economy-free UTC day: memory, flushed to one SQLite row per day. */
  private metrics = new Map<number, Counters>();
  private waitSamples = new Map<number, number[]>();
  private dirty = false;
  private flushAt: number | null = null;

  constructor(private readonly deps: HubDeps) {}

  init() {
    this.deps.sql.exec("CREATE TABLE IF NOT EXISTS results (ticket TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.deps.sql.exec("CREATE TABLE IF NOT EXISTS metrics (day INTEGER PRIMARY KEY, data TEXT NOT NULL)");
  }

  /* ------------------------------------------------------------- queue ------------------------------------------------------------- */

  private att(ws: HostSocket): Waiter | null {
    try {
      const a = ws.deserializeAttachment() as Waiter | null;
      return a && a.kind === "waiter" ? a : null;
    } catch {
      return null;
    }
  }
  private open() {
    return this.deps.sockets().filter((s) => !this.gone.has(s));
  }
  private send(ws: HostSocket, msg: unknown) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
  private close(ws: HostSocket, code: number, reason: string) {
    this.gone.add(ws);
    try {
      ws.close(code, reason);
    } catch {
      /* closed */
    }
  }
  private identity(w: Waiter) {
    return w.userId ? "u:" + w.userId : w.device ? "d:" + w.device : "t:" + w.ticket;
  }
  waiting(): number {
    return this.open().filter((s) => this.att(s)?.state === "waiting").length;
  }

  closed(ws: HostSocket) {
    const w = this.att(ws);
    this.gone.add(ws);
    if (w?.state === "waiting") this.count("queue.leave");
  }

  async message(ws: HostSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > 1024) return this.close(ws, 1009, "too large");
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return this.send(ws, { t: "error", code: "INVALID", message: "알 수 없는 메시지예요." });
    }
    if (typeof msg !== "object" || msg === null) return;
    const now = this.deps.now();
    const me = this.att(ws);
    if (msg.t === "alive") {
      if (me) ws.serializeAttachment({ ...me, aliveAt: now });
      // Re-try pairing: waiters held back by the repeat-pair rule become compatible after 20 s.
      return this.pairAll();
    }
    if (msg.t === "cancel") {
      if (me?.state === "waiting") this.count("queue.cancel");
      return this.close(ws, 1000, "cancelled");
    }
    if (msg.t !== "queue" || me) return;
    // ---------- join the queue ----------
    const nick = validateNickname(msg.name);
    if (!nick.ok) return this.reject(ws, "NAME", nick.message);
    if (typeof msg.ticket !== "string" || !TICKET.test(msg.ticket)) return this.reject(ws, "INVALID", "매칭 정보가 올바르지 않아요.");
    const device = typeof msg.device === "string" && TICKET.test(msg.device) ? await hash("device:" + msg.device) : null;
    const ticket = await hash("ticket:" + msg.ticket);
    let userId: string | null = null;
    if (typeof msg.session === "string" && SESSION.test(msg.session)) userId = await this.deps.auth(msg.session).catch(() => null);
    // Another frame of this socket may have been handled during the awaits above.
    if (this.gone.has(ws) || this.att(ws)) return;
    const t = this.deps.now();
    // A refresh / reconnect after the match was made: hand out the same seat again.
    const stored = this.deps.sql.exec<{ data: string; expires: number }>("SELECT data, expires FROM results WHERE ticket = ?", ticket).toArray()[0];
    if (stored && stored.expires > t) {
      this.send(ws, { t: "matched", ...JSON.parse(stored.data) });
      return this.close(ws, 1000, "matched");
    }
    const w: Waiter = { kind: "waiter", ticket, name: nick.name, userId, device, spectate: msg.spectate === true, since: t, aliveAt: t, state: "waiting" };
    const key = this.identity(w);
    const busy = this.active.get(key);
    if (busy && busy.until > t) return this.reject(ws, "IN_MATCH", "이미 진행 중인 무작위 대전이 있어요.", { room: busy.code });
    for (const s of this.open()) {
      if (s === ws) continue;
      const o = this.att(s);
      if (!o) continue;
      if (o.ticket === ticket) {
        // The same tab (refresh / new socket): the new socket replaces the old one, keeping its place.
        if (o.state === "pairing") return this.reject(ws, "PAIRING", "매칭을 마무리하는 중이에요. 잠시 후 다시 시도해 주세요.");
        w.since = o.since;
        this.close(s, 4010, "replaced");
      } else if (userId && o.userId === userId) return this.reject(ws, "DUPLICATE", "다른 화면에서 이미 매칭을 기다리고 있어요.");
    }
    if (this.waiting() >= HUB_LIMITS.maxWaiters) return this.reject(ws, "BUSY", "지금은 대기 인원이 많아요. 잠시 후 다시 시도해 주세요.");
    ws.serializeAttachment(w);
    this.count("queue.join");
    this.send(ws, { t: "queued", since: w.since, waiting: this.waiting() });
    await this.pairAll();
  }

  private reject(ws: HostSocket, code: string, message: string, extra: Record<string, unknown> = {}) {
    this.send(ws, { t: "error", code, message, ...extra });
    this.close(ws, 4011, code.toLowerCase());
  }

  /** Drop ghosts and expired waiters. */
  private sweep(now: number) {
    for (const s of this.open()) {
      const w = this.att(s);
      if (!w || w.state !== "waiting") continue;
      if (now - w.aliveAt > HUB_LIMITS.aliveTimeoutMs) {
        this.count("queue.ghost");
        this.close(s, 4012, "silent");
      } else if (now - w.since > HUB_LIMITS.waitMs) {
        this.count("queue.expired");
        this.send(s, { t: "expired", message: "상대를 찾지 못했어요." });
        this.close(s, 4013, "expired");
      }
    }
  }

  private compatible(a: Waiter, b: Waiter, now: number) {
    if (a.ticket === b.ticket) return false;
    if (a.userId && b.userId && a.userId === b.userId) return false;
    if (a.device && b.device && a.device === b.device) return false;
    const pair = [this.identity(a), this.identity(b)].sort().join("|");
    const last = this.recent.get(pair);
    if (last !== undefined && now - last < HUB_LIMITS.rePairAfterMs && (now - a.since < HUB_LIMITS.rePairPatienceMs || now - b.since < HUB_LIMITS.rePairPatienceMs)) return false;
    return true;
  }

  /** Pair as many waiters as possible (oldest first). */
  async pairAll() {
    for (;;) {
      const now = this.deps.now();
      this.sweep(now);
      const waiting = this.open()
        .map((s) => ({ s, w: this.att(s)! }))
        .filter((x) => x.w?.state === "waiting")
        .sort((x, y) => x.w.since - y.w.since);
      let chosen: [typeof waiting[number], typeof waiting[number]] | null = null;
      outer: for (let i = 0; i < waiting.length; i++)
        for (let j = i + 1; j < waiting.length; j++)
          if (this.compatible(waiting[i].w, waiting[j].w, now)) {
            chosen = [waiting[i], waiting[j]];
            break outer;
          }
      if (!chosen) return;
      // Critical section ends here: both are marked before any await.
      for (const x of chosen) x.s.serializeAttachment({ ...x.w, state: "pairing" } satisfies Waiter);
      await this.pair(chosen[0], chosen[1]);
    }
  }

  private async pair(a: { s: HostSocket; w: Waiter }, b: { s: HostSocket; w: Waiter }) {
    const now = this.deps.now();
    // Who moves first is decided by the server at random.
    const flip = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 1;
    const [first, second] = flip ? [b, a] : [a, b];
    const pub = a.w.spectate && b.w.spectate;
    let result: MatchResult;
    try {
      result = await this.deps.createMatch({ name: first.w.name, userId: first.w.userId, key: this.identity(first.w) }, { name: second.w.name, userId: second.w.userId, key: this.identity(second.w) }, { public: pub });
    } catch {
      result = { ok: false, message: "경기를 만들지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
    if (!result.ok) {
      this.count("match.fail");
      for (const x of [a, b]) this.reject(x.s, "UNAVAILABLE", result.message);
      return;
    }
    const t = this.deps.now();
    this.deps.sql.exec("DELETE FROM results WHERE expires < ?", t);
    const keys: string[] = [];
    for (const [i, x] of [first, second].entries()) {
      const other = i === 0 ? second : first;
      const data = { code: result.code, playerId: result.seats[i].playerId, token: result.seats[i].token, name: x.w.name, opponent: other.w.name, public: pub };
      this.deps.sql.exec("INSERT OR REPLACE INTO results (ticket, data, expires) VALUES (?, ?, ?)", x.w.ticket, JSON.stringify(data), t + HUB_LIMITS.resultTtlMs);
      this.send(x.s, { t: "matched", ...data });
      this.close(x.s, 1000, "matched");
      const key = this.identity(x.w);
      keys.push(key);
      this.active.set(key, { code: result.code, until: t + HUB_LIMITS.activeTtlMs });
      this.sample("wait", t - x.w.since);
    }
    this.codeKeys.set(result.code, keys);
    this.recent.set([...keys].sort().join("|"), now);
    if (this.recent.size > 2000) for (const [k, v] of this.recent) if (now - v > HUB_LIMITS.rePairAfterMs) this.recent.delete(k);
    this.count("match.random");
    if (pub) this.count("match.public");
    if (a.w.userId && b.w.userId) this.count("match.members");
  }

  /** A random match ended (or its room closed): both players may queue again. */
  ended(code: string) {
    for (const k of this.codeKeys.get(code) ?? []) if (this.active.get(k)?.code === code) this.active.delete(k);
    this.codeKeys.delete(code);
    this.publicList.delete(code);
  }

  /* --------------------------------------------------------- public spectating --------------------------------------------------------- */

  publish(raw: unknown) {
    const e = raw as PublicEntry;
    if (!e || typeof e.code !== "string" || !Array.isArray(e.players) || e.players.length !== 2) return;
    if (!this.publicList.has(e.code) && this.publicList.size >= HUB_LIMITS.maxPublic) return;
    const players = e.players.map((p) => ({ name: String(p.name).slice(0, 40), score: Number(p.score) | 0, look: sanitizeLook(p.look) }));
    this.publicList.set(e.code, { code: e.code, players, round: Math.max(1, Math.min(12, Number(e.round) | 0)), spectators: Number(e.spectators) | 0, max: Number(e.max) | 0, at: this.deps.now() });
  }
  unpublish(code: string) {
    this.publicList.delete(code);
  }
  list(): PublicEntry[] {
    const now = this.deps.now();
    const out: PublicEntry[] = [];
    for (const [code, e] of this.publicList) {
      if (now - e.at > HUB_LIMITS.publicTtlMs) {
        this.publicList.delete(code);
        continue;
      }
      const { at: _at, ...entry } = e;
      out.push(entry);
    }
    // Rooms with free spectator places and later rounds first.
    return out.sort((x, y) => Number(x.spectators >= x.max) - Number(y.spectators >= y.max) || y.round - x.round).slice(0, 30);
  }

  /* --------------------------------------------------------------- metrics --------------------------------------------------------------- */

  private today() {
    return Math.floor(this.deps.now() / 86_400_000);
  }
  count(name: string, n = 1) {
    const day = this.today();
    const m = this.metrics.get(day) ?? this.loadDay(day);
    m[name] = (m[name] ?? 0) + n;
    this.metrics.set(day, m);
    this.markDirty();
  }
  /** Keep the max of a value (e.g. biggest daily coin issuance of one account). */
  peak(name: string, value: number) {
    const day = this.today();
    const m = this.metrics.get(day) ?? this.loadDay(day);
    if ((m[name] ?? 0) >= value) return;
    m[name] = value;
    this.metrics.set(day, m);
    this.markDirty();
  }
  private sample(name: string, value: number) {
    const day = this.today();
    const list = this.waitSamples.get(day) ?? [];
    if (list.length < 500) list.push(value);
    this.waitSamples.set(day, list);
    this.count(name + ".n");
    this.count(name + ".totalMs", Math.round(value));
  }
  private loadDay(day: number): Counters {
    const row = this.deps.sql.exec<{ data: string }>("SELECT data FROM metrics WHERE day = ?", day).toArray()[0];
    try {
      return row ? (JSON.parse(row.data) as Counters) : {};
    } catch {
      return {};
    }
  }
  private markDirty() {
    this.dirty = true;
    const at = this.deps.now() + HUB_LIMITS.metricsFlushMs;
    if (this.flushAt === null) {
      this.flushAt = at;
      this.deps.setAlarm?.(at);
    }
  }
  /** Persist counters (one row per day, at most every 10 minutes). */
  flush() {
    this.flushAt = null;
    if (!this.dirty) return;
    for (const [day, m] of this.metrics) this.deps.sql.exec("INSERT INTO metrics (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data", day, JSON.stringify(m));
    const keep = this.today() - 1;
    for (const day of [...this.metrics.keys()]) if (day < keep) this.metrics.delete(day);
    this.deps.sql.exec("DELETE FROM metrics WHERE day < ?", this.today() - 120);
    this.dirty = false;
  }
  /** Operations view for the administrator (never public). */
  report(days = 14) {
    this.flush();
    const from = this.today() - days + 1;
    const rows = this.deps.sql.exec<{ day: number; data: string }>("SELECT day, data FROM metrics WHERE day >= ? ORDER BY day", from).toArray();
    const waits = this.waitSamples.get(this.today()) ?? [];
    const sorted = [...waits].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
    return {
      days: rows.map((r) => ({ day: new Date(r.day * 86_400_000).toISOString().slice(0, 10), ...(JSON.parse(r.data) as Counters) })),
      now: { waiting: this.waiting(), publicRooms: this.publicList.size, activeRandom: this.active.size, waitMsToday: { n: sorted.length, p50: q(0.5), p90: q(0.9) } },
    };
  }
}
