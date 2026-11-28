import { DatabaseSync } from "node:sqlite";
import { AccountStore, type Sql } from "../../worker/src/account";
import { EconomyStore, type EconSql } from "../../worker/src/economy";
import { MemberOps, type MemberSql } from "../../worker/src/admin/member";
import { AdminCore, type InboxItem } from "../../worker/src/admin/store";
import { APPROVED_SOURCES, RewardGrants, type GrantSource } from "../../worker/src/grants";
import { claimAdminItem, deliverAdminItem, redeemAdminItem, revokeAdminItem, type AdminGrantContext } from "../../worker/src/admin/grant-port";
import { BoardCore } from "../../worker/src/feedback/board";
import { adminSettings } from "../../worker/src/admin/roles";
import { handleAdminRoute, type AdminBackends, type AdminUserApi } from "../../worker/src/admin/api";
import { sha256 } from "../../worker/src/oidc";
import type { SessionUser } from "../../worker/src/accounts-api";

/** node:sqlite with a re-entrant transaction (same contract as the Durable Object shells). */
export function sqlite(): EconSql & Sql & MemberSql {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  return {
    exec<T>(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*(select|pragma|with)/i.test(query) ? (stmt.all(...(params as never[])) as T[]) : (stmt.run(...(params as never[])), [] as T[]);
      return { toArray: () => rows };
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth++;
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

/**
 * C5 grant sources for the admin mechanics tests: production approves only the automatic retention sources
 * (APPROVED_SOURCES), so admin rewards, adopted-suggestion rewards and redeem codes are refused there. The
 * mechanics tests simulate a future owner approval of the three admin sources; `PRODUCTION_SOURCES` checks
 * the real gate (tests/int1-admin-grants.test.ts).
 */
export const ADMIN_TEST_SOURCES: ReadonlySet<GrantSource> = new Set([...APPROVED_SOURCES, "operator", "suggestion", "redeem-code"]);
export const PRODUCTION_SOURCES = APPROVED_SOURCES;

/** One in-memory account (the parts of UserStore the admin routes use, over the real stores). */
export class FakeAccount implements AdminUserApi {
  sql = sqlite();
  store = new AccountStore(this.sql);
  econ = new EconomyStore(this.sql);
  member = new MemberOps(this.sql);
  grants: RewardGrants;
  failDeliveries = 0;
  constructor(readonly userId: string, nickname: string | null, readonly clock: () => number, sources: ReadonlySet<GrantSource> = ADMIN_TEST_SOURCES) {
    this.store.init();
    this.econ.init();
    this.member.init();
    this.grants = new RewardGrants(this.sql, this.econ, { enabled: sources });
    this.grants.init();
    this.store.ensureUser(userId, "google", clock());
    if (nickname) this.store.setNickname(nickname, clock());
  }
  async me() {
    return this.store.profile();
  }
  async adminView() {
    return { account: this.store.adminSummary(), ledger: this.econ.verify(), standing: this.member.standing(this.clock()), inbox: this.member.inbox(this.clock()) };
  }
  async adminRecord(id: string) {
    return this.store.adminRecord(id);
  }
  /** Same delivery paths as UserStore (worker/src/admin/grant-port.ts): C5 RewardGrants is the only crediting path. */
  ctx(): AdminGrantContext {
    return { userId: this.userId, grants: this.grants, member: this.member, transaction: (fn) => this.sql.transaction(fn) };
  }
  async deliver(item: InboxItem) {
    if (this.failDeliveries > 0) {
      this.failDeliveries--;
      throw new Error("transient");
    }
    if (item.coins > 0 || item.gems > 0) this.econ.welcome(this.userId, this.clock(), null);
    return deliverAdminItem(this.ctx(), item, this.clock());
  }
  async revokeItem(id: string) {
    return revokeAdminItem(this.ctx(), id, "admin:console", this.clock());
  }
  async applySanction(s: { id: string; kind: string; reason: string; until: number | null }) {
    if (this.member.applySanction(s as never, this.clock()) && s.kind === "nickname_reset") this.store.resetNickname(this.clock());
    return "ok" as const;
  }
  async liftSanction(id: string) {
    return this.member.liftSanction(id, this.clock());
  }
  async inbox() {
    return { items: this.member.inbox(this.clock()), unclaimed: this.grants.inbox(this.clock()).length };
  }
  async mySanctions() {
    return this.member.sanctions();
  }
  async claim(id: string) {
    return claimAdminItem(this.ctx(), id, this.clock());
  }
  async redeemGrant(item: InboxItem) {
    this.econ.welcome(this.userId, this.clock(), null);
    return redeemAdminItem(this.ctx(), item, this.clock());
  }
}

export const uid = (c: string) => "u_" + c.repeat(22).slice(0, 22);

export function world(env: { ADMIN_ACCOUNTS?: string; ADMIN_WRITES?: string; ADMIN_APPROVAL?: string; ADMIN_REWARD_POLICY?: string; ADMIN_REAUTH?: string; APP_URL?: string; GRANT_SOURCES?: "production" | "admin-test" } = {}) {
  let now = Date.UTC(2026, 10, 28, 12);
  const clock = () => now;
  const admin = new AdminCore(sqlite());
  admin.init();
  const board = new BoardCore(sqlite());
  board.init();
  const accounts = new Map<string, FakeAccount>();
  const sessions = new Map<string, SessionUser>();
  const counts: Record<string, number> = {};
  const account = (userId: string, nickname: string | null = "닉" + userId.slice(2, 5)) => {
    const a = new FakeAccount(userId, nickname, clock, env.GRANT_SOURCES === "production" ? PRODUCTION_SOURCES : ADMIN_TEST_SOURCES);
    accounts.set(userId, a);
    const token = "s1." + userId + "." + "x".repeat(43);
    sessions.set(token, { userId, secret: "x", suspended: false, restricted: false, until: null });
    return { account: a, session: token };
  };
  const call = <T>(target: object, name: string, args: unknown[]) => Promise.resolve((target as Record<string, (...a: unknown[]) => T>)[name](...structuredClone(args)));
  const backends = (): AdminBackends => ({
    settings: adminSettings(env),
    admin: { op: (n, ...a) => call(admin, n, a) as never, schedule: async () => undefined },
    board: { op: (n, ...a) => call(board, n, a) as never },
    user: (id) => accounts.get(id) ?? ({ me: async () => null, deliver: async () => "absent", applySanction: async () => "absent" } as AdminUserApi),
    sessionUser: async (r) => {
      const t = (r.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const s = sessions.get(t);
      if (!s) return null;
      const st = accounts.get(s.userId)!.member.standing(now);
      return { ...s, suspended: st.suspended, restricted: st.restricted, until: st.suspendedUntil ?? st.restrictedUntil };
    },
    hubReport: async () => ({ days: [{ day: "2026-11-28", "queue.join": 10, "match.random": 4, "finished.random.completed": 3, "finished.random.forfeit": 1, "duration.random.totalSec": 1800 }], now: { waiting: 1 } }),
    usage: async () => ({ roomsToday: 3 }),
    liveActivity: async () => ({ waiting: 1 }),
    flags: { economy: true },
    limited: async () => false,
    count: async (k, n = 1) => void (counts[k] = (counts[k] ?? 0) + n),
    client: "c",
    now: clock,
    feedback: true,
    economy: true,
  });
  /**
   * Admin sign-in as production does it: the Google re-authentication callback (simulated here by the
   * ticket it would create, with auth_time = now) → POST /api/admin/session { reauth, clientState }.
   */
  const adminLogin = async (session: string, opts: { authTime?: number; tamper?: "user" | "state" } = {}) => {
    const userId = sessions.get(session)?.userId ?? uid("Z");
    const cs = "client-state-" + Math.random().toString(36).slice(2).padEnd(24, "x");
    const ticket = await admin.createReauth(opts.tamper === "user" ? uid("Q") : userId, await sha256(cs), opts.authTime ?? now, now);
    const r = await handleAdminRoute(req("/api/admin/session", session, { reauth: ticket, clientState: opts.tamper === "state" ? cs + "x" : cs }), new URL("https://w.example/api/admin/session"), backends(), reply);
    const body = (await r.json()) as Record<string, any>;
    return { status: r.status, body, token: body.token as string | undefined };
  };
  return { admin, board, accounts, account, backends, counts, advance: (ms: number) => void (now += ms), clock, adminLogin };
}

export const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export function req(path: string, token: string | null, body?: unknown) {
  return new Request("https://w.example" + path, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { authorization: "Bearer " + token } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
