/**
 * Offline loudness check of the synthesized audio (lazy chunk; used by browser tests and
 * `scripts/audio/measure-levels.mjs`). Numbers only: this is not a listening test.
 */
import { render, TRACKS } from "./bgm-render";
import { EMOTE_VOICES, renderSfx, type Sfx, type SfxOptions } from "../sound";

export type Level = { peak: number; rms: number; activeRms: number };
const db = (v: number) => Math.round(200 * Math.log10(Math.max(v, 1e-9))) / 10;
/** Sample peak, whole-buffer RMS and RMS over the 50 ms windows that are not silent (dBFS). */
export function levels(buf: AudioBuffer): Level {
  let peak = 0, sum = 0, n = 0, activeSum = 0, active = 0;
  const win = Math.floor(buf.sampleRate * 0.05);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < buf.length; i += win) {
    let s = 0, m = 0;
    for (const d of chans)
      for (let j = i; j < Math.min(buf.length, i + win); j++) {
        s += d[j] * d[j];
        m++;
        const a = Math.abs(d[j]);
        if (a > peak) peak = a;
      }
    sum += s;
    n += m;
    if (Math.sqrt(s / m) > 0.001) {
      activeSum += s;
      active += m;
    }
  }
  return { peak: db(peak), rms: db(Math.sqrt(sum / n)), activeRms: db(Math.sqrt(activeSum / Math.max(1, active))) };
}
export const bgmLevels = async () => Object.fromEntries(await Promise.all(Object.entries(TRACKS).map(async ([k, c]) => [k, levels(await render(c))] as const)));
export const sfxLevel = async (name: Sfx, options: SfxOptions = {}, volume = 0.7) => levels(await renderSfx(name, options, volume));
export const emoteVoices = () => Object.keys(EMOTE_VOICES);
