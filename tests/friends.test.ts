import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { FRIEND_LIMITS, FriendIndexStore, FriendStore, Presence, normalizeCode, type FriendSql } from "../worker/src/friends";
import { handleFriendRoute, sendInvites, type FriendDeps, type FriendUser } from "../worker/src/friends-api";

/**
 * Friends & invites (I/J): the routes over real per-account SQLite stores (node:sqlite, the same SQL
 * as the Durable Objects), an in-memory "network" of accounts, a fake clock.
 */
function sql(): FriendSql {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (q: string, ...p: unknown[]) => {
      const st = db.prepare(q);
      // like the Durable Object API: a statement runs when exec is called
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
  };
}
function world() {
  const clock = { t: Date.UTC(2026, 10, 25, 3) };
  const index = new FriendIndexStore(sql());
  index.init();
  const accounts = new Map<string, { store: FriendStore; presence: Presence; nickname: string }>();
  const add = (userId: string, nickname: string) => {
    const store = new FriendStore(sql());
    store.init();
    accounts.set(userId, { store, presence: new Presence(), nickname });
  };
  const user = (id: string): FriendUser => {
    const a = accounts.get(id)!;
    return {
      fr: async (op: string, ...args: unknown[]) => (a.store as unknown as Record<string, (...x: unknown[]) => unknown>)[op](...args) as never,
      nickname: async () => a.nickname,
      presence: async () => a.presence.status(clock.t),
      ping: async () => a.presence.ping(clock.t),
      publicProfile: async () => ({ userId: id, nickname: a.nickname, joinedAt: 1, online: { games: 3, wins: 2, losses: 1, draws: 0, best: 200, average: 180 } }),
    };
  };
  const deps: FriendDeps = {
    user,
    index: { register: async (id, n) => index.register(id, n), lookup: async (c) => index.lookup(c), search: async (n) => index.search(n) },
    limited: async () => false,
    now: () => clock.t,
  };
  const call = async (as: string, method: "GET" | "POST", path: string, body?: Record<string, unknown>) => {
    const url = new URL("http://x" + path);
    const res = await handleFriendRoute(new Request(url, { method }), url, { userId: as }, deps, (status, b) => new Response(JSON.stringify(b), { status }), async () => body ?? {});
    return { status: res!.status, body: (await res!.json()) as Record<string, any> };
  };
  const codeOf = async (id: string) => (await call(id, "GET", "/api/me/friends")).body.me.code as string;
  return { clock, index, accounts, add, user, deps, call, codeOf };
}

describe("친구 코드", () => {
  it("YL + 8자리(헷갈리는 글자 없음), 사람이 친 형식도 정규화", () => {
    expect(normalizeCode("yl-7k3q 9p2x")).toBe("YL7K3Q9P2X");
    expect(normalizeCode("7K3Q9P2X")).toBe("YL7K3Q9P2X");
    expect(normalizeCode("YLOOIL1234")).toBe("YL00111234");
    expect(normalizeCode("YL123")).toBeNull();
  });
});

