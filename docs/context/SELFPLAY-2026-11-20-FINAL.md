# YachtLab 경쟁형 AI·전체 게임 자기 대국 종합 보고서 (2026-11-20)

**최종 결론:** 실제 12라운드 게임에서 진화적 리그 자기 대국, REINFORCE(선형·신경망), Monte-Carlo Actor-Critic, 상대 점수분포 캘리브레이션, Win DP v3를 구현·실험했다. **기존 Win DP v2보다 높은 경쟁 승률을 검증한 새로운 모델은 나오지 않았다.** 연구 코드는 유지하며 사이트 기본 AI는 변경하지 않는다.

## 게임·측정 조건

- 규칙: 닌텐도식 Yacht Dice 12카테고리, 주사위 5개, 턴당 최대 3회, 상단 63점 이상 보너스 +35.
- 승리점수율: 승리 1, 무승부 0.5, 패배 0. 선후공을 바꾼 동일 시드 2개 경기를 짝지어 95% 정규 근사 CI 계산.
- 각 선수의 주사위 난수는 엔진에서 별도로 생성. 학습 정책에는 게임 내부 `seed/rng`를 입력하지 않는다.
- 학습, 후보 선택, 최종 확증은 서로 다른 시드 구간. **최종 확증 결과로 추가 튜닝하지 않았다.**
- 기준선: **DP Expert**는 평균점수 191.760879752165점(이론), **Win DP v2**는 이전 독립 20,000경기에서 DP Expert 상대 **50.630%** (95% CI 50.406~50.854%).
- 새 연구의 기준선과 기존 결과는 서로 다른 실험으로, 타 연구의 수치를 섞어서 직접 유의성을 검정하지 않는다.

## A. 진화적 리그 자기 대국·선형 REINFORCE

