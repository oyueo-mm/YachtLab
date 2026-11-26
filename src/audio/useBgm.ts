import { useEffect } from "react";
import { requestBgm, type BgmScene } from "./bgm";

/** Ask for a background-music scene while this component is mounted (see requestBgm priorities). */
export function useBgmScene(scene: BgmScene | null, priority = 0) {
  useEffect(() => (scene ? requestBgm(scene, priority) : undefined), [scene, priority]);
}
