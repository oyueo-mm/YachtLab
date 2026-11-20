# YachtLab PSRO·적응형 상대 자기 대국·확률분포·PPO 연구

> 2026-11-20 연구 프로토콜. 실제 12카테고리 닌텐도식 요트다이스 규칙. **본 실험 완료 전에는 성능 우위가 미확인**이다. 기존 Win DP v2, DP Expert 및 웹사이트 기본 AI는 보존한다.

## 왜 이 네 가지를 연결하는가?

기존 선형 및 소형 신경망 자기 대국은 실제 최종 승패로 학습했지만 Win DP v2보다 강해졌다고 확인하지 못했다. 강한 상대가 고정되어 있으면 그 상대에만 과적합할 수 있다. 이번에는 다음 폐회로를 만든다.

1. 전체 정책 모집단의 **실제 대국 승패로 대전 행렬**을 채운다.
2. 반대칭 2인 제로섬 **제한 메타게임(restricted meta-game)** 에서 *fictitious play*로 근사 Nash 혼합 분포를 계산한다.
3. **그 혼합 분포에서 상대를 매 경기 새로 뽑아** full-game 승패 보상 기반 근사 최적 대응 정책을 학습한다.
4. 새 정책을 모집단에 추가하고 대전 행렬과 메타 분포를 **다시 계산**한다.
5. PPO는 이렇게 만든 메타 정책들 및 동적으로 추가된 이전 PPO 체크포인트를 상대로 실제 12라운드의 끝까지 학습한다.
6. 별도로 상대 점수분포의 비정규 구조를 학습하고, 실험 전용 Win DP v3에 넣어 평가한다.

## 1. 실제 PSRO 메타게임 솔버

| 구성 | 구현 |
|---|---|
| Restricted population | DP Expert, Win DP v2, 위험형·보너스형 residual 정책, 새로 훈련된 best-response oracle |
| Meta-game | 모집단 모든 정책 쌍의 **양 좌석 교대** 게임으로 payoff 추정 |
| Meta payoff | 제로섬 `A[i][j] = 2·승리점수율−1`, `A[j][i] = −A[i][j]`, 대각선 0 |
| Meta solver | 2인 제로섬 **fictitious play**, 행·열 경험분포 및 제한게임 duality gap/exploitability 출력 |
| Oracle | 현재 Nash 메타 혼합을 상대로 실제 게임 보상 기반 ES 변이·선발 |
| Iterate | 새 정책 추가 후 missing payoff 평가 → 메타게임 재해결 |
| Validation | Oracle 개발 및 메타행렬 시드와 별도 실험 시드 사용 |

관련 코드: [메타 솔버](../../src/psro-meta.ts) · [리그 학습](../../scripts/research-psro.mjs) · [수학 테스트](../../tests/psro-meta.test.ts).

**범위 제한:** 오라클은 제한된 계산량의 진화적 탐색으로 구한 **근사 best response**다. 따라서 전체 12라운드 전략공간에 대한 정확한 Nash equilibrium이나 수학적 최적 대응이라고 주장하지 않는다. 출력되는 exploitability는 **기존 모집단에 한정된 값**이며, 상대 전략 전체로의 exploitability가 아니다. 모집단의 payoff도 유한 경기의 통계적 추정치다.

## 2. 상대 전략 적응형 자기 대국

- 진화적 PSRO가 매 반복마다 **상대 선택 분포를 재해결**하므로 전 세대와 현재 강한 상대를 고르게 경험한다.
- PPO 학습 중에는 고정된 PSRO restricted meta mix뿐 아니라, 학습 단계마다 추가되는 **이전 PPO 정책 스냅샷**을 포함한다. 스냅샷은 평가 관측 외의 게임 내부 주사위 RNG를 입력하지 않는다.
- 각 게임의 상대 정책을 혼합 분포에서 한 번 샘플링하므로 한 에피소드 동안 정책이 불필요하게 변하지 않는다.
- 상대가 승리 상황에 따라 온라인에서 바로 최적 대응하는 exact alternating minimax는 **아직 구현되지 않았다**. 적응형 모집단을 사용한 학습을 구분해서 기록한다.
- 훈련/후보 선택/최종 확증 시드 불중복, 각 플레이어 주사위 독립 RNG, 모든 좌석 교대.

## 3. 평균·분산이 아닌 상대 최종 점수 확률분포

기존 Win DP v3의 Gaussian 예측보다 더 세밀한 모델은 [실제 정책별 게임에서 추정한 discrete residual PMF](../../scripts/research-opponent-pmf.mjs)다.

- 각 라운드(남은 카테고리 3~12개)에서 **예상 최종점수 = 현재 총점 + 정확한 단독 DP 미래 기대점수**를 계산.
- 경기 종료 후 관측된 *실제 총점 − 예상 총점*을 수집해 **남은 카테고리 수·상대 정책별** 잔차 분포 추정.
- 다중 대역폭 커널 평활화 및 정규분포 prior shrinkage. 대역폭은 **별도 검증 시드**에서 선택한다.
- 마지막 **미사용 확증 시드**에서 Gaussian 기준 대비 **CRPS와 log score**를 계산. 작을수록 좋다.
- 선택한 정책별 이산 PMF를 [Win DP v3](../../src/competitive-v3.ts)의 opponent forecast에 제공하며 실제 대전을 수행한다.

