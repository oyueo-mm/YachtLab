import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalWorker, type LocalWorker } from "./helpers/wrangler";
import { fakeLogin, startFakeIdp, type FakeIdp } from "./helpers/fake-idp";
import { userIdFor } from "../worker/src/oidc";

/**
 * ADMIN-1 / FEEDBACK-1 end to end in the real Workers runtime (wrangler dev --local, persisted SQLite in
 * a temp dir): new Durable Objects + migration v5, admin sign-in from a member session, role checks,
 * two-person approval, alarm-driven delivery, claim through the economy ledger, suspension enforcement,
 * appeal, suggestion board, account deletion. Local only — no Cloudflare account, no production data.
 */
const ORIGIN = "http://127.0.0.1:5173";
let idp: FakeIdp;
let worker: LocalWorker;
const ids: Record<string, string> = {};

beforeAll(async () => {
  idp = await startFakeIdp();
  for (const who of ["owner-a", "owner-b", "viewer", "member"]) ids[who] = await userIdFor("google", who);
  worker = await startLocalWorker({
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    AUTH_SECRET: "s".repeat(40),
    APP_URL: ORIGIN + "/YachtLab/",
    TEST_OIDC_ISSUER: idp.issuer,
    ECONOMY: "on",
    ADMIN_ACCOUNTS: `${ids["owner-a"]}:owner,${ids["owner-b"]}:owner,${ids.viewer}:viewer`,
    ADMIN_WRITES: "on",
    FEEDBACK_BOARD: "on",
  });
}, 120_000);
afterAll(async () => {
  await worker?.stop();
  idp?.close();
});

async function call(token: string | null, path: string, body?: unknown) {
  const res = await fetch(worker.url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: ORIGIN, ...(token ? { authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const adminSession = async (member: string) => (await call(member, "/api/admin/session", {})).body?.token as string;

describe("admin console and engagement in the Workers runtime", () => {
  it("runs the whole operator flow without touching anything outside this local worker", async () => {
    const a = await fakeLogin(worker.url, idp, "owner-a", ORIGIN);
    const b = await fakeLogin(worker.url, idp, "owner-b", ORIGIN);
    const v = await fakeLogin(worker.url, idp, "viewer", ORIGIN);
    const m = await fakeLogin(worker.url, idp, "member", ORIGIN);
    expect((await call(m, "/api/me/nickname", { nickname: "테스트회원" })).status).toBe(200);
    expect((await call(m, "/api/me/economy")).status).toBe(200);

    // non-admins: the admin API does not exist for them
    expect((await call(m, "/api/admin/session", {})).status).toBe(404);
    expect((await call(null, "/api/admin/overview")).status).toBe(404);
    const va = await adminSession(v);
    expect((await call(va, "/api/admin/overview")).status).toBe(200);
    expect((await call(va, "/api/admin/members")).status).toBe(403);

    const aa = await adminSession(a);
    const ba = await adminSession(b);
    const members = await call(aa, "/api/admin/members?nickname=" + encodeURIComponent("테스트"));
    expect(members.body.members.map((x: any) => x.userId)).toContain(ids.member);

    // notice → public list
    expect((await call(aa, "/api/admin/notices", { title: "점검 안내", body: "새벽 점검이 있어요", kind: "maintenance", important: true, status: "published" })).status).toBe(200);
    expect((await call(null, "/api/notices")).body.notices[0]).toMatchObject({ title: "점검 안내", important: true });

    // reward: draft (A) → approve (B) → alarm delivery → claim → ledger
    const before = (await call(m, "/api/me/economy")).body.snapshot.wallet.coins as number;
    const draft = await call(aa, "/api/admin/rewards", { title: "점검 보상", coins: 77, expiresAt: Date.now() + 86_400_000, target: { type: "users", userIds: [ids.member] } });
    expect(draft.status).toBe(201);
    expect((await call(aa, `/api/admin/actions/${draft.body.actionId}/approve`, { confirm: draft.body.actionId })).body.error.code).toBe("SECOND_APPROVER");
    expect((await call(ba, `/api/admin/actions/${draft.body.actionId}/approve`, { confirm: draft.body.actionId })).body.ok).toBe(true);
    let inbox: any = null;
    for (let i = 0; i < 40 && !inbox?.unclaimed; i++) {
      await new Promise((r) => setTimeout(r, 250));
      inbox = (await call(m, "/api/me/mailbox")).body;
    }
    expect(inbox.unclaimed).toBe(1);
    const claim = await call(m, `/api/me/mailbox/${inbox.items[0].id}/claim`, {});
    expect(claim.body).toMatchObject({ ok: true, coins: 77 });
    expect((await call(m, `/api/me/mailbox/${inbox.items[0].id}/claim`, {})).status).toBe(409);
    expect((await call(m, "/api/me/economy")).body.snapshot.wallet.coins).toBe(before + 77);
    const view = await call(aa, `/api/admin/members/${ids.member}`);
    expect(view.body.ledger.ok).toBe(true);
    expect(JSON.stringify(view.body)).not.toContain("s1.");

    // suggestion board
    const post = await call(m, "/api/suggestions", { category: "feature", title: "랭킹 시즌", body: "시즌제 랭킹이 있으면 좋겠어요" });
    expect(post.status).toBe(201);
    expect((await call(null, "/api/suggestions")).body.items[0]).toMatchObject({ title: "랭킹 시즌", author: "테스트회원" });

    // suspension: approved by the second owner, enforced on member writes and online play, appealed and lifted
    const s = await call(aa, "/api/admin/sanctions", { userId: ids.member, kind: "suspend", reason: "테스트 정지 사유", days: 1 });
    await call(ba, `/api/admin/actions/${s.body.actionId}/approve`, { confirm: s.body.actionId });
    expect((await call(m, "/api/me/nickname", { nickname: "바뀐이름" })).body.error.code).toBe("SUSPENDED");
    expect((await call(m, "/api/ai/start", {})).body.error.code).toBe("SANCTIONED");
    const mine = await call(m, "/api/me/sanctions");
    const appeal = await call(m, "/api/me/appeals", { sanctionId: mine.body.sanctions[0].id, text: "테스트 이의제기 내용입니다." });
    expect(appeal.status).toBe(201);
    expect((await call(aa, `/api/admin/appeals/${appeal.body.id}`, { status: "accepted", answer: "해제합니다" })).body.lifted).toBe(true);
    expect((await call(m, "/api/me/nickname", { nickname: "바뀐이름" })).status).toBe(200);

    const audit = await call(aa, "/api/admin/audit");
    expect(audit.body.entries.map((e: any) => e.action)).toEqual(expect.arrayContaining(["action.execute", "member.view", "appeal.answer", "denied"]));

    // account deletion: leaves the index; the post stays anonymous
    expect((await call(m, "/api/me/delete", { confirm: "DELETE" })).status).toBe(200);
    expect((await call(aa, `/api/admin/members?userId=${ids.member}`)).body.total).toBe(0);
    expect((await call(null, `/api/suggestions/${post.body.id}`)).body.suggestion.author).toBe("탈퇴한 사용자");
  }, 120_000);
});
