export const SEASONS = {
  "christmas-2026": {
    name: "크리스마스 컬렉션",
    start: Date.parse("2026-12-01T00:00:00+09:00"),
    end: Date.parse("2027-01-01T00:00:00+09:00"),
  },
} as const;

export type SeasonId = keyof typeof SEASONS;

export function seasonActive(id: SeasonId, now: number) {
  const season = SEASONS[id];
  return now >= season.start && now < season.end;
}
