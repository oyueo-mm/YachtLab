import { beforeEach, describe, expect, it } from "vitest";
import { MANUAL_ADD_MESSAGE, loadRelation, liveApi, peekRelation, resetRelations, sendFriendRequest, setScopeProvider, type FriendApi, type VerifiedRelation } from "../src/social/friend-relations";

/**
 * Safety of friend requests from a match (review of #127): a request goes only to a person the SERVER has
 * bound to a friend code. Nickname search, public numbers, an unindexed account, capped search results and
 * same-name people can never decide whom to ask. Account switches isolate cache, in-flight lookups and sends.
 */
let account: string | null = "A";
beforeEach(() => {
  account = "A";
  setScopeProvider(() => account);
  resetRelations();
});

/** What the Worker offers today: legacy endpoints only (search by nickname / code, profile numbers, request by code). */
function legacyWorld(opts: { results?: { code: string; nickname: string; relation: string }[]; indexed?: boolean; capped?: boolean } = {}) {
  const calls = { search: 0, profile: 0, friendProfile: 0, request: 0 };
  const api: FriendApi = {
    // These exist on the server but must never be reached by the client for identity decisions.
    request: async () => (calls.request++, { status: "sent" }),
  };
  return { api, calls, search: async () => (calls.search++, opts.indexed === false ? [] : opts.results ?? [{ code: "YLAAAAAAAA", nickname: "철수", relation: "none" }]) };
}
const verified = (over: Partial<VerifiedRelation> = {}): VerifiedRelation => ({ relation: "none", code: "YLVERIFIED", nickname: "철수", ...over });
function verifiedWorld(over: Partial<VerifiedRelation> = {}) {
  const calls = { lookup: 0, request: 0 };
  const api: FriendApi = { relationByUserId: async () => (calls.lookup++, verified(over)), request: async () => (calls.request++, { status: "sent" }) };
  return { api, calls };
}

describe("검증되지 않은 기존 Worker에서는 닉네임·전적으로 추정하지 않고 요청을 막는다", () => {
  it("검증 기능이 없는 어댑터는 네트워크 호출 없이 unresolved이고 수동 친구 코드 입력을 안내한다", async () => {
    const w = legacyWorld();
    expect((await loadRelation("s", "u1", w.api)).relation).toBe("unresolved");
    const out = await sendFriendRequest("s", "u1", w.api);
    expect(out).toEqual({ ok: false, message: MANUAL_ADD_MESSAGE });
    expect(w.calls).toEqual({ search: 0, profile: 0, friendProfile: 0, request: 0 });
  });
  it("닉네임 검색 결과가 정확히 한 명이어도(그 사람이 실제 상대라는 보장이 없으므로) 요청하지 않는다", async () => {
    const w = legacyWorld({ results: [{ code: "YLAAAAAAAA", nickname: "철수", relation: "none" }] });
    expect((await sendFriendRequest("s", "u1", w.api)).ok).toBe(false);
    expect(w.calls.request).toBe(0);
  });
  it("동명이인(검색 결과 여러 명, 공개 수치가 같아도) 요청하지 않는다", async () => {
    const w = legacyWorld({ results: [{ code: "YLAAAAAAAA", nickname: "철수", relation: "none" }, { code: "YLBBBBBBBB", nickname: "철수", relation: "none" }] });
    expect((await sendFriendRequest("s", "u1", w.api)).ok).toBe(false);
    expect(w.calls.request).toBe(0);
  });
  it("대상 계정이 색인에 없어 검색 결과가 비어도(또는 다른 사람만 나와도) 요청하지 않는다", async () => {
    const empty = legacyWorld({ indexed: false });
    const other = legacyWorld({ results: [{ code: "YLCCCCCCCC", nickname: "철수(바뀐 닉네임의 다른 사람)", relation: "none" }] });
    for (const w of [empty, other]) {
      expect((await sendFriendRequest("s", "u2", w.api)).ok).toBe(false);
      expect(w.calls.request).toBe(0);
    }
  });
  it("검색 결과 개수 제한(10명)에 걸린 흔한 닉네임도 요청하지 않는다", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ code: "YL" + String(i).repeat(8), nickname: "철수", relation: "none" }));
    const w = legacyWorld({ results: many });
    expect((await sendFriendRequest("s", "u3", w.api)).ok).toBe(false);
    expect(w.calls.request).toBe(0);
  });
  it("실제 연결(liveApi): 서버가 계정-코드 대응을 확인해 주지 못하면(구 Worker 404·네트워크 오류) 요청하지 않는다", async () => {
    const api = liveApi("https://example.invalid");
    expect((await loadRelation("s", "u1", api)).relation).toBe("unresolved");
    expect((await sendFriendRequest("s", "u1", api)).ok).toBe(false);
  });
});

