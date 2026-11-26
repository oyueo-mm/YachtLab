import { describe, expect, it } from "vitest";
import { BUS_GAIN, SFX_HEADROOM, volumeCurve } from "../src/sound";
import { normalize, PEAK_CEILING_DB, TARGET_RMS_DB } from "../src/audio/bgm-render";

const dB = (g: number) => 20 * Math.log10(g);

describe("오디오 믹스 (2026-11-27)", () => {
  it("음량 슬라이더는 같은 간격이 같은 dB 변화가 되고, 0은 무음·100%는 0 dB", () => {
    expect(volumeCurve(0)).toBe(0);
    expect(volumeCurve(1)).toBeCloseTo(1, 6);
    expect(dB(volumeCurve(0.1))).toBeCloseTo(-30, 1);
    const steps = [0.2, 0.4, 0.6, 0.8, 1].map((v) => dB(volumeCurve(v)));
    const deltas = steps.slice(1).map((v, i) => v - steps[i]);
    for (const d of deltas) expect(d).toBeCloseTo(deltas[0], 6); // constant dB per step above 10 %
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.01) {
      const g = volumeCurve(v);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });
  it("기본 효과음 70 %의 실제 이득은 예전과 같다(주사위 소리 체감 유지)", () => {
    expect(volumeCurve(0.7) * SFX_HEADROOM).toBeCloseTo(0.7 * 0.9, 2);
  });
  it("이모티콘·아이템 효과음은 주사위보다 큰 버스 이득을 가진다", () => {
    expect(BUS_GAIN.emote).toBeGreaterThan(BUS_GAIN.dice * 2);
    expect(BUS_GAIN.item).toBeGreaterThan(BUS_GAIN.dice * 2);
  });
  it("BGM 정규화: 목표 RMS로 올리되 샘플 피크는 천장을 넘지 않는다", () => {
    const fake = (data: Float32Array[]) => ({ numberOfChannels: data.length, getChannelData: (c: number) => data[c] }) as unknown as AudioBuffer;
    // quiet sine: RMS −43 dBFS
    const a = new Float32Array(22050).map((_, i) => 0.01 * Math.sin(i / 7));
    const r = normalize(fake([a, a.slice()]));
    expect(r.rmsDb).toBeCloseTo(TARGET_RMS_DB, 1);
    expect(r.peakDb).toBeLessThanOrEqual(PEAK_CEILING_DB + 1e-6);
    // very spiky signal: the peak ceiling wins over the RMS target
    const b = new Float32Array(22050);
    b[100] = 0.05;
    const s = normalize(fake([b]));
    expect(s.peakDb).toBeCloseTo(PEAK_CEILING_DB, 3);
    expect(s.rmsDb).toBeLessThan(TARGET_RMS_DB);
  });
});
