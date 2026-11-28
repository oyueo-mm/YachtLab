import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleAdminRoute, handleEngagementRoute } from "../worker/src/admin/api";
import { BODY_LIMITS } from "../worker/src/limits";
import { reply, uid, world } from "./helpers/admin-fakes";

/**
 * SEC-1 2차 감사 후속(INT-1 통합 트리). 발견 ID는 감사 보고서의 ID다(담당 트랙 ID 아님).
 * INT-1: 관리자·참여·일일 경로의 본문은 선언 길이와 실제 스트림 바이트 모두 상한을 넘으면 읽기를 멈춘다.
 */
const A = uid("A"), B = uid("B"), U = uid("U");
const streamed = (path: string, token: string, chunks: number, size: number) => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= chunks) return c.close();
      pulled++;
      c.enqueue(new TextEncoder().encode(pulled === 1 ? '{"x":"' + "a".repeat(size - 6) : "a".repeat(size)));
    },
  });
  const request = new Request("https://w.example" + path, { method: "POST", body, duplex: "half", headers: { authorization: "Bearer " + token, "content-type": "application/json" } } as RequestInit);
  return { request, pulled: () => pulled };
};

describe("SEC-1 2차 INT-1 · 본문 크기 상한", () => {
  it("관리자 쓰기 경로: 길이 선언 없는 큰 스트림은 상한을 넘는 즉시 400, 나머지는 읽지 않는다", async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner,${B}:owner`, ADMIN_WRITES: "on" });
    const token = (await w.adminLogin(w.account(A).session)).token as string;
    const s = streamed("/api/admin/notices", token, 64, 4096);
    const r = await handleAdminRoute(s.request, new URL(s.request.url), w.backends(), reply);
    expect(r.status).toBe(400);
    expect(s.pulled()).toBeLessThan(64);
    expect(s.pulled() * 4096).toBeLessThanOrEqual(BODY_LIMITS.admin + 2 * 4096);
  });

  it("참여 경로(제안·쿠폰 등): 같은 방식으로 상한 적용", async () => {
    const w = world({});
    const m = w.account(U);
    const s = streamed("/api/me/redeem", m.session, 64, 4096);
    const r = (await handleEngagementRoute(s.request, new URL(s.request.url), w.backends(), reply))!;
    expect(r.status).toBe(400);
    expect(s.pulled()).toBeLessThan(64);
  });

  it("선언된 Content-Length가 상한을 넘으면 본문을 전혀 읽지 않는다", async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner`, ADMIN_WRITES: "on" });
    const token = (await w.adminLogin(w.account(A).session)).token as string;
    const request = new Request("https://w.example/api/admin/notices", { method: "POST", body: "{}", headers: { authorization: "Bearer " + token, "content-length": String(BODY_LIMITS.admin + 1) } });
    const r = await handleAdminRoute(request, new URL(request.url), w.backends(), reply);
    expect(r.status).toBe(400);
    expect(request.bodyUsed).toBe(false);
  });

  it("Worker 소스 어디에서도 request.text()/json()으로 본문 전체를 버퍼링하지 않는다(일일 경로 포함)", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
    walk("worker/src");
    const offenders = files.filter((f) => /\b(request|req)\.(text|json|arrayBuffer|formData)\(\)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    expect(readFileSync("worker/src/index.ts", "utf8")).toContain("readJsonObject(request, BODY_LIMITS.daily)");
  });
});

