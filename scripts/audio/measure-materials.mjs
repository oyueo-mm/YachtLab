#!/usr/bin/env node
/**
 * FX-1 material sound matrix: every die material × board surface (floor hit), die-on-die knock, soft vs
 * hard hit (velocity → level and brightness), the Lv.3 throw accent, and a stress render (a whole busy
 * throw with a yacht on top at 100 % volume) for clipping and voice count. Offline render in headless
 * Chromium through the live buses and limiter. Numbers only — NOT a listening test.
 *
 *   node scripts/audio/measure-materials.mjs [--json docs/audio/materials-2026-11-28.json]
 */
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const server = await createServer({ server: { port: 5198, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5198/YachtLab/");
const result = await page.evaluate(async () => {
  const m = await import("/YachtLab/src/audio/measure.ts");
  const materials = ["plastic", "resin", "wood", "metal", "gold", "glass", "crystal", "stone", "ice", "lava", "magic", "space"];
  const surfaces = ["matte", "felt", "wood", "stone", "ice", "metal", "water", "grass"];
  const out = { floor: {}, knock: {}, velocity: {}, accent: {}, stress: {} };
  for (const material of materials) {
    out.floor[material] = {};
    for (const surface of surfaces) {
      const p = await m.sfxProfile("impact", { material, surface, intensity: 1 });
      out.floor[material][surface] = `${p.activeRms} dB / ${p.centroidHz} Hz`;
    }
    const k = await m.sfxProfile("clack", { material, intensity: 0.8 });
    out.knock[material] = `${k.activeRms} dB / ${k.centroidHz} Hz`;
    const soft = await m.sfxProfile("impact", { material, intensity: 0.3 });
    const hard = await m.sfxProfile("impact", { material, intensity: 1 });
    out.velocity[material] = `soft ${soft.activeRms} dB ${soft.centroidHz} Hz → hard ${hard.activeRms} dB ${hard.centroidHz} Hz`;
  }
  for (const land of ["glass", "fire", "zap", "cosmic", "bell", "ice"]) {
    const roll = await m.sfxProfile("diceFxRoll", { land });
    const landing = await m.sfxProfile("diceFx", { land });
    out.accent[land] = `throw ${roll.activeRms} dB, landing ${landing.activeRms} dB`;
  }
  for (const [material, surface] of [["glass", "stone"], ["metal", "metal"], ["plastic", "matte"], ["wood", "wood"]]) out.stress[material + "/" + surface] = await m.stressLevel(1, material, surface);
  return out;
});
await browser.close();
await server.close();
const json = process.argv.indexOf("--json");
if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(result, null, 2));
for (const [k, v] of Object.entries(result)) { console.log(k); console.table(v); }
