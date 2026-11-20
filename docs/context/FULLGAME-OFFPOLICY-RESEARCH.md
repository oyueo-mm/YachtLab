# YachtLab 전체 12라운드 강화학습 알고리즘 확대 비교 — DQN·QR-DQN·ExIt·Dyna-Q·Discrete SAC + PPO 2배

> 2026-11-21 연구 계획과 자동 실행 코드. **미실행 성능은 성과로 작성하지 않는다.** 기준 게임은 닌텐도식 요트다이스 12카테고리(미국 Yahtzee 13카테고리가 아님). 현재 검증된 경쟁형 AI Win DP v2의 기본값은 그대로 유지한다.

## 구현한 전체 게임 강화학습 다섯 계열

| 계열 | 실제 구현 요소 | 충실도 및 별개 미구현 요소 |
|---|---|---|
| **Double Dueling DQN + PER (Rainbow-lite)** | value/advantage 분해 선형 network, Double Q online/target action selection, proportional PER + importance weight, **3-step TD**, 주기적 target copy | **정식 Rainbow 미구현**: C51 categorical distribution, NoisyNet 등 누락. Rainbow 완전체라고 부르지 않는다 |
| **QR-DQN** | 행동별 **16개 고정 분위수**의 return 분포, pairwise quantile Huber regression, Double target action selection, PER, terminal credit 1/.5/0 | IQN(연속 `τ` embedding) **미구현**. 고정된 16개 quantile 회귀가 핵심 |
| **Expert Iteration** | 정책 상태마다 DP 기대점수가 비슷한 2~3개 후보를 골라 **미래 주사위를 새로 샘플링한 실제 전체 게임 rollout**으로 승리 점수율을 평가, top 개선 행동을 정책에 supervised distillation, 여러 반복 | 예산 제한 MC oracle이며 진짜 최적 대응 증명 없음, 초기 DP보다 강하다고 가정하지 않음 |
| **Dyna-Q (정확한 전이 모델)** | YachtLab **기존 엔진으로 추가 가상 next-decision transitions** 생성, real+imagined replay를 Double Dueling Q TD 학습 | 가상 전이는 **새 RNG 시드**로 생성; 미래 주사위 미리 읽지 않음. 변형된 모델을 따로 학습하지 않음 |
| **Discrete SAC (소형 연구 정책)** | off-policy stochastic actor, **two critics**, soft entropy regularized objective, target Q critic copy, replay, terminal 승패 보상 | 선형 근사 actor/critic, 고성능 딥 신경망 SAC가 아님. 모든 옵션을 갖춘 production SAC 주장 금지 |

### 공통 게임 및 관측 원칙

- 게임은 실제 `src/engine.ts`의 12라운드, 주사위 5개, 최대 3회 굴림, upper 63점 이상 보너스 +35, 2명 대전, 완전 종료까지 진행한다.
- 행동 입력은 공개 주사위·남은 카테고리·점수판에서 만든 기존 `src/selfplay-residual.ts`의 12개 특징 + DP expected-score 상대 차이 1개. **숨겨진 PRNG 상태·`seed`는 모델 입력과 replay에서 제외**.
- 사용 가능한 후보는 DP 기대점수 최적에서 **최대 6점 손실**의 합법적인 주사위 고정/점수 선택 행동. 마지막 2개 카테고리는 기존 **Win DP v2를 보존**한다. 따라서 전체 게임으로 학습·평가하지만 **전체 44개 행동을 완전히 자유롭게 배우는 학습은 아니다**.
- 학습 상대: 강한 Win DP v2 50%, DP Expert 25%, 과거 frozen 자신의 정책 최대 25%. 매 대국마다 선택, 같은 에피소드 중 상대 정책은 고정.
- 각 대전 결과는 실제 최종 `winCredit = 승 1 / 동 .5 / 패 0`. 중간 보상은 0이며 자신의 다음 행동까지의 n-step/1-step TD로 학습한다.
- 본실험: Double Dueling, QR-DQN, Dyna, Discrete SAC는 **각 1,500개 전체 게임 훈련**; Expert Iteration은 rollout 비용으로 **350개 실제 게임 + 전게임 MC oracle rollouts**. 초기 모델과 훈련 모델을 각각 별도 validation 시드 200경기/상대 및 untouched confirmation 시드 **1,200경기 vs Win DP v2 + 600경기 vs DP Expert**로 평가. 하나의 시작 시드만 학습하므로 파일럿이다.
- 실제 로그는 [통합 연구 workflow](../../.github/workflows/offpolicy-ppo-expanded.yml)와 [생성된 결과](./_generated/FULLGAME-RL-ZOO-LATEST.md); 훈련별 checkpoint 및 every paired match가 Actions artifact에 저장.

