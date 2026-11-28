/**
 * Preview integration point for the rendering/sound owner (담당 03) — UI-2, 2026-11-28.
 *
 * The shop and the inventory never start a renderer per card. Cards use cheap static thumbnails
 * (`ItemThumb`: one 2D canvas face or CSS sample, painted only while on screen). Exactly one interactive
 * stage is live at a time — the one in the open detail dialog (or the inventory combo dialog) — and it is
 * unmounted when the dialog closes.
 *
 * 03 can plug a renderer in without touching shop code:
 *   registerPreviewProvider({ id: "dice-webgl-v2", categories: ["dice", "board"], Stage, thumbnail, sound })
 *  - `Stage`     replaces the built-in interactive stage for those categories (gets level, partner, active).
 *  - `thumbnail` may return a pre-rendered image URL for a card (e.g. an atlas); null falls back to ItemThumb.
 *  - `thumbnailAsync` renders a still on demand (FX-1 3D thumbnails); the 2D thumbnail is the placeholder.
 *  - `sound`     plays a cue for the "효과음 듣기/비교" buttons; absent → the built-in synthesized cues.
 * The last provider registered for a category wins. Providers must not read game RNG or touch a match.
 */
import type { ComponentType } from "react";
import type { ItemCategory, ItemDef } from "../../economy/live/catalog";

export type SoundCue = "roll" | "land" | "emote" | "fx" | "tap";
export type PreviewStageProps = {
  item: ItemDef;
  level: number;
  /** A die shown on this board / a board under this die (combo preview), or null. */
  partner: ItemDef | null;
  /** False while the dialog is closing or the page is hidden: stop the render loop. */
  active: boolean;
};
export type PreviewProvider = {
  id: string;
  categories: readonly ItemCategory[];
  Stage?: ComponentType<PreviewStageProps>;
  thumbnail?: (item: ItemDef, level: number) => string | null;
  /**
   * Static still rendered later (e.g. FX-1 `loadDiceThumbnail()` → one shared WebGL context, serial queue,
   * memory + sessionStorage cache). Called only for cards on screen; the 2D thumbnail stays until it
   * resolves and remains when it resolves to null (no WebGL). `px` = bitmap size (2 × CSS size).
   */
  thumbnailAsync?: (item: ItemDef, level: number, px: number) => Promise<string | null>;
  sound?: (item: ItemDef, level: number, cue: SoundCue) => void;
};

const providers: PreviewProvider[] = [];
export function registerPreviewProvider(p: PreviewProvider) {
  const at = providers.findIndex((x) => x.id === p.id);
  if (at >= 0) providers.splice(at, 1);
  providers.push(p);
  return () => {
    const n = providers.indexOf(p);
    if (n >= 0) providers.splice(n, 1);
  };
}
export const previewProvider = (category: ItemCategory): PreviewProvider | null =>
  [...providers].reverse().find((p) => p.categories.includes(category)) ?? null;

/** Single active stage: a stage asks for the token; an older stage loses it (and should go static). */
let activeToken = 0;
const listeners = new Set<() => void>();
export function claimStage() {
  const token = ++activeToken;
  listeners.forEach((fn) => fn());
  return token;
}
export const isActiveStage = (token: number) => token === activeToken;
export function onStageChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** QA / integration hook (same pattern as `__yachtlabSound`): lets a test or INT-1 check register a provider. */
if (typeof window !== "undefined") (window as unknown as { __yachtlabPreview?: { register: typeof registerPreviewProvider } }).__yachtlabPreview = { register: registerPreviewProvider };
