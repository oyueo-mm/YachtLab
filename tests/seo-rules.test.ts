import { describe, expect, it } from "vitest";
import { categories, score } from "../src/engine";
// @ts-expect-error plain ESM script without types
import { CATEGORIES, scoreOf, FAQ_GROUPS, GUIDE } from "../scripts/seo/rules-content.mjs";

describe("rules page (guide/) uses the game's scoring", () => {
  it("scoreOf equals engine score on every one of the 7,776 rolls", () => {
    expect(CATEGORIES.map(([id]: [string]) => id)).toEqual([...categories]);
    for (let n = 0; n < 7776; n++) {
      const v = [0, 1, 2, 3, 4].map((i) => (Math.floor(n / 6 ** i) % 6) + 1);
      for (const c of categories) expect(scoreOf(v, c)).toBe(score(v, c));
    }
  });
  it("keeps the old anchors and every category", () => {
    for (const id of ["turn", "scores", "bonus", "odds", "strategy", "play", "faq"]) expect(GUIDE.body).toContain(`id="${id}"`);
    for (const c of categories) expect(GUIDE.body).toContain(`id="cat-${c}"`);
  });
  it("FAQ is grouped and keeps the original questions", () => {
    const titles = FAQ_GROUPS.map(([t]: [string]) => t);
    expect(titles).toEqual(["게임 플레이", "온라인 대전", "AI 대전", "계정", "상점 및 재화", "모바일", "문제 해결"]);
    const qs = FAQ_GROUPS.flatMap(([, items]: [string, string[][]]) => items.map((i) => i[0]));
    for (const q of ["요트다이스와 야추는 같은 게임인가요?", "야찌(Yahtzee)와 무엇이 다른가요?", "설치나 회원가입이 필요한가요?", "휴대폰에서도 되나요?", "친구와 어떻게 같이 하나요?", "AI는 얼마나 강한가요?", "요트가 두 번 나오면 어떻게 하나요?", "0점을 적어도 되나요?", "실제 주사위로 할 때 점수를 적을 곳이 있나요?"]) expect(qs).toContain(q);
  });
});
