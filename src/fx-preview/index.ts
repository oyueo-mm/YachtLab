/** FX-1 preview interface — see FxPreview.tsx and docs/context/FX1-DICE-BOARD-SOUND-2026-11-28.md §5. */
export { FxPreview, previewLevel, type FxMoment, type FxPreviewHandle, type FxPreviewProps, type FxPreviewSound } from "./FxPreview";
export { diceMaterialSpec, type DiceMaterialSpec, type MaterialClass } from "../dice3d/dice-material";
/** Static 3D thumbnails for shop cards (lazy-load this module: it pulls in three.js). */
export const loadDiceThumbnail = () => import("../dice3d/thumbnail").then((m) => m.diceThumbnail);
