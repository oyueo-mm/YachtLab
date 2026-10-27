import kernel from "./dp-kernel.json";
import manifest from "./dp-manifest.json";
import { categories, score, upper, total, type Game } from "./engine";
import type { Decision, Candidate } from "./ai";
let table: Float64Array | null = null;
let loading: Promise<void> | null = null;
let index: Map<string, number> | null = null;
export const dpTableBytes = 4096 * 64 * 8;
export function setDPTable(bytes: ArrayBuffer) {
  if (bytes.byteLength !== dpTableBytes)
    throw Error("DP 가치 테이블의 크기가 올바르지 않습니다.");
  table = new Float64Array(bytes);
  if (
    !Number.isFinite(table[4095 * 64]) ||
    table[4095 * 64] < 100 ||
    table[4095 * 64] > 323
  ) {
    table = null;
    throw Error("DP 가치 테이블을 검증할 수 없습니다.");
  }
}
export async function loadDP() {
  if (table) return;
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch(
      `${import.meta.env.BASE_URL}ai/${manifest.asset}`,
    );
    if (!response.ok) throw Error(`DP 테이블 로드 실패 (${response.status})`);
    const packed = await response.arrayBuffer();
    const header = new Uint8Array(packed);
    const bytes =
      header[0] === 31 && header[1] === 139
        ? await new Response(
            new Blob([packed])
              .stream()
              .pipeThrough(new DecompressionStream("gzip")),
          ).arrayBuffer()
        : packed; // Some hosts transparently decompress a Content-Encoding response.
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== manifest.sha256)
      throw Error("DP 테이블의 무결성 검증에 실패했습니다.");
    setDPTable(bytes);
  })();
  try {
    await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}
export function dpFutureValue(mask: number, u: number) {
  if (!table) throw Error("DP 테이블을 먼저 로드해주세요.");
  return table[mask * 64 + Math.min(63, u)];
}
export function chanceValues(full: ArrayLike<number>) {
  const e = new Float64Array(462);
  for (let d = 0; d < 252; d++) e[210 + d] = full[d];
  for (let h = 209; h >= 0; h--) {
    const children = kernel.children[h];
    let sum = 0;
    for (let face = 0; face < 6; face++) sum += e[children[face]];
    e[h] = sum / 6;
  }
  return e;
}
export function turnValues(mask: number, u: number, left: number) {
  const stop = new Float64Array(252);
  for (let d = 0; d < 252; d++) {
    let best = -Infinity;
    for (let c = 0; c < 12; c++)
      if (mask & (1 << c)) {
        const p = kernel.points[d][c],
          next = c < 6 ? Math.min(63, u + p) : u;
        best = Math.max(
          best,
          p +
            (u < 63 && next === 63 ? 35 : 0) +
            dpFutureValue(mask ^ (1 << c), next),
        );
      }
    stop[d] = best;
  }
  let values = stop,
    expected: Float64Array | null = null;
  for (let r = 0; r < left; r++) {
    expected = chanceValues(values);
    const next = new Float64Array(252);
    for (let d = 0; d < 252; d++) {
      let best = stop[d];
      for (const h of kernel.holds[d]) best = Math.max(best, expected[h]);
      next[d] = best;
    }
    values = next;
  }
  return { values, expected };
}
export function dpDecision(state: Game): Decision {
  if (state.done || !state.rolls)
    throw Error("DP 판단에는 굴린 주사위가 필요합니다.");
  const card = state.cards[state.player],
    u = Math.min(63, upper(card));
  const mask = categories.reduce(
    (m, c, i) => (card[c] === undefined ? m | (1 << i) : m),
    0,
  );
  if (!index)
    index = new Map(kernel.states.slice(210).map((v, i) => [v.join(""), i]));
  const dice = state.dice.map((d) => d.value),
    d = index.get([...dice].sort().join(""))!;
  const { expected } = turnValues(mask, u, 3 - state.rolls),
    base = total(card);
  const actions: {
    decision:
      | { type: "score"; category: (typeof categories)[number] }
      | { type: "reroll"; ids: number[] };
    candidate: Candidate;
  }[] = [];
  for (let c = 0; c < 12; c++)
    if (mask & (1 << c)) {
      const p = score(dice, categories[c]),
        next = c < 6 ? Math.min(63, u + p) : u;
      actions.push({
        decision: { type: "score", category: categories[c] },
        candidate: {
          label: categories[c],
          value:
            base +
            p +
            (u < 63 && next === 63 ? 35 : 0) +
            dpFutureValue(mask ^ (1 << c), next),
        },
      });
    }
  if (expected)
    for (const h of kernel.holds[d]) {
      const kept = kernel.states[h];
      if (kept.length === 5) continue;
      const left = [...kept],
        ids = state.dice
          .filter((die) => {
            const i = left.indexOf(die.value);
            if (i < 0) return false;
            left.splice(i, 1);
            return true;
          })
          .map((die) => die.id);
      actions.push({
        decision: { type: "reroll", ids },
        candidate: {
          label: `고정 ${kept.join("·") || "없음"}`,
          value: base + expected[h],
        },
      });
    }
  actions.sort((a, b) => b.candidate.value - a.candidate.value);
  const best = actions[0];
  return {
    ...best.decision,
    value: best.candidate.value,
    candidates: actions.map((a) => a.candidate),
    note: "전체 게임 DP 기대 최종점수 · 독립 공정 주사위 모형 · Float64 수치 계산 (상대 승률 최적화 아님)",
  };
}

export type Choice = { type: "score"; category: (typeof categories)[number] } | { type: "reroll"; ids: number[] };
const partialIndex = new Map(kernel.states.map((v, i) => [v.join(""), i]));
/** 0..31 stable-ID hold masks; 32..43 score categories. Illegal actions are -Infinity. */
export function dpActionValues(state: Game): number[] {
  if (state.done || !state.rolls) throw Error("굴린 주사위가 필요합니다.");
  const card = state.cards[state.player], u = Math.min(63, upper(card)), base = total(card);
  const mask = categories.reduce((m, c, i) => card[c] === undefined ? m | (1 << i) : m, 0);
  const dice = state.dice.map(d => d.value);
  const q = Array(44).fill(-Infinity);
  categories.forEach((c, i) => {
    if (!(mask & (1 << i))) return;
    const p = score(dice, c), next = i < 6 ? Math.min(63, u + p) : u;
    q[32 + i] = base + p + (u < 63 && next === 63 ? 35 : 0) + dpFutureValue(mask ^ (1 << i), next);
  });
  if (state.rolls < 3) {
    const expected = chanceValues(turnValues(mask, u, 2 - state.rolls).values);
    for (let m = 0; m < 32; m++) {
      const key = state.dice.filter(d => m & (1 << d.id)).map(d => d.value).sort().join("");
      q[m] = base + expected[partialIndex.get(key)!];
    }
  }
  return q;
}
export function choiceIndex(choice: Choice): number {
  if (choice.type === "score") {
    const c = categories.indexOf(choice.category);
    if (c < 0) throw Error("알 수 없는 카테고리입니다.");
    return 32 + c;
  }
  if (new Set(choice.ids).size !== choice.ids.length || choice.ids.some(id => !Number.isInteger(id) || id < 0 || id > 4)) throw Error("잘못된 고정 주사위입니다.");
  return choice.ids.reduce((mask, id) => mask | (1 << id), 0);
}
export function dpActionValue(state: Game, choice: Choice) {
  const q = dpActionValues(state)[choiceIndex(choice)];
  if (!Number.isFinite(q)) throw Error("불법 행동은 평가할 수 없습니다.");
  return q;
}
