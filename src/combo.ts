import { score, type Category, type Die } from "./engine";

/**
 * Which dice "make" a scored category — for the presentation layer only.
 * Points always come from the engine (`score`); this never changes them. For example four-of-a-kind
 * is built by four dice, while its points are the sum of all five.
 *
 * Selection is deterministic and keyed by die id (never by on-screen position or order):
 * when several dice could serve the same role (a repeated face), the lowest id is chosen.
 */
export function comboDiceIds(dice: readonly Pick<Die, "id" | "value">[], category: Category): number[] {
  const values = dice.map((d) => d.value);
  if (values.length !== 5 || score(values, category) <= 0) return []; // 0 points: no celebration
  const byId = [...dice].sort((a, b) => a.id - b.id);
  const lowestWith = (value: number, skip: ReadonlySet<number> = new Set()) => byId.find((d) => d.value === value && !skip.has(d.id));
  const all = () => byId.map((d) => d.id);
  const ofFace = (n: number) => byId.filter((d) => d.value === n).map((d) => d.id);
  switch (category) {
    case "aces":
      return ofFace(1);
    case "deuces":
      return ofFace(2);
    case "threes":
      return ofFace(3);
    case "fours":
      return ofFace(4);
    case "fives":
      return ofFace(5);
    case "sixes":
      return ofFace(6);
    case "choice":
    case "full":
    case "yacht":
      return all();
    case "four": {
      for (let face = 1; face <= 6; face++) {
        const ids = ofFace(face);
        if (ids.length >= 4) return ids.slice(0, 4);
      }
      return [];
    }
    case "small": {
      for (const start of [1, 2, 3]) {
        const run = [start, start + 1, start + 2, start + 3].map((v) => lowestWith(v));
        if (run.every(Boolean)) return run.map((d) => d!.id).sort((a, b) => a - b);
      }
      return [];
    }
    case "large": {
      for (const start of [1, 2]) {
        const run = [0, 1, 2, 3, 4].map((k) => lowestWith(start + k));
        if (run.every(Boolean)) return run.map((d) => d!.id).sort((a, b) => a - b);
      }
      return [];
    }
  }
}

/** Stronger presentation for the hardest combinations. */
export const grandCombos: readonly Category[] = ["large", "yacht"];
