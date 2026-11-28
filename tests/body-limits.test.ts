import { describe, expect, it } from "vitest";
import { readJsonObject, readLimitedText } from "../worker/src/limits";

/** SEC-1: body size is checked before / while reading, never after buffering the whole body. */
const streamed = (parts: string[]) => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= parts.length) return c.close();
      c.enqueue(new TextEncoder().encode(parts[pulled++]));
    },
  });
  return { req: new Request("http://x/", { method: "POST", body, duplex: "half" } as RequestInit), pulled: () => pulled };
};

describe("요청 본문 크기 사전 검사", () => {
  it("선언된 Content-Length가 한도를 넘으면 읽지 않고 거절", async () => {
    const req = new Request("http://x/", { method: "POST", body: "{}", headers: { "content-length": "99999" } });
    await expect(readLimitedText(req, 100)).rejects.toThrow("too large");
    expect(req.bodyUsed).toBe(false);
  });
  it("길이 선언 없는 스트림은 한도를 넘는 순간 중단(나머지 청크를 읽지 않음)", async () => {
    const s = streamed(["x".repeat(60), "x".repeat(60), "x".repeat(60), "x".repeat(60)]);
    await expect(readLimitedText(s.req, 100)).rejects.toThrow("too large");
    expect(s.pulled()).toBeLessThan(4);
  });
  it("한도 안의 정상 JSON 객체는 그대로, 배열·잘못된 UTF-8·비객체는 SyntaxError", async () => {
    expect(await readJsonObject(new Request("http://x/", { method: "POST", body: '{"a":1}' }), 100)).toEqual({ a: 1 });
    expect(await readJsonObject(new Request("http://x/", { method: "POST" }), 100)).toEqual({});
    await expect(readJsonObject(new Request("http://x/", { method: "POST", body: "[1]" }), 100)).rejects.toBeInstanceOf(SyntaxError);
    await expect(readJsonObject(new Request("http://x/", { method: "POST", body: new Uint8Array([0xff, 0xfe]) }), 100)).rejects.toBeInstanceOf(SyntaxError);
  });
});
