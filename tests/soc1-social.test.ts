import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { FRIEND_LIMITS, FriendIndexStore, FriendStore, Presence, type FriendSql } from "../worker/src/friends";
import { challenge, handleFriendRoute, type FriendDeps, type FriendUser } from "../worker/src/friends-api";
import { PresenceHub, SOCIAL_LIMITS, SocialStore, checkPins } from "../worker/src/social";

/**
 * SOC-1: friends by account id (never by nickname), central presence (one call per list, multi-tab,
 * "unknown" after a restart, hidden), direct challenges (dedupe, busy, accept / decline / expire /
 * cancel), showcase achievements (earned only, ≤ 3, visibility, blocks). node:sqlite, fake clock.
 */
function sql(): FriendSql {
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
  };
}
const uid = (n: string) => ("u_" + n).padEnd(24, "x");

function world(opts: { central?: boolean } = {}) {
  const clock = { t: Date.UTC(2026, 10, 28, 3) };
  const index = new FriendIndexStore(sql());
  index.init();
  const hubSql = sql();
  let hub = new PresenceHub(hubSql, clock.t - 10 * 60_000);
  hub.init(clock.t);
  const calls = { statuses: 0, presence: 0, isFriend: 0 };
  type Acc = { store: FriendStore; social: SocialStore; presence: Presence; nickname: string | null; opponents: Set<string>; earned: string[]; results: Record<string, string[]> };
  const accounts = new Map<string, Acc>();
  const add = (name: string, nickname: string | null = name) => {
    const id = uid(name);
    const store = new FriendStore(sql());
    store.init();
    accounts.set(id, { store, social: new SocialStore(sql()), presence: new Presence(), nickname, opponents: new Set(), earned: [], results: {} });
    return id;
  };
  const user = (id: string): FriendUser => {
    const a = accounts.get(id);
    return {
      fr: async (op: string, ...args: unknown[]) => {
        if (op === "isFriend") calls.isFriend++;
        return a ? ((a.store as unknown as Record<string, (...x: unknown[]) => unknown>)[op](...args) as never) : (null as never);
      },
      nickname: async () => a?.nickname ?? null,
      presence: async () => (calls.presence++, a!.presence.status(clock.t)),
      ping: async () => a?.presence.ping(clock.t),
      publicProfile: async () => (a ? { userId: id, nickname: a.nickname, joinedAt: 1, online: { games: 0, wins: 0, losses: 0, draws: 0, best: null, average: null } } : null),
      social: async (op: string, ...args: unknown[]) => (a!.social as unknown as Record<string, (...x: unknown[]) => unknown>)[op](...args) as never,
      earned: async () => a?.earned ?? [],
      showcase: async (viewer) => {
        if (!a) return [];
        if (viewer && a.store.isBlocking(viewer)) return [];
        const vis = a.social.settings().pinsVisibility;
        if (vis === "private" && viewer !== id) return [];
        if (vis === "friends" && (!viewer || (!a.store.isFriend(viewer) && viewer !== id))) return [];
        return a.social.pins(a.earned);
      },
      versus: async (other) => {
        const r = a?.results[other] ?? [];
        return { games: r.length, wins: r.filter((x) => x === "win").length, losses: r.filter((x) => x === "loss").length, draws: r.filter((x) => x === "draw").length };
      },
      playedWith: async (other) => !!a?.opponents.has(other),
    };
  };
  const rooms = new Map<string, { members: string[]; seats: number; status: "lobby" | "playing" }>();
  const deps: FriendDeps = {
    user,
    index: { register: async (id, n, avoid, keep) => index.register(id, n, avoid, keep), lookup: async (c) => index.lookup(c), search: async (n) => index.search(n) },
    limited: async () => false,
    now: () => clock.t,
    ...(opts.central === false
      ? {}
      : {
          presence: {
            statuses: async (ids) => (calls.statuses++, hub.statuses(ids, clock.t)),
            beat: async (id, device, state) => hub.beat(id, device, clock.t, state),
            setHidden: async (id, hidden) => hub.setHidden(id, hidden),
          },
        }),
    sharesRoom: async (room, a, b) => !!rooms.get(room)?.members.includes(a) && !!rooms.get(room)?.members.includes(b),
  };
  const call = async (as: string, method: "GET" | "POST" | "PUT", path: string, body?: Record<string, unknown>) => {
    const url = new URL("http://x" + path);
    const res = await handleFriendRoute(new Request(url, { method }), url, { userId: as }, deps, (status, b) => new Response(JSON.stringify(b), { status }), async () => body ?? {});
    return { status: res!.status, body: (await res!.json()) as Record<string, any> };
  };
  const codeOf = async (id: string) => (await call(id, "GET", "/api/me/friends")).body.me.code as string;
  const befriend = async (a: string, b: string) => {
    await call(a, "POST", "/api/me/friends/request", { code: await codeOf(b) });
    await call(b, "POST", "/api/me/friends/accept", { code: await codeOf(a) });
  };
  let roomN = 0;
  const challengeRooms = (me: string) => ({
    create: async () => {
      const code = "ROOM" + String.fromCharCode(65 + roomN++) + "Z";
      rooms.set(code, { members: [me], seats: 2, status: "lobby" });
      return { ok: true as const, code, playerId: "p_" + code, token: "t".repeat(30) };
    },
    open: async (room: string) => rooms.get(room)?.status === "lobby" && rooms.get(room)!.members.length < 2,
  });
  let idn = 0;
  const challengeAs = (me: string, code: string) => challenge({ userId: me }, code, deps, challengeRooms(me), () => "inv-" + String(++idn).padStart(8, "0"));
  const restartHub = () => {
    hub = new PresenceHub(hubSql, clock.t);
    hub.init(clock.t);
  };
  return { clock, index, accounts, add, user, deps, call, codeOf, befriend, calls, rooms, challengeAs, restartHub, hub: () => hub };
}

