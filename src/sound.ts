import { getSettings } from "./settings";

/**
 * Sound effects synthesized at runtime with the Web Audio API.
 * Every sound is generated from oscillators and generated noise in this file — no audio assets,
 * so there are no third-party license terms to track.
 *
 * Autoplay policy: the AudioContext is only created/resumed inside a real user gesture
 * (pointerdown/keydown). Until then every request is skipped silently, never queued.
 */
export type Sfx =
  | "throw"
  | "impact"
  | "settle"
  | "hold"
  | "release"
  | "score"
  | "scoreZero"
  | "bonus"
  | "yacht"
  | "win"
  | "lose"
  | "draw";

export type SfxOptions = {
  /** Seconds from now. Used to line sounds up with dice keyframes. */
  delay?: number;
  /** 0..1 loudness/brightness scale (e.g. later bounces are softer). */
  intensity?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
};

type LogEntry = { name: Sfx; delay: number; played: boolean; at: number };
/** Small diagnostic ring buffer (also read by browser tests to verify sync and mute). */
export const soundLog: LogEntry[] = [];
if (typeof window !== "undefined") (window as unknown as { __yachtlabSound?: { log: LogEntry[] } }).__yachtlabSound = { log: soundLog };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.connect(ctx.destination);
  const length = Math.floor(ctx.sampleRate * 0.5);
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  return ctx;
}

/** Must be called from a user gesture handler. */
export function unlockAudio() {
  const settings = getSettings();
  if (settings.muted || settings.volume <= 0) return;
  const audio = context();
  if (audio && audio.state === "suspended") void audio.resume().catch(() => undefined);
}

let installed = false;
/** Unlock on the first real interaction; safe to call many times. */
export function installAudioUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

const ready = () => {
  const settings = getSettings();
  if (settings.muted || settings.volume <= 0 || !ctx || !master || ctx.state !== "running") return null;
  master.gain.value = settings.volume * 0.9;
  return { audio: ctx, out: master };
};

function voice(audio: AudioContext, out: AudioNode, pan: number) {
  if (!pan || !audio.createStereoPanner) return out;
  const panner = audio.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(out);
  return panner;
}

function tone(audio: AudioContext, out: AudioNode, start: number, freq: number, length: number, gain: number, type: OscillatorType = "sine", endFreq?: number) {
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + length);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.012, length / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

function burst(audio: AudioContext, out: AudioNode, start: number, length: number, gain: number, filter: BiquadFilterType, freq: number, endFreq?: number, q = 0.8) {
  if (!noise) return;
  const src = audio.createBufferSource();
  src.buffer = noise;
  const biquad = audio.createBiquadFilter();
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(freq, start);
  if (endFreq) biquad.frequency.exponentialRampToValueAtTime(endFreq, start + length);
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, length / 3));
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  src.connect(biquad).connect(env).connect(out);
  src.start(start, Math.random() * 0.3);
  src.stop(start + length + 0.02);
}

const notes = (audio: AudioContext, out: AudioNode, start: number, freqs: number[], step: number, length: number, gain: number, type: OscillatorType) =>
  freqs.forEach((f, i) => tone(audio, out, start + i * step, f, length, gain, type));

export function playSfx(name: Sfx, options: SfxOptions = {}) {
  const delay = Math.max(0, options.delay ?? 0);
  const engine = ready();
  soundLog.push({ name, delay, played: !!engine, at: typeof performance !== "undefined" ? performance.now() : 0 });
  if (soundLog.length > 200) soundLog.splice(0, soundLog.length - 200);
  if (!engine) return;
  const { audio } = engine;
  const k = Math.max(0.15, Math.min(1, options.intensity ?? 1));
  const out = voice(audio, engine.out, options.pan ?? 0);
  const t = audio.currentTime + delay + 0.005;
  switch (name) {
    case "throw": // dice leaving the hand / sliding out of a cup
      burst(audio, out, t, 0.2, 0.22 * k, "bandpass", 700, 2600, 1.1);
      break;
    case "impact": // die hitting the felt tray: a dull thud plus a short click
      tone(audio, out, t, 150 + 40 * k, 0.07, 0.35 * k, "sine", 70);
      burst(audio, out, t, 0.035, 0.28 * k, "highpass", 1800, undefined, 0.7);
      break;
    case "settle": // final tiny wobble
      burst(audio, out, t, 0.03, 0.12 * k, "bandpass", 2400, undefined, 2);
      tone(audio, out, t, 210, 0.05, 0.12 * k, "sine", 120);
      break;
    case "hold":
      tone(audio, out, t, 880, 0.06, 0.16, "triangle", 1180);
      burst(audio, out, t, 0.015, 0.08, "highpass", 3000);
      break;
    case "release":
      tone(audio, out, t, 700, 0.06, 0.12, "triangle", 470);
      break;
    case "score":
      notes(audio, out, t, [659.25, 987.77], 0.07, 0.16, 0.16, "sine");
      break;
    case "scoreZero":
      tone(audio, out, t, 330, 0.16, 0.12, "triangle", 260);
      break;
    case "bonus":
      notes(audio, out, t, [523.25, 659.25, 783.99, 1046.5], 0.075, 0.2, 0.15, "triangle");
      break;
    case "yacht":
      notes(audio, out, t, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.065, 0.22, 0.15, "triangle");
      [523.25, 659.25, 783.99].forEach((f) => tone(audio, out, t + 0.36, f, 0.55, 0.08, "sine"));
      break;
    case "win":
      notes(audio, out, t, [392, 523.25, 659.25, 783.99], 0.09, 0.24, 0.15, "triangle");
      [523.25, 659.25, 783.99].forEach((f) => tone(audio, out, t + 0.38, f, 0.6, 0.07, "sine"));
      break;
    case "lose":
      notes(audio, out, t, [440, 392, 329.63], 0.14, 0.3, 0.12, "sine");
      break;
    case "draw":
      notes(audio, out, t, [523.25, 523.25], 0.16, 0.22, 0.12, "triangle");
      break;
  }
}
