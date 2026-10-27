import { readFile, writeFile } from "node:fs/promises";
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
const s = await read("benchmarks/v04/summary.json"),
  r = await read("training/distillation-results.json"),
  audit = await read("training/distillation-audit.json"),
  example = await read("benchmarks/v04/strategy-example.json"),
  browser = await read("benchmarks/v04/browser-inference.json");
if (!s.complete) throw Error("Final evaluation incomplete");
const f = (x) => x.toFixed(3),
  ci = (x) => x.map(f).join(" ~ ");
const lines = [
  `# YachtLab v0.4 실제 증류·평가 보고서

DP 정책을 학습한 **Distilled Policy**는 미사용 시드 1,000경기 평균 ${f(s.algorithms.find((x) => x.algorithm === "Distilled Policy").mean)}점이다. 기존 PPO를 개선했지만 DP Expert를 넘지 못했다. PPO 미세조정 이후에는 평균 점수가 낮아졌다. 세 모델을 각각 보존하고 DP Expert를 기본 상대와 최고 성능 기준 모델로 유지한다. 학습·평가 수치는 실제 실행 결과이며 최종 평가를 보고 가중치나 하이퍼파라미터를 다시 맞추지 않았다.

## 데이터와 재현

- DP·Greedy·Random·혼합 정책으로 실제 엔진에서 생성한 학습 3,600대국 **${s.trainingStates.toLocaleString()}개 상태 기록**, 검증 400대국 **${s.validationStates.toLocaleString()}개 상태 기록**. 각 대국은 2인 12라운드이며 두 플레이어의 상태를 수집했다. 동일 시드의 두 플레이어에서 동일 상태가 반복될 수 있으므로 이 수치는 고유 상태 수가 아니다.
- 초·중·후반, 남은 굴림 0·1·2, 다양한 남은 칸, 보너스 직전 상태를 포함한다. 학습의 상단 50~62점 상태는 14,450개, 동가 최적 행동이 여러 개인 상태는 28,530개다. 임의로 불가능한 점수판을 만들지 않았다.
- 학습 시드: Murmur3 finalizer(400000+i); 상태 검증: 500000+i; 체크포인트 선택용 160경기: 600000+i; 최종 평가: 700000+i. v0.3의 200000+i 평가를 재사용하지 않았다. 실제 시드 집합의 교집합이 0인지 확인했다.
- 상태 관측은 기존 60차원을 유지하되, 주사위를 **눈·고유 ID 순서로 정규화**하는 canonical-sorted-v2다. 화면의 드래그 순서는 관측에 들어가지 않는다. 행동 0~31은 정규화한 주사위의 고정 마스크, 32~43은 기존 카테고리다. 추론 후 고정 마스크를 실제 고유 ID로 다시 매핑한다.
- 각 상태의 44개 Q_DP 값을 저장했다. 불법 행동은 −Infinity다. 최대 Q에서 1e-4 이내인 모든 행동을 정답 집합으로 사용해 같은 눈의 대칭 ID를 오답으로 강제하지 않는다. 데이터 해시와 분포는 [데이터 메타데이터](../../training/distillation-data.json), [감사 결과](../../training/distillation-audit.json)에 있다.
- 로컬 대용량 float32 데이터와 PyTorch 체크포인트는 Git에서 제외했다. 기존 PPO JSON과 DP 테이블을 수정하지 않았다.

## 실제 학습

PyTorch ${r.environment.pytorch}, CPU 2스레드, seed 404. tanh MLP 64×64와 128×128을 각각 최대 35 epoch 학습했다. Adam 1e-3, batch 1024, gradient clip 1, 검증 regret 기반 patience 6을 적용하며 두 실험은 최대 epoch까지 실행됐다. 손실은 동등 최적 행동 집합의 로그 확률 질량 손실 + 0.1×soft-target cross entropy(temperature 1.5)다. 검증 DP 손실이 가장 작은 체크포인트를 선택했다.

| 구조 | 선택 epoch | 동등 최적 행동 일치율 | Top-3 | 평균 DP 손실 | 선택용 160경기 평균 |
|---|---:|---:|---:|---:|---:|`,
];
for (const a of r.architectures)
  lines.push(
    `| ${a.width}×${a.width} | ${a.bestEpoch} | ${(100 * a.validation.top1Equivalent).toFixed(2)}% | ${(100 * a.validation.top3Equivalent).toFixed(2)}% | ${f(a.validation.meanDPRegret)} | ${f(a.validationGames.mean)} |`,
  );