describe("SOC-1 친구: 계정 ID 기준, 닉네임으로 추측하지 않음", () => {
  it("닉네임을 정하지 않은 계정도 존재하는 계정으로 찾는다(존재 판단은 프로필)", async () => {
    const w = world();
    const me = w.add("nn1", "나");
    const noName = w.add("nn2", null);
    w.accounts.get(me)!.opponents.add(noName);
    const rel = await w.call(me, "GET", `/api/me/friends/relation?userId=${noName}`);
    expect(rel.status).toBe(200);
    expect(rel.body.code).toMatch(/^YL/);
  });

  it("같은 닉네임의 두 계정: 최근 상대의 계정 ID로 관계를 묻고 요청하면 정확히 그 계정에게만 간다", async () => {
    const w = world();
    const me = w.add("me", "나");
    const twinA = w.add("twinA", "하늘");
    const twinB = w.add("twinB", "하늘");
    w.accounts.get(me)!.opponents.add(twinB);
    // twinB never opened friends: no code yet → the server registers it (자동 등록·복구)
    expect(w.accounts.get(twinB)!.store.code()).toBeNull();
    const rel = await w.call(me, "GET", `/api/me/friends/relation?userId=${twinB}`);
    expect(rel.status).toBe(200);
    expect(rel.body).toMatchObject({ relation: "none", nickname: "하늘" });
    expect(rel.body.code).toBe(w.accounts.get(twinB)!.store.code());
    expect(JSON.stringify(rel.body)).not.toContain(twinB);
    expect((await w.call(me, "POST", "/api/me/friends/request", { userId: twinB })).body).toEqual({ status: "sent" });
    expect(w.accounts.get(twinB)!.store.lists().incoming).toHaveLength(1);
    expect(w.accounts.get(twinA)!.store.lists().incoming).toHaveLength(0);
    expect((await w.call(me, "GET", `/api/me/friends/relation?userId=${twinB}`)).body.relation).toBe("outgoing");
    // twinA was never my opponent and is not in a room with me: the id can not be used to probe it
    expect((await w.call(me, "GET", `/api/me/friends/relation?userId=${twinA}`)).status).toBe(404);
    expect((await w.call(me, "POST", "/api/me/friends/request", { userId: twinA })).status).toBe(404);
    expect((await w.call(me, "GET", `/api/me/friends/relation?userId=not-an-id`)).status).toBe(400);
  });

  it("경기 중 프로필: 같은 방에 앉은 회원에게만 계정 ID로 요청; 방을 떠나면 불가", async () => {
    const w = world();
    const me = w.add("me2", "나");
    const other = w.add("other2", "너");
    w.rooms.set("ABCDEF", { members: [me, other], seats: 2, status: "playing" });
    expect((await w.call(me, "GET", `/api/me/friends/relation?userId=${other}&room=ABCDEF`)).body.relation).toBe("none");
    w.rooms.set("ABCDEF", { members: [me], seats: 2, status: "playing" });
    expect((await w.call(me, "GET", `/api/me/friends/relation?userId=${other}&room=ABCDEF`)).status).toBe(404);
  });

  it("나를 차단한 상대는 'none'과 구분되지 않고, 요청은 성공처럼 보이지만 저장되지 않는다; 탈퇴한 계정은 찾을 수 없음", async () => {
    const w = world();
    const me = w.add("me3", "나");
    const blocker = w.add("blk3", "차단자");
    const gone = uid("gone3"); // never created / deleted: no account object answers
    w.accounts.get(me)!.opponents.add(blocker).add(gone);
    const code = (await w.call(me, "GET", `/api/me/friends/relation?userId=${blocker}`)).body.code;
    await w.call(blocker, "POST", "/api/me/friends/block", { code: await w.codeOf(me) });
    expect((await w.call(me, "GET", `/api/me/friends/relation?userId=${blocker}`)).body.relation).toBe("none");
    expect((await w.call(me, "POST", "/api/me/friends/request", { userId: blocker })).body).toEqual({ status: "sent" });
    expect(w.accounts.get(blocker)!.store.lists().incoming).toHaveLength(0);
    expect(code).toMatch(/^YL/);
    // a deleted account (no profile) is not registered in the index
    expect((await w.call(me, "GET", `/api/me/friends/relation?userId=${gone}`)).status).toBe(404);
    expect(w.index.lookup("YL00000000")).toBeNull();
  });

  it("친구 프로필: 공개 프로필 + 나와의 상대 전적 + 대표 업적(공개 범위·차단 반영), 내부 ID 없음", async () => {
    const w = world();
    const a = w.add("pa", "가");
    const b = w.add("pb", "나");
    await w.befriend(a, b);
    w.accounts.get(a)!.results[b] = ["win", "win", "loss", "draw"];
    w.accounts.get(b)!.earned = ["a.match.10", "a.win.10"];
    const pinned = await w.call(b, "PUT", "/api/me/profile/pins", { ids: ["a.win.10"] });
    expect(pinned.status, JSON.stringify(pinned.body)).toBe(200);
    const prof = await w.call(a, "GET", `/api/me/friends/profile?code=${await w.codeOf(b)}`);
    expect(prof.body).toMatchObject({ nickname: "나", relation: "friend", versus: { games: 4, wins: 2, losses: 1, draws: 1 }, pins: ["a.win.10"] });
    expect(JSON.stringify(prof.body)).not.toContain(b);
    await w.call(b, "POST", "/api/me/friends/settings", { pinsVisibility: "private" });
    expect((await w.call(a, "GET", `/api/me/friends/profile?code=${await w.codeOf(b)}`)).body.pins).toEqual([]);
  });
});

