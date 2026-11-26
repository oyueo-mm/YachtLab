import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { setDPTable } from "../src/dp";
import { DatabaseSync } from "node:sqlite";
import { categories, total, type Category } from "../src/engine";
import { createMultiGame, createSoloGame, transitionMulti } from "../src/multi-engine";
import { appendMultiAction, newMultiReplay, validateMultiReplay } from "../src/multi-replay";
import { previousBest, sanitizeSoloRecord, soloStats, type SoloRecord } from "../src/solo/records";
import { fromSoloReplay } from "../src/review/sources";
import { assessSituation } from "../src/review/solver";
import { RULES_ID } from "../src/identity/records";
import { AccountStore, type Sql } from "../worker/src/account";

beforeAll(() => {
  const decoded = gunzipSync(readFileSync(new URL("../public/ai/" + manifest.asset, import.meta.url)));
  setDPTable(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer);
});

function playSolo(seed: number) {
  let replay = newMultiReplay(createSoloGame(seed), [{ type: "human", name: "나" }], "1인 플레이");
  for (const category of categories) {
    replay = appendMultiAction(replay, { type: "roll" });
    replay = appendMultiAction(replay, { type: "score", category });
  }
  return replay;
}
const card = Object.fromEntries(categories.map((c) => [c, 0])) as Record<Category, number>;
const rec = (id: string, score: number, at: number, extra: Partial<SoloRecord> = {}): SoloRecord => {
  const c = { ...card, choice: Math.min(30, score), ...(score > 30 ? { yacht: 50 } : {}) };
  return { recordId: id, rules: RULES_ID, source: "device", verification: "client-reported", startedAt: at - 1000, endedAt: at, score: total(c), card: c, ...extra };
};

describe("1인 플레이 엔진 (다인전 엔진 1좌석 재사용)", () => {
  it("12라운드 뒤 끝나고, 같은 시드의 2인전 첫 좌석과 같은 주사위를 굴린다", () => {
    const replay = playSolo(4242);
    expect(replay.finalState.done).toBe(true);
    expect(replay.finalState.round).toBe(12);
    expect(Object.keys(replay.finalState.cards[0])).toHaveLength(12);
    expect(replay.finalState.winners).toEqual([0]);
    // same dice stream as seat 0 of a normal game with the same seed (no separate RNG)
    const solo = transitionMulti(createSoloGame(7), { type: "roll" });
    const duo = transitionMulti(createMultiGame(2, 7), { type: "roll" });
    expect(solo.dice.map((d) => d.value)).toEqual(duo.dice.map((d) => d.value));
  });
  it("기존 다인전은 여전히 2명 이상만 만들 수 있다", () => {
    expect(() => createMultiGame(1, 1)).toThrow();
  });
  it("1인 기보는 검증·재계산되고 리뷰는 기대점수만 평가한다(승리점수율 없음)", () => {
    const replay = playSolo(99);
    expect(validateMultiReplay(JSON.parse(JSON.stringify(replay))).finalState).toEqual(replay.finalState);
    const review = fromSoloReplay(replay);
    if (typeof review === "string") throw Error(review);
    expect(review.solo).toBe(true);
    expect(review.steps.length).toBeGreaterThan(0);
    const first = assessSituation(review.steps[0], 0);
    expect(first.options.every((o) => o.winCredit === undefined)).toBe(true);
    const last = assessSituation(review.steps.at(-1)!, review.steps.length - 1);
    expect(last.distribution).toBeUndefined();
  });
});

describe("1인 플레이 기록", () => {
  it("완료한 12칸 점수표와 점수가 맞는 기록만 받는다", () => {
    expect(sanitizeSoloRecord(rec("s_abcdefgh12", 30, 1_790_000_000_000))).not.toBeNull();
    expect(sanitizeSoloRecord({ ...rec("s_abcdefgh12", 30, 1_790_000_000_000), score: 31 })).toBeNull();
    const partial = rec("s_abcdefgh13", 30, 1_790_000_000_000);
    delete (partial.card as Record<string, number>).yacht;
    expect(sanitizeSoloRecord(partial)).toBeNull();
    expect(sanitizeSoloRecord({ ...rec("bad", 30, 1_790_000_000_000) })).toBeNull();
    // trust cannot be raised by the client
    expect(sanitizeSoloRecord({ ...rec("s_abcdefgh14", 30, 1_790_000_000_000), verification: "server-verified" })?.verification).toBe("client-reported");
  });
  it("통계: 최고·평균·분포·최근 흐름·요트·보너스는 실제 기록에서만 계산한다", () => {
    expect(soloStats([])).toMatchObject({ plays: 0, best: null, average: null, bonusRate: null });
    const list = [rec("s_aaaaaaaa01", 20, 1_790_000_001_000), rec("s_aaaaaaaa02", 80, 1_790_000_002_000), rec("s_aaaaaaaa03", 30, 1_790_000_003_000)];
    const s = soloStats(list);
    expect(s.plays).toBe(3);
    expect(s.best).toBe(80);
    expect(s.average).toBeCloseTo((20 + 80 + 30) / 3, 6);
    expect(s.yachts).toBe(1);
    expect(s.recent.map((r) => r.score)).toEqual([20, 80, 30]);
    expect(s.distribution.reduce((a, b) => a + b.count, 0)).toBe(3);
    expect(previousBest(list, "s_aaaaaaaa02")).toBe(30);
    expect(previousBest([])).toBeNull();
  });
});

describe("1인 플레이 계정 보관 (서버)", () => {
  const sqlite = (): Sql => {
    const db = new DatabaseSync(":memory:");
    return { exec<T>(q: string, ...p: unknown[]) { const st = db.prepare(q); const rows = /^\s*select/i.test(q) ? (st.all(...(p as never[])) as T[]) : (st.run(...(p as never[])), [] as T[]); return { toArray: () => rows }; } };
  };
  it("중복 없이 저장하고 기기 전용 필드는 보관하지 않으며 신뢰 수준은 client-reported", () => {
    const s = new AccountStore(sqlite());
    s.init();
    s.ensureUser("u_" + "a".repeat(22), "google", 1_790_000_000_000);
    const r = rec("s_bbbbbbbb01", 30, 1_790_000_000_000, { replayId: "local-id", owner: "u_" + "a".repeat(22) });
    expect(s.importSolo([r, r], 1_790_000_000_000)).toEqual({ added: 1, skipped: 1 });
    const stored = s.soloRecords();
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toHaveProperty("replayId");
    expect(stored[0]).not.toHaveProperty("owner");
    expect(stored[0].verification).toBe("client-reported");
    // solo records never enter the versus match table (stats, rewards, achievements)
    expect(s.records()).toHaveLength(0);
  });
});
