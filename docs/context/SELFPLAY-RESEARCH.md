# YachtLab 전체 게임 자기 대국 · 경쟁형 AI v3 연구

> 2026-11-20, 연구 실행 코드·실험 설계. **실행 이전에는 성능이 확인되지 않았다.** 점수 게임 규칙은 12개 카테고리 닌텐도식 Yacht Dice이며 미국식 13칸 Yahtzee와 혼동하지 않는다.

## 왜 자기 대국을 우선하는가?

DP Expert는 혼자 받을 수 있는 기대 총점을 이미 매우 잘 최적화하지만, 이것은 상대를 이길 확률과 다른 목적이다. 이전에 Win DP v2는 DP Expert 상대 20,000경기에서 50.630%의 작은 우위를 보였고, 58개 위험 조절·전환 조건의 대량 탐색만으로는 우위를 확증하지 못했다.

따라서 **상대가 스스로 강해지며 전략을 바꾸는 상황을 학습**하는 것이 가치 있는 다음 질문이다. 단, 동일 모델 두 개를 대전시키는 것만으로 학습했다고 부르지 않는다. 실제 승리·무승부·패배 보상을 이용해 **정책 파라미터를 갱신**해야 한다.

## 구현 1 — 실제 12라운드 진화적 리그 자기 대국

- 연구 정책: [src/selfplay-residual.ts](../../src/selfplay-residual.ts), 학습: [scripts/train-selfplay.mjs](../../scripts/train-selfplay.mjs).
- DP Expert의 44개 행동별 기대 최종점수 Q를 **기본값**으로 쓰고, 공개 주사위 및 양 점수판에서 계산한 행동별 12차원 feature로 학습한 작은 보정값을 적용한다.
- 미래 주사위나 엔진 난수 상태를 관찰하지 않는다. 기본 위/아래 카테고리·보너스·점수차·재굴림 위험은 실제 소스에서 읽은 값.
- 마지막 **두 개 카테고리에서는 Win DP v2를 보존**, 그보다 이전 카테고리 단계에서 점수와 위험 성향을 학습한다.
- 후보 정책 가중치를 변이(gaussian mutation)시키고, **DP Expert / Win DP v2 / 전세대 정책**으로 구성한 리그에서 실제 전체 게임을 플레이한다.
- 여러 세대의 우승 정책을 보존한다. 이는 **PSRO와 유사한 경험적 모집단/최적 대응 탐색**이지, Nash meta-solver를 가진 완전한 PSRO 구현은 아니다.
- 이 단계는 실제 자기 대국 보상으로 정책 변화를 학습하는 **Evolution Strategies / population-based policy search**다.

## 구현 2 — 실제 12라운드 REINFORCE 자기 대국

- 같은 12차원 residual policy를 **확률 정책(softmax)**으로 구현한다.
- 실제 전체 게임의 최종 승리=1, 무승부=.5, 패배=0을 승리 보상으로 쓴다.
- 행동 확률의 `∇log π(a|s)`를 사용해 각 에피소드의 gradient를 합산하고, 보상 -0.5를 곱해 파라미터를 갱신하는 **REINFORCE** 학습을 수행한다.
- 학습 중 DP Expert·Win DP v2·과거 강한 정책·초기 정책을 상대로 섞어서 경기한다.
- 데이터 누출 방지: 모델의 의사결정 함수는 state.seed/state.rng에 접근하지 않으며, 훈련 중 정책 샘플링 RNG도 별도 스트림으로 유지한다.
- 이 실험은 딥 RL(PPO/QR-DQN) 신경망을 전체 게임으로 바로 확장한 것이 아니라 **낮은 차원의 정책 경사 기반 RL**이다. 실제 평가 결과와 비교 후 더 큰 신경망으로 확장할 이유를 판단한다.

## 구현 3 — 상대의 최종 점수분포 예측

- [scripts/calibrate-opponents.mjs](../../scripts/calibrate-opponents.mjs)
- DP Expert, Win DP v2, Greedy의 **실제 게임에서** 각 라운드마다 남은 예상 총점(현재 점수 + DP Expert 미래 기대점수)을 기록한다.
- 경기 종료 후 실제 점수와 예측의 오차를 훈련 시드에서 수집하여 라운드별 **잔차 평균·표준편차**를 추정한다.
- 별도 평가 시드에서 RMSE 및 정규분포 기반 negative log-likelihood를 측정한다.
- 이는 **상대가 DP Expert일 때만 정확한 확률분포**라는 기존 Win DP v2의 한계를 연구하기 위한 데이터 기반 근사다.
- 데이터에서 추정한 정규분포가 실제 점수분포와 같다고 주장하지 않는다. 반례는 본 실험의 중요한 결과다.

## 구현 4 — 3개 카테고리 경쟁형 Bellman / Win DP v3

- [src/competitive-v3.ts](../../src/competitive-v3.ts), [scripts/bench-v3.mjs](../../scripts/bench-v3.mjs).
- **내 마지막 3개 카테고리에 대한 행동**과 모든 주사위 재굴림 확률을 역방향 동적 계획법으로 계산한다.
- 상대의 남은 0~2카테고리에 대해서는 기존 **DP Expert 정책의 정확한 최종 점수분포**를 사용한다.
- 상대가 3개 이상 남았으면, 위에서 훈련된 라운드별 잔차 정규분포 **근사 모델**을 사용한다.
- **중요:** 내 3개 턴 Bellman 계산은 주어진 최종 점수 예측을 고정했다는 조건에서만 정확하다. 대전 상대가 대응 전략을 바꾸는 진짜 2인 게임의 완전 최적해가 아니다.
- 기존 DP Expert/Win DP v1/Win DP v2와 달리 v3는 연구용 코드이며 **승률 우위 검증 없이 기본 AI나 사용자 메뉴에 배포하지 않는다.**

