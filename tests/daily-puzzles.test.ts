import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import manifest from "../src/dp-manifest.json";
import { dpDecision, setDPTable } from "../src/dp";
import { winDPDecision } from "../src/win-dp";
import { addDays } from "../src/daily/calendar";
import { categories, score, type Card, type Category, type Game } from "../src/engine";
import { bankStats, buildBank, DEFAULT_OPTIONS } from "../src/daily/puzzles/generate";
import { gameFor, keepOptions, rerollProbability, TARGET_NAMES, type Target } from "../src/daily/puzzles/solver";
import { EPS, grade, keepKey, LEVELS, questionOf, scoreKey, type PuzzleBank } from "../src/daily/puzzles/types";

const bank = JSON.parse(readFileSync("src/daily/puzzles/bank.json", "utf8")) as PuzzleBank;
const puzzles = Object.values(bank.puzzles);
beforeAll(() => {
  const bytes = gunzipSync(readFileSync(`public/ai/${manifest.asset}`));
  setDPTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
});

const decisionKey = (d: { type: "score"; category: Category } | { type: "reroll"; ids: number[] }, dice: number[]) =>
  d.type === "score" ? scoreKey(d.category) : keepKey(dice.filter((_, i) => d.ids.includes(i)));

describe("퍼즐 은행: 예약·형식", () => {
  it("84일 × 입문·보통·고급, 예비 문제, 중복 없음, 모든 유형 포함", () => {
    expect(bank.rules).toBe("yacht-12@1");
    expect(bank.generator.dpSha256).toBe(manifest.sha256);
    expect(Object.keys(bank.schedule)).toHaveLength(84);
    expect(Object.keys(bank.schedule)[0]).toBe("2026-12-01");
    expect(bank.schedule[addDays("2026-12-01", 83)]).toBeDefined();
    for (const [date, ids] of Object.entries(bank.schedule)) {
      expect(ids.map((id) => bank.puzzles[id].level)).toEqual([...LEVELS]);
      ids.forEach((id) => expect(id.startsWith(date)).toBe(true));
    }
    for (const l of LEVELS) expect(bank.reserve[l].length).toBe(10);
    const s = bankStats(bank);
    expect(s.fingerprints).toBe(s.puzzles);
    expect(Object.keys(s.byKind).sort()).toEqual(["bonus", "category", "comeback", "expected", "keep", "probability", "protect", "replay", "reroll", "win"]);
  });
  it("문제에는 점수판·주사위·남은 굴림·상대 정보가 있고, 질문에는 정답이 없다", () => {
    for (const p of puzzles) {
      const q = questionOf(p);
      expect(JSON.stringify(q)).not.toContain('"best"');
      expect(q).not.toHaveProperty("key");
      expect(p.method).toBe("exact");
      if (p.objective !== "probability") {
        expect(p.position!.dice).toHaveLength(5);
        expect(p.position!.rollsLeft).toBeGreaterThanOrEqual(0);
        expect(p.position!.rollsLeft).toBeLessThanOrEqual(2);
      }
      if (p.objective === "win") expect(p.position!.opponent).toMatchObject({ finished: true });
      if (p.kind === "replay") expect(p.position!.opponent?.card).toBeDefined();
    }
  });
});

describe("퍼즐 품질", () => {
  it("모든 최적 행동을 정답으로 인정하고, 자명하거나 판단 불가능한 문제는 없다", () => {
    for (const p of puzzles) {
      const { best, values } = p.key;
      expect(best.length).toBeGreaterThanOrEqual(1);
      expect(best.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < values.length; i++) expect(values[i - 1].value).toBeGreaterThanOrEqual(values[i].value);
      const top = values[0].value;
      for (const v of values) expect(best.includes(v.key)).toBe(v.value >= top - 1e-6);
      for (const k of best) expect(grade(p.key, k)).toMatchObject({ correct: true, loss: 0 });
      const wrong = values.find((v) => !best.includes(v.key))!;
      const g = grade(p.key, wrong.key)!;
      expect(g.correct).toBe(false);
      expect(g.loss!).toBeGreaterThan(0);
      if (p.objective === "expected") expect(g.loss!).toBeGreaterThanOrEqual(0.3 - 1e-6);
      if (p.objective === "win") expect(g.loss!).toBeGreaterThanOrEqual(0.005 - 1e-6);
      expect(grade(p.key, "s:nonsense")).toBeNull();
      expect(p.key.explanation[0]).toMatch(/^정답:/);
      if (best.length > 1) expect(p.key.explanation.join(" ")).toContain("어느 것을 골라도 정답");
    }
  });
  it("모든 합법 행동을 평가한다 (킵 조합 + 열린 칸)", () => {
    for (const p of puzzles.filter((x) => x.objective !== "probability")) {
      const { card, dice, rollsLeft } = p.position!;
      const open = categories.filter((c) => card[c] === undefined).length;
      expect(p.key.values.length).toBe(open + (rollsLeft > 0 ? keepOptions(dice).length : 0));
    }
  });
});

