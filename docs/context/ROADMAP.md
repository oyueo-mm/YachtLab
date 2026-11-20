# 연구 로드맵 / 백로그 (실행 가능성 기준)

2026-11-20 연구 계획. **P0/P1은 우선순위 가설이며 성능을 보장하지 않음.** 사용자는 대규모 연구 작업을 단계별로 여러 번 의뢰하기보다 한 작업에서 여러 후보를 구현·실험·비교하는 구성을 선호한다.

## 검증이 끝난 기준 모델

| 항목 | 상태 | 근거 |
|---|---|---|
| DP Expert (단독 기대점수) | ✅ 구현·배포·독립 테스트 | [DP](../../training/dp/README.md) |
| Win DP v1 (마지막 한 턴) | ✅ 구현·배포, 20,000경기 | [실험](./RESULTS.md) |
| Win DP v2 (마지막 두 카테고리) | ✅ 구현·배포, 20,000+10,000경기 | [실험](./RESULTS.md) |
| DP-guided UCB MCTS | 🔬 연구용, 성능 우위 미입증 | [통합 연구](../INTEGRATED-RESEARCH.md) |
| QR-DQN Choice-only | 🔬 6K/30K 학습, 정확 DP 미달 | [실험](./RESULTS.md) |
| Hybrid 전환 조건 탐색 | 🧪 작은 별도 검증, 개선 미입증 | [실험](./RESULTS.md) |

## P0: 먼저 구현/검증할 후보

| ID | 작업 | 기대하는 직접 효과 | 최소 검증 및 우려 |
|---|---|---|---|
| P0-01 | Win DP를 남은 3~5개 칸까지 확대 | 더 이른 시점부터 경쟁 승률 반영 | 작은 상태는 완전탐색 교차검산, 상태 폭증·RAM |
| P0-02 | 상대 3~6칸 잔여 시점의 DP 점수분포 | 더 정확한 중반 경쟁 예측 | 분포 합 1, 평균 기대값 DP 일치, 모델 가정 |
| P0-03 | 상대 정책 best-response / endgame expectiminimax | 전략 변경하는 상대의 선택 반영 | DP·v1·v2 포함 다중 상대, 경로 의존성 |
| P0-04 | Residual policy + 경쟁 가치 신경망 | 이미 강한 DP 행동 중 변경 가치 높은 경우만 학습 | DP 손실·승률·calibration, 분포 이동 |
| P0-05 | Chance-Aware MCTS + adaptive compute | 계산 가능한 상태에서 깊은 승률 탐색 | chance-node 확률 검증, 동등 시간 예산 |
| P0-06 | League self-play, opponent modeling | 특정 DP Expert에 대한 과적합 감소 | 고정/적응형 상대, 미사용 상대 평가 |
| P0-07 | Expert Iteration | 더 나은 검색 결과를 빠른 정책으로 증류 | 원본 솔버 분리, 개선 없는 경우 실패 보고 |

## P1: 구현 가치가 있지만 P0 결과 의존

- Distributional Actor-Critic, C51/QR-DQN/IQN/FQF — 승률 목적 reward 분포와 불확실성을 직접 학습.
- A2C/Double DQN/Dueling/Rainbow — 기존 PPO의 낮은 점수 문제를 보상/관측 개선과 함께 비교.
- PSRO / Fictitious Play / population training — 강한 상대 모집단에 최적 대응 반복.
- CMA-ES / Bayesian optimization / MAP-Elites — 하이브리드 전환·위험 제어 매개변수 탐색.
- Search policy distillation / Mixture of Experts — 계산 시간 줄이거나 상황별 모델 선택.
- Exact arithmetic/interval residual verification — DP 테이블과 마지막 턴 가치의 수치 정확성 점검.

## P2/P3: 연구용 장기 후보

- NEAT, Genetic Programming, Evolution Strategies, Hierarchical RL, Discrete SAC, stochastic AlphaZero, full-game Nash approximate solver.
- 현재 규칙의 전이가 완전히 알려져 있으므로 MuZero 모델 학습의 추가 비용은 먼저 정당화해야 함.
- 기본 alpha-beta 및 일반 LLM은 높은 우선순위가 아님.

## 각 실험이 지켜야 할 프로토콜

1. **사전 등록:** 알고리즘 이름, 구현 버전/commit, 계산 예산(ms 혹은 노드 수), 하이퍼파라미터, 상대 집합, 규칙 고정.
2. **단위 검증:** 합법 행동, 점수·보너스, RNG 누출 방지, 분포 합/평균, 행동 경계, 시간 제한.
3. **탐색/훈련:** 개발 시드에서 정책·하이퍼파라미터 비교; 실험 로그 및 가중치 보존.
4. **확증:** 손대지 않은 시드·양 좌석·여러 상대·통계 구간. 경기 수를 사후 중단시켰다면 그에 따른 해석 제한을 기록.
5. **절제 실험:** 각 구성요소를 하나씩 빼서 추가 기여를 확인.
6. **배포 게이트:** 테스트/웹 UI 검증 통과, 롤백 가능, 성능 우월성이 명확하지 않으면 연구용으로만 유지.
7. **컨텍스트 갱신:** RESULTS에는 사실을, TECHNIQUES에는 상태를, DECISIONS에는 변경된 정책을 기록.

## 성공 기준의 구분

- **기대점수**: DP Expert는 전체 게임 최적 기준, 수치 오차 제외.
- **승률**: DP Expert와 Win DP v1/v2에 대한 개선 + 새로운 상대에 대한 일반화가 필요.
- **속도**: 판단 시간, 초회 로딩, RAM/배포 번들.
- **강건성**: 상대 정책의 변화, 시드의 변화, 다양한 시작 점수판, 비정상 상태 제외.
- **재현성**: GitHub Actions 성공 기록·같은 코드 SHA·원시 시드·독립 시험.

## 소통 방식

새로운 대화에서 이 백로그를 보고 다섯 단계를 다시 나눠 요청하라고 하지 말 것. 사용자가 "전부 맡긴다"고 하면 테스트·실패/성공·연구 결과 정리까지 하나의 작업으로 묶되, 시간/자원 한계로 끝내지 못한 부분은 명시하고 가짜 성공을 보고하지 않는다.

## 대량 알고리즘 탐색 연구 (2026-11-20)

[Algorithm Zoo 설계 및 재현 방법](./EXPERIMENT-ZOO.md)을 따라 **58개 정책/파라미터 조합**, 4종 새 강화학습 알고리즘과 4종 축소 문제 대조군을 CI에서 비교한다. 이 숫자는 **서로 독립적인 SOTA 모델 58개**가 아니라 정책 계열·설정의 총수다. 승률 우위 여부는 첫 실행 전에는 **미확인**이며, 성공한 실험의 검정 결과는 [_generated/LATEST_EXPERIMENT.md](./_generated/LATEST_EXPERIMENT.md)에서 확인한다. 이 파일은 GitHub Actions 성공 후 생성됨.

## 별도 표형 RL 비교 연구

[알고리즘 대량 실험](./EXPERIMENT-ZOO.md)에는 Q-learning/SARSA/Double Q/Monte Carlo/Dyna-Q/UCB-Q 등 **8개 표형 강화학습**의 축소 문제 비교도 연결함. 실제 성공된 실행 결과만 확증 성적으로 추가해야 함.
