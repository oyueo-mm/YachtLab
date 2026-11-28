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
    const w = world({ FEEDBACK_BOARD: "on" });
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