describe("서버가 계정과 친구 코드를 검증해 준 경우의 요청 보내기(후속 서버 계약용 상태 기계)", () => {
  it("관계가 없을 때만 한 번 보내고 대기 상태가 된다", async () => {
    const w = verifiedWorld();
    expect(await sendFriendRequest("s", "u1", w.api)).toEqual({ ok: true, relation: "outgoing", sent: true });
    expect(w.calls.request).toBe(1);
    expect(peekRelation("s", "u1")?.relation).toBe("outgoing");
  });
  it("연속·동시 탭은 요청 한 번", async () => {
    const w = verifiedWorld();
    const [a, b] = await Promise.all([sendFriendRequest("s", "u1", w.api), sendFriendRequest("s", "u1", w.api)]);
    expect(w.calls.request).toBe(1);
    expect(a).toEqual(b);
  });
  for (const relation of ["outgoing", "friend", "incoming", "blocked", "self"] as const) {
    it(`${relation}이면 보내지 않는다`, async () => {
      const w = verifiedWorld({ relation });
      expect(await sendFriendRequest("s", "u1", w.api)).toEqual({ ok: true, relation, sent: false });
      expect(w.calls.request).toBe(0);
    });
  }
  it("서로 요청이 엇갈리면 서버가 만든 친구 결과를 따르고, 서버 오류는 메시지로 돌려준다", async () => {
    expect(await sendFriendRequest("s", "u1", { ...verifiedWorld().api, request: async () => ({ status: "friends" }) })).toEqual({ ok: true, relation: "friend", sent: true });
    resetRelations();
    const out = await sendFriendRequest("s", "u1", { ...verifiedWorld().api, request: async () => { throw new Error("오늘은 친구 요청을 더 보낼 수 없어요."); } });
    expect(out).toEqual({ ok: false, message: "오늘은 친구 요청을 더 보낼 수 없어요." });
  });
  it("조회는 캐시되고 동시 호출은 한 번만 묻는다", async () => {
    const w = verifiedWorld();
    await Promise.all([loadRelation("s", "u1", w.api), loadRelation("s", "u1", w.api)]);
    await loadRelation("s", "u1", w.api);
    expect(w.calls.lookup).toBe(1);
  });
});

describe("계정 전환·로그아웃 시 격리", () => {
  const gate = () => { let open!: (v: VerifiedRelation) => void; const p = new Promise<VerifiedRelation>((r) => (open = r)); return { p, open }; };
  it("전환하면 이전 계정의 관계 캐시가 사라지고 새 계정은 처음부터 조회한다", async () => {
    const w = verifiedWorld({ relation: "friend" });
    await loadRelation("s", "u1", w.api);
    expect(peekRelation("s", "u1")?.relation).toBe("friend");
    account = "B";
    expect(peekRelation("s", "u1")).toBeNull();
    await loadRelation("s", "u1", w.api);
    expect(w.calls.lookup).toBe(2);
  });
  it("조회가 진행 중일 때 계정이 바뀌면 늦게 온 이전 계정 응답은 버려지고 캐시되지 않는다", async () => {
    const g = gate();
    const api: FriendApi = { relationByUserId: () => g.p, request: async () => ({}) };
    const pending = loadRelation("s", "u1", api);
    account = "B";
    expect(peekRelation("s", "u1")).toBeNull();
    g.open(verified({ relation: "friend" }));
    expect((await pending).relation).toBe("unresolved");
    expect(peekRelation("s", "u1")).toBeNull();
  });
  it("조회 중 전환 뒤 새 계정이 같은 사람을 조회해도 이전 계정의 진행 중 조회와 섞이지 않는다", async () => {
    const slow = gate();
    const apiA: FriendApi = { relationByUserId: () => slow.p, request: async () => ({}) };
    const a = loadRelation("s", "u1", apiA);
    account = "B";
    const b = await loadRelation("s", "u1", { relationByUserId: async () => verified({ relation: "incoming" }), request: async () => ({}) });
    expect(b.relation).toBe("incoming");
    slow.open(verified({ relation: "friend" })); // A's answer arrives last
    await a;
    expect(peekRelation("s", "u1")?.relation).toBe("incoming"); // B's own result stays
  });
  it("관계 확인 중 전환되면 요청을 보내지 않는다", async () => {
    const g = gate();
    let requests = 0;
    const api: FriendApi = { relationByUserId: () => g.p, request: async () => (requests++, { status: "sent" }) };
    const send = sendFriendRequest("s", "u1", api);
    account = "B";
    g.open(verified());
    const out = await send;
    expect(out.ok).toBe(false);
    expect(requests).toBe(0);
  });
  it("요청이 나간 뒤 늦게 도착한 응답이 새 계정 화면에 반영되지 않는다", async () => {
    const g = gate();
    const api: FriendApi = { relationByUserId: async () => verified(), request: () => g.p.then(() => ({ status: "sent" })) };
    const send = sendFriendRequest("s", "u1", api);
    await new Promise((r) => setTimeout(r, 0));
    account = null; // sign-out
    expect(peekRelation("s", "u1")).toBeNull();
    g.open(verified());
    const out = await send;
    expect(out.ok).toBe(false);
    expect(peekRelation("s", "u1")).toBeNull(); // nothing written for the new (signed-out) state
    account = "B";
    expect(peekRelation("s", "u1")).toBeNull();
  });
});

describe("친구 요청 모듈은 닉네임·공개 전적으로 사람을 고르는 API를 쓰지 않는다(정적 확인)", () => {
  it("friend-relations / 버튼 / 최근 대전 상대가 검색·공개 프로필·친구 프로필 호출을 import하지 않는다", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["friend-relations.ts", "FriendRequestButton.tsx", "RecentOpponents.tsx"]) {
      const src = readFileSync(new URL("../src/social/" + f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/searchFriends|friendProfile|publicProfile|friends\/search/);
    }
  });
});
