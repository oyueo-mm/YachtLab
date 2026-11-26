#!/usr/bin/env node
/**
 * Automated loudness measurement of the synthesized audio (BGM tracks + every effect category).
 * Renders offline in headless Chromium through the same code and mix buses as the live game, then
 * reports sample peak and RMS (dBFS). This is a numeric check, NOT a listening test.
 *
 *   node scripts/audio/measure-levels.mjs [--json out.json]
 */
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const server = await createServer({ server: { port: 5199, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : { executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5199/YachtLab/");
const result = await page.evaluate(async () => {
  const m = await import("/YachtLab/src/audio/measure.ts");
  const sound = await import("/YachtLab/src/sound.ts");
  const { bgmGain } = await import("/YachtLab/src/audio/bgm.ts");
  const out = { bgm: await m.bgmLevels(), sfx: {}, curve: {} };
  const cases = [
    ["throw", {}], ["impact", { intensity: 1 }], ["impact", { intensity: 0.4 }], ["clack", { intensity: 0.8 }], ["roll", { intensity: 0.7 }], ["settle", {}],
    ["hold", {}], ["score", {}], ["bonus", {}], ["combo", {}],
    ["straightHit", {}], ["yachtHit", {}], ["yacht", {}], ["grand", {}], ["win", {}], ["lose", {}], ["fxFanfare", {}], ["fxCoin", {}],
    ...["chime", "bell", "pop", "fizz", "ice", "thud", "crack", "spark", "zap", "fire", "coin", "whoosh", "glass", "cosmic"].map((land) => ["diceFx", { land }]),
    ["boardFx", { land: "cosmic" }],
    ...["clap", "party", "fire", "bolt", "gem", "rattle", "rocket", "chime", "wave", "pop", "sigh"].map((emote) => ["emote", { emote, intensity: 0.75 }]),
    ...m.emoteVoices().map((voice) => ["emoteLv3", { voice }]),
  ];
  for (const [name, opt] of cases) {
    const key = name + (opt.land ? ":" + opt.land : opt.emote ? ":" + opt.emote : opt.voice ? ":" + opt.voice : opt.intensity ? "@" + opt.intensity : "");
    out.sfx[key] = await m.sfxLevel(name, opt, 0.7);
  }
  for (const v of [0.1, 0.3, 0.5, 0.7, 1]) out.curve[v] = { sfxDb: Math.round(200 * Math.log10(sound.volumeCurve(v) * sound.SFX_HEADROOM)) / 10, bgmDb: Math.round(200 * Math.log10(bgmGain(v))) / 10 };
  return out;
});
await browser.close();
await server.close();
const json = process.argv.indexOf("--json");
if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(result, null, 2));
console.log("BGM (rendered track, before the music slider)"); console.table(result.bgm);
console.log("Effects at effects slider 70 % (default), through buses + limiter"); console.table(result.sfx);
console.log("Slider → gain (dB)"); console.table(result.curve);