## 구현 5 — 독립 평가와 배포 게이트

GitHub Actions [full-selfplay.yml](../../.github/workflows/full-selfplay.yml)에서:

1. PR 검증에서는 모든 연구 스크립트의 문법과 실제 엔진 기반 소량 자기 대국·상대 예측·v3 Bellman 실행을 확인한다.
2. main 반영 후 학습용 시드에서 진화 정책/REINFORCE를 훈련한다.
3. **학습에 사용하지 않은 별도 검증 시드**로 후보 1개를 선택하고, 해당 가중치를 고정한다.
4. 이후 **완전히 새로운 확증 시드**에서 DP Expert와 Win DP v2를 대상으로 선후공 교대 직접 대결, paired-seed 95% 근사 신뢰구간을 계산한다.
5. **상대 모델의 별도 평가 시드**와 v3 소규모 대전은 개별 실행 결과로 보존한다.
6. 가중치, 모든 원시 경기 결과, 리그 역사, 상대 예측 파라미터를 GitHub Actions 아티팩트에 저장한다.
7. 사용자 대상 기본 AI 정책은 **독립 검증에서 우위가 입증되기 전에는 교체하지 않는다.**

## 통계적 한계와 주의

- 사용자에게 홍보하는 **전체 게임** 자기 대국 연구와 Choice-only 축소 RL 실험을 섞지 않는다.
- 정책/하이퍼파라미터 탐색은 다중 비교 선택 편향을 만든다. 검증/확증 시드 구간을 분리해 결과를 기록한다.
- 같은 시드에서 좌석을 바꾼 2게임을 한 묶음으로 취급한다. 내부 주사위 시드 스트림은 선수별로 독립이며 동일 주사위 배열을 강제로 나눠 쓰는 방식이 아니다.
- 신뢰구간은 paired normal approximation. 모든 상대에 대한 세계 SOTA·Nash equilibrium 주장을 하지 않는다.
- 상대 예측은 경험적 가우시안 근사일 뿐이며, 3개 남은 상태에서도 상대를 모델링한 확률은 **정확한 점수분포가 아니다**.
- 학습 진행 중 검증 시드를 튜닝에 사용하거나, 확증 결과가 좋지 않은데 기본 모델을 교체하는 일을 금지한다.
- GitHub Actions 제한(실행 시간·메모리)으로 실험이 실패하면 실패 로그를 보존하고 성능값을 만들어내지 않는다.

## 학술적 근거

- Jakub Pawlewicz, *Towards Optimal Play in Multi-Player Yahtzee* (2011): https://doi.org/10.3233/ICG-2011-34103
- Lanctot et al., *A Unified Game-Theoretic Approach to Multiagent Reinforcement Learning* (2017) PSRO: https://proceedings.neurips.cc/paper/2017/hash/3323fe11e9595c09af38fe67567a9394-Abstract.html
- PSRO survey (2024): https://ijcai.org/proceedings/2024/880
- Nicholas A. Pape, Yahtzee self-play PG comparison: https://arxiv.org/abs/2601.00007

연구용 스크립트는 `node scripts/train-selfplay.mjs --smoke`, `node scripts/calibrate-opponents.mjs --smoke`, `node scripts/bench-v3.mjs --smoke`로 개별 최소 재현 가능. 실제 본 실험은 각 `--smoke`를 제거한다.

**연구 요약 자동 문서:** [SELFPLAY-LATEST.md](./_generated/SELFPLAY-LATEST.md) (성공한 본 실험 이후 생성). 완료 전에는 성능 향상 여부를 주장하지 않는다.

## 후속 실제 12라운드 신경망 자기 대국

- 연구 모듈: [src/neural-residual.ts](../../src/neural-residual.ts), [학습 하네스](../../scripts/train-neural-selfplay.mjs), [GitHub Actions](../../.github/workflows/neural-selfplay.yml).
- **REINFORCE 신경망**과 **Monte-Carlo advantage actor-critic** 두 모델을 실제 12라운드 승패 보상으로 학습. Actor는 DP의 행동별 Q를 기본값으로 사용하는 행동별 **12→12→1 비선형 MLP**, critic은 양쪽 공개 점수판에서 만든 5차원 값 예측 회귀 baseline이다.
- 네트워크 샘플링 및 정책 업데이트에 숨겨진 게임 시드·미래 주사위 값을 사용하지 않음.
- 각 모델 **75배치 × 96 전체 게임 에피소드**, 이전 신경망 스냅샷·DP Expert·Win DP v2와 혼합 상대 리그에서 훈련. 검증/확증 시드 분리, 원시 경기·정책 가중치 보존.
- 이 critic은 최종 게임 outcome을 대상으로 하는 **Monte-Carlo baseline**이다. TD 부트스트랩 A2C나 PPO와 동일하다고 주장하지 않는다.
- 확증 결과가 나오기 전에는 기존 Win DP v2/기본 모델에 영향 없음. [최신 신경망 결과](./_generated/NEURAL-SELFPLAY-LATEST.md)는 연구 워크플로 성공 후 생성된다.