코드: [src/selfplay-residual.ts](../../src/selfplay-residual.ts), [train-selfplay.mjs](../../scripts/train-selfplay.mjs).
검증: [실제 전체 게임 학습·독립 평가 Actions](https://github.com/oyueo-mm/YachtLab/actions/runs/44711251372).

- 기존 DP Expert Q값 위에 **12개 공개 상태·행동 feature의 학습 가능한 residual correction**. 마지막 두 칸은 Win DP v2 그대로 사용.
- Evolution Strategies / 리그: **6세대×12정책**, DP Expert·Win DP v2·이전 세대 champion과 실제 경기. 상대 스냅샷은 정책 모집단에 보존. 완전 PSRO/Nash meta-solver는 아님.
- REINFORCE: **10 epoch×96 full 12-round games**, 최종 승패 보상으로 선택 행동의 log probability gradient를 갱신.
- *선택용 새 시드*에서 기준 잔차 0 **52.153%**, 학습 REINFORCE **51.806%**, ES 최종 세대 **51.597%** (DP Expert·Win DP v2 두 상대의 승리점수율 평균; 직접 정책 간 승률 아님). **학습하지 않은 잔차 0 기준 정책이 선택됨.**

| 선택된 기준 정책 상대 | 최종 경기 수 | 승리점수율 | 95% paired CI |
|---|---:|---:|---|
| DP Expert | 3,600 | 50.750% | 50.132~51.368% |
| Win DP v2 | 3,600 | 49.903% | 49.403~50.403% |

**해석:** 잔차 0 정책은 초기~중반 DP Expert Q, 후반 Win DP v2와 사실상 같은 정책이다. 위 결과는 새로운 학습 정책의 우위를 의미하지 않음. 소형 정책의 자기 대국/진화 학습은 실제로 실행·가중치 갱신되었지만 개선을 입증하지 못했다.

## B. 상대 최종 점수분포 예측

코드: [calibrate-opponents.mjs](../../scripts/calibrate-opponents.mjs), [Win DP v3](../../src/competitive-v3.ts).

상대별 **240학습·240평가경기**에서 각 라운드의 미래 최종 점수 오차를 수집, 남은 카테고리 수별 잔차 평균/표준편차를 정규분포로 보정. 평가 단계의 RMSE:

| 상대 정책 | 보정 없음 | 잔차 보정 | 오차 개선 |
|---|---:|---:|---|
| DP Expert | 30.131 | 30.154 | 악화 |
| Win DP v2 | 28.977 | 28.913 | 소폭 개선 |
| Greedy | 28.478 | 24.729 | 개선 |

단위는 최종점수 **RMSE(점)**. 이는 승률이 아니라 **예측 오차**이며 한 게임의 여러 라운드 관측은 서로 상관되어 있음. DP Expert는 원래 기대점수 정책이므로 예측 평균을 보정해도 더 좋아지지 않는 것이 자연스러울 수 있다. 정규분포 가정은 실제 점수 확률분포의 정확한 표현이 아니다.

### Win DP v3: 마지막 3개 카테고리

**내 남은 3턴**을 모든 확률적인 주사위 결과를 고려한 Bellman DP로 계획. 상대에게 0~2칸 남았으면 기존 DP Expert 정책 점수분포를 사용하고, 3칸 이상은 위 정규분포 근사. 상대가 전략을 바꾸는 2인 게임 전체의 정확한 최적해는 아님.

| 대결 | 게임 수 | v3 승리점수율 | 판단 |
|---|---:|---:|---|
| v3 (calibrated) vs Win DP v2 | 72 | 50.000% | 우열 확정 불가 |
| v3 (uncalibrated) vs Win DP v2 | 24 | 50.000% | 우열 확정 불가 |
| v3 (calibrated) vs DP Expert | 48 | 46.875% | 표본 작음, 우위 미입증 |

**판정:** v3는 연구용으로만 보존. 규모가 너무 작아 미세한 성능 차이를 확인할 수 없다. 현 v2보다 강하다고 주장하지 않는다.

## C. 실제 전체 게임 신경망 자기 대국

코드: [src/neural-residual.ts](../../src/neural-residual.ts), [train-neural-selfplay.mjs](../../scripts/train-neural-selfplay.mjs).
검증: [GitHub Actions 전체 게임 학습과 확증](https://github.com/oyueo-mm/YachtLab/actions/runs/44713879146).

- DP Expert의 정확한 Q를 기본값으로 사용하되, 행동별 **12→12→1 tanh MLP residual**을 학습.
- **Neural REINFORCE**와 **Neural Monte-Carlo Advantage Actor-Critic** 두 가지 별도 학습.
- Actor-Critic에서 critic은 양쪽 점수판 기반 **5차원 sigmoid 가치 baseline**으로, 최종 승패 보상을 회귀 학습. 이 방식은 *terminal Monte Carlo advantage*이며 일반적인 bootstrapped A2C나 PPO는 아니다.
- 각 **75 batch×96 = 7,200 전체 게임 에피소드**, 두 모델 합계 **14,400 전체 게임 학습 경기**. 상대는 DP Expert·Win DP v2·이전 신경망 스냅샷.
- 후보 선택 시드에서 기준 0 가중치 정책 vs DP 50.000% / vs v2 50.250%, Neural REINFORCE 50.000%/50.000%, Neural MC Actor-Critic 50.250%/50.500%. 선택된 모델: **Neural Monte-Carlo Actor-Critic**.
- 최종 미사용 시드 경기:

| 후보 | 상대 | 게임 | 승리점수율 | paired 95% CI |
|---|---|---:|---:|---|
| Neural MC Actor-Critic | DP Expert | **3,600** | **51.403%** | **50.742~52.064%** |
| Neural MC Actor-Critic | Win DP v2 | **3,600** | **49.736%** | **49.239~50.233%** |
| Neural REINFORCE | Neural MC Actor-Critic | 600 | 50.000% | 49.537~50.463% |

**해석:** Neural MC Actor-Critic은 DP Expert 상대 이 평가에서 50% 초과 승리 점수율을 보였지만 **Win DP v2를 직접 대결에서 능가하지 못했다**. 과거의 Win DP v2 vs DP Expert 50.630% 수치와 다른 시드를 비교하는 방식으로 신경망 모델이 더 강하다고 주장하지 않는다. **기존 Win DP v2 유지**.

## D. 연구 결과로 배운 것

1. **자기 대국 자체가 승률 향상을 보장하지 않는다.** 상대 집합·모델 표현력·시드 반복·보상 변동성이 중요.
2. DP Expert가 이미 평균점수 최적 기준이므로 강화학습은 기대점수의 지속적인 향상이 아니라 **승리 확률의 작지만 견고한 개선**을 노려야 한다.
3. 12차원 선형 residual과 12→12→1 소형 신경망 모두 가중치를 실제 학습했지만, 그 자체로 Win DP v2보다 강해지지는 않았다.
4. 상대 점수의 평균 보정만으로 전략이 개선된다고 볼 수 없다. **전체 확률분포 및 상대 정책 적응**까지 모델링해야 한다.
5. 3턴 Bellman 솔버를 잘 구현했더라도 상대 점수분포가 근사라면 **게임 이론적 최적**이 아니다.
6. 다수 후보의 스크리닝 승률은 선택 편향을 피하기 어려움. 최종 고정 후보만 미사용 시드로 검증.

## E. 우선 남은 정밀 연구

- P0: **PSRO의 실제 meta-game solver**와 혼합 상대 정책 학습(이번 연구는 PSRO-inspired population training까지만 구현).
- P0: opponent-aware **정확 점수분포 DP를 3개 이상 카테고리**로 확장, 상대 전략 대응과 후반 Expectiminimax 통합.
- P0: **보상 분산 감소**와 교사 KL 제약을 가진 더 큰 residual PPO/actor-critic, 여러 학습 시드 반복.
- P1: chance-aware search + learned competitive value, 정확한 확률 결과 처리 및 같은 ms 예산에서 비교.
- P1: mixture-of-experts / held-out different opponents / adaptive compute, 독립 점수 차이 및 게임 상태 리그.
- P2: 완전 game-tree AlphaZero / Stochastic MuZero / Nash approximation. 실제 성능이 확인되기 전까지 SOTA라는 이름을 부여하지 않는다.

## 재현·원시 자료

- [전체 게임 리그와 3턴 연구 성공 워크플로](https://github.com/oyueo-mm/YachtLab/actions/runs/44711251372): `yachtlab-full-game-selfplay-research`, `yachtlab-three-turn-distributional-study` artifacts.
- [신경망 자기 대국 성공 워크플로](https://github.com/oyueo-mm/YachtLab/actions/runs/44713879146): `full-game-neural-selfplay` artifact.
- [자동 생성 선형 자기 대국 결과](./_generated/SELFPLAY-LATEST.md), [자동 생성 신경망 결과](./_generated/NEURAL-SELFPLAY-LATEST.md).
- 관련 코드·실험: `node scripts/train-selfplay.mjs`, `node scripts/calibrate-opponents.mjs`, `node scripts/bench-v3.mjs`, `node scripts/train-neural-selfplay.mjs`.
- 개별 게임 원시 점수, 전체 학습 가중치와 상세 메타게임은 아티팩트에 저장. 아티팩트는 보존 기간 후 만료될 수 있으므로 본 보고서를 Git 원본으로 보존한다.
- 사이트 기본 AI는 그대로 DP Expert / Win DP v2 등 기존 모델. 연구 후보는 검증 전 사용자 메뉴에 추가하지 않음.

## 방법론 참고

- Jakub Pawlewicz, *Towards Optimal Play in Multi-Player Yahtzee* (2011): https://doi.org/10.3233/ICG-2011-34103
- Lanctot et al., PSRO (2017): https://proceedings.neurips.cc/paper/2017/hash/3323fe11e9595c09af38fe67567a9394-Abstract.html
- PSRO Survey (2024): https://ijcai.org/proceedings/2024/880
- Nicholas A. Pape, Yahtzee self-play RL study (2025): https://arxiv.org/abs/2601.00007

**판정:** 자기 대국 연구의 중요한 첫 출발점을 구현·검증했지만 세계 최강이나 Win DP v2보다 높은 직접 승률을 입증하지 못했다. 다음 채팅에서 이 보고서·현재 main 코드를 함께 읽고 이어서 개발하면 된다.
