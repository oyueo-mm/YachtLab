import type { MatchKind } from "../../src/economy/live/config";
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
  maxWaiters: 200,
  maxPublic: 50,
  metricsFlushMs: 10 * 60_000,
} as const;

export type QueueSeat = { name: string; userId: string | null; key: string };
type Assignment = { id: string; seats: [Waiter, Waiter]; secrets: [string, string]; at: number };
export type MatchResult = { ok: true; code: string; seats: [{ playerId: string; token: string }, { playerId: string; token: string }] } | { ok: false; message: string };
export type PublicEntry = {
  /** Spectate id (PR118-01). `code` repeats it for older pages; neither is the room (= invite) code. */
  id?: string;
  code: string;
  kind?: "random" | "friend";
  status?: "playing";
  participants?: number;
  rounds?: number;
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
  v?: number;
};
export type HubSql = { exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] } };
export type HubDeps = {
  now(): number;
  sockets(): HostSocket[];
  sql: HubSql;
  /** Session bearer → account id, or null (guests play too). */
  auth(session: string): Promise<string | null>;
  /** Create and start a two-player room (first seat moves first). */
  createMatch(a: QueueSeat, b: QueueSeat, options: { public: boolean; assignmentId: string; secrets: [string, string] }): Promise<MatchResult>;
  setAlarm?(at: number): void;
  transaction?(run: () => void): void;
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
  private pairing = new Map<string, { waiter: Waiter; socket: HostSocket; check?: { id: string; received?: boolean; resolve: (ready: boolean) => void } }>();
  private detached = new Map<string, Waiter>();
  private recovering = new Map<string, Promise<MatchResult>>();
  private rooms = new Map<string, { kind: MatchKind; status: string; spectators: number; public: boolean }>();
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
    this.deps.sql.exec("CREATE TABLE IF NOT EXISTS assignments (identity TEXT PRIMARY KEY, code TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.deps.sql.exec("CREATE INDEX IF NOT EXISTS assignments_code ON assignments (code)");
    this.deps.sql.exec("CREATE TABLE IF NOT EXISTS match_creation (id TEXT PRIMARY KEY, first_ticket TEXT NOT NULL, second_ticket TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.deps.sql.exec("CREATE INDEX IF NOT EXISTS match_creation_first ON match_creation (first_ticket)");
    this.deps.sql.exec("CREATE INDEX IF NOT EXISTS match_creation_second ON match_creation (second_ticket)");
    this.deps.sql.exec("CREATE TABLE IF NOT EXISTS result_owners (ticket TEXT PRIMARY KEY, owner TEXT NOT NULL, code TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.deps.sql.exec("CREATE INDEX IF NOT EXISTS result_owners_code ON result_owners (code)");
    this.deps.sql.exec("CREATE TABLE IF NOT EXISTS yacht_events (id TEXT PRIMARY KEY, day INTEGER NOT NULL)");
    this.deps.sql.exec("CREATE INDEX IF NOT EXISTS yacht_events_day ON yacht_events (day)");
    this.deps.sql.exec("CREATE TABLE IF NOT EXISTS completed_matches (id TEXT PRIMARY KEY, day INTEGER NOT NULL)");
    this.deps.sql.exec("CREATE INDEX IF NOT EXISTS completed_matches_day ON completed_matches (day)");
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
    const now = this.deps.now();
    return this.open().filter((s) => {
      const w = this.att(s);
      return w?.state === "waiting" && now - w.aliveAt <= HUB_LIMITS.aliveTimeoutMs && now - w.since <= HUB_LIMITS.waitMs;
    }).length;
  }

  closed(ws: HostSocket) {
    if (this.gone.has(ws)) return;
    const w = this.att(ws);
    this.gone.add(ws);
    if (w?.state === "waiting") {
      this.detached.set(w.ticket, w);
      this.sweep(this.deps.now());
      this.count("queue.leave");
    }
    if (w && this.pairing.get(w.ticket)?.socket === ws) this.pairing.get(w.ticket)?.check?.resolve(false);
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
      if (me?.state === "pairing" && !this.pairing.has(me.ticket)) {
        const creation = this.creation(me.ticket);
        if (creation) return this.recover(ws, me.ticket, creation);
        ws.serializeAttachment({ ...me, state: "waiting", aliveAt: now });
      } else if (me) ws.serializeAttachment({ ...me, aliveAt: now });
      // Re-try pairing: waiters held back by the repeat-pair rule become compatible after 20 s.
      return this.pairAll();
    }
    if (msg.t === "ready" && me) {
      const pending = this.pairing.get(me.ticket);
      const check = pending?.check;
      if (pending?.socket !== ws || !check || check.id !== msg.id || check.received) return;
      check.received = true;
      if (me.userId) {
        const user = typeof msg.session === "string" ? await this.deps.auth(msg.session).catch(() => null) : null;
        if (this.gone.has(ws) || pending.check !== check) return;
        if (user !== me.userId) {
          check.resolve(false);
          return this.reject(ws, "SESSION_EXPIRED", "로그인이 만료됐어요. 로그인 상태를 확인해 주세요.");
        }
      }
      check.resolve(true);
      return;
    }
    const cancel = msg.t === "cancel";
    if (cancel && me) {
      const pending = this.pairing.get(me.ticket);
      if (!pending) {
        const creation = this.creation(me.ticket);
        return creation ? this.recover(ws, me.ticket, creation) : this.cancelled(ws);
      }
      if (pending.check) {
        pending.check.resolve(false);
        return this.cancelled(ws);
      }
      return this.send(ws, { t: "pairing" });
    }
    if (cancel && msg.v !== 2) return this.close(ws, 1000, "cancelled");
    if ((!cancel && msg.t !== "queue") || me) return;
    const nick = validateNickname(msg.name);
    if (!cancel && !nick.ok) return this.reject(ws, "NAME", nick.message);
    if (typeof msg.ticket !== "string" || !TICKET.test(msg.ticket)) return this.reject(ws, "INVALID", "매칭 정보가 올바르지 않아요.");
    const device = typeof msg.device === "string" && TICKET.test(msg.device) ? await hash("device:" + msg.device) : null;
    const ticket = await hash("ticket:" + msg.ticket);
    let userId: string | null = null;
    if (typeof msg.session === "string" && SESSION.test(msg.session)) userId = await this.deps.auth(msg.session).catch(() => null);
    if (this.gone.has(ws) || this.att(ws)) return;
    if (msg.v === 2 && msg.session !== undefined && !userId) return this.reject(ws, "SESSION_EXPIRED", "로그인이 만료됐어요. 로그인 상태를 확인해 주세요.");
    const t = this.deps.now();
    const owner = userId ?? "";
    if (this.sendReceipt(ws, ticket, owner)) return;
    const creation = this.creation(ticket);
    if (creation && !this.pairing.has(ticket)) {
      if ((creation.seats.find((seat) => seat.ticket === ticket)?.userId ?? "") !== owner) return this.reject(ws, "INVALID", "매칭 정보가 올바르지 않아요.");
      return this.recover(ws, ticket, creation);
    }
    const pending = this.pairing.get(ticket);
    if (pending) {
      if ((pending.waiter.userId ?? "") !== owner) return this.reject(ws, "INVALID", "매칭 정보가 올바르지 않아요.");
      if (cancel && pending.check) {
        pending.check.resolve(false);
        this.cancelled(pending.socket);
        return this.cancelled(ws);
      }
      return this.reject(ws, "PAIRING", "매칭을 마무리하는 중이에요. 잠시 후 다시 시도해 주세요.");
    }
    if (cancel) {
      if (this.detached.get(ticket)?.userId === userId) this.detached.delete(ticket);
      for (const other of this.open()) {
        const queued = this.att(other);
        if (queued?.ticket === ticket && queued.userId === userId) this.cancelled(other);
      }
      return this.cancelled(ws);
    }
    if (!nick.ok) return;
    const w: Waiter = { kind: "waiter", ticket, name: nick.name, userId, device, spectate: msg.spectate === true, since: t, aliveAt: t, state: "waiting", v: msg.v === 2 ? 2 : 1 };
    for (const key of this.keys(w)) {
      const busy = this.deps.sql.exec<{ code: string }>("SELECT code FROM assignments WHERE identity = ? AND expires > ?", key, t).toArray()[0];
      if (busy?.code.startsWith("pending:")) return this.reject(ws, "PAIRING", "매칭을 마무리하는 중이에요.");
      if (busy) return this.reject(ws, "IN_MATCH", "이미 진행 중인 무작위 대전이 있어요.", { room: busy.code });
    }
    for (const pending of this.pairing.values()) {
      if (this.overlaps(w, pending.waiter)) return this.reject(ws, "DUPLICATE", "다른 화면에서 이미 매칭을 기다리고 있어요.");
    }
    this.sweep(t);
    const detached = this.detached.get(ticket);
    if (detached?.userId === userId) w.since = detached.since;
    for (const previous of this.detached.values()) {
      if (previous.ticket !== ticket && this.overlaps(w, previous) && (w.v === 2 || previous.v === 2)) {
        return this.reject(ws, "DUPLICATE", "다른 화면에서 이미 매칭을 기다리고 있어요.");
      }
    }
    for (const s of this.open()) {
      if (s === ws) continue;
      const o = this.att(s);
      if (!o) continue;
      if (o.ticket === ticket && o.userId === userId) {
        w.since = o.since;
        this.close(s, 4010, "replaced");
      } else if (this.overlaps(w, o) && (w.v === 2 || o.v === 2 || (userId && o.userId === userId))) {
        return this.reject(ws, "DUPLICATE", "다른 화면에서 이미 매칭을 기다리고 있어요.");
      }
    }
    if (this.waiting() >= HUB_LIMITS.maxWaiters) return this.reject(ws, "BUSY", "지금은 대기 인원이 많아요. 잠시 후 다시 시도해 주세요.");
    this.detached.delete(ticket);
    ws.serializeAttachment(w);
    this.count("queue.join");
    this.send(ws, { t: "queued", since: w.since, waiting: this.waiting() });
    await this.pairAll();
  }

  private keys(w: Waiter): string[] {
    return [
      ...(w.userId ? ["u:" + w.userId] : []),
      ...(w.device ? ["d:" + w.device] : []),
      "t:" + w.ticket,
    ];
  }

  private overlaps(a: Waiter, b: Waiter) {
    return a.ticket === b.ticket || !!(a.userId && a.userId === b.userId) || !!(a.device && a.device === b.device);
  }

  private cancelled(ws: HostSocket) {
    this.count("queue.cancel");
    this.send(ws, { t: "cancelled" });
    this.close(ws, 1000, "cancelled");
  }

  private reject(ws: HostSocket, code: string, message: string, extra: Record<string, unknown> = {}) {
    this.send(ws, { t: "error", code, message, ...extra });
    this.close(ws, 4011, code.toLowerCase());
  }

  /** Drop ghosts and expired waiters. */
  private sweep(now: number) {
    for (const [ticket, w] of this.detached) {
      if (now - w.aliveAt > HUB_LIMITS.aliveTimeoutMs || now - w.since > HUB_LIMITS.waitMs) this.detached.delete(ticket);
    }
    if (this.detached.size > HUB_LIMITS.maxWaiters) this.detached.delete(this.detached.keys().next().value!);
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
    if (this.overlaps(a, b)) return false;
    for (const other of this.pairing.values()) if (this.overlaps(a, other.waiter) || this.overlaps(b, other.waiter)) return false;
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
      const contenders = this.open()
        .map((s) => ({ s, w: this.att(s)! }))
        .filter((x) => x.w?.state === "waiting");
      if (contenders.length < 2) return;
      const locked = new Set(this.deps.sql.exec<{ identity: string }>("SELECT identity FROM assignments WHERE expires > ?", now).toArray().map((row) => row.identity));
      const waiting = contenders
        .filter(({ w }) => !this.keys(w).some((key) => locked.has(key)))
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
      for (const x of chosen) {
        x.s.serializeAttachment({ ...x.w, state: "pairing" } satisfies Waiter);
        this.pairing.set(x.w.ticket, { waiter: x.w, socket: x.s });
      }
      try {
        await this.pair(chosen[0], chosen[1]);
      } finally {
        for (const x of chosen) this.pairing.delete(x.w.ticket);
      }
    }
  }

  private async pair(a: { s: HostSocket; w: Waiter }, b: { s: HostSocket; w: Waiter }) {
    if (a.w.v === 2 || b.w.v === 2) {
      const id = crypto.randomUUID();
      const both = [a, b];
      const checks = both.map(({ s, w }) => {
        if (w.v !== 2) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 4_000);
          this.pairing.get(w.ticket)!.check = { id, resolve: (ready) => { clearTimeout(timer); resolve(ready); } };
          this.send(s, { t: "check", id });
        });
      });
      const ready = await Promise.all(checks);
      for (const x of both) delete this.pairing.get(x.w.ticket)!.check;
      const live = this.open();
      if (!both.every((x, i) => ready[i] && live.includes(x.s))) {
        both.forEach((x, i) => {
          if (!live.includes(x.s)) return;
          if (!ready[i]) return this.close(x.s, 4012, "check timeout");
          x.s.serializeAttachment(x.w);
          this.send(x.s, { t: "queued", since: x.w.since, waiting: this.waiting() });
        });
        return;
      }
      for (const x of both) if (x.w.v === 2) this.send(x.s, { t: "pairing" });
    }
    const now = this.deps.now();
    // The persisted attempt fixes both the seat order and credentials before allocating a room.
    const flip = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 1;
    const pair = flip ? [b, a] : [a, b];
    const assignment: Assignment = {
      id: crypto.randomUUID(), seats: [pair[0].w, pair[1].w], secrets: [crypto.randomUUID(), crypto.randomUUID()], at: now,
    };
    const expiry = now + HUB_LIMITS.resultTtlMs;
    this.atomic(() => {
      this.deps.sql.exec("DELETE FROM match_creation WHERE expires <= ?", now);
      this.deps.sql.exec("DELETE FROM assignments WHERE expires <= ?", now);
      this.deps.sql.exec("INSERT INTO match_creation (id, first_ticket, second_ticket, data, expires) VALUES (?, ?, ?, ?, ?)",
        assignment.id, assignment.seats[0].ticket, assignment.seats[1].ticket, JSON.stringify(assignment), expiry);
      for (const w of assignment.seats) for (const key of this.keys(w)) {
        this.deps.sql.exec("INSERT INTO assignments (identity, code, expires) VALUES (?, ?, ?)", key, "pending:" + assignment.id, expiry);
      }
    });
    let result: MatchResult;
    try {
      result = await this.complete(assignment);
    } catch {
      // The room may already have committed. Force transport retry with the same ticket.
      for (const { s } of pair) this.close(s, 1012, "assignment pending");
      return;
    }
    for (const { s, w } of pair) {
      if (!result.ok) this.reject(s, "UNAVAILABLE", result.message);
      else this.sendReceipt(s, w.ticket, w.userId ?? "");
    }
  }

  private atomic(run: () => void) {
    if (this.deps.transaction) this.deps.transaction(run);
    else run();
  }

  private creation(ticket: string): Assignment | null {
    const row = this.deps.sql.exec<{ data: string }>("SELECT data FROM match_creation WHERE (first_ticket = ? OR second_ticket = ?) AND expires > ?",
      ticket, ticket, this.deps.now()).toArray()[0];
    return row ? JSON.parse(row.data) as Assignment : null;
  }

  private sendReceipt(ws: HostSocket, ticket: string, owner: string) {
    const stored = this.deps.sql.exec<{ data: string }>("SELECT results.data FROM results LEFT JOIN result_owners USING(ticket) WHERE ticket = ? AND results.expires > ? AND (owner = ? OR owner IS NULL)",
      ticket, this.deps.now(), owner).toArray()[0];
    if (!stored) return false;
    this.send(ws, { t: "matched", ...JSON.parse(stored.data) });
    this.close(ws, 1000, "matched");
    return true;
  }

  private async recover(ws: HostSocket, ticket: string, assignment: Assignment) {
    let recovery = this.recovering.get(assignment.id);
    if (!recovery) {
      recovery = this.complete(assignment);
      this.recovering.set(assignment.id, recovery);
    }
    try {
      const result = await recovery;
      if (!result.ok) return this.reject(ws, "UNAVAILABLE", result.message);
      const w = assignment.seats.find((seat) => seat.ticket === ticket);
      this.sendReceipt(ws, ticket, w?.userId ?? "");
    } catch {
      this.close(ws, 1012, "assignment pending");
    } finally {
      this.recovering.delete(assignment.id);
    }
  }

  private async complete(assignment: Assignment): Promise<MatchResult> {
    const pair = assignment.seats;
    const seats = pair.map((w) => ({ name: w.name, userId: w.userId, key: this.identity(w) }));
    // D-045: quick matches are always public, including for older clients.
    const result = await this.deps.createMatch(seats[0], seats[1], { public: true, assignmentId: assignment.id, secrets: assignment.secrets });
    const now = this.deps.now();
    this.atomic(() => {
      this.deps.sql.exec("DELETE FROM match_creation WHERE id = ?", assignment.id);
      if (!result.ok) {
        this.deps.sql.exec("DELETE FROM assignments WHERE code = ?", "pending:" + assignment.id);
        return;
      }
      this.deps.sql.exec("DELETE FROM results WHERE expires <= ?", now);
      this.deps.sql.exec("DELETE FROM result_owners WHERE expires <= ?", now);
      for (const [i, w] of pair.entries()) {
        const expiry = now + HUB_LIMITS.resultTtlMs;
        const receipt = { code: result.code, playerId: result.seats[i].playerId, token: result.seats[i].token, name: w.name, opponent: pair[1 - i].name, public: true };
        this.deps.sql.exec("INSERT OR REPLACE INTO results (ticket, data, expires) VALUES (?, ?, ?)", w.ticket, JSON.stringify(receipt), expiry);
        this.deps.sql.exec("INSERT OR REPLACE INTO result_owners (ticket, owner, code, expires) VALUES (?, ?, ?, ?)", w.ticket, w.userId ?? "", result.code, expiry);
        for (const key of this.keys(w)) {
          this.deps.sql.exec("INSERT OR REPLACE INTO assignments (identity, code, expires) VALUES (?, ?, ?)", key, result.code, now + 48 * 3600_000);
        }
      }
    });
    if (!result.ok) {
      this.count("match.fail");
      return result;
    }
    for (const w of pair) this.sample("wait", now - w.since);
    this.recent.set(pair.map((w) => this.identity(w)).sort().join("|"), assignment.at);
    if (this.recent.size > 2000) for (const [k, v] of this.recent) if (now - v > HUB_LIMITS.rePairAfterMs) this.recent.delete(k);
    this.count("match.random");
    this.count("match.public");
    if (pair.every((w) => w.userId)) this.count("match.members");
    return result;
  }

  /** A random match ended (or its room closed): both players may queue again. */
  ended(code: string) {
    this.deps.sql.exec("DELETE FROM assignments WHERE code = ?", code);
    this.deps.sql.exec("DELETE FROM results WHERE ticket IN (SELECT ticket FROM result_owners WHERE code = ?)", code);
    this.deps.sql.exec("DELETE FROM result_owners WHERE code = ?", code);
    this.publicList.delete(code);
  }

  /* --------------------------------------------------------- public spectating --------------------------------------------------------- */

  /**
   * `room` is the room code, used only as the internal key (unpublish, ended); the listed id is the
   * entry's spectate id. Without `room` (older callers) the entry's own code is the key.
   */
  publish(raw: unknown, room?: string) {
    const e = raw as PublicEntry;
    if (!e || typeof e.code !== "string" || !Array.isArray(e.players) || e.players.length < 2 || e.players.length > 20) return;
    const id = typeof e.id === "string" ? e.id : e.code;
    const key = room ?? e.code;
    if (!this.publicList.has(key) && this.publicList.size >= HUB_LIMITS.maxPublic) return;
    const players = e.players.map((p) => ({ name: String(p.name).slice(0, 40), score: Number(p.score) | 0, look: sanitizeLook(p.look) }));
    this.publicList.set(key, { id, code: id, players, kind: e.kind === "friend" ? "friend" : "random", status: "playing", participants: players.length, rounds: 12, round: Math.max(1, Math.min(12, Number(e.round) | 0)), spectators: Number(e.spectators) | 0, max: Number(e.max) | 0, at: this.deps.now() });
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

  observeRoom(code: string, info: { kind: MatchKind; status: string; spectators: number; public: boolean } | null) {
    if (info) this.rooms.set(code, info);
    else this.rooms.delete(code);
  }

  completed(matchId: string, at: number) {
    if (Math.floor(at / 86_400_000) !== this.today()) return;
    this.deps.sql.exec("INSERT OR IGNORE INTO completed_matches (id, day) VALUES (?, ?)", matchId, this.today());
  }

  yachts(matchId: string, events: { seq: number; at: number }[]) {
    const day = this.today();
    this.atomic(() => {
      for (const { seq, at } of events) {
        if (Math.floor(at / 86_400_000) === day) this.deps.sql.exec("INSERT OR IGNORE INTO yacht_events (id, day) VALUES (?, ?)", matchId + ":" + seq, day);
      }
    });
    this.markDirty();
  }

  activity(liveCodes: string[]) {
    const complete = liveCodes.every((code) => this.rooms.has(code));
    const playing = { random: 0, friend: 0, ai: 0 };
    let spectators = 0;
    let privatePlaying = 0;
    for (const code of liveCodes) {
      const room = this.rooms.get(code);
      if (!room) continue;
      if (room.status === "playing") {
        playing[room.kind]++;
        if (!room.public) privatePlaying++;
      }
      spectators += room.spectators;
    }
    const yachtsToday = this.deps.sql.exec<{ n: number }>("SELECT count(*) AS n FROM yacht_events WHERE day = ?", this.today()).toArray()[0]?.n;
    const completedToday = this.deps.sql.exec<{ n: number }>("SELECT count(*) AS n FROM completed_matches WHERE day = ?", this.today()).toArray()[0]?.n;
    return {
      asOf: this.deps.now(), timezone: "UTC", waiting: this.waiting(), activeUsers: null, yachtsToday: yachtsToday ?? 0,
      playing: complete ? playing : null, spectators: complete ? spectators : null,
      privatePlaying: complete ? privatePlaying : null, completedToday: completedToday ?? 0,
    };
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
    this.deps.sql.exec("DELETE FROM match_creation WHERE expires <= ?", this.deps.now());
    this.deps.sql.exec("DELETE FROM yacht_events WHERE day < ?", this.today() - 1);
    this.deps.sql.exec("DELETE FROM completed_matches WHERE day < ?", this.today() - 1);
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
      now: { waiting: this.waiting(), publicRooms: this.publicList.size, activeRandom: this.deps.sql.exec<{ n: number }>("SELECT count(DISTINCT code) AS n FROM assignments WHERE expires > ? AND code NOT LIKE 'pending:%'", this.deps.now()).toArray()[0]?.n ?? 0, waitMsToday: { n: sorted.length, p50: q(0.5), p90: q(0.9) } },
    };
  }
}
