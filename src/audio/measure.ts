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

/**
 * Spectral centroid (Hz) of the loudest 1024 samples (FX-1 material comparison): a single number for
 * "how bright" a collision is. Plain DFT on 128 bands; numbers only, not a listening test.
 */
export function centroid(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  let at = 0, max = 0;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > max) { max = Math.abs(d[i]); at = i; }
  const N = 1024, start = Math.max(0, Math.min(d.length - N, at - 256));
  let num = 0, den = 0;
  for (let b = 1; b < 256; b++) {
    const f = (b * buf.sampleRate) / (2 * 256);
    let re = 0, im = 0;
    const w = (2 * Math.PI * f) / buf.sampleRate;
    for (let n = 0; n < N; n++) {
      const x = d[start + n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
      re += x * Math.cos(w * n);
      im -= x * Math.sin(w * n);
    }
    const p = re * re + im * im;
    num += p * f;
    den += p;
  }
  return Math.round(den ? num / den : 0);
}
export const sfxProfile = async (name: Sfx, options: SfxOptions = {}, volume = 0.7) => {
  const buf = await renderSfx(name, options, volume);
  return { ...levels(buf), centroidHz: centroid(buf) };
};
/** A busy throw: 5 dice, ~40 collisions in 1.2 s, rolling, settle, Lv.3 accents and a yacht on top. */
export async function stressLevel(volume = 1, material: SfxOptions["material"] = "glass", surface: SfxOptions["surface"] = "stone") {
  const { renderSfxSequence } = await import("../sound");
  const events: { name: Sfx; at: number; options?: SfxOptions }[] = [{ name: "throw", at: 0, options: { material } }, { name: "diceFxRoll", at: 0.03, options: { land: "glass" } }];
  for (let i = 0; i < 40; i++) events.push({ name: i % 3 ? "impact" : "clack", at: 0.15 + i * 0.03, options: { material, surface: i % 3 ? surface : undefined, intensity: 1 - (i / 40) * 0.6, pan: ((i % 5) - 2) / 2 } });
  for (let i = 0; i < 8; i++) events.push({ name: "roll", at: 0.2 + i * 0.12, options: { material, surface, intensity: 0.8 } });
  events.push({ name: "settle", at: 1.45, options: { material, surface } }, { name: "diceFx", at: 1.5, options: { land: "glass" } }, { name: "yachtHit", at: 1.55 }, { name: "boardFx", at: 1.5, options: { land: "cosmic" } });
  const r = await renderSfxSequence(events, volume, 3.2);
  return { ...levels(r.buffer), admitted: r.admitted, requested: r.requested };
}
