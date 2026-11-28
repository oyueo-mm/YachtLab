/**
 * 경기 결과 화면의 효과음 계획 (A3). 기존 효과음(src/sound.ts)만 조합하므로 음소거·효과음·음량 설정,
 * 버스 믹스와 리미터를 그대로 따른다. 승/패/무 기본음은 경기 종료 순간 game-feel.ts가 이미 재생하므로
 * 결과 창은 기본적으로 "덧붙이는 강조음"만 낸다(includeBase로 미리보기에서만 기본음 포함).
 */
import { playSfx, type Sfx } from "../sound";
import type { Drama, OutcomeKind } from "./model";

export type SoundCue = { sfx: Sfx; delay: number; intensity?: number };

export function resultSoundPlan(kind: OutcomeKind, drama: Drama, opts: { includeBase?: boolean; rank?: number; shared?: boolean } = {}): SoundCue[] {
  const cues: SoundCue[] = [];
  if (opts.includeBase) {
    const base: Sfx | null =
      kind === "win" || kind === "forfeit-win" ? "win"
      : kind === "loss" || kind === "forfeit-loss" ? "lose"
      : kind === "draw" ? "draw"
      : kind === "rank" ? (opts.rank === 1 ? (opts.shared ? "winShared" : "win") : "draw")
      : null;
    if (base) cues.push({ sfx: base, delay: 0, intensity: kind === "forfeit-win" ? 0.6 : 1 });
  }
  if (drama === "grand-comeback") cues.push({ sfx: "fxFanfare", delay: 0.35 }, { sfx: "fxCoin", delay: 1.1, intensity: 0.7 });
  else if (drama === "comeback") cues.push({ sfx: "fxFanfare", delay: 0.35, intensity: 0.75 });
  else if (drama === "final-turn") cues.push({ sfx: "fxBell", delay: 0.3 }, { sfx: "fxSparkle", delay: 0.7, intensity: 0.7 });
  else if (drama === "close") cues.push({ sfx: "fxBell", delay: 0.3, intensity: 0.7 });
  if (kind === "solo-best") cues.push({ sfx: "fxSparkle", delay: 0.25 }, { sfx: "fxBell", delay: 0.65, intensity: 0.7 });
  else if (kind === "solo-first") cues.push({ sfx: "fxBell", delay: 0.25, intensity: 0.7 });
  return cues;
}

/** 실제 재생. playSfx가 설정(음소거·효과음 끄기·음량)을 확인하므로 여기서 따로 검사하지 않는다. */
export function playResultSounds(cues: readonly SoundCue[]) {
  for (const cue of cues) playSfx(cue.sfx, { delay: cue.delay, intensity: cue.intensity });
}