lines.push(`
선택 모델은 128×128, actor 파라미터 ${audit.fixedCheckpoints["Distilled Policy"].actorParameters.toLocaleString()}개, 체크포인트 ${s.gradientUpdates.toLocaleString()}회 gradient update다. 동가를 무시하고 가장 낮은 인덱스의 argmax 하나만 정답으로 두면 일치율은 ${(100 * audit.fixedCheckpoints["Distilled Policy"].canonicalLowestIndexArgmaxAgreement).toFixed(2)}%다. 대칭·동가 행동을 인정한 지표와 구분한다.

PPO 추가 학습은 실제 점수·상단 보너스 증가량/100을 보상으로 **${s.ppoSteps.toLocaleString()} 환경 스텝**을 실행했다. 64환경×horizon64, gamma1, GAE lambda0.95, clip0.2, 4epoch, minibatch256, value coefficient0.5, entropy0.003, gradient clip0.5, lr1e-4, teacher 보존 손실 계수0.05를 사용했다. 체크포인트는 최종 테스트가 아닌 별도 160경기 검증으로 선택했으며 선택 시점은 **${s.ppoCheckpointSteps.toLocaleString()}스텝**이다.

동일 예산 262,144스텝의 무작위 초기화 PPO도 실행했다. 해당 모델의 검증 평균은 ${f(r.randomInitControl.games.mean)}점이다. scratch lr3e-4와 teacher 보존 손실 없음 등 설정이 다르므로 초기화 효과만 분리한 인과 실험으로 해석하지 않는다. 대조군은 배포 모델로 등록하지 않았다.

모방학습 검증 평균 ${f(r.before.games.mean)} → 선택한 PPO 체크포인트 ${f(r.after.games.mean)}점; 평균 DP regret ${f(r.before.meanDPRegret)} → ${f(r.after.meanDPRegret)}점이다. 추가 학습의 악화도 로그에 그대로 보존했다. 마지막 PPO 업데이트의 검증 평균은 ${f((await read("training/distilled-ppo-log.json")).at(-1).validationMean)}점이다.

![실제 학습·검증 곡선](learning-curves.png)

[64 로그](../../training/bc-64-log.json), [128 로그](../../training/bc-128-log.json), [PPO 로그](../../training/distilled-ppo-log.json), [무작위 초기화 로그](../../training/random-init-ppo-log.json), [설정·체크포인트·해시](../../training/distillation-results.json).

## 독립 최종 평가

각 정책 1,000경기, 동일한 1,000개 미사용 시드, 선후공 교대. 평균의 95% 구간은 mean ± 1.96×표준오차다. 정책 가중치를 고정한 후 한 번 평가했다. 최종 평가 후 튜닝은 하지 않았다.

| 정책 | 평균 | 95% CI | 중앙값 | 최저~최고 | 보너스 | 요트 | 판단 평균 ms |
|---|---:|---:|---:|---:|---:|---:|---:|`);
for (const a of s.algorithms)
  lines.push(
    `| ${a.algorithm} | ${f(a.mean)} | ${ci(a.ci95)} | ${a.median} | ${a.min}~${a.max} | ${(100 * a.bonusRate).toFixed(1)}% | ${(100 * a.yachtRate).toFixed(1)}% | ${a.decisionMs.toFixed(4)} |`,
  );
lines.push(`
판단 시간은 로컬 Node의 순수 decide 연산 평균이다. DP는 이미 계산한 작은 가치 테이블과 최적화된 현재 턴 계산을 사용하므로 이번 측정에서 학생보다 빨랐다. 학생 모델은 테이블 전송 크기를 줄였으며 추론 속도 우위를 주장하지 않는다.

| 모델 | 원본 bytes | gzip bytes |
|---|---:|---:|`);
for (const a of s.algorithms.filter((a) => a.model))
  lines.push(
    `| ${a.algorithm} | ${a.model.bytes.toLocaleString()} | ${a.model.gzipBytes.toLocaleString()} |`,
  );
