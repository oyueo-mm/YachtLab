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
  | "clack"
  | "roll"
  | "combo"
  | "grand"
  | "settle"
  | "hold"
  | "release"
  | "score"
  | "scoreZero"
  | "bonus"
  | "yacht"
  | "win"
  | "lose"
  | "draw"
  /** Five of a kind just came up (before any score is chosen). */
  | "yachtHit"
  /** Another player joined the online room. */
  | "join";

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

/**
 * "v2" (default): dice sounds modelled on real plastic dice — short resonant clicks with several
 * damped modes, a table thud that grows with the impact, rolling as a train of tiny edge clicks and a
 * settling rattle; every hit varies a little in pitch, level and pan. "v1" keeps the first synthesis
 * for side-by-side comparison (주사위 실험실 → 효과음 시연).
 * "v3" (candidate, lab only until people have listened to it on phones): see the v3 section below.
 */
export type SfxVariant = "v1" | "v2" | "v3";
let variant: SfxVariant = "v2";
export const sfxVariant = () => variant;
export function setSfxVariant(v: SfxVariant) {
  variant = v;
}

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
  // A gentle compressor keeps bursts of collisions from clipping (no harsh distortion on phones).
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter).connect(ctx.destination);
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

/* ------------------------------------------------------------------ v2 dice ------------------------------------------------------------------ */

const jitter = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;

/** Damped sine modes: the ring of a small hard object (each mode: frequency Hz, decay s, level). */
function modes(audio: AudioContext, out: AudioNode, start: number, list: [number, number, number][]) {
  for (const [freq, decay, gain] of list) {
    if (gain < 0.002) continue;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.0001, start + decay * 4);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(start + decay * 4 + 0.01);
  }
}

/** A plastic die hitting the felt-and-wood tray: click modes + a body thud, both scaled by strength. */
function dieOnTable(audio: AudioContext, out: AudioNode, t: number, k: number) {
  const p = jitter(0.06);
  const bright = 0.35 + 0.65 * k;
  modes(audio, out, t, [
    [1850 * p, 0.012, 0.22 * k],
    [2950 * p * jitter(0.03), 0.008, 0.16 * k * bright],
    [4420 * p * jitter(0.03), 0.005, 0.1 * k * bright],
  ]);
  tone(audio, out, t, 150 * jitter(0.12) + 70 * k, 0.04 + 0.06 * k, (0.08 + 0.34 * k) * jitter(0.15), "sine", 70);
  burst(audio, out, t, 0.004 + 0.004 * k, 0.12 * k, "highpass", 2500, undefined, 0.7);
}

/** Two dice knocking: higher, drier, no thud. */
function dieOnDie(audio: AudioContext, out: AudioNode, t: number, k: number) {
  const p = jitter(0.08);
  modes(audio, out, t, [
    [3300 * p, 0.009, 0.2 * k],
    [4950 * p * jitter(0.04), 0.006, 0.14 * k],
    [6800 * p * jitter(0.04), 0.004, 0.08 * k],
  ]);
  burst(audio, out, t, 0.004, 0.1 * k, "bandpass", 5200, undefined, 1.4);
}

/** A die tumbling over its edges: a quick train of tiny ticks (count and level follow the speed). */
function rolling(audio: AudioContext, out: AudioNode, t: number, k: number) {
  const ticks = 2 + Math.round(3 * k);
  let at = t;
  for (let i = 0; i < ticks; i++) {
    const g = (0.03 + 0.08 * k) * jitter(0.35);
    modes(audio, out, at, [
      [2300 * jitter(0.12), 0.005, g],
      [3600 * jitter(0.12), 0.003, g * 0.6],
    ]);
    if (i % 2 === 0) tone(audio, out, at, 190 * jitter(0.1), 0.03, g * 0.7, "sine", 110);
    at += (0.018 + Math.random() * 0.024) / (0.6 + k);
  }
}

/** Coming to rest: two or three ever softer, ever slower ticks. */
function settling(audio: AudioContext, out: AudioNode, t: number, k: number) {
  let at = t,
    gap = 0.035,
    g = 0.12 * k;
  for (let i = 0; i < 3; i++) {
    modes(audio, out, at, [
      [2100 * jitter(0.1), 0.007, g],
      [3300 * jitter(0.1), 0.004, g * 0.5],
    ]);
    tone(audio, out, at, 170 * jitter(0.1), 0.035, g * 0.8, "sine", 100);
    at += gap;
    gap *= 1.7;
    g *= 0.55;
  }
}

/** Dice leaving the hand: a short rattle of dice against each other. */
function shake(audio: AudioContext, out: AudioNode, t: number, k: number) {
  for (let i = 0; i < 4; i++) dieOnDie(audio, out, t + i * (0.028 + Math.random() * 0.02), 0.25 * k * jitter(0.3));
  burst(audio, out, t, 0.14, 0.05 * k, "bandpass", 1200, 3000, 0.8);
}


