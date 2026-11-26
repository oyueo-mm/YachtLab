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

const idle = () =>
  new Promise<void>((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 1500 });
    else setTimeout(resolve, 300);
  });
const cache = new Map<string, Promise<AudioBuffer>>();
function track(scene: Exclude<BgmScene, "none">) {
  let p = cache.get(scene);
  if (!p) {
    // Built in idle time so the first throw after the unlocking tap never waits for the music graph.
    p = idle().then(() => import("./bgm-render")).then((m) => m.render(m.TRACKS[scene]));
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
