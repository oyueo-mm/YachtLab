import { useRef, useState } from "react";
import { Dices, FlaskConical, LoaderCircle } from "lucide-react";
import { type DebugRoll } from "../Dice";
import { DiceArea } from "../DiceArea";
import { loadDiceTable } from "../dice3d-loader";
import type { Die } from "../engine";
import { useThrowGesture } from "../game-feel";
import { useDiceBusy } from "../useDiceBusy";
import { webglAvailable, type DiceRenderer } from "../settings";
import SoundDemo from "./SoundDemo";

const face = () => 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 6);
type Batch = {
  runs: number;
  ok: number;
  match: number;
  settled: number;
  corrected: number;
  inBounds: number;
  p50: number;
  p95: number;
  minDistance: number;
  maxEndStepDeg: number;
  avgSimMs: number;
  width: number;
  height: number;
};

/**
 * Dice lab: try the 3D physics prototype next to the original 2.5D motion with chosen results,
 * and run a headless batch check of the physics on this tray's real size.
 */
export default function DiceLab() {
  const [renderer, setRenderer] = useState<DiceRenderer>(webglAvailable() ? "3d-high" : "2.5d");
  const [targets, setTargets] = useState<(number | "random")[]>(["random", "random", "random", "random", "random"]);
  const [dice, setDice] = useState<Die[]>(() => [1, 2, 3, 4, 5].map((value, id) => ({ id, value, held: false })));
  const [order, setOrder] = useState([0, 1, 2, 3, 4]);
  const [rollEvent, setRollEvent] = useState(0);
  const [last, setLast] = useState<DebugRoll | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [running, setRunning] = useState(false);
  const busy = useDiceBusy();
  const trayRef = useRef<HTMLElement>(null);
  const roll = () => {
    if (busy) return;
    setDice((list) => list.map((d, i) => (d.held ? d : { ...d, value: targets[i] === "random" ? face() : (targets[i] as number) })));
    setRollEvent((n) => n + 1);
    const started = performance.now();
    const poll = window.setInterval(() => {
      const info = (window as unknown as { __yachtlabDice?: { last: DebugRoll } }).__yachtlabDice?.last;
      if (info && (info.endedAt ?? 0) > started) {
        setLast(info);
        window.clearInterval(poll);
      }
    }, 100);
    window.setTimeout(() => window.clearInterval(poll), 6000);
  };
  const gesture = useThrowGesture(!busy, roll);
  const runBatch = async () => {
    const tray = trayRef.current;
    if (!tray) return;
    setRunning(true);
    const mod = await loadDiceTable();
    if (!mod) {
      setRunning(false);
      return;
    }
    // Use the real 3D table geometry when it is shown; otherwise a typical desktop tray.
    const table = tray.querySelector<HTMLElement>(".physical-dice");
    const hit = tray.querySelector<HTMLElement>(".die-hit");
    const size = hit?.getBoundingClientRect().width || 90;
    const W = table ? table.clientWidth / size : 9.5,
      H = table ? table.clientHeight / size - 1.6 : 5.2;
    const frames: number[] = [];
    const stats: Batch = { runs: 0, ok: 0, match: 0, settled: 0, corrected: 0, inBounds: 0, p50: 0, p95: 0, minDistance: Infinity, maxEndStepDeg: 0, avgSimMs: 0, width: W, height: H };
    let ms = 0;
    for (let run = 0; run < 300; run++) {
      const held = run % 4 === 3 ? new Set([run % 5, (run + 2) % 5]) : new Set<number>();
      const input = {
        width: W,
        height: H,
        direction: (run % 2 ? 1 : -1) as 1 | -1,
        seed: (run * 2654435761) >>> 0,
        landing: "free" as const,
        // Held dice sit on the shelf outside the tray: only free dice are thrown.
        dice: [0, 1, 2, 3, 4].filter((id) => !held.has(id)).map((id) => ({ id, value: 1 + ((run + id * 5) % 6), held: false, x: W / 2, z: H / 2 })),
        starts: run % 2 ? Object.fromEntries([0, 1, 2, 3, 4].map((id) => [id, { x: 1 + ((id * 1.7) % (W - 2)), z: 1 + ((id * 1.3) % (H - 2)) }])) : undefined,
      };
      const result = mod.simulateThrow(input);
      stats.runs++;
      if (result.ok) stats.ok++;
      if (result.tracks.every((t) => mod.finalValue(t, result.frameCount) === t.value)) stats.match++;
      if (result.stats.settled) stats.settled++;
      if (result.stats.inBounds) stats.inBounds++;
      stats.corrected += result.corrected;
      stats.minDistance = Math.min(stats.minDistance, result.stats.minDistance);
      stats.maxEndStepDeg = Math.max(stats.maxEndStepDeg, result.stats.maxEndStepDeg);
      frames.push(result.frameCount);
      ms += result.stats.simMs;
      if (run % 25 === 24) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
    frames.sort((a, b) => a - b);
    stats.p50 = frames[Math.floor(frames.length / 2)];
    stats.p95 = frames[Math.floor(frames.length * 0.95)];
    stats.avgSimMs = ms / stats.runs;
    setBatch(stats);
    setRunning(false);
  };
  const ms = (f: number) => Math.round((f / 60 / 1.15) * 1000);
  return (
    <section className="dice-lab" aria-labelledby="dice-lab-title">
      <div className="lab-hub-heading">
        <h1 id="dice-lab-title">주사위 실험실</h1>
        <p>3D 물리 주사위 프로토타입과 기존 2.5D 연출을 같은 결과로 비교해요. 결과 눈은 항상 아래에서 정한 값(또는 무작위)이며, 연출은 결과를 바꾸지 않아요.</p>
      </div>
      <div className="dice-lab-grid">
        <section ref={trayRef} className="game-board throw-tray" aria-label="실험 트레이" {...gesture}>
          <DiceArea
            state={{ dice, order, rolls: 1 }}
            interactive={!busy}
            animate
            rollEvent={rollEvent}
            forceRenderer={renderer}
            onToggle={(id) => setDice((list) => list.map((d) => (d.id === id ? { ...d, held: !d.held } : d)))}
            onOrder={setOrder}
          />
          <div className="roll-area">
            <button type="button" className="primary roll-button" onClick={roll} disabled={busy || dice.every((d) => d.held)}>
              <Dices size={20} /> 굴리기
            </button>
          </div>
        </section>
        <aside className="dice-lab-panel">
          <h2>연출 방식</h2>
          <select aria-label="연출 방식" value={renderer} onChange={(e) => setRenderer(e.target.value as DiceRenderer)}>
            <option value="3d-high" disabled={!webglAvailable()}>
              3D 자유 착지 · 고급 (그림자)
            </option>
            <option value="3d" disabled={!webglAvailable()}>
              3D 자유 착지 · 가볍게
            </option>
            <option value="2.5d">2.5D (기존 CSS 연출)</option>
            <option value="none">모션 없음</option>
          </select>
          <h2>결과 눈 지정</h2>
          <div className="dice-lab-targets">
            {targets.map((t, i) => (
              <select
                key={i}
                aria-label={`주사위 ${i + 1} 결과`}
                value={t}
                onChange={(e) => setTargets((list) => list.map((v, k) => (k === i ? (e.target.value === "random" ? "random" : Number(e.target.value)) : v)))}
              >
                <option value="random">?</option>
                {[1, 2, 3, 4, 5, 6].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <h2>마지막 굴림</h2>
          {last ? (
            <dl className="dice-lab-stats" data-testid="dice-lab-last">
              <dt>방식</dt>
              <dd>{last.mode}</dd>
              <dt>목표 눈</dt>
              <dd>{Object.values(last.targets).join(" ")}</dd>
              {last.finals && (
                <>
                  <dt>3D 최종 눈</dt>
                  <dd>{Object.values(last.finals).join(" ")}</dd>
                  <dt>일치</dt>
                  <dd>{Object.keys(last.targets).every((id) => last.finals![Number(id)] === last.targets[Number(id)]) ? "예" : "아니요"}</dd>
                  <dt>길이</dt>
                  <dd>{ms(last.frames ?? 0)}ms</dd>
                  <dt>시뮬레이션 시도</dt>
                  <dd>{last.attempts}</dd>
                </>
              )}
              {last.frameMs && (
                <>
                  <dt>프레임 시간 평균 / p95</dt>
                  <dd>
                    {last.frameMs.avg.toFixed(1)} / {last.frameMs.p95.toFixed(1)}ms
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="setup-note">굴리면 결과가 표시돼요.</p>
          )}
          <SoundDemo />
          <h2>물리 일괄 검증</h2>
          <button type="button" className="secondary" onClick={runBatch} disabled={running}>
            {running ? <LoaderCircle size={16} className="spin" /> : <FlaskConical size={16} />} 이 트레이 크기로 300회 검증
          </button>
          {batch && (
            <dl className="dice-lab-stats" data-testid="dice-lab-batch">
              <dt>트레이 (주사위 단위)</dt>
              <dd>
                {batch.width.toFixed(1)} × {batch.height.toFixed(1)}
              </dd>
              <dt>최종 눈 일치</dt>
              <dd>
                {batch.match}/{batch.runs}
              </dd>
              <dt>깨끗한 착지 (3D 사용)</dt>
              <dd>
                {batch.ok}/{batch.runs}
              </dd>
              <dt>시간 내 정지</dt>
              <dd>
                {batch.settled}/{batch.runs}
              </dd>
              <dt>트레이 안</dt>
              <dd>
                {batch.inBounds}/{batch.runs}
              </dd>
              <dt>모서리 보정</dt>
              <dd>{batch.corrected}개</dd>
              <dt>길이 중앙값 / p95</dt>
              <dd>
                {ms(batch.p50)} / {ms(batch.p95)}ms
              </dd>
              <dt>최소 중심 거리</dt>
              <dd>{batch.minDistance.toFixed(3)}</dd>
              <dt>끝부분 최대 회전/프레임</dt>
              <dd>{batch.maxEndStepDeg.toFixed(1)}°</dd>
              <dt>시뮬레이션 평균</dt>
              <dd>{batch.avgSimMs.toFixed(1)}ms</dd>
            </dl>
          )}
        </aside>
      </div>
    </section>
  );
}