describe("SEC-1 2차 INT-3 · RETENTION 마스터 스위치", () => {
  const grant = { approver: A, policyVersion: "policy-1" };
  it("스위치가 꺼지면 관리자 보상 전달·알림함 수령·쿠폰 지급이 모두 RETENTION_OFF, 원장 변화 없음", async () => {
    const w = world({ RETENTION: "off" });
    const m = w.account(U);
    const g = () => m.account.econ.snapshot(U, w.clock()).ledger.filter((l: { id: string }) => l.id.startsWith("g:")).length;
    const item = { id: "op:rw_" + "q".repeat(16), kind: "reward" as const, title: "보상", body: "", coins: 10, gems: 0, expiresAt: w.clock() + 86_400_000, grant };
    await expect(m.account.deliver(item)).rejects.toMatchObject({ code: "RETENTION_OFF" });
    expect((await m.account.claim(item.id)) as { code: string }).toMatchObject({ code: "RETENTION_OFF" });
    expect((await m.account.redeemGrant({ ...item, id: "code:cd_" + "q".repeat(16), kind: "reward" })) as { code: string }).toMatchObject({ code: "RETENTION_OFF" });
    expect(g()).toBe(0);
    expect(m.account.grants.inbox(w.clock())).toHaveLength(0);
  });

  it("스위치가 켜진 뒤 끈 경우(롤백): 이미 보상함에 있던 보상도 호환 수령 경로로 받을 수 없다", async () => {
    const w = world({});
    const m = w.account(U);
    const item = { id: "op:rw_" + "r".repeat(16), kind: "reward" as const, title: "보상", body: "", coins: 10, gems: 0, expiresAt: w.clock() + 86_400_000, grant };
    await m.account.deliver(item);
    m.account.rewardsOn = false;
    expect((await m.account.claim(item.id)) as { code: string }).toMatchObject({ code: "RETENTION_OFF" });
    expect(m.account.grants.inbox(w.clock())).toHaveLength(1); // kept for later, not paid
  });

  it("호환 수령 경로는 관리자 전달 항목(op:/sug:)만 받는다 — 출석 등 다른 C5 보상 txId는 NOT_FOUND", async () => {
    const w = world({});
    const m = w.account(U);
    for (const id of ["att:2026-11-28", "code:cd_" + "s".repeat(16), "streak:30", "x"]) {
      expect((await m.account.claim(id)) as { code: string }).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("UserStore는 ECONOMY와 RETENTION이 모두 on일 때만 어댑터를 연다", () => {
    const src = readFileSync("worker/src/index.ts", "utf8");
    expect(src).toContain("rewardsOn: this.retentionOn");
    expect(src).toMatch(/get retentionOn\(\) \{\s*return this\.economyOn && this\.env\.RETENTION === "on";/);
  });
});

import { CleanupQueue, EXT_CLEANUP_TABLE, INDEX_TARGET, runCleanup } from "../worker/src/account-cleanup";
import { sqlite } from "./helpers/admin-fakes";

describe("SEC-1 2차 INT-7 · 롤백에도 관리자·게시판 탈퇴 정리가 남는다", () => {
  it("이전 버전(기본 대기열만 읽고 알 수 없는 대상을 계정으로 처리)이 돌아도 확장 대기열 작업은 그대로 남고, 롤포워드 뒤 실행된다", async () => {
    const sql = sqlite();
    const base = new CleanupQueue(sql), ext = new CleanupQueue(sql, EXT_CLEANUP_TABLE);
    base.init(); ext.init();
    base.enqueue(U, [INDEX_TARGET, uid("P")], "YL12345678", 0);
    ext.enqueue(U, ["@admin", "@board"], "YL12345678", 0);
    // the pre-INT-1 Worker: index → index, anything else → an account `fr("forget")` (neutral success)
    const oldSeen: string[] = [];
    await runCleanup(new CleanupQueue(sql), async (job) => void oldSeen.push(job.target), () => 0);
    expect(oldSeen.sort()).toEqual([INDEX_TARGET, uid("P")].sort());
    expect(oldSeen).not.toContain("@admin");
    expect(ext.pending()).toBe(2);
    // roll forward: the current Worker works through the extension queue
    const sent: string[] = [];
    expect(await runCleanup(ext, async (job) => void sent.push(job.target), () => 1)).toMatchObject({ done: 2, remaining: 0 });
    expect(sent.sort()).toEqual(["@admin", "@board"]);
  });
  it("UserStore는 관리자·게시판 대상을 확장 대기열에만 넣고, 탈퇴 시 그 테이블을 보존하며, 경보·재시도·종료를 두 대기열 모두에 적용한다", () => {
    const src = readFileSync("worker/src/index.ts", "utf8");
    expect(src).toContain("this.extCleanup.enqueue(owner, [ADMIN_TARGET, BOARD_TARGET], plan.code, now)");
    expect(src).not.toMatch(/this\.cleanup\.enqueue\([^)]*ADMIN_TARGET/);
    expect(src).toContain('new Set(["tomb", "acct_cleanup", EXT_CLEANUP_TABLE, "fr_retired", "daily_used"])');
    expect(src).toContain("this.extCleanup.nextAt()");
    expect(src).toContain("this.extCleanup.requeue(epoch, now)");
    expect(src).toContain("this.extCleanup.parked() === this.extCleanup.pending()");
  });
  it("대기열 테이블 이름은 소문자·밑줄만 허용(SQL 식별자 주입 불가)", () => {
    expect(() => new CleanupQueue(sqlite(), 'x"; DROP TABLE tomb; --')).toThrow();
  });
});

describe("SEC-1 2차 · 기능이 꺼진 상태의 경로", () => {
  it("RETENTION이 꺼지면 쿠폰·알림함 수령은 관리자 허브를 부르기 전에 404 RETENTION_OFF", async () => {
    const w = world({ RETENTION: "off" });
    const m = w.account(U);
    const calls: string[] = [];
    const backends = w.backends();
    const admin = backends.admin;
    backends.admin = { op: (name: string, ...a: unknown[]) => (calls.push(name), (admin.op as (n: string, ...x: unknown[]) => Promise<unknown>)(name, ...a)) } as typeof admin;
    for (const path of ["/api/me/redeem", "/api/me/rewards/redeem", `/api/me/mailbox/op:rw_${"a".repeat(16)}/claim`]) {
      const request = new Request("https://w.example" + path, { method: "POST", headers: { authorization: "Bearer " + m.session, "content-type": "application/json" }, body: JSON.stringify({ code: "ANYCODE1" }) });
      const r = (await handleEngagementRoute(request, new URL(request.url), backends, reply))!;
      expect(r.status).toBe(404);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("RETENTION_OFF");
    }
    expect(calls.filter((c) => c === "redeem" || c === "code")).toEqual([]);
  });
});

describe("SEC-1 2차 ECO-2/ECO-3 · 교환 코드", () => {
  const route = async (w: ReturnType<typeof world>, path: string, token: string, body: unknown) => {
    const r = await handleAdminRoute(new Request("https://w.example" + path, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) }), new URL("https://w.example" + path), w.backends(), reply);
    return (await r.json()) as Record<string, any>;
  };
  const eng = async (w: ReturnType<typeof world>, token: string, code: string) => {
    const request = new Request("https://w.example/api/me/rewards/redeem", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const r = (await handleEngagementRoute(request, new URL(request.url), w.backends(), reply))!;
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  it("없는 코드·시작 전 코드·대상 외 코드·소진된 코드는 같은 응답(존재 여부를 알 수 없음), 본인 사용 이력만 구분", async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner,${B}:owner`, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "policy-1" });
    const a = (await w.adminLogin(w.account(A).session)).token as string;
    const b = (await w.adminLogin(w.account(B).session)).token as string;
    const make = async (body: Record<string, unknown>) => {
      const c = await route(w, "/api/admin/codes", a, { title: "쿠폰", coins: 5, endsAt: w.clock() + 86_400_000 * 5, maxTotal: 10, ...body });
      await route(w, `/api/admin/actions/${c.actionId}/approve`, b, { confirm: c.actionId });
    };
    await make({ code: "LATER2026", startsAt: w.clock() + 86_400_000 });
    await make({ code: "OLDONLY26", joinedBefore: w.clock() - 86_400_000 * 365 });
    await make({ code: "ONEUSE26", maxTotal: 1 });
    const m = w.account(U), other = w.account(uid("O"));
    expect((await eng(w, other.session, "ONEUSE26")).status).toBe(200); // used up by someone else
    const answers = await Promise.all(["NOSUCH2026", "LATER2026", "OLDONLY26", "ONEUSE26"].map((c) => eng(w, m.session, c)));
    expect(new Set(answers.map((x) => JSON.stringify([x.status, x.body.error.code, x.body.error.message]))).size).toBe(1);
    expect(answers[0].body.error.code).toBe("INVALID_CODE");
    // only my own earlier use is told apart
    expect((await eng(w, other.session, "ONEUSE26")).body.error.code).toBe("CODE_USED");
  });
  it("Worker 라우터가 /api/me/rewards/redeem을 관리자 쿠폰 흐름으로 보낸다(보상 페이지 쿠폰 입력 하나)", () => {
    const src = readFileSync("worker/src/index.ts", "utf8");
    expect(src).toContain('(parts[2] === "rewards" && parts[3] === "redeem" && parts.length === 4)');
    expect(src).toContain('redeem: this.grants.isEnabled("redeem-code")');
  });
});

describe("SEC-1 2차 ADM-2 · 관리자 작업과 감사 기록의 장애 일관성", () => {
  const post = async (w: ReturnType<typeof world>, path: string, token: string, body: unknown) => {
    const r = await handleAdminRoute(new Request("https://w.example" + path, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) }), new URL("https://w.example" + path), w.backends(), reply);
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  const setup = async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner,${B}:owner`, ADMIN_WRITES: "on" });
    const a = (await w.adminLogin(w.account(A).session)).token as string;
    const b = (await w.adminLogin(w.account(B).session)).token as string;
    const m = w.account(U);
    const d = await post(w, "/api/admin/sanctions", a, { userId: U, kind: "suspend", reason: "감사 시험", days: 3 });
    return { w, a, b, m, id: d.body.actionId as string };
  };
  it("효과 전에 'started' 감사 행과 executing 상태가 함께 기록되고, 끝나면 상태와 결과 행이 함께 기록된다", async () => {
    const { w, b, id } = await setup();
    expect((await post(w, `/api/admin/actions/${id}/approve`, b, { confirm: id })).status).toBe(200);
    const rows = w.admin.auditLog({ limit: 50 }).entries.filter((e: any) => e.action === "action.execute" && e.target === id).map((e: any) => e.result);
    expect(rows.sort()).toEqual(["ok", "started"]);
    expect(w.admin.action(id)!.status).toBe("executed");
  });
  it("결과 기록 직전에 관리자 허브 호출이 실패해도 'started' 행과 executing 상태가 남고, 재개(resume)가 같은 효과를 한 번만 적용한다", async () => {
    const { w, b, m, id } = await setup();
    const backends = w.backends();
    const op = backends.admin.op.bind(backends.admin) as (n: string, ...x: unknown[]) => Promise<unknown>;
    let failFinish = true;
    backends.admin = { ...backends.admin, op: (n: string, ...x: unknown[]) => (n === "finishExecution" && failFinish ? Promise.reject(new Error("hub down")) : op(n, ...x)) } as typeof backends.admin;
    const path = `/api/admin/actions/${id}/approve`;
    await expect(handleAdminRoute(new Request("https://w.example" + path, { method: "POST", headers: { authorization: "Bearer " + b, "content-type": "application/json" }, body: JSON.stringify({ confirm: id }) }), new URL("https://w.example" + path), backends, reply)).rejects.toThrow();
    expect(w.admin.action(id)!.status).toBe("executing");
    expect(w.admin.auditLog({ limit: 50 }).entries.filter((e: any) => e.target === id && e.result === "started")).toHaveLength(1);
    const sanctionsBefore = await m.account.mySanctions();
    expect(sanctionsBefore).toHaveLength(1); // the effect happened in the account
    failFinish = false;
    // still inside the stale window: not resumable yet (it may be running)
    expect((await post(w, `/api/admin/actions/${id}/resume`, b, { confirm: id })).body.error.code).toBe("RUNNING");
    w.advance(121_000);
    const r = await post(w, `/api/admin/actions/${id}/resume`, b, { confirm: id });
    expect(r.status).toBe(200);
    expect(r.body.attempt).toBe(2);
    expect(w.admin.action(id)!.status).toBe("executed");
    expect(await m.account.mySanctions()).toHaveLength(1); // idempotent: not applied twice
    // a finished action cannot be resumed again
    expect((await post(w, `/api/admin/actions/${id}/resume`, b, { confirm: id })).status).toBe(409);
  });
  it("대기 중인 작업은 재개 경로로 실행할 수 없다(승인 절차 우회 불가)", async () => {
    const { w, b, id } = await setup();
    expect((await post(w, `/api/admin/actions/${id}/resume`, b, { confirm: id })).status).toBe(409);
    expect(w.admin.action(id)!.status).toBe("pending");
  });
});

describe("SEC-1 2차 INT-6 · 재가입 제재 승계(장애 시 닫힘)", () => {
  it("진행 중 제재 조회가 실패하면 계정·로그인 코드를 만들지 않는다(빈 목록으로 대체하지 않음), 계정 생성과 제재 적용은 한 트랜잭션", () => {
    const src = readFileSync("worker/src/index.ts", "utf8");
    const body = src.slice(src.indexOf("async ensureAndCode("), src.indexOf("async exchange("));
    expect(body).not.toMatch(/op\("signup"[^;]*\.catch\(/);
    expect(body.indexOf('op("signup"')).toBeLessThan(body.indexOf("ensureUser(userId, provider"));
    expect(body).toMatch(/transactionSync\(\(\) => \{\s*this\.store\.ensureUser\(userId, provider, Date\.now\(\)\);\s*for \(const c of carried\) this\.member\.applySanction/);
  });
});

describe("SEC-1 2차 INT-4/INT-5 · 공개 경로 요청 비용", () => {
  it("공지: NOTICES 꺼짐이면 관리자 허브를 부르지 않고, 켜짐이면 인스턴스 캐시·클라이언트 한도를 쓴다", () => {
    const src = readFileSync("worker/src/index.ts", "utf8");
    expect(src).toContain('(parts[1] === "notices" && (!env.ADMIN || env.NOTICES !== "on")) return reply(200, { notices: [] })');
    expect(src).toContain('isolateLimited("notices:" + (await clientKey(request)), 30)');
    expect(src).toContain("NOTICES_CACHE_MS");
  });
  it("오늘의 요트: 퍼즐 상태는 인스턴스 캐시, 회원 정보는 계정 호출 1번", () => {
    const api = readFileSync("worker/src/daily-api.ts", "utf8");
    expect(api).toContain("await cachedFlags(deps.board(today), today, Date.now())");
    expect(api).toContain("await u.dailyToday(today, puzzles.map((p) => p.id))");
    expect(readFileSync("worker/src/daily-admin.ts", "utf8")).toContain("forgetDailyFlags(date)");
  });
});

describe("SEC-1 2차 ADM-2(원본 R5) · 관리자 색인 안의 쓰기와 감사 행은 함께 기록되거나 함께 실패한다", () => {
  const post = async (w: ReturnType<typeof world>, path: string, token: string, body: unknown, backends = w.backends()) => {
    const r = await handleAdminRoute(new Request("https://w.example" + path, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) }), new URL("https://w.example" + path), backends, reply);
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  it("감사 기록이 실패하면 공지도 게시되지 않는다(같은 트랜잭션), 성공하면 둘 다 남는다", async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner,${B}:owner`, ADMIN_WRITES: "on" });
    const a = (await w.adminLogin(w.account(A).session)).token as string;
    const core = w.admin as unknown as { audit: (e: unknown) => void };
    const real = core.audit.bind(core);
    core.audit = () => { throw new Error("DO reset"); };
    await expect(post(w, "/api/admin/notices", a, { title: "공지 제목", body: "공지 본문", status: "published" })).rejects.toThrow();
    core.audit = real;
    expect(w.admin.notices(false, w.clock())).toHaveLength(0);
    expect((await post(w, "/api/admin/notices", a, { title: "공지 제목", body: "공지 본문", status: "published" })).status).toBe(200);
    expect(w.admin.notices(false, w.clock())).toHaveLength(1);
    expect(w.admin.auditLog({ action: "notice" }).entries).toHaveLength(1);
  });
  it("관리자 색인 쓰기 경로는 별도 audit 호출 없이 audited로만 기록한다(정적)", () => {
    const src = readFileSync("worker/src/admin/api.ts", "utf8");
    expect(src).toContain("audited<");
    // (recordSanction inside an approved action's execution is covered by beginExecution / finishExecution)
    for (const op of ["saveNotice", "endNotice", "createCode", "updateReport", "answerAppeal", "cancelCampaign"]) expect(src).not.toMatch(new RegExp(`b\\.admin\\.op[^(]*\\("${op}"`));
    expect(readFileSync("worker/src/index.ts", "utf8")).toContain('fail(503, "AUDIT_UNAVAILABLE"');
  });
  it("원본 R1(ADM-3): 늦은 탈퇴 정리 재시도는 재가입 계정의 대기 지급을 지우지 않는다", async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner,${B}:owner`, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "p1" });
    const t0 = w.clock();
    w.admin.activity({ userId: U, nickname: "n", createdAt: t0 - 86_400_000, day: 1, firstInWeek: true, firstInMonth: true, gapDays: null } as never);
    w.advance(3600_000);
    w.admin.signup(U, w.clock());
    w.admin.scheduleCampaign("act_" + "1".repeat(20), { title: "t", message: "m", coins: 1, gems: 0, target: { type: "users", userIds: [U] }, scheduledAt: w.clock() + 3600_000, expiresAt: w.clock() + 2 * 86_400_000, approvedBy: A, policyVersion: "p1" } as never, w.clock());
    w.advance(2 * 3600_000);
    await (w.admin as unknown as { process: (n: number, f: () => Promise<never>) => Promise<unknown> }).process(w.clock(), async () => { throw new Error("transient"); });
    const pending = () => (w.admin as unknown as { sql: { exec: (q: string, ...p: unknown[]) => { toArray(): { n: number }[] } } }).sql.exec("SELECT count(*) AS n FROM deliveries WHERE user_id = ? AND status = 'pending'", U).toArray()[0].n;
    expect(pending()).toBe(1);
    w.admin.deleted(U, t0);
    expect(pending()).toBe(1);
  });
});

describe("SEC-1 2차 ADM-5·ADM-6(원본 R2b·R4b) · 객체 간 지연이 있는 동시 요청", () => {
  const slow = (o: any) => ({ ...o, op: async (n: string, ...x: unknown[]) => { await new Promise((r) => setTimeout(r, 5)); return o.op(n, ...x); } });
  const call = async (w: ReturnType<typeof world>, path: string, token: string, body: unknown, extra: Record<string, unknown> = {}) => {
    const r = await handleAdminRoute(new Request("https://w.example" + path, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) }), new URL("https://w.example" + path), { ...w.backends(), ...extra } as never, reply);
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  it("같은 제안의 채택 보상 초안은 동시에 요청해도 하나만 만들어진다", async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner,${B}:owner`, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "p1" });
    const a = (await w.adminLogin(w.account(A).session)).token as string;
    const V = uid("V");
    w.account(V);
    const sg = w.board.create({ userId: V, nickname: "v" }, { category: "feature", title: "좋은 제안입니다", body: "내용을 열 글자 이상 적어요" }, w.clock()) as { id: string };
    await call(w, `/api/admin/suggestions/${sg.id}`, a, { status: "adopted", adoptReason: "채택합니다" });
    const base = w.backends();
    const rs = await Promise.all([1, 2, 3].map(() => call(w, `/api/admin/suggestions/${sg.id}/reward`, a, { coins: 10 }, { board: slow(base.board), admin: slow(base.admin) })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.body.error?.code === "DUPLICATE")).toHaveLength(2);
    expect(w.admin.actions("pending")).toHaveLength(1);
  });
  it("동시 본인 승인 3건: 실행 1건, 하루 예산도 1건만 소진", async () => {
    const w = world({ ADMIN_ACCOUNTS: `${A}:owner`, ADMIN_WRITES: "on", ADMIN_REWARD_POLICY: "p1", ADMIN_APPROVAL: "self" });
    let a = (await w.adminLogin(w.account(A).session)).token as string;
    w.account(U);
    const d = await call(w, "/api/admin/rewards", a, { title: "보상", coins: 5, expiresAt: w.clock() + 2 * 86_400_000, target: { type: "users", userIds: [U] } });
    w.advance(11 * 60_000);
    a = (await w.adminLogin(w.account(A).session)).token as string;
    const base = w.backends();
    const rs = await Promise.all([1, 2, 3].map(() => call(w, `/api/admin/actions/${d.body.actionId}/approve`, a, { confirm: d.body.actionId }, { admin: slow(base.admin) })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((w.admin as unknown as { sql: { exec: (q: string) => { toArray(): { n: number }[] } } }).sql.exec("SELECT n FROM self_approvals").toArray()).toEqual([{ n: 1 }]);
    expect(w.admin.campaigns()).toHaveLength(1);
  });
});
