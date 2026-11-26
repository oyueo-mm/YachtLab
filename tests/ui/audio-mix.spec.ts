import { expect, test } from "@playwright/test";

/**
 * Automated loudness check (offline render in Chromium through the live mix buses and limiter).
 * Numbers, not a listening test: see docs/audio/MIX.md.
 */
type Level = { peak: number; rms: number; activeRms: number };
type Measure = {
  bgmLevels: () => Promise<Record<string, Level>>;
  sfxLevel: (name: string, options?: object, volume?: number) => Promise<Level>;
  emoteVoices: () => string[];
};

test("BGM 7곡은 −23…−19 dBFS RMS로 정규화되고 클리핑이 없다", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "오프라인 렌더는 한 번만");
  await page.goto("./");
  const bgm = await page.evaluate(async () => ((await (window as unknown as { __yachtlabAudioMeasure: () => Promise<Measure> }).__yachtlabAudioMeasure()) as Measure).bgmLevels());
  expect(Object.keys(bgm)).toHaveLength(7);
  for (const [scene, l] of Object.entries(bgm)) {
    expect(l.rms, scene).toBeGreaterThan(-23.5);
    expect(l.rms, scene).toBeLessThan(-19);
    expect(l.peak, scene).toBeLessThanOrEqual(-0.9);
  }
});

test("이모티콘 전용음은 모두 또렷한 크기이고, 100 %에서도 0 dBFS를 넘지 않는다", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "오프라인 렌더는 한 번만");
  await page.goto("./");
  const result = await page.evaluate(async () => {
    const m = (await (window as unknown as { __yachtlabAudioMeasure: () => Promise<Measure> }).__yachtlabAudioMeasure()) as Measure;
    const out: Record<string, { def: Level; max: Level }> = {};
    for (const voice of m.emoteVoices()) out[voice] = { def: await m.sfxLevel("emoteLv3", { voice }, 0.7), max: await m.sfxLevel("emoteLv3", { voice }, 1) };
    out.impact = { def: await m.sfxLevel("impact", { intensity: 1 }, 0.7), max: await m.sfxLevel("impact", { intensity: 1 }, 1) };
    out.yacht = { def: await m.sfxLevel("yachtHit", {}, 0.7), max: await m.sfxLevel("yachtHit", {}, 1) };
    return out;
  });
  const { impact, ...rest } = result;
  for (const [voice, l] of Object.entries(rest)) {
    expect(l.def.activeRms, voice).toBeGreaterThan(-39);
    expect(l.def.peak, voice).toBeLessThan(-4); // noise bursts use random offsets: ±2 dB between renders
    expect(l.max.peak, voice).toBeLessThanOrEqual(0);
  }
  // emotes are not buried under a single hard dice hit any more
  const median = Object.values(rest).map((l) => l.def.activeRms).sort((a, b) => a - b)[Math.floor(Object.keys(rest).length / 2)];
  expect(median).toBeGreaterThan(impact.def.activeRms);
});
