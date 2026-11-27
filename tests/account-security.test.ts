import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ABSENT_ACCOUNT, FRIEND_LIMITS, FriendIndexStore, FriendStore, Presence, type FriendSql } from "../worker/src/friends";
import { handleFriendRoute, sendInvites, type FriendDeps, type FriendUser, type ResidueMode } from "../worker/src/friends-api";
import { CLEANUP_MAX_ATTEMPTS, CleanupQueue, INDEX_TARGET, runCleanup, type CleanupJob } from "../worker/src/account-cleanup";
import { AccountStore, SESSION_CAP, SESSION_TTL_MS, type Sql } from "../worker/src/account";
import { sha256 } from "../worker/src/oidc";

/**
 * C4.2 account security (SEC-03 / B-10, SEC-04 / B-11) over real SQLite (node:sqlite, the same SQL as the
 * Durable Objects). The audit repro (docs/audits/c4-2026-11-28/repro/friend-deletion-residue.repro.mts)
 * R1–R3 are ported here as regression tests that must now FAIL to reproduce.
 *
 * `deleteAccount` below mirrors UserStore.deleteAccount (worker/src/index.ts): plan → wipe + queue in one
 * step → cleanup calls through the same FriendUser RPC surface, with the same "absent account" answers.
 */
function sql(): FriendSql & Sql {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (q: string, ...p: unknown[]) => {
      const st = db.prepare(q);
      const rows = /^\s*(SELECT|WITH)/i.test(q) ? (st.all(...(p as never[])) as never[]) : (st.run(...(p as never[])), [] as never[]);
      return { toArray: () => rows };
    },
    transaction: <T>(fn: () => T) => {
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as FriendSql & Sql;
}

type Account = { exists: boolean; store: FriendStore; db: FriendSql; queue: CleanupQueue; presence: Presence; nickname: string };

function world(residue: ResidueMode = "off") {
  const clock = { t: Date.UTC(2026, 10, 28, 3) };
  const index = new FriendIndexStore(sql());
  index.init();
  const accounts = new Map<string, Account>();
  const metrics: Record<string, number> = {};
  /** Called before every friend RPC (account, op): used to interleave a deletion at any step. */
  let hook: ((id: string, op: string) => Promise<void>) | null = null;
  /** Cleanup calls to these targets fail (simulated object / network failure). */
  const failing = new Set<string>();
  const fresh = (): Pick<Account, "store" | "db"> => {
    const db = sql();
    const store = new FriendStore(db);
    store.init();
    return { store, db };
  };
  const add = (id: string, nickname: string) => {
    const q = new CleanupQueue(sql());
    q.init();
    accounts.set(id, { exists: true, ...fresh(), queue: q, presence: new Presence(), nickname });
  };
  const user = (id: string): FriendUser => ({
    fr: async (op: string, ...args: unknown[]) => {
      if (hook) await hook(id, op);
      const a = accounts.get(id);
      if (!a || !a.exists) return ABSENT_ACCOUNT[op] as never;
      return (a.store as unknown as Record<string, (...x: unknown[]) => unknown>)[op](...args) as never;
    },
    nickname: async () => accounts.get(id)?.nickname ?? null,
    presence: async (viewer?: string) => {
      const a = accounts.get(id);
      if (!a || !a.exists || (viewer !== undefined && !a.store.isFriend(viewer))) return "offline";
      return a.presence.status(clock.t);
    },
    ping: async () => accounts.get(id)?.presence.ping(clock.t),
    publicProfile: async () => null,
  });
  const deps: FriendDeps = {
    user,
    index: {
      register: async (id, n, avoid) => index.register(id, n, avoid),
      lookup: async (c) => index.lookup(c),
      search: async (n) => index.search(n),
      live: async (pairs) => index.live(pairs),
    },
    limited: async () => false,
    now: () => clock.t,
    residue,
    metric: async (k, n) => void (metrics[k] = (metrics[k] ?? 0) + n),
  };
  const call = async (as: string, method: "GET" | "POST", path: string, body?: Record<string, unknown>) => {
    const url = new URL("http://x" + path);
    const res = await handleFriendRoute(new Request(url, { method }), url, { userId: as }, deps, (status, b) => new Response(JSON.stringify(b), { status }), async () => body ?? {});
    return { status: res!.status, body: (await res!.json()) as Record<string, any> };
  };
  const codeOf = async (id: string) => (await call(id, "GET", "/api/me/friends")).body.me.code as string;
  const lists = (id: string) => accounts.get(id)!.store.lists();
  const send = async (job: CleanupJob, owner: string) => {
    if (failing.has(job.target)) throw Error("unreachable");
    if (job.target === INDEX_TARGET) index.removeCode(owner, job.code);
    else await user(job.target).fr("forget", owner, job.code);
  };
  /** UserStore.deleteAccount: plan, wipe + queue (one step), then the cleanup calls. */
  const deleteAccount = async (id: string) => {
    const a = accounts.get(id)!;
    const plan = a.exists ? a.store.deletionPlan() : { code: null, peers: [] };
    const owner = a.exists ? id : null;
    Object.assign(a, fresh(), { exists: false, presence: new Presence() });
    if (plan.code) a.db.exec("INSERT OR IGNORE INTO fr_retired (code, at) VALUES (?, ?)", plan.code, clock.t);
    if (owner && (plan.code || plan.peers.length)) a.queue.enqueue(owner, [INDEX_TARGET, ...plan.peers], plan.code, clock.t);
    return runCleanup(a.queue, send, () => clock.t);
  };
  /** The alarm retry. */
  const retry = (id: string) => runCleanup(accounts.get(id)!.queue, send, () => clock.t);
  /** main before C4.2 (the audit repro): blockedBy to friends only, index entry dropped, store wiped. */
  const legacyDelete = async (id: string) => {
    const a = accounts.get(id)!;
    for (const fid of a.store.friendIds()) await user(fid).fr("blockedBy", id);
    index.remove(id);
    Object.assign(a, fresh(), { exists: false });
  };
  /** Same Google account signs in again: same internal id (userIdFor), new empty account. */
  const rejoin = (id: string, nickname?: string) => {
    const a = accounts.get(id)!;
    a.exists = true;
    if (nickname) a.nickname = nickname;
  };
  return {
    clock, index, accounts, metrics, add, user, deps, call, codeOf, lists, deleteAccount, retry, legacyDelete, rejoin, failing,
    setHook: (h: typeof hook) => void (hook = h),
  };
}

describe("C4 재현 R1~R3 회귀 (이제 재현되지 않아야 함)", () => {
  it("R1: 탈퇴한 사용자가 보낸 대기 요청은 상대의 받은 요청에서 사라진다(닉네임·코드·내부 ID 잔존 없음)", async () => {
    const w = world();
    w.add("u_alice", "앨리스");
    w.add("u_bob", "밥");
    const bobCode = await w.codeOf("u_bob");
    expect((await w.call("u_alice", "POST", "/api/me/friends/request", { code: bobCode })).body.status).toBe("sent");
    const run = await w.deleteAccount("u_alice");
    expect(run).toMatchObject({ failed: 0, remaining: 0 });
    expect((await w.call("u_bob", "GET", "/api/me/friends")).body.incoming).toEqual([]);
    expect(JSON.stringify(w.lists("u_bob"))).not.toMatch(/앨리스/);
    expect(w.accounts.get("u_bob")!.store.deletionPlan().peers).toEqual([]);
    expect((await w.call("u_bob", "GET", "/api/me/inbox")).body.requests).toBe(0);
  });

  it("R2: 같은 Google 계정 재가입 후, 남아 있던(구버전 탈퇴) 요청을 수락해도 친구가 되지 않는다", async () => {
    const w = world();
    w.add("u_alice", "앨리스");
    w.add("u_bob", "밥");
    const bobCode = await w.codeOf("u_bob");
    await w.call("u_alice", "POST", "/api/me/friends/request", { code: bobCode });
    await w.legacyDelete("u_alice"); // residue made by the old deletion, as on production today
    const residue = (await w.call("u_bob", "GET", "/api/me/friends")).body.incoming;
    expect(residue).toHaveLength(1); // R1 under the OLD deletion: reproduced
    w.rejoin("u_alice");
    const accepted = await w.call("u_bob", "POST", "/api/me/friends/accept", { code: residue[0].code });
    expect(accepted.status).toBe(404);
    expect(accepted.body.error.code).toBe("REQUEST_GONE");
    expect(w.lists("u_alice").friends).toEqual([]);
    expect(w.lists("u_bob").friends).toEqual([]);
    expect(w.lists("u_bob").incoming).toEqual([]); // the dead request is gone after the attempt
    // the re-joined account also gets a NEW friend code (old one retired)
    expect(await w.codeOf("u_alice")).not.toBe(residue[0].code);
  });

  it("R2': 새 삭제 경로에서 재가입 직후에도 친구화 불가(대기 요청·재요청 교차 모두)", async () => {
    const w = world();
    w.add("u_alice", "앨리스");
    w.add("u_bob", "밥");
    const bobCode = await w.codeOf("u_bob");
    const aliceCode = await w.codeOf("u_alice");
    await w.call("u_bob", "POST", "/api/me/friends/request", { code: aliceCode }); // bob → old alice
    await w.deleteAccount("u_alice");
    w.rejoin("u_alice");
    expect(w.lists("u_bob").outgoing).toEqual([]);
    // re-joined alice asks bob: bob's request to the OLD account must not turn it into "friends"
    expect((await w.call("u_alice", "POST", "/api/me/friends/request", { code: bobCode })).body.status).toBe("sent");
    expect(w.lists("u_bob").friends).toEqual([]);
    expect(w.lists("u_bob").incoming).toHaveLength(1);
  });

  it("R3: 만료 세션은 로그인·인증·알람에서 일괄 정리되고, 계정당 세션 수는 상한을 넘지 않는다", async () => {
    const store = new AccountStore(sql());
    store.init();
    const t0 = Date.UTC(2026, 10, 28, 3);
    store.ensureUser("u_carol", "google", t0);
    const login = async (t: number) => {
      const cs = "client-state-" + t + "-".repeat(20);
      return (await store.exchange(await store.createLoginCode(await sha256(cs), t), cs, t))!;
    };
    const old: string[] = [];
    for (let i = 0; i < 5; i++) old.push(await login(t0 + i));
    const later = t0 + SESSION_TTL_MS + 86_400_000;
    // the audit's R3: 5 expired rows stay until something runs — now the alarm / a sign-in prunes them all
    expect(store.pruneSessions(later)).toBe(5);
    expect(store.sessionCount()).toBe(0);
    for (const s of old) expect(await store.authenticate(s, later)).toBe(false);

    // a fresh sign-in also prunes, and authentication does at most once a day
    for (let i = 0; i < 3; i++) await login(later + i);
    const fresh = await login(later + 10);
    expect(store.nextSessionExpiry()).toBe(later + SESSION_TTL_MS);
    const muchLater = later + SESSION_TTL_MS + 5;
    expect(await store.authenticate(fresh, muchLater)).toBe(true); // 10 ms left
    expect(store.sessionCount()).toBe(1); // the 3 older ones expired and were pruned in the same call
  });

  it("세션 상한: 상한 이내의 기존 유효 세션은 모두 유지, 초과 로그인 때만 가장 오래된 세션이 끝난다; 로그아웃·전체 로그아웃 유지", async () => {
    const store = new AccountStore(sql());
    store.init();
    const t0 = Date.UTC(2026, 10, 28, 3);
    store.ensureUser("u_dan", "google", t0);
    const login = async (t: number) => {
      const cs = "client-state-" + t + "-".repeat(20);
      return (await store.exchange(await store.createLoginCode(await sha256(cs), t), cs, t))!;
    };
    const s: string[] = [];
    for (let i = 0; i < SESSION_CAP; i++) s.push(await login(t0 + i * 1000));
    for (const x of s) expect(await store.authenticate(x, t0 + 60_000)).toBe(true);
    s.push(await login(t0 + 100_000));
    expect(store.sessionCount()).toBe(SESSION_CAP);
    expect(await store.authenticate(s[0], t0 + 100_001)).toBe(false); // the oldest
    for (const x of s.slice(1)) expect(await store.authenticate(x, t0 + 100_001)).toBe(true);
    await store.logout(s[5]);
    expect(await store.authenticate(s[5], t0 + 100_002)).toBe(false);
    expect(await store.authenticate(s[6], t0 + 100_002)).toBe(true);
    store.logoutAll();
    expect(store.sessionCount()).toBe(0);
    // a login code can be used once; an expired one never
    const cs = "client-state-x" + "-".repeat(20);
    const code = await store.createLoginCode(await sha256(cs), t0);
    expect(await store.exchange(code, cs, t0 + 3 * 60_000)).toBeNull();
  });
});

describe("탈퇴 정리 범위 (SEC-03)", () => {
  it("받은 요청(내가 받은)·보낸 쪽 상대의 보낸 요청, 친구 관계, 그 친구의 받은 초대가 모두 정리된다", async () => {
    const w = world();
    for (const [id, n] of [["u_a", "에이"], ["u_b", "비"], ["u_c", "씨"], ["u_d", "디"]] as const) w.add(id, n);
    const [a, b, c] = [await w.codeOf("u_a"), await w.codeOf("u_b"), await w.codeOf("u_c")];
    await w.call("u_b", "POST", "/api/me/friends/request", { code: a }); // b → a (a received)
    await w.call("u_a", "POST", "/api/me/friends/request", { code: c });
    await w.call("u_c", "POST", "/api/me/friends/accept", { code: a }); // a ↔ c friends
    await w.call("u_d", "POST", "/api/me/friends/request", { code: a });
    await w.call("u_a", "POST", "/api/me/friends/decline", { code: await w.codeOf("u_d") }); // d's declined request
    // d's declined row keeps only the time (no nickname / code of a)
    const dOut = w.accounts.get("u_d")!.db.exec<{ code: string; nickname: string }>("SELECT code, nickname FROM fr_out").toArray();
    expect(dOut).toEqual([{ code: "", nickname: "" }]);
    expect(await sendInvites({ userId: "u_a" }, [c], "ROOM42", w.deps, () => "inv-1")).toEqual({ [c]: "sent" });
    expect((await w.call("u_c", "GET", "/api/me/inbox")).body.invites).toHaveLength(1);
    w.accounts.get("u_a")!.presence.ping(w.clock.t);
    expect((await w.call("u_c", "GET", "/api/me/friends")).body.friends[0].status).toBe("online");

    await w.deleteAccount("u_a");
    expect(w.lists("u_b").outgoing).toEqual([]);
    expect(w.lists("u_c").friends).toEqual([]);
    expect((await w.call("u_c", "GET", "/api/me/inbox")).body).toEqual({ requests: 0, invites: [] });
    for (const id of ["u_b", "u_c"]) expect(JSON.stringify(w.accounts.get(id)!.db.exec("SELECT * FROM fr_invites").toArray()) + JSON.stringify(w.lists(id))).not.toMatch(/u_a|에이/);
    // the index no longer finds the old code; its retired code is never handed back
    expect(w.index.lookup(a)).toBeNull();
    w.rejoin("u_a");
    const again = await w.codeOf("u_a");
    expect(again).not.toBe(a);
    expect((await w.call("u_b", "POST", "/api/me/friends/request", { code: a })).status).toBe(404);
    void b;
  });

  it("차단: 탈퇴한 사람을 차단한 목록은 '탈퇴한 사용자'로 익명화되고 재가입해도 차단이 유지된다(차단 회피 불가); 차단 해제 가능", async () => {
    const w = world();
    w.add("u_x", "엑스");
    w.add("u_y", "와이");
    const [x, y] = [await w.codeOf("u_x"), await w.codeOf("u_y")];
    await w.call("u_y", "POST", "/api/me/friends/block", { code: x });
    expect(w.lists("u_y").blocked).toEqual([{ code: x, nickname: "엑스" }]);
    await w.deleteAccount("u_x");
    const blocked = w.lists("u_y").blocked;
    expect(blocked).toHaveLength(1);
    expect(blocked[0].nickname).toBe(FRIEND_LIMITS.deletedName);
    expect(blocked[0].code).not.toBe(x);
    expect(w.index.lookup(blocked[0].code)).toBeNull(); // a placeholder that names nobody
    // re-joined x (same Google account) cannot reach y: request looks "sent" but y gets nothing
    w.rejoin("u_x", "새엑스");
    expect((await w.call("u_x", "POST", "/api/me/friends/request", { code: y })).body.status).toBe("sent");
    expect(w.lists("u_y").incoming).toEqual([]);
    // search hides y from x as before
    // y can still unblock the anonymised entry
    expect((await w.call("u_y", "POST", "/api/me/friends/unblock", { code: blocked[0].code })).status).toBe(200);
    expect(w.lists("u_y").blocked).toEqual([]);
  });

  it("차단: 내가 차단한 상대가 있는 상태로 탈퇴하면 상대 쪽 서버 전용 역색인도 지워진다", async () => {
    const w = world();
    w.add("u_x", "엑스");
    w.add("u_y", "와이");
    await w.call("u_x", "POST", "/api/me/friends/block", { code: await w.codeOf("u_y") });
    expect(w.accounts.get("u_y")!.store.deletionPlan().peers).toEqual(["u_x"]); // y knows (server-side) who blocks it
    await w.call("u_x", "POST", "/api/me/friends/unblock", { code: (w.lists("u_x").blocked[0]).code });
    expect(w.accounts.get("u_y")!.store.deletionPlan().peers).toEqual([]);
    await w.call("u_x", "POST", "/api/me/friends/block", { code: await w.codeOf("u_y") });
    await w.deleteAccount("u_x");
    expect(w.accounts.get("u_y")!.store.deletionPlan().peers).toEqual([]);
  });

  it("다른 계정이 탈퇴한(빈) 계정에 요청·초대·수락해도 그 계정 저장소에 아무것도 쓰이지 않는다", async () => {
    const w = world();
    w.add("u_x", "엑스");
    w.add("u_y", "와이");
    const x = await w.codeOf("u_x");
    w.failing.add(INDEX_TARGET); // the index cleanup has not landed yet: the old code still resolves
    await w.deleteAccount("u_x");
    expect(w.index.lookup(x)?.userId).toBe("u_x");
    const r = await w.call("u_y", "POST", "/api/me/friends/request", { code: x });
    expect(r.status).toBe(404);
    expect(w.lists("u_y").outgoing).toEqual([]);
    expect(w.accounts.get("u_x")!.store.deletionPlan()).toEqual({ code: null, peers: [] });
    // retry lands later
    w.failing.clear();
    w.clock.t += 61_000;
    expect(await w.retry("u_x")).toMatchObject({ done: 1, remaining: 0 });
    expect(w.index.lookup(x)).toBeNull();
  });
});

describe("여러 Durable Object에 걸친 실패·재시도 (SEC-03)", () => {
  it("실패한 상대는 대기열에 남아 지수 백오프로 재시도되고, 성공하면 지워진다", async () => {
    const w = world();
    w.add("u_a", "에이");
    w.add("u_b", "비");
    w.add("u_c", "씨");
    const a = await w.codeOf("u_a");
    await w.call("u_b", "POST", "/api/me/friends/request", { code: a });
    await w.call("u_c", "POST", "/api/me/friends/request", { code: a });
    w.failing.add("u_b");
    const run = await w.deleteAccount("u_a");
    expect(run).toMatchObject({ done: 2, failed: 1, remaining: 1 }); // index + c done, b pending
    expect(w.lists("u_c").outgoing).toEqual([]);
    expect(w.lists("u_b").outgoing).toHaveLength(1);
    const q = w.accounts.get("u_a")!.queue;
    expect(q.nextAt()).toBe(w.clock.t + 60_000);
    expect(await w.retry("u_a")).toMatchObject({ done: 0, failed: 0, remaining: 1 }); // not due yet
    w.clock.t += 60_000;
    expect(await w.retry("u_a")).toMatchObject({ failed: 1, remaining: 1 });
    expect(q.nextAt()).toBe(w.clock.t + 5 * 60_000);
    w.failing.clear();
    w.clock.t += 5 * 60_000;
    expect(await w.retry("u_a")).toMatchObject({ done: 1, remaining: 0 });
    expect(w.lists("u_b").outgoing).toEqual([]);
    expect(q.owner()).toBeNull(); // the deleted id is not kept once the queue is empty
  });

  it("영구 실패는 상한 횟수 후 포기(운영 지표로 집계)", async () => {
    const q = new CleanupQueue(sql());
    q.init();
    q.enqueue("u_gone", ["u_peer"], "YL00000000", 0);
    let t = 0;
    let gaveUp = 0;
    for (let i = 0; i < CLEANUP_MAX_ATTEMPTS + 2; i++) {
      const r = await runCleanup(q, async () => Promise.reject(Error("x")), () => t);
      gaveUp += r.gaveUp;
      t = (q.nextAt() ?? t) + 1;
    }
    expect(gaveUp).toBe(1);
    expect(q.pending()).toBe(0);
  });

  it("재가입 뒤 늦게 도착한 재시도는 새 계정의 관계·코드를 지우지 않는다(세대 한정)", async () => {
    const w = world();
    w.add("u_a", "에이");
    w.add("u_b", "비");
    const [a, b] = [await w.codeOf("u_a"), await w.codeOf("u_b")];
    await w.call("u_b", "POST", "/api/me/friends/request", { code: a });
    w.failing.add("u_b").add(INDEX_TARGET);
    await w.deleteAccount("u_a");
    w.rejoin("u_a");
    const a2 = await w.codeOf("u_a"); // retired code avoided even though the index still had it
    expect(a2).not.toBe(a);
    expect(w.index.lookup(a)).toBeNull();
    // b's old request to the old a is replaced when the new a and b meet
    expect((await w.call("u_a", "POST", "/api/me/friends/request", { code: b })).body.status).toBe("sent");
    expect((await w.call("u_b", "POST", "/api/me/friends/accept", { code: a2 })).body.status).toBe("friends");
    w.failing.clear();
    w.clock.t += 3600_000;
    await w.retry("u_a");
    expect(w.lists("u_b").friends.map((f) => f.code)).toEqual([a2]);
    expect(w.lists("u_a").friends.map((f) => f.code)).toEqual([b]);
    expect(w.index.lookup(a2)?.userId).toBe("u_a");
  });
});

describe("경합: 탈퇴와 동시에 친구 요청 수락·요청", () => {
  /** Run `action`, deleting `victim` right before the k-th friend RPC; returns how many RPCs the action made. */
  type W = ReturnType<typeof world>;
  async function interleave(k: number, action: (w: W, code: string) => Promise<unknown>, setup: (w: W) => Promise<string>, victim = "u_alice") {
    const w = world();
    w.add("u_alice", "앨리스");
    w.add("u_bob", "밥");
    const code = await setup(w);
    let n = 0;
    let deleting = false;
    w.setHook(async () => {
      if (deleting) return;
      if (n++ === k) {
        deleting = true;
        await w.deleteAccount(victim);
      }
    });
    const result = await action(w, code);
    w.setHook(null);
    if (!deleting) await w.deleteAccount(victim); // deletion after the action completed
    return { w, steps: n, result };
  }
  const invariants = async (w: W) => {
    // nothing about alice remains on bob's side, and alice's (absent) account holds nothing
    const bob = w.lists("u_bob");
    expect(bob.friends).toEqual([]);
    expect(bob.incoming).toEqual([]);
    expect(bob.outgoing).toEqual([]);
    expect(w.accounts.get("u_bob")!.store.deletionPlan().peers).toEqual([]);
    expect(w.accounts.get("u_alice")!.store.deletionPlan()).toEqual({ code: null, peers: [] });
    // a re-join does not make them friends either
    w.rejoin("u_alice");
    expect(w.lists("u_alice").friends).toEqual([]);
  };

  it("수락 경로의 모든 RPC 사이에 탈퇴를 끼워 넣어도 잔존·자동 친구화 없음", async () => {
    const setup = async (w: W) => {
      await w.call("u_alice", "POST", "/api/me/friends/request", { code: await w.codeOf("u_bob") });
      return (await w.call("u_bob", "GET", "/api/me/friends")).body.incoming[0].code as string;
    };
    const accept = (w: W, code: string) => w.call("u_bob", "POST", "/api/me/friends/accept", { code });
    const total = (await interleave(1e9, accept, setup)).steps;
    expect(total).toBeGreaterThan(5);
    const outcomes = new Set<number>();
    for (let k = 0; k <= total; k++) {
      const { w, result } = await interleave(k, accept, setup);
      outcomes.add((result as { status: number }).status);
      await invariants(w);
    }
    expect(outcomes).toEqual(new Set([200, 404])); // some interleavings accept first, others find it gone
  });

  it("상대에게 요청을 보내는 도중 상대가 탈퇴해도 보낸 요청이 남지 않음", async () => {
    const setup = async (w: W) => {
      await w.codeOf("u_bob");
      return w.codeOf("u_alice");
    };
    const request = (w: W, code: string) => w.call("u_bob", "POST", "/api/me/friends/request", { code });
    const total = (await interleave(1e9, request, setup)).steps;
    for (let k = 0; k <= total; k++) await invariants((await interleave(k, request, setup)).w);
  });

  it("교차 요청(상대가 이미 나에게 요청) 중 탈퇴해도 한쪽만 친구로 남지 않음", async () => {
    const setup = async (w: W) => {
      await w.call("u_alice", "POST", "/api/me/friends/request", { code: await w.codeOf("u_bob") });
      return (await w.call("u_bob", "GET", "/api/me/friends")).body.incoming[0].code as string;
    };
    const crossing = (w: W, code: string) => w.call("u_bob", "POST", "/api/me/friends/request", { code });
    const total = (await interleave(1e9, crossing, setup)).steps;
    for (let k = 0; k <= total; k++) await invariants((await interleave(k, crossing, setup)).w);
  });
});

describe("기존 정상 계정 보호 · 구버전 잔존 데이터 정리(운영자 승인 전 off)", () => {
  async function legacyWorld(mode: ResidueMode) {
    const w = world(mode);
    for (const [id, n] of [["u_gone", "떠난이"], ["u_bob", "밥"], ["u_live", "남은이"]] as const) w.add(id, n);
    const [bob, live] = [await w.codeOf("u_bob"), await w.codeOf("u_live")];
    await w.call("u_gone", "POST", "/api/me/friends/request", { code: bob });
    await w.call("u_bob", "POST", "/api/me/friends/block", { code: await w.codeOf("u_gone") });
    await w.call("u_live", "POST", "/api/me/friends/request", { code: bob });
    await w.legacyDelete("u_gone");
    // a healthy friendship that must never be touched
    await w.call("u_bob", "POST", "/api/me/friends/accept", { code: live });
    w.clock.t += 86_400_000; // the next day (the check runs at most once a day per account)
    return w;
  }

  it("off(기본): 잔존 행을 일괄 수정하지 않는다(정상 친구 유지, 구 차단 행 그대로)", async () => {
    const w = await legacyWorld("off");
    const before = JSON.stringify(w.lists("u_bob"));
    await w.call("u_bob", "GET", "/api/me/friends");
    expect(JSON.stringify(w.lists("u_bob"))).toBe(before);
    expect(w.lists("u_bob").friends.map((f) => f.nickname)).toEqual(["남은이"]);
    expect(w.metrics).toEqual({});
  });

  it("dry-run: 개수만 집계하고 아무것도 바꾸지 않는다", async () => {
    const w = await legacyWorld("dry-run");
    const before = JSON.stringify(w.lists("u_bob"));
    await w.call("u_bob", "GET", "/api/me/friends");
    expect(JSON.stringify(w.lists("u_bob"))).toBe(before);
    expect(w.metrics).toEqual({ "friends.residue.found": 1 });
  });

  it("on: 탈퇴 세대의 행만 정리(차단은 익명화), 살아 있는 계정의 친구·요청은 그대로; 하루 1회", async () => {
    const w = await legacyWorld("on");
    await w.call("u_bob", "GET", "/api/me/friends");
    const l = w.lists("u_bob");
    expect(l.friends.map((f) => f.nickname)).toEqual(["남은이"]);
    expect(l.blocked.map((b) => b.nickname)).toEqual([FRIEND_LIMITS.deletedName]);
    expect(w.metrics).toEqual({ "friends.residue.cleaned": 1 });
    await w.call("u_bob", "GET", "/api/me/friends");
    expect(w.metrics).toEqual({ "friends.residue.cleaned": 1 });
  });
});

describe("초대·접속 상태는 같은 세대의 상호 친구에게만", () => {
  it("친구 삭제 후 받은 초대는 사라지고, 한쪽에만 남은 친구 행으로는 상대의 접속 상태를 볼 수 없다", async () => {
    const w = world();
    w.add("u_a", "에이");
    w.add("u_b", "비");
    const [a, b] = [await w.codeOf("u_a"), await w.codeOf("u_b")];
    await w.call("u_a", "POST", "/api/me/friends/request", { code: b });
    await w.call("u_b", "POST", "/api/me/friends/accept", { code: a });
    await sendInvites({ userId: "u_a" }, [b], "ROOM42", w.deps, () => "inv-1");
    await w.call("u_a", "POST", "/api/me/friends/remove", { code: b });
    expect((await w.call("u_b", "GET", "/api/me/inbox")).body.invites).toEqual([]);
    // a one-sided (stale) friend row: b still lists a, a does not list b
    await w.call("u_a", "POST", "/api/me/friends/request", { code: b });
    await w.call("u_b", "POST", "/api/me/friends/accept", { code: a });
    w.accounts.get("u_a")!.store.removeFriend("u_b");
    w.accounts.get("u_a")!.presence.ping(w.clock.t);
    expect((await w.call("u_b", "GET", "/api/me/friends")).body.friends[0].status).toBe("offline");
    // and a stale invite row from a non-friend (e.g. left by an older version) is never shown
    w.accounts.get("u_a")!.db.exec("INSERT INTO fr_invites (id, from_id, from_code, from_name, room, at, expires) VALUES ('inv-2', 'u_z', 'YL00000000', '지', 'ROOM43', ?, ?)", w.clock.t, w.clock.t + 60_000);
    expect((await w.call("u_a", "GET", "/api/me/inbox")).body.invites).toEqual([]);
  });

  it("거절된 요청은 24시간 뒤 행 자체가 정리된다", async () => {
    const w = world();
    w.add("u_a", "에이");
    w.add("u_b", "비");
    const b = await w.codeOf("u_b");
    await w.call("u_a", "POST", "/api/me/friends/request", { code: b });
    await w.call("u_b", "POST", "/api/me/friends/decline", { code: await w.codeOf("u_a") });
    expect((await w.call("u_a", "POST", "/api/me/friends/request", { code: b })).body.error.code).toBe("COOLDOWN");
    w.clock.t += FRIEND_LIMITS.retryAfterDeclineMs;
    expect((await w.call("u_a", "POST", "/api/me/friends/request", { code: b })).body.status).toBe("sent");
    expect(w.accounts.get("u_a")!.db.exec("SELECT count(*) AS n FROM fr_out").toArray()).toEqual([{ n: 1 }]);
  });
});
