import { useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import { playSfx, setSpeakerSimulation, speakerSimulation, unlockAudio, type Sfx, type Surface } from "../sound";
import { dieSounds, type DiceMaterial } from "../sound-packs";
import type { LandSound } from "../dice3d/dice-fx";

/**
 * FX-1 listening check (developer lab, not a player setting). People compare what the offline numbers
 * cannot judge: does each material sound like itself, do material × board combinations make sense, does a
 * repeated hit get tiring, is the theme layer under the physical sound, and how it survives a phone speaker.
 * Everything goes through the live mix (`playSfx`), so mute / volume settings apply as in a game.
 */
const MATERIALS: DiceMaterial[] = ["plastic", ...(Object.keys(dieSounds) as DiceMaterial[])];
const SURFACES: Surface[] = ["matte", "felt", "wood", "leather", "stone", "ice", "metal", "water", "sand", "grass", "acrylic"];
const ACCENTS: LandSound[] = ["glass", "fire", "zap", "cosmic", "bell", "ice", "crack", "coin"];

function throwOf(material: DiceMaterial, surface: Surface) {
  playSfx("throw", { material });
  const hits: [number, Sfx, number][] = [[0.16, "impact", 0.95], [0.21, "clack", 0.7], [0.29, "impact", 0.6], [0.36, "roll", 0.7], [0.42, "clack", 0.45], [0.5, "impact", 0.4], [0.56, "roll", 0.45], [0.68, "impact", 0.25], [0.82, "settle", 0.4]];
  for (const [delay, name, intensity] of hits) playSfx(name, { delay, intensity, material, surface: name === "clack" ? undefined : surface, pan: (Math.random() - 0.5) * 0.8 });
}

export const LISTENING_FORM = `### FX-1 청취 평가 (기기: ___ / 출력: 스피커·이어폰 / 음량: __%)
| 항목 | 1~5 | 메모 |
|---|---|---|
| 재질이 소리로 구별된다(플라스틱·나무·금속·유리·보석·돌·얼음) | | |
| 보드 표면 조합이 자연스럽다(펠트·원목·석재·금속·물) | | |
| 강약(세게/약하게)이 자연스럽다 | | |
| 같은 충돌 12회 반복이 거슬리지 않는다 | | |
| 테마 보조음이 물리음을 가리지 않는다 | | |
| 휴대폰 스피커에서 충돌음이 들린다 | | |
| 요트·스트레이트·승리음의 크기가 적당하다 | | |
`;

export default function MaterialListening() {
  const [material, setMaterial] = useState<DiceMaterial>("plastic");
  const [surface, setSurface] = useState<Surface>("felt");
  const [speaker, setSpeaker] = useState(speakerSimulation);
  const [blind, setBlind] = useState<{ a: DiceMaterial; b: DiceMaterial; shown: boolean } | null>(null);
  const play = (fn: () => void) => {
    unlockAudio();
    fn();
  };
  const sweep = () => [0.2, 0.4, 0.6, 0.8, 1].forEach((k, i) => playSfx("impact", { material, surface, intensity: k, delay: i * 0.45 }));
  const repeat = () => Array.from({ length: 12 }, (_, i) => playSfx("impact", { material, surface, intensity: 0.75, delay: i * 0.28 }));
  const newBlind = () => {
    const pick = () => MATERIALS[Math.floor(Math.random() * MATERIALS.length)];
    let a = pick(), b = pick();
    while (b === a) b = pick();
    setBlind({ a, b, shown: false });
  };
  const form = useMemo(() => LISTENING_FORM, []);
  return (
    <section className="sound-demo material-listening" aria-label="재질 청취 비교">
      <h3 className="sound-demo-sub">재질·보드 표면 청취 비교 (FX-1)</h3>
      <div className="sound-demo-buttons" role="group" aria-label="주사위 재질">
        {MATERIALS.map((m) => (
          <button key={m} type="button" className={m === material ? "primary" : "secondary"} aria-pressed={m === material} onClick={() => setMaterial(m)}>{m}</button>
        ))}
      </div>
      <div className="sound-demo-buttons" role="group" aria-label="보드 표면">
        {SURFACES.map((s) => (
          <button key={s} type="button" className={s === surface ? "primary" : "secondary"} aria-pressed={s === surface} onClick={() => setSurface(s)}>{s}</button>
        ))}
      </div>
      <div className="sound-demo-buttons" role="group" aria-label="재생">
        <button type="button" className="primary" onClick={() => play(() => throwOf(material, surface))}><Volume2 size={16} /> 한 번 던지기</button>
        <button type="button" className="secondary" onClick={() => play(sweep)}>약 → 강 5단계</button>
        <button type="button" className="secondary" onClick={() => play(repeat)}>같은 충돌 12회 (반복 피로)</button>
        <button type="button" className="secondary" onClick={() => play(() => playSfx("clack", { material, intensity: 0.8 }))}>주사위끼리</button>
      </div>
      <div className="sound-demo-buttons" role="group" aria-label="테마 보조음">
        {ACCENTS.map((land) => (
          <button key={land} type="button" className="secondary" onClick={() => play(() => { throwOf(material, surface); playSfx("diceFxRoll", { land, delay: 0.03, intensity: 0.8 }); playSfx("diceFx", { land, delay: 0.9 }); })}>
            물리음 + {land}
          </button>
        ))}
      </div>
      <div className="sound-demo-buttons" role="group" aria-label="블라인드 비교">
        <button type="button" className="secondary" onClick={newBlind}>블라인드 A/B 새로 뽑기</button>
        {blind && <>
          <button type="button" className="secondary" onClick={() => play(() => throwOf(blind.a, surface))}>A 듣기</button>
          <button type="button" className="secondary" onClick={() => play(() => throwOf(blind.b, surface))}>B 듣기</button>
          <button type="button" className="secondary" onClick={() => setBlind({ ...blind, shown: true })}>{blind.shown ? `A=${blind.a}, B=${blind.b}` : "정답 보기"}</button>
        </>}
      </div>
      <label className="setup-note">
        <input type="checkbox" checked={speaker} onChange={(e) => { setSpeakerSimulation(e.target.checked); setSpeaker(e.target.checked); }} /> 휴대폰 스피커 근사(저역 차단·중역 강조, 실험실에서만 · 실제 기기 측정 아님)
      </label>
      <details>
        <summary>평가 기록 양식(복사해서 PR·이슈에 붙이기)</summary>
        <pre className="listening-form">{form}</pre>
      </details>
    </section>
  );
}
