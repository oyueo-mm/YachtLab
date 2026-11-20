# YachtLab AI 연구 기법 전체 목록

> **문서 성격:** 연구 후보 도감. 아래의 높은 우선순위는 성능 예측에 대한 **가설**이며 실험 결과가 아님.
> **기준:** 현재 게임은 12카테고리 닌텐도식 요트다이스. 승리점수율 = 승리 1 + 무승부 0.5.
> **진행 상태:** ✅ 배포/기존 구현, 🔬 작은 문제 또는 연구용 구현, 🧪 실험 기록만 존재, 💡 아직 구현하지 않은 후보.
> **우선순위:** P0 직접 검증이 유망, P1 연구 가치 높음, P2 장기/고비용, P3 먼저 할 필요 낮음. 예측이므로 모든 기법의 성능 개선은 **미확인** 상태로 취급.

## 확률·수학적 계획법 (A)

| 기법 | 핵심 메커니즘과 YachtLab 적용 | 상태 | 우선 |
|---|---|---|---|
| Full-Game Expected-Score DP | 남은 점수 칸 마스크와 상단 누적 점수의 Bellman 가치 계산; 단독 기대점수 최대화 | ✅ DP Expert | 기준 |
| Single-Turn Win DP | 상대 최종 점수/분포에 대해 한 턴 승리점수율 최대화 | ✅ Win DP v1 | 기준 |
| Multi-Turn Win DP | 승률 목적 Bellman 재귀를 남은 3~5개 이상 카테고리로 확장 | ✅ 2개까지 v2, 💡 3+ | **P0** |
| Distributional DP | **고정된 한 정책**이 생성하는 최종점수의 확률질량함수 계산 | ✅ 상대 DP 정책 2개 이하, 💡 확장 | **P0** |
| Target-Score DP | 적정 점수 T를 넘길 확률에 목적함수를 고정; 목표별로 전략 상이 | 🔬 1~2칸 실험 | **P0** |
| Endgame Expectiminimax | 남은 양쪽 턴의 최적 대응과 주사위 확률을 함께 전개 | 💡 | **P0** |
| Best-Response Solver | 고정된 상대 정책을 가장 잘 상대하는 행동 선택 | ✅ v2에서 DP Expert 조건부, 💡 다른 상대 | **P0** |
| Risk-Sensitive Optimization | 승패 점수차에 따라 분산·상방 꼬리·하방 위험을 조절 | 💡 | P1 |
| CVaR Optimization | 최악 구간의 예상 성과를 제한; 앞서고 있을 때의 방어 전략 등 검토 | 💡 | P2 |
| Robust Optimization | 여러 상대 정책/점수 예측 불확실성에서 최악 성능을 방어 | 💡 | P1 |
| Exact Arithmetic / Interval DP | Float64 오차·Bellman 잔차·근접 동률 행동을 검산 | 🧪 독립 소규모 Bellman 검증, 💡 정밀 검증 | P1 |
| Distribution-Conditioned Utility | 상대 점수분포의 누적확률함수 F(S)로 마지막 점수 S의 승리점수율을 계산 | ✅ v1/v2 | 기준 |

## 확률 탐색과 게임 트리 탐색 (B)

| 기법 | 핵심 메커니즘과 YachtLab 적용 | 상태 | 우선 |
|---|---|---|---|
| Turn Expectimax | 현재 턴 내 남은 굴림의 확률 트리 완전 탐색, 근사 말단 효용 | ✅ | 기준 |
| Full-Game Expectimax | 남은 카테고리 순서까지 전개해 정확/근사 미래 승률 탐색 | 💡 | P1 |
| Chance-Aware MCTS | 주사위 결과를 chance node로 분리하는 다라운드 UCT | 💡 | **P0** |
| PUCT / Neural MCTS | 정책 신경망 prior와 가치망으로 탐색을 유도 | 💡 | P1 |
| DP-Guided UCB / MCTS | DP의 미래 기대점수를 탐색 말단값과 행동 후보 prior로 사용 | 🔬 실험 48경기, 열세 | P1 |
| Sparse Sampling | 기하급수적 주사위 분기에서 근사 표본으로 기대값 계산 | 💡 | P1 |
| Progressive Widening | 시뮬레이션이 늘수록 고려할 chance 결과/행동 늘림 | 💡 | P1 |
| Beam Search | 유망한 확률 상태를 제한된 폭으로 확장 | 💡 | P2 |
| Rollout-Based Planning | 현재 상태에서 미래 경기를 수만 번 샘플링하여 승률 추정 | 💡 | P1 |
| Adaptive Search | 승패 경계 및 선택 민감도가 큰 경우에만 더 깊게 계산 | 💡 | **P0** |
| Real-Time Dynamic Programming | 필요한 상태만 Bellman 백업하여 순차 최적화 | 💡 | P2 |
| Stochastic AlphaZero | 주사위 확률 노드를 가진 MCTS+policy/value network를 자기 대국으로 학습 | 💡 | P2 |

