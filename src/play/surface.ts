import type { Surface } from "../sound";

/** Board surface under a dice area: read from the nearest board section (set by <BoardFx>). */
export function surfaceAt(el: Element | null | undefined): Surface | undefined {
  const v = (el?.closest("[data-surface]") as HTMLElement | null)?.dataset.surface;
  return (v || undefined) as Surface | undefined;
}
