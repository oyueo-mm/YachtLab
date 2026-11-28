import { lookAt } from "../../economy/live/catalog";
import { loadDiceThumbnail } from "../../fx-preview";
import { registerPreviewProvider } from "./preview-registry";

/**
 * UI-2 × FX-1: dice cards upgrade from the instant 2D face to FX-1's static 3D still (same materials as a
 * match) once on screen. FX-1 owns the renderer: one shared WebGL context, serial queue, released 8 s after
 * the last request, memory + sessionStorage cache; null without WebGL → the 2D face stays.
 */
registerPreviewProvider({
  id: "fx1-dice-stills",
  categories: ["dice"],
  thumbnailAsync: async (item, level, px) => (await loadDiceThumbnail())(lookAt(item, level).dice ?? null, px),
});