## PPO 추가 학습량 2배

- 이전 3시드 PPO 실험 [근거](./EXTENDED-PSRO-PMF-PPO-RESULTS.md): PPO 일반형과 PPO+DP 교사 KL을 각각 **3시드 × 8,192 full-game**, 합계 **49,152게임**. 일반 PPO 승리점수율 평균 48.22%, KL PPO 50.07%, 유의한 Win DP v2 개선 없음.
- 새 실험은 **두 PPO 변형 × 각 3독립 초기화 × (128배치 × 128경기)** = 총 **98,304건의 전체 게임 PPO 훈련**.
- 이전과 **같은 PSRO 혼합 상대**, 학습 관측, actor/value, PPO clipped surrogate/GAE/critic/teacher-KL, 선후공 교대, 후보 선택용 validation과 별도 untouched confirmation을 사용. **학습량만 2배 늘리는 controlled experiment**로 해석.
- 각 seed마다 일반 PPO, PPO+DP-KL, 학습하지 않은 기준 정책을 **동일 confirmation seed**에 대해 Win DP v2, DP Expert와 모두 대결한다. 새 모델만/가장 좋은 시드만 발표하지 않는다.
- 요약은 기존 `PPO-MULTISEED-LATEST.md`와 다른 [PPO high-budget 결과](./_generated/PPO-HIGH-BUDGET-LATEST.md)에 보존. 원시 seed별 게임 점수와 정책 가중치는 `ppo-high-budget-seed-0/1/2` artifacts.
- GitHub Actions 실행 제한 등으로 중단되면 **중단/미검증으로 표기**, 성능 수치를 만들지 않는다.

## 비교 기준과 한계

1. 5계열 + PPO는 **서로 다른 학습 대상·학습 예산**이므로 단순 승리점수율이 높으면 그 알고리즘이 본질적으로 우월하다고 주장하지 않는다.
2. 성능 주장은 **훈련/검증과 분리된 confirmation 시드, 두 좌석 교대 및 승리 점수율 CI**를 기본으로 한다. 여러 모델의 다중 비교 유의성까지 전부 해결한 것은 아니다.
3. QR-DQN vs IQN, Double Dueling vs Full Rainbow는 구현 수준이 다르므로 불명확하게 합쳐 말하지 않는다.
4. GPU 기반 딥 신경망·수백만 게임 규모의 SOTA 실험이 아니라 **정확한 엔진을 활용한 연구용 소형 모델**이다.
5. 강화학습이 더 강해지지 않아도 코드·원시 실험·모델·실패 사례를 GitHub 맥락 허브에 자동 보존하고, 기존 Win DP v2는 무단 변경하지 않는다.

## 연구 근거

- Rainbow 원 논문: https://arxiv.org/abs/1710.02298
- Quantile Regression DQN: https://arxiv.org/abs/1710.10044
- IQN (미구현 참고): https://arxiv.org/abs/1806.06923
- PPO: https://arxiv.org/abs/1707.06347
- Expert Iteration: https://arxiv.org/abs/1705.08439
- Dyna / Model-Based Planning: Sutton & Barto, Reinforcement Learning (2nd edition), Chapter 8
