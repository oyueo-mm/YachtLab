import { beforeEach, describe, expect, it } from "vitest";
import { loadRelation, peekRelation, resetRelations, resolveRelation, sendFriendRequest, type FriendApi } from "../src/social/friend-relations";

const base = { userId: "u1", nickname: "철수", joinedAt: 1_700_000_000_000, online: { games: 5, wins: 3, losses: 2, draws: 0, best: 250, average: 200 } };
function fake(over: Partial<FriendApi> & { results?: { code: string; nickname: string; relation: any }[]; profiles?: Record<string, any> } = {}) {
  const calls = { search: 0, request: 0, profile: 0 };
  const api: FriendApi = {
    profile: async () => (calls.profile++, base),
    search: async () => (calls.search++, over.results ?? [{ code: "YLAAAAAAAA", nickname: "철수", relation: "none" }]),
    friendProfile: async (code) => over.profiles?.[code] ?? { code, nickname: "철수", joinedAt: 0, online: { games: 0, wins: 0, losses: 0, draws: 0, best: null, average: null } },
    action: async () => (calls.request++, { status: "sent" }),
    ...over,
  } as FriendApi;
  return { api, calls };
}
beforeEach(() => resetRelations());

describe("친구 요청 관계 확인", () => {
  it("닉네임이 유일하면 그 사람의 관계와 코드를 쓴다", async () => {
    const { api } = fake({ results: [{ code: "YLBBBBBBBB", nickname: "철수", relation: "friend" }] });
    expect(await resolveRelation(api, "u1")).toMatchObject({ relation: "friend", code: "YLBBBBBBBB" });
  });
  it("닉네임이 같은 사람이 여럿이면 공개 수치가 일치하는 한 명만 인정한다", async () => {
    const { api } = fake({
      results: [{ code: "YLAAAAAAAA", nickname: "철수", relation: "none" }, { code: "YLCCCCCCCC", nickname: "철수", relation: "outgoing" }],
      profiles: { YLCCCCCCCC: { ...base, code: "YLCCCCCCCC" } },
    });
    expect(await resolveRelation(api, "u1")).toMatchObject({ relation: "outgoing", code: "YLCCCCCCCC" });
  });
  it("구분할 수 없으면 unresolved이고 요청을 보내지 않는다", async () => {
    const { api, calls } = fake({ results: [{ code: "YLAAAAAAAA", nickname: "철수", relation: "none" }, { code: "YLCCCCCCCC", nickname: "철수", relation: "none" }] });
    expect((await resolveRelation(api, "u1")).relation).toBe("unresolved");
    const out = await sendFriendRequest("s", "u1", api);
    expect(out.ok).toBe(false);
    expect(calls.request).toBe(0);
  });
});

describe("친구 요청 보내기", () => {
  it("관계가 없을 때만 한 번 보내고 대기 상태가 된다", async () => {
    const { api, calls } = fake();
    expect(await sendFriendRequest("s", "u1", api)).toEqual({ ok: true, relation: "outgoing", sent: true });
    expect(calls.request).toBe(1);
    expect(peekRelation("s", "u1")?.relation).toBe("outgoing");
  });
  it("연속으로 눌러도(동시) 요청은 한 번만 간다", async () => {
    const { api, calls } = fake();
    const [a, b] = await Promise.all([sendFriendRequest("s", "u1", api), sendFriendRequest("s", "u1", api)]);
    expect(calls.request).toBe(1);
    expect(a).toEqual(b);
  });
  it("이미 보낸 뒤 다시 눌러도 서버가 알려 준 대기 상태를 존중해 다시 보내지 않는다", async () => {
    const { api, calls } = fake({ results: [{ code: "YLAAAAAAAA", nickname: "철수", relation: "outgoing" }] });
    expect(await sendFriendRequest("s", "u1", api)).toEqual({ ok: true, relation: "outgoing", sent: false });
    expect(calls.request).toBe(0);
  });
  for (const relation of ["friend", "incoming", "blocked", "self"] as const) {
    it(`${relation}이면 요청을 보내지 않는다`, async () => {
      const { api, calls } = fake({ results: [{ code: "YLAAAAAAAA", nickname: "철수", relation }] });
      const out = await sendFriendRequest("s", "u1", api);
      expect(out).toEqual({ ok: true, relation, sent: false });
      expect(calls.request).toBe(0);
    });
  }
  it("서로 요청이 엇갈리면 서버가 친구로 만든 결과를 따른다", async () => {
    const { api } = fake({ action: async () => ({ status: "friends" }) });
    expect(await sendFriendRequest("s", "u1", api)).toEqual({ ok: true, relation: "friend", sent: true });
  });
  it("서버 오류는 메시지로 돌려주고 대기 상태로 바꾸지 않는다", async () => {
    const { api } = fake({ action: async () => { throw new Error("오늘은 친구 요청을 더 보낼 수 없어요."); } });
    expect(await sendFriendRequest("s", "u1", api)).toEqual({ ok: false, message: "오늘은 친구 요청을 더 보낼 수 없어요." });
    expect(peekRelation("s", "u1")?.relation).toBe("none");
  });
  it("관계 조회는 캐시되고 동시 호출은 한 번만 검색한다", async () => {
    const { api, calls } = fake();
    await Promise.all([loadRelation("s", "u1", api), loadRelation("s", "u1", api)]);
    await loadRelation("s", "u1", api);
    expect(calls.search).toBe(1);
  });
});