**범위:** 이는 유한 표본으로 학습한 정책·잔여 라운드별 **경험적 이산 점수분포**다. 전체 scorecard mask를 기준으로 한 주사위 완전열거 정확 확률분포는 아니다. 정규분포보다 CRPS가 악화하면 개선을 인정하지 않는다. `Win DP v3`의 내 3턴 Bellman은 조건부 정확하더라도 상대 최종 점수분포는 근사이다.

## 4. 실제 12라운드 clipped PPO

[수학·손실 함수](../../src/ppo-surrogate.ts) · [실전 full-game PPO 학습](../../scripts/train-ppo-psro.mjs)

- DP Expert Q기댓값을 기본값으로 사용하는 행동별 12→12→1 신경망을 쓴다. 마지막 2카테고리는 기존 Win DP v2 판단으로 보존한다.
- **실제 12라운드 최종 승패 1/0.5/0**을 게임 보상으로 사용.
- 자신의 관측 가능한 연속 의사결정들에서 `GAE(λ=0.95, γ=1)`를 계산해 critic 기준 이점(advantage)을 추정한다.
- 행동 시점의 **행동 로그확률을 동결**하고, 동일 배치 데이터를 다중 epochs/minibatches로 재사용하여 `ratio = exp(logπ_new − logπ_old)`, `L^CLIP = min(ratio·A, clip(ratio, 1−ε,1+ε)·A)`를 실제 구현한다.
- 정책 critic(기존 양 점수판 특징의 logistic value baseline)은 terminal-credit 기반 λ-return 목표로 학습한다.
- `PPO` 및 **`PPO + DP teacher-KL`** 두 모델 비교. DP 교사 선호 확률분포를 KL 정규화하는 경우와 없는 경우 분리.
- **학습 전 잔차0(강한 교사) 기준과 함께 별도 선택용 시드에서 경쟁**, 하나만 고정 후 새 시드에서 DP Expert/Win DP v2와 직접 대결한다.
- PPO 정책 샘플링 난수는 게임 주사위 RNG와 분리. 학습 시 입력되는 Game 복제본은 seed/rng를 0으로 제거하고, 모델은 미래 주사위를 읽지 않는다.

**범위:** 신경망은 소형 residual actor다. 표준 PPO의 *clipped surrogate*와 *GAE critic*, 미니배치 반복 갱신을 구현했지만 대형 PPO·AlphaZero·Nash 최적화 같은 주장을 하지 않는다. 마지막 두 카테고리는 학습된 actor가 아니다.

## 5. 실험·재현

- CI: [PSRO·PMF·PPO 통합 GitHub Actions](../../.github/workflows/psro-ppo.yml)
- PR에서 `npm test`와 다음 연구 스크립트 **smoke 실제 게임** 실행; main에서는 별도 대량 학습·확증 실행.
- PSRO는 진화적 Oracle 3회 추가, 각 반복마다 메타게임 행렬 갱신.
- PMF는 정책별 **훈련 350/모델 선택 180/미사용 확증 320게임**. 총점 분포의 CRPS·NLL을 보고.
- PPO는 모델당 **32배치 × 84 = 2,688게임 실제 전체 게임 훈련**. 배치당 행동 old logπ frozen, 3epochs, clip 0.2, Adam 및 KL 기반 조기 종료.
- 최종 PSRO mixture vs DP Expert/Win DP v2, PPO 최종 후보 vs DP Expert/Win DP v2 각각 **선후공 1,200~1,600 seed pairs**, 단계별 별도.
- 원시 정책 가중치·매 경기 점수·모든 확률분포는 GitHub Actions 아티팩트 90일 보존. 성공한 결과의 핵심 수치는 `docs/context/_generated`에 자동 커밋.

### 실제 실행 결과(성공 후 생성)

- [PSRO 결과](./_generated/PSRO-LATEST.md)
- [상대 최종점수 분포](./_generated/PMF-LATEST.md)
- [전체 게임 PPO 결과](./_generated/PPO-LATEST.md)

**비교 원칙:** 학습/검증 단계의 1등 수치를 확증 승률이라고 소개하지 않는다. 95% 구간은 paired-seed normal approximation이며 다중 후보 비교의 모든 불확실성을 보정하지는 못한다. 새 모델의 Win DP v2 직접 대국에서 개선이 입증되지 않으면 기본 AI는 유지한다.

## 참고 논문

- Lanctot et al. (2017), *A Unified Game-Theoretic Approach to Multiagent Reinforcement Learning* (PSRO, empirical meta game, oracle, fictitious play/PRD): https://mlanctot.info/files/papers/nips17-psro.pdf
- Schulman et al. (2017), *Proximal Policy Optimization Algorithms*: https://arxiv.org/abs/1707.06347
- Gneiting & Raftery (2007), proper scoring rules/CRPS: https://doi.org/10.1198/016214506000001437

실제로 성능 개선이 입증되기 전에는 기존 사용자 UI/AI 기본값/배포 모델을 변경하지 않는다.