/* ------------------------------------------------------------------ v3 candidate ------------------------------------------------------------------ */
/*
 * Candidate for a more natural plastic-dice sound, compared side by side in the lab (not the default):
 *  - Attack from a very short band-passed noise impulse instead of pure sines (sines alone read "beepy").
 *  - Inharmonic modes whose ratios are re-drawn per hit, so repeated hits never sound like one sample.
 *  - The table body sits at ~380–520 Hz, where phone speakers still reproduce it (150 Hz thuds vanish on
 *    most phone speakers); a little low end remains for headphones.
 *  - Die-on-die contacts are a quick double tick (flam), as two edges rarely meet at the same instant.
 *  - Rolling is friction noise with sparse edge ticks rather than a train of identical clicks.
 * Whether this is actually better must be judged by listening (it has not been, on real phones).
 */
function impulse(audio: AudioContext, out: AudioNode, t: number, gain: number, freq: number, q: number, length = 0.003) {
  burst(audio, out, t, length, gain, "bandpass", freq, undefined, q);
}
function v3Table(audio: AudioContext, out: AudioNode, t: number, k: number) {
  impulse(audio, out, t, 0.2 * k, 3600 * jitter(0.15), 0.9);
  const base = 1700 * jitter(0.08);
  modes(audio, out, t, [
    [base, 0.01, 0.13 * k],
    [base * (1.55 + Math.random() * 0.15), 0.007, 0.09 * k],
    [base * (2.35 + Math.random() * 0.25), 0.004, 0.06 * k],
  ]);
  tone(audio, out, t, (380 + 140 * k) * jitter(0.1), 0.025 + 0.02 * k, (0.06 + 0.16 * k) * jitter(0.2), "sine", 260);
  if (k > 0.45) tone(audio, out, t, 140 * jitter(0.1), 0.06, 0.1 * k, "sine", 80);
}
function v3Die(audio: AudioContext, out: AudioNode, t: number, k: number) {
  const flam = 0.003 + Math.random() * 0.004;
  for (const [at, g] of [[t, 1], [t + flam, 0.55]] as const) {
    impulse(audio, out, at, 0.16 * k * g, 5200 * jitter(0.12), 1.3, 0.0025);
    const base = 3000 * jitter(0.1);
    modes(audio, out, at, [
      [base, 0.006, 0.12 * k * g],
      [base * (1.45 + Math.random() * 0.2), 0.004, 0.07 * k * g],
    ]);
  }
}
function v3Roll(audio: AudioContext, out: AudioNode, t: number, k: number) {
  burst(audio, out, t, 0.09, 0.035 + 0.05 * k, "bandpass", 1500 * jitter(0.2), 2200, 1.1);
  const ticks = 1 + Math.round(2 * k);
  for (let i = 0; i < ticks; i++) impulse(audio, out, t + Math.random() * 0.08, (0.05 + 0.07 * k) * jitter(0.3), 3000 * jitter(0.2), 1.1);
}
function v3Settle(audio: AudioContext, out: AudioNode, t: number, k: number) {
  let at = t,
    gap = 0.04,
    g = 0.1 * k;
  for (let i = 0; i < 3; i++) {
    impulse(audio, out, at, g, 3000 * jitter(0.15), 1);
    tone(audio, out, at, 420 * jitter(0.1), 0.02, g * 0.6, "sine", 300);
    at += gap;
    gap *= 1.6;
    g *= 0.5;
  }
}
function v3Shake(audio: AudioContext, out: AudioNode, t: number, k: number) {
  for (let i = 0; i < 5; i++) v3Die(audio, out, t + i * (0.022 + Math.random() * 0.018), 0.22 * k * jitter(0.35));
}

/**
 * Voice budget: physics can report dozens of contacts per throw. At most MAX_VOICES dice sounds ring
 * at once, and the same kind of sound is not repeated within a few milliseconds (louder hits win).
 */