## 강화학습 (C)

| 기법 | 핵심 메커니즘과 YachtLab 적용 | 상태 | 우선 |
|---|---|---|---|
| PPO | clipping 기반 actor-critic으로 44개 행동 확률 학습 | ✅ 기존 단독점수 PPO | 기준 |
| A2C / A3C | actor와 critic을 동시 학습, 병렬 환경의 variance 축소 | 💡 | P1 |
| Double DQN | 목표 행동 선택·평가를 분리해 Q 과대평가 완화 | 💡 | P1 |
| Dueling DQN | 상태 가치 V와 행동 advantage A를 별도로 예측 | 💡 | P1 |
| Rainbow DQN | Double/Dueling/Distributional/PER 등의 조합 | 💡 | P1 |
| QR-DQN | 수익의 여러 분위수를 학습해 승리 목적에 대응 | 🔬 초이스 1칸만, 전체 게임 미구현 | P1 |
| C51 | categorical distributional Q network, 이산 수익 분포 | 💡 | P1 |
| IQN / FQF | 분위수 함수/표본의 유연한 학습 | 💡 | P1 |
| Discrete SAC | 이산 행동 공간에서 엔트로피 조절과 critic 학습 | 💡 | P2 |
| Distributional Actor-Critic | 기대값 대신 수익 분포를 critic으로 예측 | 💡 | P1 |
| Model-Based RL | 알려진 주사위 확률과 전이 모델을 활용한 가상 학습 | 💡 | P1 |
| Offline RL | 기존 DP/대국 로그를 활용해 정책을 학습 | 💡 (현재 지식증류 BC는 구현됨) | P1 |
| Hierarchical RL | 카테고리 보존 같은 상위 의도와 주사위 고정 행동 분리 | 💡 | P2 |
| Teacher-Guided RL | DP Expert의 정책/가치로 초기화하고 승률 보상에 적응 | ✅ 기대점수 BC/PPO, 💡 승률 목적 | **P0** |

## 자기 대국·게임 이론 (D)

| 기법 | 핵심 메커니즘과 YachtLab 적용 | 상태 | 우선 |
|---|---|---|---|
| League Self-Play | DP·Win DP·학습 모델 등 상대 다양성으로 범용 정책 학습 | 💡 | **P0** |
| PSRO | 제한된 상대 정책 집합의 meta-game을 구성하고 best response 추가 | 💡 | P1 |
| Fictitious Play | 상대의 과거 평균 정책에 대한 최적 대응을 반복 | 💡 | P1 |
| Population-Based Self-Play | 성향이 다른 여러 정책을 함께 훈련 | 💡 | P1 |
| Best-Response Iteration | 한 상대의 취약점을 찾아 대응 정책을 점진적으로 개선 | 💡 | P1 |
| Exploitability Minimization | 상대가 최적 대응할 때의 취약도를 낮추는 목적 | 💡 | P1 |
| Nash / Minimax Approximation | 여러 상대에 대해 균형에 가까운 전략 계산 | 💡 | P2 |
| CFR / Deep CFR | 후회 최소화로 게임 이론적 평균 정책 학습; 현 규칙에서는 우선순위 낮음 | 💡 | P3 |

## 진화·메타휴리스틱 (E)

| 기법 | 핵심 메커니즘과 YachtLab 적용 | 상태 | 우선 |
|---|---|---|---|
| Genetic Algorithm | 정책/임계값을 대전 승률 피트니스로 진화 | 💡 | P1 |
| CMA-ES | 위험 조절·승률 가치 결합 계수 등 연속 파라미터 탐색 | 💡 | P1 |
| Evolution Strategies | 신경망 가중치를 진화적 경사추정으로 최적화 | 💡 | P2 |
| Genetic Programming | 주사위/점수판 기반 규칙 나무 자동 생성 | 💡 | P2 |
| NEAT | 신경망의 연결과 가중치를 공동 진화 | 💡 | P2 |
| MAP-Elites | 강한 공격/안정/보너스 등 다양한 전략 레퍼토리 확보 | 💡 | P1 |
| Population-Based Training | 훈련 중 정책 가중치/하이퍼파라미터를 경쟁적으로 교환 | 💡 | P1 |
| Bayesian Optimization | 적은 벤치마크 예산으로 하이브리드 조건을 최적화 | 💡 | P1 |
| Simple Threshold Search | 정책 전환 조건을 소규모 격자 탐색 | 🧪 Hybrid 0 후보, 독립 검증 실패 | 기준 |

## 하이브리드·모방·가치 신경망 (F)