describe("SOC-1 대표 업적", () => {
  it("달성한 업적만, 중복·3개 초과 거절, 같은 값은 쓰기 없음, 다른 기기에서도 같은 값", async () => {
    const w = world();
    const a = w.add("pin1", "가");
    const earned = ["a.match.10", "a.match.100", "a.win.10", "x.300"];
    for (const id of earned) expect(checkPins([id], [id]).ok).toBe(true);
    w.accounts.get(a)!.earned = earned;
    expect((await w.call(a, "PUT", "/api/me/profile/pins", { ids: ["nope"] })).body.error.code).toBe("PINS_NOT_EARNED");
    expect((await w.call(a, "PUT", "/api/me/profile/pins", { ids: [earned[0], earned[0]] })).body.error.code).toBe("PINS_DUPLICATE");
    expect((await w.call(a, "PUT", "/api/me/profile/pins", { ids: earned })).body.error.code).toBe("PINS_TOO_MANY");
    // earned elsewhere is not enough: another account's achievement is refused here
    expect((await w.call(a, "PUT", "/api/me/profile/pins", { ids: ["a.win.100"] })).body.error.code).toBe("PINS_NOT_EARNED");
    expect((await w.call(a, "PUT", "/api/me/profile/pins", { ids: "x" })).body.error.code).toBe("PINS");
    expect((await w.call(a, "PUT", "/api/me/profile/pins", { ids: earned.slice(0, 3) })).body.pins).toEqual(earned.slice(0, 3));
    // "another device" = another request: the server value
    expect((await w.call(a, "GET", "/api/me/profile/pins")).body).toMatchObject({ pins: earned.slice(0, 3), visibility: "public", max: SOCIAL_LIMITS.maxPins });
    expect(checkPins(["a", "b", "c", "d"], ["a", "b", "c", "d"])).toMatchObject({ ok: false, code: "PINS_TOO_MANY" });
  });
});

