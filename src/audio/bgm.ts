import { bgmAudible, getSettings, subscribeSettings } from "../settings";
import { onAudioUnlocked, sharedAudio } from "../sound";

/**
 * Background music (2026-11-26). Every track is composed and rendered in this file with the Web Audio
 * API (OfflineAudioContext) the first time its scene is needed: no audio files, nothing downloaded,
 * no third-party licence (the music is this project's own work, usable commercially).
 *
 *  - Seamless loop: each track is rendered with a tail and the tail is folded back onto the start, so
 *    the end flows into the beginning without a click or a gap (AudioBufferSourceNode.loop).
 *  - Crossfade: scene changes fade the old track out and the new one in (1.6 s), never two copies of
 *    the same scene; a scene that is already playing is not restarted.
 *  - Autoplay policy: nothing plays before a real user gesture has started the shared AudioContext.
 *  - Hidden tab / page leaving: the music fades out and stops; it comes back when the page is visible.
 *  - Lazy + cached: a track is rendered only when its scene first plays (≈ 0.1–0.3 s on the audio
 *    thread), kept in memory afterwards (≈ 2–3 MB per track at 22.05 kHz stereo float).
 *  - Independent from effects: own on/off and volume (settings: bgm, bgmVolume), master mute stops both.
 *
 * Extensible for sound packs: `TRACKS` maps a scene to a composition; a future BGM item can provide
 * its own composition table without touching playback.
 */
export type BgmScene = "home" | "lobby" | "game" | "shop" | "review" | "win" | "lose" | "none";

type Instrument = "pad" | "pluck" | "bell" | "bass" | "keys" | "shaker" | "kick" | "brush";
type Composition = {
  bpm: number;
  /** Chords as MIDI note lists, one per bar (looped). */
  chords: number[][];
  bars: number;
  seed: number;
  /** Relative level of each part (0 = off). */
  mix: Partial<Record<Instrument, number>>;
  /** Melody density 0..1 and register offset (semitones). */
  melody: { density: number; octave: number; voice: "pluck" | "bell" | "keys" };
  /** Low-pass ceiling of the whole track (Hz): lower = softer, less distracting. */
  tone: number;
  swing?: number;
};

const n = (name: string) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name)!;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"]!;
  return base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
};
const chord = (...names: string[]) => names.map(n);