export const MAX_VOICES = 10;
const MIN_GAP: Partial<Record<Sfx, number>> = { impact: 0.018, clack: 0.024, roll: 0.06, settle: 0.08 };
/** Pure admission control for collision sounds (times in seconds, on the audio clock). */
export function createVoiceBudget(maxVoices = MAX_VOICES) {
  let ends: number[] = [];
  const last = new Map<string, { at: number; k: number }>();
  return (name: Sfx, now: number, start: number, length: number, k: number): boolean => {
    ends = ends.filter((end) => end > now);
    const gap = MIN_GAP[name];
    if (gap !== undefined) {
      const prev = last.get(name);
      if (prev && Math.abs(start - prev.at) < gap && k <= prev.k * 1.4) return false;
      if (ends.length >= maxVoices) return false;
      last.set(name, { at: start, k });
    }
    ends.push(start + length);
    return true;
  };
}
const budget = createVoiceBudget();
const admit = (audio: AudioContext, name: Sfx, start: number, length: number, k: number) => budget(name, audio.currentTime, start, length, k);

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
  if (variant === "v3") {
    switch (name) {
      case "impact":
        if (k < 0.18 || !admit(audio, name, t, 0.08, k)) return;
        return v3Table(audio, out, t, k);
      case "clack":
        if (k < 0.18 || !admit(audio, name, t, 0.04, k)) return;
        return v3Die(audio, out, t, k);
      case "roll":
        if (!admit(audio, name, t, 0.1, k)) return;
        return v3Roll(audio, out, t, k);
      case "settle":
        if (!admit(audio, name, t, 0.2, k)) return;
        return v3Settle(audio, out, t, k);
      case "throw":
        return v3Shake(audio, out, t, k);
      default:
        break;
    }
  }
  if (variant === "v2") {
    switch (name) {
      case "impact":
        if (k < 0.18 || !admit(audio, name, t, 0.12, k)) return;
        return dieOnTable(audio, out, t, k);
      case "clack":
        if (k < 0.18 || !admit(audio, name, t, 0.05, k)) return;
        return dieOnDie(audio, out, t, k);
      case "roll":
        if (!admit(audio, name, t, 0.12, k)) return;
        return rolling(audio, out, t, k);
      case "settle":
        if (!admit(audio, name, t, 0.25, k)) return;
        return settling(audio, out, t, k);
      case "throw":
        return shake(audio, out, t, k);
      default:
        break;
    }
  }
  switch (name) {
    case "throw": // dice leaving the hand / sliding out of a cup
      burst(audio, out, t, 0.2, 0.22 * k, "bandpass", 700, 2600, 1.1);
      break;
    case "impact": {
      // Die hitting the matte tray. Hard hits: heavy thud + sharp tick; soft hits: a short muted tap.
      const hard = Math.max(0, (k - 0.35) / 0.65);
      tone(audio, out, t, 120 + 70 * k, 0.05 + 0.07 * k, (0.16 + 0.42 * k) * (0.9 + 0.2 * hard), "sine", 56);
      burst(audio, out, t, 0.02 + 0.03 * hard, 0.1 + 0.32 * hard, "highpass", 1500 + 1500 * hard, undefined, 0.7);
      if (hard > 0.5) burst(audio, out, t + 0.012, 0.06, 0.1 * hard, "lowpass", 900, 300);
      break;
    }
    case "clack": // two dice knocking: higher, drier, shorter than a floor hit
      tone(audio, out, t, 520 + 160 * k, 0.03, 0.18 * k, "square", 340);
      burst(audio, out, t, 0.022, 0.22 * k, "bandpass", 3200, undefined, 2.2);
      break;
    case "roll": // a die rolling over its edges: a faint dry rumble
      burst(audio, out, t, 0.1, 0.07 * k, "bandpass", 520, 360, 0.9);
      break;
    case "combo": // dice springing up: a bright two-note lift
      tone(audio, out, t, 587.33, 0.13, 0.16, "triangle", 740);
      tone(audio, out, t + 0.07, 880, 0.2, 0.15, "triangle", 1046.5);
      burst(audio, out, t, 0.05, 0.06, "highpass", 3500);
      break;
    case "grand": // large straight / yacht: a fuller rising figure
      notes(audio, out, t, [523.25, 659.25, 783.99, 1046.5], 0.06, 0.2, 0.15, "triangle");
      [523.25, 783.99, 1046.5].forEach((f) => tone(audio, out, t + 0.28, f, 0.5, 0.07, "sine"));
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
    case "yachtHit": // five of a kind: a quick bright sparkle rising over a soft chord
      notes(audio, out, t, [783.99, 987.77, 1174.66, 1567.98, 1975.53], 0.045, 0.18, 0.11, "triangle");
      [783.99, 1174.66, 1567.98].forEach((f) => tone(audio, out, t + 0.22, f, 0.6, 0.05, "sine"));
      for (let i = 0; i < 4; i++) burst(audio, out, t + 0.05 + i * 0.06, 0.03, 0.04, "highpass", 6000);
      break;
    case "join": // someone entered the room: a soft two-note chime
      tone(audio, out, t, 880, 0.35, 0.12, "sine");
      tone(audio, out, t + 0.14, 1318.51, 0.45, 0.11, "sine");
      tone(audio, out, t + 0.14, 2637.02, 0.2, 0.02, "sine");
      break;
  }
}
