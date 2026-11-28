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