export const TRACKS: Record<Exclude<BgmScene, "none">, Composition> = {
  // Harbor morning: warm major sevenths, marimba-like plucks, light brushes.
  home: {
    bpm: 84, bars: 8, seed: 11, tone: 5200, swing: 0.08,
    chords: [chord("C3", "E3", "G3", "B3"), chord("A2", "C3", "E3", "G3"), chord("F2", "A2", "C3", "E3"), chord("G2", "B2", "D3", "F3"),
      chord("C3", "E3", "G3", "B3"), chord("E2", "G2", "B2", "D3"), chord("F2", "A2", "C3", "E3"), chord("G2", "B2", "D3", "A3")],
    mix: { pad: 0.5, pluck: 0.0, bass: 0.55, brush: 0.18, shaker: 0.1 },
    melody: { density: 0.55, octave: 24, voice: "pluck" },
  },
  // Waiting room: an airy pulse that does not feel like a timer.
  lobby: {
    bpm: 96, bars: 8, seed: 23, tone: 6000,
    chords: [chord("D3", "F#3", "A3", "E4"), chord("B2", "D3", "F#3", "A3"), chord("G2", "B2", "D3", "F#3"), chord("A2", "D3", "E3", "A3"),
      chord("D3", "F#3", "A3", "C#4"), chord("B2", "D3", "F#3", "A3"), chord("G2", "B2", "D3", "F#3"), chord("A2", "C#3", "E3", "G3")],
    mix: { pad: 0.45, keys: 0.32, bass: 0.45, shaker: 0.16 },
    melody: { density: 0.35, octave: 24, voice: "bell" },
  },
  // In a match: very sparse and soft (thinking first): long pad, a few bell notes, no beat.
  game: {
    bpm: 66, bars: 8, seed: 37, tone: 3400,
    chords: [chord("F2", "A2", "C3", "E3"), chord("E2", "G2", "B2", "D3"), chord("D2", "F2", "A2", "C3"), chord("C2", "E2", "G2", "B2"),
      chord("Bb1", "D2", "F2", "A2"), chord("A1", "C2", "E2", "G2"), chord("D2", "F2", "A2", "C3"), chord("G1", "B1", "D2", "F2")],
    mix: { pad: 0.42, bass: 0.3 },
    melody: { density: 0.16, octave: 36, voice: "bell" },
  },
  // Shop: light and bouncy, a soft kick and shaker.
  shop: {
    bpm: 104, bars: 8, seed: 51, tone: 6500, swing: 0.12,
    chords: [chord("Eb3", "G3", "Bb3", "D4"), chord("C3", "Eb3", "G3", "Bb3"), chord("Ab2", "C3", "Eb3", "G3"), chord("Bb2", "D3", "F3", "Ab3"),
      chord("Eb3", "G3", "Bb3", "D4"), chord("G2", "Bb2", "D3", "F3"), chord("Ab2", "C3", "Eb3", "G3"), chord("Bb2", "D3", "F3", "C4")],
    mix: { pad: 0.3, keys: 0.3, bass: 0.55, shaker: 0.2, kick: 0.32 },
    melody: { density: 0.6, octave: 24, voice: "pluck" },
  },
  // Game review: reflective, slow minor colours.
  review: {
    bpm: 70, bars: 8, seed: 67, tone: 3800,
    chords: [chord("A2", "C3", "E3", "B3"), chord("F2", "A2", "C3", "E3"), chord("C3", "E3", "G3", "D4"), chord("G2", "B2", "D3", "A3"),
      chord("D2", "F2", "A2", "C3"), chord("A2", "C3", "E3", "G3"), chord("F2", "A2", "C3", "E3"), chord("E2", "G#2", "B2", "D3")],
    mix: { pad: 0.48, keys: 0.22, bass: 0.35 },
    melody: { density: 0.25, octave: 24, voice: "keys" },
  },
  // After a win: bright, festive but short phrases.
  win: {
    bpm: 112, bars: 4, seed: 79, tone: 7000,
    chords: [chord("C3", "E3", "G3", "C4"), chord("F3", "A3", "C4", "F4"), chord("A2", "C3", "E3", "A3"), chord("G2", "B2", "D3", "G3")],
    mix: { pad: 0.35, keys: 0.3, bass: 0.5, kick: 0.3, shaker: 0.2 },
    melody: { density: 0.7, octave: 24, voice: "bell" },
  },
  // After a loss: calm and kind, not sad.
  lose: {
    bpm: 72, bars: 4, seed: 83, tone: 3200,
    chords: [chord("F2", "A2", "C3", "E3"), chord("C3", "E3", "G3", "B3"), chord("D2", "F2", "A2", "C3"), chord("Bb1", "D2", "F2", "C3")],
    mix: { pad: 0.5, bass: 0.3, keys: 0.18 },
    melody: { density: 0.18, octave: 24, voice: "keys" },
  },
};

