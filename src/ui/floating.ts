/**
 * Position helpers for floating panels (UI-1 match popup). Pure functions so clamping can be unit tested.
 * Positions are stored as the panel's top-left corner in CSS pixels.
 */
export type Point = { x: number; y: number };
export type Box = { width: number; height: number };

/** Keep a panel fully on screen with a margin (the safe area is handled by the margin on phones). */
export function clampPoint(point: Point, panel: Box, viewport: Box, margin = 8): Point {
  const maxX = Math.max(margin, viewport.width - panel.width - margin);
  const maxY = Math.max(margin, viewport.height - panel.height - margin);
  return {
    x: Math.round(Math.min(maxX, Math.max(margin, point.x))),
    y: Math.round(Math.min(maxY, Math.max(margin, point.y))),
  };
}

/** Default spot: bottom-right corner, above a phone's bottom bar. */
export function defaultPoint(panel: Box, viewport: Box, margin = 16): Point {
  const bottom = viewport.width <= 760 ? 88 : margin;
  return clampPoint({ x: viewport.width - panel.width - margin, y: viewport.height - panel.height - bottom }, panel, viewport);
}

const KEY = "yachtlab.match-popup.v1";
/** Saved position as fractions of the viewport so a resize or rotation keeps the same corner. */
export function loadAnchor(): { fx: number; fy: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && Number.isFinite(raw.fx) && Number.isFinite(raw.fy)) return { fx: Math.min(1, Math.max(0, raw.fx)), fy: Math.min(1, Math.max(0, raw.fy)) };
  } catch {
    // storage unavailable
  }
  return null;
}
export function saveAnchor(point: Point, panel: Box, viewport: Box) {
  const spanX = Math.max(1, viewport.width - panel.width);
  const spanY = Math.max(1, viewport.height - panel.height);
  try {
    localStorage.setItem(KEY, JSON.stringify({ fx: point.x / spanX, fy: point.y / spanY }));
  } catch {
    // storage unavailable
  }
}
export function anchorPoint(anchor: { fx: number; fy: number }, panel: Box, viewport: Box): Point {
  return clampPoint({ x: anchor.fx * (viewport.width - panel.width), y: anchor.fy * (viewport.height - panel.height) }, panel, viewport);
}
