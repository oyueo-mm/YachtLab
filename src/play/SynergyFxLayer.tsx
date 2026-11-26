import { useEffect, useRef } from "react";
import { synergyOf } from "../economy/live/collections";
import { fxBudget, useSettings } from "../settings";
import { SynergyLayer } from "./board-synergy";
import { attachToTray } from "./tray-attach";

/** Mounts the theme synergy canvas inside the tray (lazy chunk; see SynergyFx in BoardFx.tsx). */
export default function SynergyFxLayer({ dice, board, level, host, sound = true }: { dice?: string; board?: string; level: number; host: React.RefObject<HTMLElement | null>; sound?: boolean }) {
  const settings = useSettings();
  const collection = synergyOf(dice, board);
  const budget = collection ? fxBudget(settings) : 0;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const kind = collection?.kind;
  useEffect(() => {
    const section = host.current;
    if (!kind || budget <= 0 || !section) return;
    section.dataset.synergy = kind;
    // Level 1 → a lighter synergy, both items at Lv.3 → the full one.
    const detach = attachToTray(section, (tray) => new SynergyLayer(tray, kind, 0.65 + 0.175 * (Math.min(3, Math.max(1, level)) - 1), budget, () => soundRef.current));
    return () => {
      detach();
      delete section.dataset.synergy;
    };
  }, [kind, level, budget, host]);
  return null;
}
