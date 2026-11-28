import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import MaterialListening from "./MaterialListening";
import { RESULT_SETS, playSfx, resultSoundSet, setResultSoundSet, setSfxVariant, setSpeakerSimulation, sfxVariant, unlockAudio, type ResultSet, type Sfx, type SfxVariant } from "../sound";

/** A throw as heard in a game: shake, a few hits of decreasing strength, dice knocking, rolling, rest. */
function throwSequence() {
  playSfx("throw");
  const hits: [number, Sfx, number][] = [
    [0.16, "impact", 0.95],
    [0.21, "clack", 0.7],
    [0.29, "impact", 0.6],
    [0.36, "roll", 0.7],
    [0.42, "clack", 0.45],
    [0.5, "impact", 0.4],
    [0.56, "roll", 0.45],
    [0.68, "impact", 0.25],
    [0.82, "settle", 0.4],
  ];
  for (const [delay, name, intensity] of hits) playSfx(name, { delay, intensity, pan: (Math.random() - 0.5) * 0.8 });
}

const SINGLE: [string, () => void][] = [
  ["바닥 충돌 (강)", () => playSfx("impact", { intensity: 1 })],
  ["바닥 충돌 (약)", () => playSfx("impact", { intensity: 0.35 })],
  ["주사위끼리", () => playSfx("clack", { intensity: 0.8 })],
  ["구르기", () => playSfx("roll", { intensity: 0.8 })],
  ["멈춤", () => playSfx("settle", { intensity: 0.5 })],
  ["요트 달성", () => playSfx("yachtHit")],
  ["라지 스트레이트", () => playSfx("straightHit")],
  ["상대 입장", () => playSfx("join")],
];

/**
 * Side-by-side listening test for the dice sounds: v1 (first synthesis), v2 (current), v3 (candidate).
 * All sounds are synthesized in the browser (src/sound.ts) — no audio files, no third-party licenses.
 */
export default function SoundDemo() {
  const [variant, setVariant] = useState<SfxVariant>(sfxVariant);
  const [result, setResult] = useState<ResultSet>(resultSoundSet);
  // Leaving the lab restores the current sounds for games (and turns the speaker simulation off).
  useEffect(() => () => { setSfxVariant("v2"); setSpeakerSimulation(false); }, []);
  const pick = (v: SfxVariant) => {
    setSfxVariant(v);
    setVariant(v);
  };
  const play = (fn: () => void) => {
    unlockAudio();
    fn();
  };
  return (
    <div className="sound-demo" aria-label="효과음 시연">
      <h2>효과음 시연</h2>
      <div className="segmented" role="radiogroup" aria-label="효과음 버전">
        {(["v1", "v2", "v3"] as const).map((v) => (
          <label key={v} className={variant === v ? "checked" : ""}>
            <input type="radio" name="sfx-variant" checked={variant === v} onChange={() => pick(v)} />
            <span>{v === "v2" ? "현재 (v2)" : v === "v1" ? "이전 (v1)" : "후보 (v3)"}</span>
          </label>
        ))}
      </div>
      <div className="sound-demo-buttons">
        <button type="button" className="primary" onClick={() => play(throwSequence)}>
          <Volume2 size={16} /> 한 번 던지기
        </button>
        {SINGLE.map(([label, fn]) => (
          <button key={label} type="button" className="secondary" onClick={() => play(fn)}>
            {label}
          </button>
        ))}
      </div>
      <h3 className="sound-demo-sub">경기 결과 소리</h3>
      <div className="segmented sound-result-sets" role="radiogroup" aria-label="결과 소리 후보">
        {RESULT_SETS.map((r) => (
          <label key={r.id} className={result === r.id ? "checked" : ""} title={r.note}>
            <input
              type="radio"
              name="result-set"
              checked={result === r.id}
              onChange={() => {
                setResultSoundSet(r.id);
                setResult(r.id);
              }}
            />
            <span>{r.label}</span>
          </label>
        ))}
      </div>
      <div className="sound-demo-buttons" role="group" aria-label="결과 소리 듣기">
        {(
          [
            ["승리 (단독 1위)", "win"],
            ["공동 1위", "winShared"],
            ["패배 · 2위 이하", "lose"],
            ["무승부", "draw"],
          ] as const
        ).map(([label, name]) => (
          <button key={name} type="button" className="secondary" onClick={() => play(() => playSfx(name))}>
            {label}
          </button>
        ))}
      </div>
      <p className="setup-note">고른 결과 소리는 이 기기의 게임에 그대로 쓰여요(기본: 밝은 팡파르). 음량·음소거 설정을 따라요.</p>
      <MaterialListening />
      <p className="setup-note">효과음은 모두 브라우저에서 합성해요(외부 음원 없음). 이전·현재·후보 버전으로 같은 소리를 비교해 보세요. 후보(v3)는 휴대폰 스피커에서도 들리는 음역과 짧은 잡음 타격음을 쓴 실험 버전이에요. 게임에는 항상 현재 버전이 쓰여요.</p>
    </div>
  );
}