describe("친구 요청·수락·거절·취소·삭제", () => {
  it("코드로 요청 → 상대가 받은 요청 → 수락하면 양쪽 친구 목록, 응답에 내부 ID·이메일 없음", async () => {
    const w = world();
    w.add("u_alice", "앨리스");
    w.add("u_bob", "밥");
    const bob = await w.codeOf("u_bob");
    const r = await w.call("u_alice", "POST", "/api/me/friends/request", { code: bob });
    expect(r.body).toEqual({ status: "sent" });
    const inbox = await w.call("u_bob", "GET", "/api/me/friends");
    expect(inbox.body.incoming.map((x: { nickname: string }) => x.nickname)).toEqual(["앨리스"]);
    const alice = await w.codeOf("u_alice");
    expect((await w.call("u_bob", "POST", "/api/me/friends/accept", { code: alice })).body).toEqual({ status: "friends" });
    const a = (await w.call("u_alice", "GET", "/api/me/friends")).body;
    const b = (await w.call("u_bob", "GET", "/api/me/friends")).body;
    expect(a.friends.map((f: { nickname: string }) => f.nickname)).toEqual(["밥"]);
    expect(b.friends.map((f: { nickname: string }) => f.nickname)).toEqual(["앨리스"]);
    expect(a.outgoing).toEqual([]);
    expect(JSON.stringify([a, b])).not.toMatch(/u_alice|u_bob|@/);
  });

  it("서로 동시에 요청하면 바로 친구, 거절은 24시간 뒤에 다시 요청 가능, 보낸 요청 취소", async () => {
    const w = world();
    for (const [id, n] of [["u_a", "가"], ["u_b", "나"], ["u_c", "다"]]) w.add(id, n);
    const [a, b, c] = [await w.codeOf("u_a"), await w.codeOf("u_b"), await w.codeOf("u_c")];
    await w.call("u_a", "POST", "/api/me/friends/request", { code: b });
    expect((await w.call("u_b", "POST", "/api/me/friends/request", { code: a })).body).toEqual({ status: "friends" });
    // decline → cool-down for the sender
    await w.call("u_a", "POST", "/api/me/friends/request", { code: c });
    await w.call("u_c", "POST", "/api/me/friends/decline", { code: a });
    expect((await w.call("u_c", "GET", "/api/me/friends")).body.incoming).toEqual([]);
    expect((await w.call("u_a", "POST", "/api/me/friends/request", { code: c })).body.error.code).toBe("COOLDOWN");
    w.clock.t += FRIEND_LIMITS.retryAfterDeclineMs + 1;
    expect((await w.call("u_a", "POST", "/api/me/friends/request", { code: c })).body.status).toBe("sent");
    // cancel
    await w.call("u_a", "POST", "/api/me/friends/cancel", { code: c });
    expect((await w.call("u_c", "GET", "/api/me/friends")).body.incoming).toEqual([]);
    // remove a friend: both sides
    await w.call("u_b", "POST", "/api/me/friends/remove", { code: a });
    expect((await w.call("u_a", "GET", "/api/me/friends")).body.friends).toEqual([]);
  });

  it("차단: 친구·요청이 모두 사라지고, 차단된 쪽의 요청은 성공처럼 보이지만 아무것도 남지 않으며, 검색에도 안 보인다", async () => {
    const w = world();
    w.add("u_a", "가");
    w.add("u_b", "나");
    const [a, b] = [await w.codeOf("u_a"), await w.codeOf("u_b")];
    await w.call("u_a", "POST", "/api/me/friends/request", { code: b });
    await w.call("u_b", "POST", "/api/me/friends/accept", { code: a });
    await w.call("u_b", "POST", "/api/me/friends/block", { code: a });
    expect((await w.call("u_a", "GET", "/api/me/friends")).body.friends).toEqual([]);
    expect((await w.call("u_b", "GET", "/api/me/friends")).body.blocked.map((x: { nickname: string }) => x.nickname)).toEqual(["가"]);
    expect((await w.call("u_a", "POST", "/api/me/friends/request", { code: b })).body).toEqual({ status: "sent" }); // not revealed
    expect((await w.call("u_b", "GET", "/api/me/friends")).body.incoming).toEqual([]);
    expect((await w.call("u_a", "POST", "/api/me/friends/search", { query: "나" })).body.results).toEqual([]);
    expect((await w.call("u_a", "GET", "/api/me/friends/profile?code=" + b)).status).toBe(404);
    // the blocker cannot send requests either until unblocking
    expect((await w.call("u_b", "POST", "/api/me/friends/request", { code: a })).body.error.code).toBe("BLOCKED");
    await w.call("u_b", "POST", "/api/me/friends/unblock", { code: a });
    expect((await w.call("u_b", "GET", "/api/me/friends")).body.blocked).toEqual([]);
  });

  it("하루 요청 30건 제한", async () => {
    const w = world();
    w.add("u_s", "스패머");
    const codes = [];
    for (let i = 0; i < 31; i++) {
      w.add("u_t" + i, "대상" + i);
      codes.push(await w.codeOf("u_t" + i));
    }
    for (let i = 0; i < 30; i++) expect((await w.call("u_s", "POST", "/api/me/friends/request", { code: codes[i] })).status).toBe(200);
    expect((await w.call("u_s", "POST", "/api/me/friends/request", { code: codes[30] })).body.error.code).toBe("DAILY_LIMIT");
  });
});

