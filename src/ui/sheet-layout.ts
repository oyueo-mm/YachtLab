/**
 * Column plan for the shared N-player score sheet (UI-1). Pure so it can be unit tested.
 *
 * Minimums keep every cell usable: category names stay readable and score buttons stay ≥ 44px wide
 * (the touch target) inside a column of at least `column` px. When the measured width cannot hold
 * every column at its minimum, the sheet scrolls horizontally and the pinned seat moves next to the
 * sticky category column so it never scrolls away.
 */
export type SheetLayout = { order: number[]; scroll: boolean; pinned: number | null; category: number; column: number };

export const SHEET_MIN = {
  /** category column by available width: phones / tablets / desktop */
  category: (width: number) => (width > 0 && width < 480 ? 96 : width > 0 && width < 760 ? 124 : 164),
  /** player column minimum (≥ 44px button + cell padding) */
  column: (width: number) => (width > 0 && width < 480 ? 60 : 72),
} as const;

export function sheetLayout({ width, seats, pinned }: { width: number; seats: number[]; pinned?: number }): SheetLayout {
  const category = SHEET_MIN.category(width);
  const column = SHEET_MIN.column(width);
  // Unknown width (first render, tests without layout): keep the natural order, no scroll decision yet.
  const scroll = width > 0 && category + seats.length * column > width;
  const pin = pinned !== undefined && seats.includes(pinned) ? pinned : null;
  const order = scroll && pin !== null ? [pin, ...seats.filter((s) => s !== pin)] : seats;
  return { order, scroll, pinned: scroll ? pin : null, category, column };
}