lines.push(`
모델 JSON과 DP 테이블 자체의 크기다. 공통 Worker 코드·HTML·CSS는 제외했다. 새 모델은 선택할 때만 별도 정적 JSON 청크로 로드하며 홈 시연은 모델이나 DP 테이블을 요청하지 않는다. PyTorch/TypeScript 확률 일치, 합법 마스크, 표시 순서 독립성, 모델 SHA-256을 테스트했다.

### 짝 비교와 승률

단독 점수는 자기 RNG만 사용하므로 같은 시드의 점수 쌍으로 맞대결 결과를 재구성했다. 실제 맞대결 300건(학생 vs DP·Distilled PPO·기존 PPO 각 100건, 좌석 교대)에서 점수 쌍이 모두 일치했다. 승률은 무승부 0.5승을 포함한다. DP 손실 자체가 승률 손실을 뜻하는 것은 아니다.

| A | B | A−B 평균 | 차이 95% CI | A 승률(무승부 0.5) |
|---|---|---:|---:|---:|`);
for (const p of s.pairs)
  lines.push(
    `| ${p.a} | ${p.b} | ${f(p.meanDifference)} | ${ci(p.ci95)} | ${(100 * p.winCredit).toFixed(2)}% |`,
  );
lines.push(`
### 실제 브라우저 측정

로컬 Chromium, 같은 실제 기보 상태, 준비된 Worker에서 100회 판단 왕복. 메시지 복사·통신 비용을 포함하며 최초 요청은 Worker 시작과 모델 준비를 포함한다. HTTP 캐시는 일부 따뜻할 수 있다. 공개 네트워크나 실제 모바일 하드웨어의 보장 수치가 아니다.

| 정책 | 최초 요청 ms | 준비 후 평균 ms | P95 ms |
|---|---:|---:|---:|`);
for (const b of browser.rows)
  lines.push(
    `| ${b.algorithm} | ${b.firstMs.toFixed(2)} | ${b.meanRoundTripMs.toFixed(3)} | ${b.p95RoundTripMs.toFixed(3)} |`,
  );
lines.push(`
## 실제 전략 차이 사례

[Greedy vs Greedy, seed42, ${example.frameIndex}번째 행동](strategy-example.json)의 실제 기록 직전 상태다. 현재 총점을 포함한 기대 최종점수는 DP/두 학생의 듀스 기록 **215.357점**, Greedy/Expectimax/기존 PPO의 펜타 기록 **209.588점**으로 **5.769점** 차이다. 즉시 얻는 점수만으로는 남은 칸의 기회비용을 설명할 수 없다. 이 차이는 그 행동 이후 DP 최적 정책을 따른다는 가정이며 실제 해당 AI의 종료 점수 예측이나 상대 승률이 아니다. 원본 상태와 각 정책의 실제 추천·자체 근거를 JSON에 보존했다.

## 재현 명령

\`\`\`sh
python -m pip install -r training/requirements.txt
node scripts/distill-data.mjs 3600 400
python training/distill.py
python training/audit_distillation.py
python training/plot_distillation.py
node scripts/evaluate-v04.mjs "DP Expert" 1000
node scripts/evaluate-v04.mjs "Distilled Policy" 1000
node scripts/evaluate-v04.mjs "Distilled PPO" 1000
node scripts/evaluate-v04.mjs Expectimax 1000
node scripts/evaluate-v04.mjs Greedy 1000
node scripts/evaluate-v04.mjs PPO 1000
node scripts/finalize-distillation.mjs
node scripts/check-v04-pairs.mjs
node scripts/strategy-example.mjs
node scripts/summarize-v04.mjs
node scripts/report-v04.mjs
\`\`\`

브라우저 측정은 프로덕션 빌드와 preview를 실행한 뒤 node scripts/browser-distilled.mjs로 재현한다. 재학습은 로컬 실험의 재현용이며 이번 최종 평가 세트를 다시 미사용이라고 부를 수는 없다. 각 데이터·모델의 해시와 실측 로그로 이번 실험을 고정했다.
`);
await writeFile("benchmarks/v04/REPORT.md", lines.join("\n") + "\n");