describe("검색·프로필 (사용자 열거 방지)", () => {
  it("정확한 닉네임·친구 코드만 찾고(부분 검색 없음) 최대 10명, 하루 검색 한도", async () => {
    const w = world();
    w.add("u_me", "나");
    for (let i = 0; i < 12; i++) {
      w.add("u_h" + i, "하늘");
      await w.codeOf("u_h" + i);
    }
    w.add("u_x", "하늘색");
    await w.codeOf("u_x");
    const r = await w.call("u_me", "POST", "/api/me/friends/search", { query: "하늘" });
    expect(r.body.results).toHaveLength(10);
    expect(r.body.results.every((x: { nickname: string; relation: string }) => x.nickname === "하늘" && x.relation === "none")).toBe(true);
    expect((await w.call("u_me", "POST", "/api/me/friends/search", { query: "하" })).body.results).toEqual([]);
    const code = await w.codeOf("u_x");
    expect((await w.call("u_me", "POST", "/api/me/friends/search", { query: code.toLowerCase() })).body.results.map((x: { nickname: string }) => x.nickname)).toEqual(["하늘색"]);
    const p = await w.call("u_me", "GET", "/api/me/friends/profile?code=" + code);
    expect(p.body).toMatchObject({ nickname: "하늘색", code, online: { games: 3 } });
    expect(p.body.userId).toBeUndefined();
    for (let i = 0; i < FRIEND_LIMITS.searchesPerDay - 3; i++) await w.call("u_me", "POST", "/api/me/friends/search", { query: "없는닉" });
    expect((await w.call("u_me", "POST", "/api/me/friends/search", { query: "하늘" })).body.error.code).toBe("DAILY_LIMIT");
  });
});

describe("접속 상태·초대", () => {
  it("상태는 친구에게만(목록) 보이고, 받은함 확인이 '접속 중'을 갱신하며 2분 30초 뒤 오프라인, 경기 중 표시", async () => {
    const w = world();
    w.add("u_a", "가");
    w.add("u_b", "나");
    const [a, b] = [await w.codeOf("u_a"), await w.codeOf("u_b")];
    await w.call("u_a", "POST", "/api/me/friends/request", { code: b });
    await w.call("u_b", "POST", "/api/me/friends/accept", { code: a });
    expect((await w.call("u_a", "GET", "/api/me/friends")).body.friends[0].status).toBe("offline");
    await w.call("u_b", "GET", "/api/me/inbox");
    expect((await w.call("u_a", "GET", "/api/me/friends")).body.friends[0].status).toBe("online");
    w.accounts.get("u_b")!.presence.setPlaying("ROOM42", w.clock.t);
    expect((await w.call("u_a", "GET", "/api/me/friends")).body.friends[0].status).toBe("playing");
    w.accounts.get("u_b")!.presence.setPlaying(null, w.clock.t);
    w.clock.t += FRIEND_LIMITS.onlineMs + 1;
    expect((await w.call("u_a", "GET", "/api/me/friends")).body.friends[0].status).toBe("offline");
  });

  it("초대: 친구에게만, 같은 친구·방은 1분에 한 번, 차단하면 받지 않음(보낸 쪽은 모름), 10분 뒤 만료, 거절하면 사라짐", async () => {
    const w = world();
    for (const [id, n] of [["u_h", "방장"], ["u_f", "친구"], ["u_s", "남"]]) w.add(id, n);
    const [h, f, s] = [await w.codeOf("u_h"), await w.codeOf("u_f"), await w.codeOf("u_s")];
    await w.call("u_h", "POST", "/api/me/friends/request", { code: f });
    await w.call("u_f", "POST", "/api/me/friends/accept", { code: h });
    let n = 0;
    const send = () => sendInvites({ userId: "u_h" }, [f, s], "ABCDEF", w.deps, () => "inv" + ++n);
    expect(await send()).toEqual({ [f]: "sent", [s]: "not-friend" });
    expect(await send()).toEqual({ [f]: "recent", [s]: "not-friend" });
    const box = (await w.call("u_f", "GET", "/api/me/inbox")).body;
    expect(box.invites).toHaveLength(1);
    expect(box.invites[0]).toMatchObject({ from: { nickname: "방장", code: h }, room: "ABCDEF" });
    expect(JSON.stringify(box)).not.toContain("u_h");
    await w.call("u_f", "POST", "/api/me/invites/decline", { id: box.invites[0].id });
    expect((await w.call("u_f", "GET", "/api/me/inbox")).body.invites).toEqual([]);
    // expiry
    w.clock.t += 61_000;
    await send();
    w.clock.t += FRIEND_LIMITS.inviteTtlMs + 1;
    expect((await w.call("u_f", "GET", "/api/me/inbox")).body.invites).toEqual([]);
    // blocked: the inviter still sees "sent" but nothing arrives
    await w.call("u_f", "POST", "/api/me/friends/block", { code: h });
    w.clock.t += 61_000;
    expect((await send())[f]).toBe("not-friend"); // blocking removed the friendship as well
    expect((await w.call("u_f", "GET", "/api/me/inbox")).body.invites).toEqual([]);
  });
});
