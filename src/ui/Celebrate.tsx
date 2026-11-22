import { Sparkles, Star } from "lucide-react";
import type { Celebration } from "../game-feel";

/** Brief visual cue that accompanies the yacht / upper-bonus sounds (sound is never the only signal). */
export function Celebrate({ value }: { value: Celebration }) {
  if (!value) return null;
  return (
    <div key={value.key} className={`celebrate celebrate-${value.kind}`} role="status">
      {value.kind === "yacht" ? <Sparkles size={22} aria-hidden="true" /> : <Star size={20} aria-hidden="true" />}
      <span>{value.kind === "yacht" ? "요트! +50" : "상단 보너스 +35"}</span>
    </div>
  );
}
