import { describe, expect, it } from "vitest";
import { bonus, upper, type Card } from "../src/engine";
import { detectBonuses } from "../src/bonus-moment";

/** Upper-bonus trigger logic (the component only adds presentation): once per player per game, never on open/reload/reconnect. */
const card = (aces: number, deuces = 0, threes = 0, fours = 0, fives = 0, sixes = 0): Card => ({ aces, deuces, threes, fours, fives, sixes } as Card);
const at63 = card(3, 6, 9, 12, 15, 18); // 3×(1+2+…+6) = 63
const at62 = card(3, 6, 9, 12, 15, 17);
const fresh = () => ({ prev: new Map<string, boolean>(), fired: new Set<string>() });

describe("상단 보너스 규칙(변경 없음)", () => {
  it("63점이면 +35, 62점이면 0", () => {
    expect(upper(at63)).toBe(63);
    expect(bonus(at63)).toBe(35);
    expect(bonus(at62)).toBe(0);
  });
});

describe("상단 보너스 연출 트리거", () => {
  it("처음 63점 이상이 되는 순간 한 번만, 이후 점수가 올라도 다시 재생하지 않는다", () => {
    const { prev, fired } = fresh();
    expect(detectBonuses(prev, fired, "m1", [{ id: "a", card: card(3) }])).toEqual([]);
    expect(detectBonuses(prev, fired, "m1", [{ id: "a", card: at62 }])).toEqual([]);
    expect(detectBonuses(prev, fired, "m1", [{ id: "a", card: at63 }])).toEqual(["a"]);
    expect(detectBonuses(prev, fired, "m1", [{ id: "a", card: { ...at63, choice: 20 } }])).toEqual([]);
    expect(detectBonuses(prev, fired, "m1", [{ id: "a", card: at63 }])).toEqual([]);
  });
  it("이미 보너스가 있는 화면을 열거나 새로고침·재접속해도 재생하지 않는다", () => {
    const { prev, fired } = fresh();
    expect(detectBonuses(prev, fired, "m1", [{ id: "a", card: at63 }])).toEqual([]);
    // the screen is rebuilt (new component state) in the same session: still silent
    const again = new Map<string, boolean>();
    expect(detectBonuses(again, fired, "m1", [{ id: "a", card: at63 }])).toEqual([]);
  });
  it("같은 경기에서 한 번 재생한 뒤 화면이 다시 만들어져도(재접속) 같은 경기·플레이어는 반복하지 않는다", () => {
    const { prev, fired } = fresh();
    detectBonuses(prev, fired, "m1", [{ id: "a", card: at62 }]);
    expect(detectBonuses(prev, fired, "m1", [{ id: "a", card: at63 }])).toEqual(["a"]);
    const rebuilt = new Map<string, boolean>();
    expect(detectBonuses(rebuilt, fired, "m1", [{ id: "a", card: at62 }])).toEqual([]); // baseline
    expect(detectBonuses(rebuilt, fired, "m1", [{ id: "a", card: at63 }])).toEqual([]); // already shown in m1
  });
  it("플레이어마다 따로: 내 보너스, 상대 보너스, 관전자 모두 각자 한 번", () => {
    const { prev, fired } = fresh();
    const base = [{ id: "me", card: card(3) }, { id: "op", card: card(3) }, { id: "p3", card: card(3) }];
    detectBonuses(prev, fired, "m1", base);
    expect(detectBonuses(prev, fired, "m1", [{ id: "me", card: at63 }, base[1], base[2]])).toEqual(["me"]);
    expect(detectBonuses(prev, fired, "m1", [{ id: "me", card: at63 }, { id: "op", card: at63 }, base[2]])).toEqual(["op"]);
    expect(detectBonuses(prev, fired, "m1", [{ id: "me", card: at63 }, { id: "op", card: at63 }, { id: "p3", card: at63 }])).toEqual(["p3"]);
  });
  it("새 경기(점수판이 비워짐)에서는 다시 처음 달성할 때 재생된다", () => {
    const { prev, fired } = fresh();
    detectBonuses(prev, fired, "g1", [{ id: "a", card: at62 }]);
    expect(detectBonuses(prev, fired, "g1", [{ id: "a", card: at63 }])).toEqual(["a"]);
    expect(detectBonuses(prev, fired, "g2", [{ id: "a", card: {} as Card }])).toEqual([]); // reset
    expect(detectBonuses(prev, fired, "g2", [{ id: "a", card: at63 }])).toEqual(["a"]);
  });
});
