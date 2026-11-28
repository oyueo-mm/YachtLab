/**
 * Column plan for the shared N-player score sheet (UI-1). Pure so it can be unit tested.
 *
 * The roomiest tier that fits is used: "wide" (category 164 / player 72), "mid" (124 / 60) and
 * "tight" (88 / 50 — still a 44px score button with 3px cell padding). When even "tight" cannot
 * hold every column, the sheet scrolls horizontally and the pinned seat moves next to the sticky
 * category column so it never scrolls away. Unknown width (first render) keeps the "wide" plan.
 */
export type SheetTier = "wide" | "mid" | "tight";
export type SheetLayout = { order: number[]; scroll: boolean; pinned: number | null; category: number; column: number; tier: SheetTier };

export const SHEET_TIERS: Record<SheetTier, { category: number; column: number }> = {
  wide: { category: 164, column: 72 },
  mid: { category: 124, column: 60 },
  tight: { category: 88, column: 50 },
};

export function sheetLayout({ width, seats, pinned }: { width: number; seats: number[]; pinned?: number }): SheetLayout {
  const need = (t: SheetTier) => SHEET_TIERS[t].category + seats.length * SHEET_TIERS[t].column;
  const tier: SheetTier = width <= 0 || need("wide") <= width ? "wide" : need("mid") <= width ? "mid" : "tight";
  // Scrolling: keep the middle tier when there is room for its category column (names stay readable).
  const scroll = width > 0 && need(tier) > width;
  const used: SheetTier = scroll && width >= 480 ? "mid" : tier;
  const pin = pinned !== undefined && seats.includes(pinned) ? pinned : null;
  const order = scroll && pin !== null ? [pin, ...seats.filter((s) => s !== pin)] : seats;
  return { order, scroll, pinned: scroll ? pin : null, tier: used, ...SHEET_TIERS[used] };
}
