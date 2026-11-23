import { describe, expect, it } from "vitest";
import { nextHoldOrder, shiftHoldOrder, toggleHoldOrder } from "../src/hold-order";

const dice = (held: number[]) => [0, 1, 2, 3, 4].map((id) => ({ id, value: 3, held: held.includes(id) }));

describe("고정 순서(선택 순서) — 표시 전용", () => {
  it("C → A → E 순서로 고정하면 고정 영역도 C, A, E", () => {
    let order: number[] = [];
    for (const [id, held] of [
      [2, [2]],
      [0, [2, 0]],
      [4, [2, 0, 4]],
    ] as const) {
      order = nextHoldOrder(order, dice([...held]));
      expect(order.at(-1)).toBe(id);
    }
    expect(order).toEqual([2, 0, 4]);
  });
  it("해제하면 그 주사위만 빠지고 나머지 순서는 유지, 다시 고르면 맨 뒤", () => {
    let order = nextHoldOrder([2, 0, 4], dice([2, 4]));
    expect(order).toEqual([2, 4]);
    order = nextHoldOrder(order, dice([2, 4, 0]));
    expect(order).toEqual([2, 4, 0]);
  });
  it("눈이 모두 같아도 id로 구분하고, 재굴림(고정 그대로)에서는 순서가 바뀌지 않는다", () => {
    const order = nextHoldOrder([3, 1], dice([1, 3]));
    expect(order).toEqual([3, 1]);
    expect(nextHoldOrder(order, dice([1, 3]))).toEqual([3, 1]);
  });
  it("한 번에 여러 개가 고정되면(AI) id 순으로 뒤에 붙고, 새 턴에는 비워진다", () => {
    expect(nextHoldOrder([4], dice([4, 2, 0]))).toEqual([4, 0, 2]);
    expect(nextHoldOrder([4, 0, 2], dice([]))).toEqual([]);
  });
  it("중복·잘못된 이전 값은 정리된다", () => {
    expect(nextHoldOrder([1, 1, 9, 2], dice([1, 2]))).toEqual([1, 2]);
  });
  it("토글과 자리 이동", () => {
    expect(toggleHoldOrder([2, 0], 4)).toEqual([2, 0, 4]);
    expect(toggleHoldOrder([2, 0, 4], 0)).toEqual([2, 4]);
    expect(shiftHoldOrder([2, 0, 4], 0, 1)).toEqual([2, 4, 0]);
    expect(shiftHoldOrder([2, 0, 4], 2, -1)).toEqual([2, 0, 4]);
  });
});