const RATE = 22050;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Render one composition to a seamlessly looping stereo buffer. */
async function render(c: Composition): Promise<AudioBuffer> {
  const beat = 60 / c.bpm;
  const bar = beat * 4;
  const loop = bar * c.bars;
  const tail = 3;
  const total = Math.ceil((loop + tail) * RATE);
  const off = new OfflineAudioContext(2, total, RATE);
  const out = off.createGain();
  out.gain.value = 0.55;
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = c.tone;
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  out.connect(lp).connect(comp).connect(off.destination);
  // generated reverb (exponentially decaying noise)
  const verb = off.createConvolver();
  const ir = off.createBuffer(2, Math.floor(RATE * 2.2), RATE);
  const r0 = rng(c.seed * 7);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (r0() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
  }
  verb.buffer = ir;
  const wet = off.createGain();
  wet.gain.value = 0.32;
  verb.connect(wet).connect(out);
  const send = (node: AudioNode, amount: number) => {
    const g = off.createGain();
    g.gain.value = amount;
    node.connect(g).connect(verb);
  };
  const noise = off.createBuffer(1, RATE, RATE);
  const nd = noise.getChannelData(0);
  const rn = rng(c.seed * 13);
  for (let i = 0; i < nd.length; i++) nd[i] = rn() * 2 - 1;

  const panned = (pan: number) => {
    const p = off.createStereoPanner();
    p.pan.value = pan;
    p.connect(out);
    send(p, 0.6);
    return p;
  };
  const env = (g: GainNode, t: number, a: number, peak: number, d: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const osc = (type: OscillatorType, f: number, t: number, len: number, dest: AudioNode, gain: number, a = 0.005, detune = 0) => {
    const o = off.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const g = off.createGain();
    env(g, t, a, gain, len);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + a + len + 0.05);
  };
  const r = rng(c.seed);
  const mix = c.mix;
  const padBus = panned(0);
  const padLp = off.createBiquadFilter();
  padLp.type = "lowpass";
  padLp.frequency.value = 1400;
  padLp.connect(padBus);
  for (let b = 0; b < c.bars; b++) {
    const t = b * bar;
    const ch = c.chords[b % c.chords.length];
    if (mix.pad) for (const [i, m] of ch.entries())
      for (const det of [-7, 7]) osc(i % 2 ? "triangle" : "sawtooth", hz(m + 12), t, bar + 0.6, padLp, 0.03 * mix.pad, 0.6, det);
    if (mix.bass) {
      osc("sine", hz(ch[0] - 12), t, beat * 1.6, panned(0), 0.24 * mix.bass, 0.01);
      osc("sine", hz(ch[0] - 12 + (r() < 0.5 ? 7 : 12)), t + beat * 2, beat * 1.4, panned(0), 0.18 * mix.bass, 0.01);
    }
    if (mix.keys) for (let k = 0; k < 4; k++) {
      if (k % 2 && r() < 0.5) continue;
      const tt = t + k * beat;
      for (const m of ch.slice(1)) osc("triangle", hz(m + 12), tt, beat * 0.9, panned(-0.25), 0.03 * mix.keys, 0.01);
    }
    for (let s = 0; s < 8; s++) {
      const sw = s % 2 ? (c.swing ?? 0) * beat : 0;
      const tt = t + s * beat * 0.5 + sw;
      if (mix.shaker && (s % 2 === 1 || r() < 0.25)) {
        const src = off.createBufferSource();
        src.buffer = noise;
        const f = off.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = 6500;
        const g = off.createGain();
        env(g, tt, 0.004, 0.05 * mix.shaker * (s % 2 ? 1 : 0.6), 0.06);
        src.connect(f).connect(g).connect(panned(0.35));
        src.start(tt, r() * 0.8);
        src.stop(tt + 0.1);
      }
      if (mix.brush && s % 2 === 1) {
        const src = off.createBufferSource();
        src.buffer = noise;
        const f = off.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 3200;
        const g = off.createGain();
        env(g, tt, 0.02, 0.05 * mix.brush, 0.18);
        src.connect(f).connect(g).connect(panned(-0.2));
        src.start(tt, r() * 0.8);
        src.stop(tt + 0.25);
      }
      if (mix.kick && s % 4 === 0) {
        const o = off.createOscillator();
        o.frequency.setValueAtTime(120, tt);
        o.frequency.exponentialRampToValueAtTime(48, tt + 0.16);
        const g = off.createGain();
        env(g, tt, 0.004, 0.32 * mix.kick, 0.2);
        o.connect(g).connect(panned(0));
        o.start(tt);
        o.stop(tt + 0.3);
      }
    }
    // melody: chord tones (and a passing note) on a gentle rhythm
    const steps = 8;
    let last = ch[1];
    for (let s = 0; s < steps; s++) {
      if (r() > c.melody.density * (s % 2 ? 0.7 : 1.1)) continue;
      const pool = [...ch, ch[1] + 12, ch[0] + 12];
      let m = pool[Math.floor(r() * pool.length)];
      if (Math.abs(m - last) > 9) m = last + (m > last ? 2 : -2);
      last = m;
      const tt = t + s * beat * 0.5 + (s % 2 ? (c.swing ?? 0) * beat : 0);
      const f = hz(m + c.melody.octave - 12);
      const dest = panned((r() - 0.5) * 0.5);
      if (c.melody.voice === "pluck") {
        osc("triangle", f, tt, 0.42, dest, 0.07, 0.004);
        osc("sine", f * 2, tt, 0.12, dest, 0.02, 0.003);
      } else if (c.melody.voice === "bell") {
        osc("sine", f, tt, 1.1, dest, 0.05, 0.003);
        osc("sine", f * 2.76, tt, 0.4, dest, 0.012, 0.002);
        osc("sine", f * 5.4, tt, 0.15, dest, 0.005, 0.002);
      } else {
        osc("triangle", f, tt, 0.7, dest, 0.05, 0.01);
        osc("sine", f * 2, tt, 0.35, dest, 0.015, 0.008);
      }
    }
  }
  const rendered = await off.startRendering();
  // fold the tail onto the beginning → seamless loop of exactly `loop` seconds
  const len = Math.floor(loop * RATE);
  const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: RATE });
  for (let ch = 0; ch < 2; ch++) {
    const src = rendered.getChannelData(ch);
    const dst = buf.getChannelData(ch);
    dst.set(src.subarray(0, len));
    for (let i = len; i < src.length; i++) dst[i - len] += src[i];
  }
  return buf;
}