describe("SOC-1 접속 상태", () => {
  it("친구 목록은 중앙 상태를 한 번만 조회하고(친구 수와 무관), 온라인인 친구만 상호 친구 확인; 계정별 상태 조회 없음", async () => {
    const w = world();
    const me = w.add("pr0", "나");
    const fs = [];
    for (let i = 0; i < 12; i++) {
      const f = w.add("pf" + i, "친구" + i);
      await w.befriend(me, f);
      fs.push(f);
    }
    await w.call(fs[0], "GET", "/api/me/inbox?device=tab-aaaaaaaa");
    await w.call(fs[1], "GET", "/api/me/inbox?device=tab-bbbbbbbb");
    w.calls.statuses = w.calls.presence = w.calls.isFriend = 0;
    const list = (await w.call(me, "GET", "/api/me/friends")).body;
    expect(w.calls.statuses).toBe(1);
    expect(w.calls.presence).toBe(0);
    expect(w.calls.isFriend).toBe(2);
    const st = Object.fromEntries(list.friends.map((f: any) => [f.nickname, f.status]));
    expect(st["친구0"]).toBe("online");
    expect(st["친구1"]).toBe("online");
    expect(st["친구5"]).toBe("offline");
    expect(list.presence).toBe("v2");
  });

  it("여러 탭·기기: 한 탭을 닫아도 다른 탭이 있으면 접속 중, 모두 닫으면 바로 오프라인, 비정상 종료는 2분 30초 뒤", async () => {
    const w = world();
    const a = w.add("mt1", "가");
    const b = w.add("mt2", "나");
    await w.befriend(a, b);
    const status = async () => (await w.call(a, "GET", "/api/me/friends")).body.friends[0].status;
    await w.call(b, "GET", "/api/me/inbox?device=tab-one-1111");
    await w.call(b, "GET", "/api/me/inbox?device=phone-2222222");
    expect(await status()).toBe("online");
    await w.call(b, "POST", "/api/me/presence", { device: "tab-one-1111", state: "offline" });
    expect(await status()).toBe("online");
    await w.call(b, "POST", "/api/me/presence", { device: "phone-2222222", state: "offline" });
    expect(await status()).toBe("offline");
    expect((await w.call(b, "POST", "/api/me/presence", { device: "x", state: "offline" })).status).toBe(400);
    // crash / network loss: no goodbye, the TTL ends it
    await w.call(b, "GET", "/api/me/inbox?device=tab-one-1111");
    w.clock.t += FRIEND_LIMITS.onlineMs - 1000;
    expect(await status()).toBe("online");
    w.clock.t += 2000;
    expect(await status()).toBe("offline");
  });

  it("경기 중 표시는 재시작 후에도 유지, 재시작 직후 하트비트 전은 '상태 확인 불가', 비공개 설정은 오프라인으로 보임", async () => {
    const w = world();
    const a = w.add("rs1", "가");
    const b = w.add("rs2", "나");
    const c = w.add("rs3", "다");
    await w.befriend(a, b);
    await w.befriend(a, c);
    w.hub().setPlaying([c], "ROOM42", w.clock.t);
    w.restartHub();
    const st = async () => Object.fromEntries((await w.call(a, "GET", "/api/me/friends")).body.friends.map((f: any) => [f.nickname, f.status]));
    expect(await st()).toEqual({ 나: "unknown", 다: "playing" });
    await w.call(b, "GET", "/api/me/inbox?device=tab-xxxxxxxx");
    expect((await st())["나"]).toBe("online");
    // hidden: friends see offline (also while playing), and it is stored
    await w.call(c, "POST", "/api/me/friends/settings", { presence: "hidden" });
    expect((await st())["다"]).toBe("offline");
    w.restartHub();
    w.clock.t += FRIEND_LIMITS.onlineMs + 1;
    expect((await st())["다"]).toBe("offline");
    await w.call(c, "POST", "/api/me/friends/settings", { presence: "friends" });
    expect((await st())["다"]).toBe("playing");
    w.hub().setPlaying([c], null, w.clock.t);
    expect((await st())["다"]).toBe("offline");
    expect((await w.call(c, "POST", "/api/me/friends/settings", { presence: "everyone" })).status).toBe(400);
  });

  it("한쪽만 친구로 남은 경우(삭제 도중)·차단 후에는 상태가 보이지 않는다", async () => {
    const w = world();
    const a = w.add("hs1", "가");
    const b = w.add("hs2", "나");
    await w.befriend(a, b);
    await w.call(b, "GET", "/api/me/inbox?device=tab-xxxxxxxx");
    w.accounts.get(b)!.store.removeFriend(a); // b's half only
    expect((await w.call(a, "GET", "/api/me/friends")).body.friends[0].status).toBe("offline");
  });

  it("중앙 상태가 없는 구 Worker 구성에서는 기존 계정별 조회를 쓴다(호환)", async () => {
    const w = world({ central: false });
    const a = w.add("lg1", "가");
    const b = w.add("lg2", "나");
    await w.befriend(a, b);
    await w.call(b, "GET", "/api/me/inbox");
    expect((await w.call(a, "GET", "/api/me/friends")).body.friends[0].status).toBe("online");
    expect(w.calls.presence).toBe(1);
  });
});

