/**
 * Period-limited sales (기간 한정). A season has a fixed start and end in Korean time; the server's clock
 * decides (worker/src/economy.ts refuses a purchase outside the window; the shop shows the server time
 * from the economy snapshot). After the end, owners keep and use their items. `rerun` says plainly
 * whether the items may come back — no fake deadlines, no silent extensions (docs/context/
 * COLLECTIONS-2026-11-27.md §기간 한정).
 */
export const SEASONS = {
  "christmas-2026": {
    name: "크리스마스 컬렉션",
    start: Date.parse("2026-12-01T00:00:00+09:00"),
    end: Date.parse("2027-01-01T00:00:00+09:00"),
    rerun: "재판매 여부는 아직 정하지 않았어요.",
  },
} as const;

export type SeasonId = keyof typeof SEASONS;

export function seasonActive(id: SeasonId, now: number) {
  const season = SEASONS[id];
  return now >= season.start && now < season.end;
}
/** Announced but not on sale yet (shown as "판매 예정" up to 14 days before). */
export function seasonUpcoming(id: SeasonId, now: number, lead = 14 * 86_400_000) {
  const season = SEASONS[id];
  return now < season.start && season.start - now <= lead;
}
/** " · 남은 기간 3일" while on sale (server time), "" otherwise. */
export function remainingText(id: SeasonId, now: number) {
  const season = SEASONS[id];
  if (!seasonActive(id, now)) return "";
  const left = season.end - now;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  return ` · 남은 기간 ${days > 0 ? `${days}일 ` : ""}${hours}시간`;
}