const cache = new Map<string, Promise<AudioBuffer>>();
function track(scene: Exclude<BgmScene, "none">) {
  let p = cache.get(scene);
  if (!p) {
    p = render(TRACKS[scene]);
    cache.set(scene, p);
    p.catch(() => cache.delete(scene));
  }
  return p;
}

type Playing = { scene: BgmScene; src: AudioBufferSourceNode; gain: GainNode };
let wanted: BgmScene = "none";
let playing: Playing | null = null;
let bus: GainNode | null = null;
let generation = 0;
const FADE = 1.6;
/** Diagnostics for tests: the scene that is audible (or would be) and how many sources are live. */
export const bgmState = { scene: "none" as BgmScene, live: 0, requested: "none" as BgmScene };
if (typeof window !== "undefined") (window as unknown as { __yachtlabBgm?: typeof bgmState }).__yachtlabBgm = bgmState;

function output(audio: AudioContext) {
  if (!bus || bus.context !== audio) {
    bus = audio.createGain();
    bus.connect(audio.destination);
  }
  bus.gain.setTargetAtTime(getSettings().bgmVolume * 0.6, audio.currentTime, 0.08);
  return bus;
}

function fadeOut(p: Playing, audio: AudioContext, seconds = FADE) {
  const t = audio.currentTime;
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(p.gain.gain.value, t);
  p.gain.gain.linearRampToValueAtTime(0, t + seconds);
  try {
    p.src.stop(t + seconds + 0.05);
  } catch {
    /* already stopped */
  }
  p.src.onended = () => {
    bgmState.live = Math.max(0, bgmState.live - 1);
    p.src.disconnect();
    p.gain.disconnect();
  };
}

async function sync() {
  const audio = sharedAudio();
  const scene = typeof document !== "undefined" && document.hidden ? "none" : bgmAudible() ? wanted : "none";
  bgmState.requested = wanted;
  if (!audio) return;
  if (playing?.scene === scene) {
    output(audio);
    return;
  }
  const gen = ++generation;
  if (playing) {
    fadeOut(playing, audio, scene === "none" ? 0.6 : FADE);
    playing = null;
  }
  bgmState.scene = "none";
  if (scene === "none") return;
  let buffer: AudioBuffer;
  try {
    buffer = await track(scene);
  } catch {
    return;
  }
  if (gen !== generation) return; // a newer scene was requested meanwhile
  const src = audio.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, audio.currentTime);
  gain.gain.linearRampToValueAtTime(1, audio.currentTime + FADE);
  src.connect(gain).connect(output(audio));
  src.start();
  bgmState.live++;
  bgmState.scene = scene;
  playing = { scene, src, gain };
}

/** Ask for the music of a scene (repeated calls with the same scene do nothing). */
export function setBgmScene(scene: BgmScene) {
  if (wanted === scene) return;
  wanted = scene;
  void sync();
}

/**
 * Scene requests from the screen tree: the page (priority 0), a match in progress (1), the review
 * dialog (2), the result dialog (3). The highest priority wins; ties go to the newest request.
 */
const requests: { id: number; scene: BgmScene; priority: number }[] = [];
let requestSeq = 0;
function resolve() {
  let best: (typeof requests)[number] | null = null;
  for (const r of requests) if (!best || r.priority >= best.priority) best = r;
  setBgmScene(best?.scene ?? "none");
}
export function requestBgm(scene: BgmScene, priority = 0) {
  const r = { id: ++requestSeq, scene, priority };
  requests.push(r);
  resolve();
  return () => {
    const i = requests.findIndex((x) => x.id === r.id);
    if (i >= 0) requests.splice(i, 1);
    resolve();
  };
}
export const bgmScene = () => wanted;

let installed = false;
/** Wire the music to settings, visibility and the first user gesture. Safe to call more than once. */
export function installBgm() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  onAudioUnlocked(() => void sync());
  subscribeSettings(() => void sync());
  document.addEventListener("visibilitychange", () => void sync());
  window.addEventListener("pagehide", () => {
    const audio = sharedAudio();
    if (audio && playing) {
      fadeOut(playing, audio, 0.1);
      playing = null;
    }
  });
}
