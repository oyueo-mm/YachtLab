import { Star } from "lucide-react";
import type { Celebration } from "../game-feel";

/**
 * Brief visual cue for the upper-bonus sound (sound is never the only signal).
 * Yacht and the other combinations are shown by the score effect itself (dice + label).
 */
export function Celebrate({ value }: { value: Celebration }) {
  if (!value || value.kind !== "bonus") return null;
  return (
    <div key={value.key} className="celebrate celebrate-bonus" role="status">
      <Star size={20} aria-hidden="true" />
      <span>상단 보너스 +35</span>
    </div>
  );
}
