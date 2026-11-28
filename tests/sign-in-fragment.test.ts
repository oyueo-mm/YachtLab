import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSignIn } from "../src/identity/account-client";

/** SEC-1-12: the sign-in fragment leaves the address bar even when it is malformed. */
function stubBrowser(hash: string) {
  const loc = { hash, pathname: "/YachtLab/", search: "" };
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => void (loc.hash = url.slice(url.indexOf("#"))));
  const store = new Map<string, string>();
  vi.stubGlobal("location", loc);
  vi.stubGlobal("history", { state: null, replaceState });
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k), setItem: (k: string, v: string) => void store.set(k, v) });
  return { loc, replaceState };
}
afterEach(() => vi.unstubAllGlobals());

describe("로그인 프래그먼트 정리", () => {
  it("형식이 깨진 코드도 주소창에서 지우고 실패로 끝난다", async () => {
    const { loc, replaceState } = stubBrowser("#login=%E0%A4%A");
    await expect(completeSignIn("https://api.example")).resolves.toMatchObject({ ok: false });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(loc.hash).toBe("#profile");
  });
  it("이 브라우저에서 시작하지 않은 정상 형식 코드도 지운 뒤 거절한다", async () => {
    const { loc } = stubBrowser("#login=u_" + "a".repeat(22) + "." + "b".repeat(43));
    await expect(completeSignIn("https://api.example")).resolves.toMatchObject({ ok: false });
    expect(loc.hash).toBe("#profile");
  });
});