describe("기존 엔진과의 결과 비교", () => {
  it("기대점수 문제: 기존 DP Expert(dpDecision)의 값·행동과 일치", () => {
    let checked = 0;
    for (const p of puzzles.filter((x) => x.objective === "expected")) {
      const { card, dice, rollsLeft } = p.position!;
      const d = dpDecision(gameFor(card, dice, rollsLeft));
      expect(Math.abs(d.value - p.key.values[0].value)).toBeLessThan(1e-5);
      expect(p.key.best).toContain(decisionKey(d as never, dice));
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
  it("승리 확률 문제(남은 칸 1개): 기존 Win DP의 정확 마지막 턴 값과 일치", () => {
    let checked = 0;
    for (const p of puzzles.filter((x) => x.objective === "win" && categories.filter((c) => x.position!.card[c] === undefined).length === 1)) {
      const { card, dice, rollsLeft, opponent } = p.position!;
      const opp: Card = Object.fromEntries(categories.map((c) => [c, c === "choice" ? opponent!.total : 0]));
      const g: Game = { ...gameFor(card, dice, rollsLeft), cards: [opp, { ...card }], player: 1 };
      const d = winDPDecision(g)!;
      expect(Math.abs(d.value - p.key.values[0].value)).toBeLessThan(1e-5);
      expect(p.key.best).toContain(decisionKey(d as never, dice));
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
  it("확률 문제: 정답 보기가 완전 열거 값과 같다", () => {
    for (const p of puzzles.filter((x) => x.objective === "probability")) {
      const kept = p.position!.dice.filter((v) => v > 0);
      const target = (Object.entries(TARGET_NAMES).find(([, name]) => p.prompt.includes(name + "이(가)"))?.[0]) as Target;
      expect(target).toBeDefined();
      const [ok, all] = rerollProbability(kept, target);
      // independent brute force over all 6^n outcomes
      const n = 5 - kept.length;
      let hit = 0;
      for (let i = 0; i < 6 ** n; i++) {
        const faces = [...kept];
        for (let j = 0, x = i; j < n; j++, x = Math.floor(x / 6)) faces.push(1 + (x % 6));
        const isHit = target === "fullOrFour" ? score(faces, "full") > 0 || score(faces, "four") > 0 : score(faces, target as Category) > 0;
        if (isHit) hit++;
      }
      expect([ok, all]).toEqual([hit, 6 ** n]);
      const answer = p.choices!.find((c) => "o:" + c.id === p.key.best[0])!;
      expect(answer.label).toBe(((ok / all) * 100).toFixed(1) + "%");
      expect(new Set(p.choices!.map((c) => c.label)).size).toBe(4);
    }
  });
});

describe("정답 비공개", () => {
  it("웹 번들 코드(src/)는 정답 은행을 가져오지 않는다 (Worker와 생성 스크립트만)", () => {
    const files: string[] = [];
    const walk = (dir: string) => readdirSync(dir).forEach((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : /\.(ts|tsx)$/.test(f) && files.push(join(dir, f))));
    walk("src");
    expect(files.filter((f) => /(?:from\s*|import\(\s*)["'][^"']*bank\.json["']/.test(readFileSync(f, "utf8")))).toEqual([]);
    expect(readFileSync("worker/src/daily-api.ts", "utf8")).toContain("puzzles/bank.json");
  });
});

describe("재현성", () => {
  it("같은 시드·같은 DP 테이블이면 저장된 은행과 바이트 단위로 같다", () => {
    const again = buildBank(DEFAULT_OPTIONS);
    expect(JSON.stringify(again)).toBe(JSON.stringify(bank));
  }, 120_000);
  it("시드가 바뀌면 다른 문제가 나온다", () => {
    const small = buildBank({ ...DEFAULT_OPTIONS, seed: 7, days: 3, reservePerLevel: 0, solitaireGames: 40, endgameGames: 120, replayGames: 4, probabilityQuestions: 60 });
    expect(Object.keys(small.schedule)).toHaveLength(3);
    expect(small.puzzles["2026-12-01-intro"].fingerprint).not.toBe(bank.puzzles["2026-12-01-intro"].fingerprint);
  }, 60_000);
});