describe("SOC-1 대전 신청", () => {
  it("친구 목록에서 바로 신청 → 초대 알림 → 수락 시 보낸 쪽에 '수락됨'; 중복 신청은 같은 방을 돌려줌", async () => {
    const w = world();
    const a = w.add("ch1", "가");
    const b = w.add("ch2", "나");
    await w.befriend(a, b);
    const bCode = await w.codeOf(b);
    const first = await w.challengeAs(a, bCode);
    expect(first.status).toBe(201);
    const body = first.body as any;
    expect(body).toMatchObject({ status: "sent", code: "ROOMAZ" });
    expect(body.invite).toMatchObject({ to: { code: bCode, nickname: "나" }, room: "ROOMAZ", state: "pending", kind: "challenge" });
    const again = await w.challengeAs(a, bCode);
    expect(again.status).toBe(200);
    expect((again.body as any).status).toBe("pending");
    expect(w.rooms.size).toBe(1);
    const inbox = (await w.call(b, "GET", "/api/me/inbox")).body;
    expect(inbox.invites).toHaveLength(1);
    expect(inbox.invites[0]).toMatchObject({ room: "ROOMAZ", from: { nickname: "가" } });
    // accept: (index.ts) takes the invite and marks the sender's copy
    const taken = w.accounts.get(b)!.store.takeInviteFrom(inbox.invites[0].id, w.clock.t)!;
    expect(taken.fromId).toBe(a);
    w.accounts.get(a)!.social.answerSent(taken.invite.id, "accepted");
    expect((await w.call(a, "GET", "/api/me/inbox")).body.sent[0].state).toBe("accepted");
    // the room filled: a new challenge makes a new room
    w.rooms.get("ROOMAZ")!.members.push(b);
    expect((await w.challengeAs(a, bCode)).status).toBe(201);
  });

  it("거절하면 보낸 쪽에 '거절됨', 10분 뒤 '만료', 보낸 사람이 취소하면 받은 쪽에서 사라짐", async () => {
    const w = world();
    const a = w.add("cd1", "가");
    const b = w.add("cd2", "나");
    const c = w.add("cd3", "다");
    await w.befriend(a, b);
    await w.befriend(a, c);
    await w.challengeAs(a, await w.codeOf(b));
    const inv = (await w.call(b, "GET", "/api/me/inbox")).body.invites[0];
    await w.call(b, "POST", "/api/me/invites/decline", { id: inv.id });
    expect((await w.call(a, "GET", "/api/me/inbox")).body.sent.find((s: any) => s.id === inv.id).state).toBe("declined");
    // declined → a new challenge is allowed at once (different invite)
    expect((await w.challengeAs(a, await w.codeOf(b))).status).toBe(201);
    w.clock.t += FRIEND_LIMITS.inviteTtlMs + 1;
    const sent = (await w.call(a, "GET", "/api/me/inbox")).body.sent;
    expect(sent.find((x: any) => x.id !== inv.id).state).toBe("expired");
    expect(sent.find((x: any) => x.id === inv.id).state).toBe("declined");
    expect((await w.call(b, "GET", "/api/me/inbox")).body.invites).toHaveLength(0);
    // cancel
    await w.challengeAs(a, await w.codeOf(c));
    const cInv = (await w.call(c, "GET", "/api/me/inbox")).body.invites[0];
    await w.call(a, "POST", "/api/me/invites/cancel", { id: cInv.id });
    expect((await w.call(c, "GET", "/api/me/inbox")).body.invites).toHaveLength(0);
    expect((await w.call(a, "GET", "/api/me/inbox")).body.sent.find((x: any) => x.id === cInv.id).state).toBe("cancelled");
    // someone else's id does nothing
    await w.call(b, "POST", "/api/me/invites/cancel", { id: cInv.id });
  });

  it("경기 중인 친구에게는 안내만, 친구가 아니면 거절, 비공개 설정 친구는 경기 중이어도 드러나지 않음", async () => {
    const w = world();
    const a = w.add("cb1", "가");
    const b = w.add("cb2", "나");
    const stranger = w.add("cb3", "남");
    await w.befriend(a, b);
    w.hub().setPlaying([b], "ROOM99", w.clock.t);
    const busy = await w.challengeAs(a, await w.codeOf(b));
    expect(busy.status).toBe(409);
    expect((busy.body as any).error.code).toBe("BUSY");
    expect(w.rooms.size).toBe(0);
    expect((await w.challengeAs(a, await w.codeOf(stranger))).status).toBe(404);
    await w.call(b, "POST", "/api/me/friends/settings", { presence: "hidden" });
    expect((await w.challengeAs(a, await w.codeOf(b))).status).toBe(201);
  });

  it("남용 방지: 신청은 분당 한도(limited)로 막힌다", async () => {
    const w = world();
    const a = w.add("ab1", "가");
    const b = w.add("ab2", "나");
    await w.befriend(a, b);
    w.deps.limited = async (key) => key.startsWith("challenge:");
    expect((await w.challengeAs(a, await w.codeOf(b))).status).toBe(429);
  });
});

describe("SOC-1 접속 상태: 재시작 직후 명시적 종료", () => {
  it("재시작 직후라도 모든 탭이 종료를 알린 계정은 '오프라인'(확인 불가 아님)", () => {
    const db = new DatabaseSync(":memory:");
    const s = { exec: (q: string, ...p: unknown[]) => { const st = db.prepare(q); const rows = /^\s*SELECT/i.test(q) ? (st.all(...(p as never[])) as never[]) : (st.run(...(p as never[])), [] as never[]); return { toArray: () => rows }; } };
    const hub = new PresenceHub(s, 1000);
    hub.init(1000);
    expect(hub.status("u_x", 2000)).toBe("unknown");
    hub.beat("u_x", "tab-aaaaaaaa", 2000);
    hub.beat("u_x", "tab-aaaaaaaa", 3000, "offline");
    expect(hub.status("u_x", 3000)).toBe("offline");
    hub.beat("u_y", "tab-bbbbbbbb", 3000, "offline");
    expect(hub.status("u_y", 3000)).toBe("offline");
    hub.sweep(4000);
    expect(hub.status("u_y", 4000)).toBe("offline");
  });
});