| 기법 | 핵심 메커니즘과 YachtLab 적용 | 상태 | 우선 |
|---|---|---|---|
| Residual Policy Learning | DP Expert를 기본으로 두고 승률 개선 가치가 있는 행동만 바꿈 | 💡 | **P0** |
| Expert Iteration | 탐색으로 개선된 정책을 학습 → 다시 탐색하는 반복 | 💡 | **P0** |
| Policy Distillation | DP Expert의 판단을 소형 신경망으로 모방 | ✅ Distilled Policy | 기준 |
| Distilled PPO | BC 모방 이후 PPO 파인튜닝 | ✅ 성능 개선 실패를 포함해 기록 | 기준 |
| Ensemble / Mixture of Experts | 보드 상황에 따라 정확 솔버/탐색/학습 정책을 선택 | 💡 | P1 |
| Opponent Modeling Network | 상대별 미래 점수분포/플레이 전략을 예측 | 💡 | **P0** |
| Competitive Value Network | 상태와 상대 분포에 따른 승리 점수율을 근사 | 💡 | **P0** |
| Learned Search Heuristic | 탐색 상태·행동 후보를 신경망으로 선별 | 💡 | P1 |
| Uncertainty-Aware Policy | 가치 오차·상대 모델 불확실성에 따라 안전한 폴백 | 💡 | P1 |
| Hybrid Ultimate Agent | 정확한 후반부 솔버 + 가치망 + 적응 탐색 + 상대 모형 | 💡 | 장기 목표 |

## 왜 일부는 우선순위가 낮은가

- **MuZero**는 환경 모델 자체를 학습한다. YachtLab은 게임 규칙과 주사위 전이를 이미 정확하게 알기 때문에 모든 것을 재학습하는 비용이 불필요할 수 있다.
- **단순 PPO 재학습**은 기존 PPO/Distilled PPO 성적에서 개선 근거가 약하다. 관측·보상·교사 신호 개선 없이는 반복만 늘리는 것보다 대안이 유망하다.
- **일반 Alpha-Beta**는 확률 노드를 그대로 처리하지 못한다. 사용한다면 Expectiminimax/확률 트리로 바꾸어야 한다.
- **LLM 단독 주사위 에이전트**는 정확한 확률 계산기/가치망보다 효율적일 근거가 부족하다. 연구 기록·설명에는 활용 가능.

## 제안하는 집중 연구 세 축

1. **Exact Competitive Solver:** Multi-Turn Win DP + opponent distribution + 후반부 Expectiminimax.
2. **Learning Competitive Agent:** Teacher-guided residual policy + distributional critic + league self-play.
3. **Hybrid Ultimate Agent:** exact solver + chance-aware MCTS + learned value/opponent + adaptive computation.

세 축을 동등한 예산으로 분리 평가하고, 유의한 성능 향상을 보인 부품만 결합한다. 최종 후보는 **미사용 시드·선후공 교대·여러 강한 상대·평균 점수·근사 신뢰구간·판단 시간**으로 평가한다. 새로운 알고리즘의 세계 SOTA 주장은 하지 않는다.

## 외부 근거

[연구 출처 모음](./REFERENCES.md)과 [실험 증거](./RESULTS.md)를 참고한다. QR-DQN·PSRO·Stochastic MuZero 등의 원 논문은 **YachtLab에서 성능이 높다는 직접 증거가 아니라 방법론 근거**이다.

## 2026-11-20 완료된 실제 알고리즘 비교

[58개 정책 설정과 12개 강화학습 알고리즘 결과](./EXPERIMENT-ZOO-2026-11-20.md)는 실제 실행 완료됨. 축소 문제 **REINFORCE·A2C·DQN·Double DQN** (9,000학습/5,000평가) 및 **Q-learning·SARSA·Expected SARSA·Double Q-learning·First-Visit MC·Dyna-Q·UCB Q-learning·Optimistic Q-learning** (250,000학습/10,000평가) 훈련 및 가중치 보존 완료.

실제 12라운드 58개 전략 탐색은 완료됐지만 **Win DP v2보다 높은 범용 승리점수율이 독립 검증으로 입증되지는 않음**. 위험 조절, 카테고리 편향, UCB 예산 변형은 연구용으로만 남긴다. 12개 강화학습 방법은 모두 **한 카테고리 전용**이며 본 게임 SOTA로 소개하지 않는다.

## 2026-11-20 전체 게임 자기 대국 연구

12라운드 최종 승패를 보상으로 학습하는 **진화 리그 ES + REINFORCE**, opponent-score residual calibration, 마지막 3개 카테고리의 경쟁형 DP v3(상대 3칸 이상은 가우시안 예측 **근사**)를 실제 구현. [실험 설계](./SELFPLAY-RESEARCH.md). 성공한 자동 실험이 생기기 전에는 성능 향상 결과로 표기 금지. 참조 [자동 자기 대국 연구](./_generated/SELFPLAY-LATEST.md).
