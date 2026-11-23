/**
 * Order in which held dice sit on the hold shelf: the order the player selected them.
 * Presentation only — the engine's dice values and `held` flags are never changed here.
 *
 *  - a die that becomes held is appended (first selected = first slot)
 *  - a die that is released is removed; the others keep their relative order
 *  - dice are identified by id, so equal faces never get mixed up
 *  - several dice held at once (e.g. an AI move) are appended in id order
 */
export function nextHoldOrder(previous: readonly number[], dice: readonly { id: number; held: boolean }[]): number[] {
  const held = new Set(dice.filter((d) => d.held).map((d) => d.id));
  const kept: number[] = [];
  for (const id of previous) if (held.has(id) && !kept.includes(id)) kept.push(id);
  const added = [...held].filter((id) => !kept.includes(id)).sort((a, b) => a - b);
  return [...kept, ...added];
}

/** Toggle one die in a selection-ordered hold list (append when held, remove when released). */
export function toggleHoldOrder(order: readonly number[], id: number): number[] {
  return order.includes(id) ? order.filter((x) => x !== id) : [...order, id];
}

/** Move a held die one place left (-1) or right (+1) within the hold order. */
export function shiftHoldOrder(order: readonly number[], id: number, step: -1 | 1): number[] {
  const i = order.indexOf(id),
    j = i + step;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
