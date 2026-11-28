# YachtLab AI 연구 기법 전체 목록

> **문서 성격:** 연구 후보 도감. 아래의 높은 우선순위는 성능 예측에 대한 **가설**이며 실험 결과가 아님.
> **기준:** 현재 게임은 12카테고리 닌텐도식 요트다이스. 승리점수율 = 승리 1 + 무승부 0.5.
> **진행 상태:** ✅ 배포/기존 구현, 🔬 작은 문제 또는 연구용 구현, 🧪 실험 기록만 존재, 💡 아직 구현하지 않은 후보.
> **우선순위:** P0 직접 검증이 유망, P1 연구 가치 높음, P2 장기/고비용, P3 먼저 할 필요 낮음. 예측이므로 모든 기법의 성능 개선은 **미확인** 상태로 취급.

## 브라우저 AI·게임 리뷰 실행

v5-R 단일 Float32 은행은 워커의 WASM 메모리에 직접 생성한다. OPFS 복원은 본문과 인덱스를 필요한 배열에 한 번만 읽고, 블록 단위 체크섬을 검증한다. YPB1 INT16은 배포 크기 검토 대상이며 현재 실행에서는 전체 Float32로 디코딩한다. [실행 검증](./V5-R-PRODUCT.md)

C2 게임 리뷰는 1인 DP Expert 기대점수와 2인 단일 은행 v5-R 승리점수율을 사용한다. 순차 종반은 정확 expectiminimax로 평가하고 동시 진행은 공개 카드 기준 고정 상대 모델로 추정한다. 첫 굴림과 재굴림의 조건부 기댓값 차이가 운이다. [비교와 한계](./C2-GAME-REVIEW.md)

## 일일 콘텐츠 계산 (LIVE-1, 제품 — 새 AI 모델 아님)

| 기법 | 핵심 메커니즘과 YachtLab 적용 | 상태 |
|---|---|---|
| 위치 인덱싱 주사위 테이프 | HMAC(그날 키, 라운드·굴림) → 칸별 균등 눈; 킵 선택과 무관하게 모두 같은 위치에서 같은 눈 | ✅ 오늘의 요트 |
| 커밋–공개(commit-reveal) | 아침에 키의 해시만 공개, 마감 뒤 키 공개로 누구나 재검증 | ✅ |
| 퍼즐 행동 가치 표 | 기존 DP Expert `dpActionValues`로 모든 합법 행동의 기대 최종점수 | ✅ 퍼즐 |
| 끝난 상대 대비 정확 종반 승률 | 남은 칸 ≤ 3개, (칸 마스크·상단·현재 점수) 역진 귀납, 무승부 ½ | ✅ 퍼즐(남은 칸 1개는 Win DP와 일치 시험) |
| 규칙 기반 난이도 | 최선–차선 차이 + 단순 규칙(최대 즉시 점수·최다 눈 고정·기대점수 최적)의 적중 여부 | ✅ |

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

## 2026-11-24 경제 연구에 쓴 기법 (AI 성능 연구가 아님)

| 기법 | 적용 | 상태 |
|---|---|---|
| DP 행동가치 소프트맥스 숙련도 정책 | τ로 입문~전문가 5단계 실제 경기 데이터 생성(`scripts/economy/policies.ts`) | ✅ 연구 전용(게임 AI 미등록) |
| **DP Expert 정확 최종점수 분포** | (마스크, 상단합) 마르코프 연쇄 역전파로 전체 게임 PMF, 평균 = DP 값(오차 1.4×10⁻¹³). 위의 Distributional DP를 **전체 게임·단일 정책**으로 확장한 첫 결과 | ✅ `scripts/economy/exact-score-pmf.ts` |
| 목표 패턴 게임 DP(4,096 마스크) | 323점 완벽 경기 등 "그 목표만 노리는" 최대 확률 | ✅ `src/economy/dice-exact.ts` |
| 교차 엔트로피 중요도 표집 | 주사위 면 분포 기울이기 — 250·270점은 일치, 290점 이상은 비효율(부정적 결과) | 🧪 교차 검증용 |
| 에이전트 기반 경제 시뮬레이션 | 사용자 유형×모델×기간, 정규화 비교, 민감도, 모집단·Cloudflare | ✅ `src/economy/simulate.ts` |
| 시간 기반 가격 역산·강화 곡선 비교 | 선형·기하급수·멱함수·구간별 | ✅ 권고만 |

## 2026-11-24 온라인 다인전 서버 기법 (AI 성능 연구가 아님)

- 동시 진행: 라운드마다 플레이어별 독립 턴, `roundStarted`/`roundTimedOut` 이벤트, 시간 초과 시 서버가 최고 점수 칸 자동 기록(`auto`), 3회 연속 미응답 시 기권 처리. 감사는 이벤트 재실행으로 동일.
- 비용 제어: 다인 경기는 하루 예산 ⌈N/2⌉ 단위, 방당 최대 이벤트 4000·연결 48, 연결 분당 120.

## 2026-11-25 제품 기법 (AI 성능 연구가 아님)

- 화면도 서버와 같은 도배 제한 함수(`allowSocial`·`socialRetryMs`)로 미리 판단하고, 서버가 되돌려 준 메시지만 "보냄"으로 표시(D-047).
- 재접속 유예 정보를 남아 있는 소켓 첨부 데이터에 보관해 Hibernation 뒤에도 유지(저장소 쓰기 0, D-046).
- 주사위 면 캔버스 그림 함수 하나를 3D 텍스처·썸네일·미리보기가 공유(D-050).
- 친구 접속 상태는 저장 없이 계정 객체 메모리 + 사이트의 1분 받은함 확인으로만(D-051).

### 제품 UI: 신규 플레이어의 점수 기록

연습 차례는 실제 12칸 엔진의 굴림·킵·재굴림·기록을 사용하는 별도 화면 상태다. 기존 족보 설명과 모바일 점수표를 공유한다. 한 열은 족보 주사위 그림을 볼 수 있고, 두 열은 더 많은 족보를 한 화면에서 볼 수 있다. 두 열은 점수표 콘텐츠 폭이 332px 이상일 때 선택할 수 있다.
## 2026-11-27 A1 제품 표현 기법 (AI 성능 연구가 아님, [A1-DICE-BOARD](./A1-DICE-BOARD-2026-11-27.md))

| 기법 | 상태 |
|---|---|
| 사전 시뮬레이션 + 정지 후 큐브 대칭 면 배정(결과와 연출 분리) | 유지(기존) |
| 모서리 깎은 볼록 다면체 주사위, 진행 방향 결합 초기 각속도, 바닥 접촉 구름 저항·정지 마찰, 겹침 없는 출발 묶음 | 완료(`impulse` 기본) |
| 보드 표면별 충돌음 필터·공명(세기 → 밝기) | 완료 |
| 보드별 절차적 장면(Lv.2 환경 / Lv.3 충돌 세기 비례 국소 반응, 환경 상태를 바꾸는 반응) | 완료 26종 |
| 시너지 = 주사위 경로 기록 + 정지 주사위 연결 | 완료 10종 |
| 캐시 글로우 스프라이트, `shadowBlur` 제거, 단일 캔버스 합성, 가시성 기반 rAF 정지, 적응 프레임 간격 | 완료 |
| 물리 사전 계산 Web Worker | 완료(A1.1) |
| 측정 프레임 기반 적응형 장식 품질(히스테리시스·던지기 경계 적용) | 완료(A1.1) |
| OffscreenCanvas 보드 렌더 | 후보(미구현) |

## 2026-11-25 Win DP v5 연구 기법 ([V5-APEX-RESEARCH](./V5-APEX-RESEARCH.md))

| 기법 | 적용 | 상태 |
|---|---|---|
| **전 상태 정확 정책 PMF 은행** | DP Expert의 미래 득점 PMF를 199,744 정규화 상태 전부에서(질량 오차 2.8e-15, 평균 오차 7.4e-13). 위 "Distributional DP"의 전 상태 확장 | ✅ `src/research-v5/policy-pmf.ts` |
| 상단 점수 정규화 | 보너스 확정/불가능/상단 칸 없음 → 동치 병합(23.8%), DP 표에서 비트 단위 동치 검증 | ✅ |
| **정확 PMF 롤아웃(v5-R)** | 현재 턴을 승리 점수율로 정확 최적화 + 이후 양측 DP Expert의 정확 PMF. DP Expert에 대한 정책 개선 1단계, 0.07 ms/판단 | ✅ 연구용, 확증 결과는 RESULTS |
| **정확 2인 Expectiminimax 종반** | 양측 남은 칸 ≤ 3(복기용 4), negamax + chance + 안전 가지치기. 3v3 평균 21 ms, 4v4 0.74 s | ✅ `src/research-v5/apex.ts` |
| 정확 우도 Bayesian 상대 필터 | 공개 점수판 변화의 정확 확률 P_π(c,p\|state), ε 혼합·감쇠 | ✅ 연구용(v5-D) |
| VOI 조건부 depth-2 PMF-Expectimax | 상위 2개 카테고리 차이가 작을 때만 | 🧪 개발 시드에서 −0.135%p, 채택 안 함 |
| 잔차 상호작용 가치(릿지/MLP) | 정확 expectiminimax − 정확 PMF 잔차 학습, 보류 MAE −17%(릿지) | 🧪 측정만, 대국 미적용 |
| CFR / Deep CFR | 완전정보 순차게임이라 역진 귀납법으로 충분 | ❌ 채택 안 함(근거 문서화) |
| 네이티브 C++ 은행 빌더 | TS 대비 18.5× (3.0 s) | ✅ 교차검증용 |
| 복기용 분석 인터페이스 | 모든 행동 가치·손실·점수차 PMF·정확도 표기·실시간/복기 엔진 분리 | ✅ `src/research-v5/analysis.ts`, UI 없음 |

## 2026-11-25 Win DP v6 연구 기법 ([V6-APEX-RESEARCH](./V6-APEX-RESEARCH.md), 70개 기법 상태표 §9)

| 기법 | 설명 | 상태 |
|---|---|---|
| **지수효용 λ-정책 정확 PMF 은행** | E[exp(λG)]는 점수 이동에 분리 가능 → 최적 정책이 자기 상태(mask,u)만의 함수 → λ별 전 상태 정확 PMF. λ=0은 DP Expert와 비트 동일 | ✅ `src/research-v6/risk.ts` |
| 정책군 롤아웃(v6-P) | 이번 턴 이후 "미래의 나"가 λ 7개 중 최선을 약속. 모델 가치 ≥ v5-R | ✅ 작은 개선: v5-R 직접 대결 50.131%(9511)·50.209%(9512), 공통 상대 이득은 미확정 |
| 개방루프 전 구간 BR(v6-A) | 상대 고정 PMF에 대해 남은 ≤K칸 정확 Bellman DP | ❌ 개선 실패 |
| 상대 정책군 최대최소/혼합(v6-L/Lm) | 제한 Robust BR / RNR | ❌ 개선 실패 |
| 경기 분할 Ridge 잔차(v6-C) | 정확 상호작용 − 정책군 가치, 내부 검증 k 게이트 | 측정·대국 §6.3 |
| 확장 Bayesian(v6-D/Dd) | λ 7가설 정확 우도, 감쇠 | 대국 §6.3 |
| 자립형 WASM PMF 생성기 | libc 없는 C → wasm32, 커널 표를 JS에서 주입해 TS와 비트 동일 | ✅ 8.0 s Node / 8.1 s 브라우저 워커 |
| Rust PMF 생성기 | 같은 연산 순서 포팅 | ✅ 3.5 s, 비트 동일 |
| 단일 복사 은행 로더 | 파일 → 단일 ArrayBuffer 직접 읽기 | ✅ RSS 677→379 MB |
| 결정 수준 양자화 평가 | 실제 국면에서 행동 일치·후회·근소 동률·극단 국면 분리 | ✅ Float32 손실 0, INT16 5.9e-7 |
| PMF 신경망 증류·하이브리드 | numpy MLP softmax 분포 | ❌ 결정 불일치 4.8%(하이브리드 ≤6칸 정확 2.1%) |
| 분석 API v6 | 승/무/패, 굴림 전 가치, 결정 손실 vs 운 | ✅ `src/research-v6/analysis6.ts` |

## 2026-11-25 Win DP v7 연구 기법 ([V7-APEX-RESEARCH](./V7-APEX-RESEARCH.md))

| 기법 | 내용 | 상태 |
|---|---|---|
| 정확 결정 손실(regret) 벤치마크 | 실제 대국 국면(양측 ≤4칸)에서 추정기의 턴 정책을 정확 상호작용 가치로 평가. 국면별 분산 0 | ✅ `scripts/research-v7/regret.ts` |
| 상대 1턴 반응 정지가치(v7-I1) | 내 득점 뒤 상대가 자기 승률 최대로 한 턴을 정확히 둔 뒤, 내 정책군 폐루프 말단 | ✅ regret 최저(0.0083), 대국 개발만 |
| v7-I1RO | 상대 턴 v5-R 목표 + 상대 최종점수 혼합 PMF에 대한 개루프 정책군 | ✅ **작은 개선**: v6-P 직접 대결 9541 50.136% 유의, 9531 50.091%(Holm 미달) |
| 정책 행렬게임 Nash(v7-N) | 7×7 영합 행렬게임 LP | ✅ 구현, 실국면에서 순수 안장점(= v6-L) |
| 대조군 I1D | 비반응 상대 턴 + 폐루프 | ✅ 개선 거의 없음 → 개선 원인은 상대 반응 |
| 두 수 반응 I2 / I2R | 상대 반응 턴 뒤 내 다음 턴을 P 정지가치로 정확히 풂(폐루프) | ✅ regret 최저(K=4 0.0024~0.0026), 대국 개발 중 |
| 개루프 두 수 반응 I2RO | 상대 반응 혼합 PMF 뒤 내 턴 정확 | ✅ regret 0.0035(K=4), 0.0045(K=5), 루트 24 ms |
| 경량 I1RO1 | I1RO를 DP 은행 1개로 | ✅ regret v6-P 수준, 제품 트랙 대국 비교 중 |
| 정확 교사 + 잔차 학습 | 양측 ≤5칸 정확 가치, numpy ridge/MLP | ⚠️ 같은 범위만 개선, 외삽 실패(개선 미입증) |
| 다중 턴 I3 이상 | 폐루프 N³ | ✅ v7.2 I3R(첫 반응 폐루프 + 두 번째 반응 I1RO), regret K=4 0.0014 |
| I3Rp 확률 질량 가지치기 | 상대 결과 누적 질량 0.8까지만 깊게, 나머지 I2R 리프(근사) | ✅ regret 0.0015, 비용 1/3; 창 변형 I3RpW4 대국 개발 중 |
| 단일 은행 I2RO1 / I2R1 (제품) | DP 은행 1개로 두 수 반응; 단일 은행 동치표(V7 §9.1) | ✅ regret K=4 0.0043/0.0035, v5-R과 같은 메모리 → **제품 주 후보**, 확증 9571/9581 진행 |
| 정확 솔버 해시 메모 | Float64 개방 주소 메모(값 동일), 6M 삭제 한계 제거 | ✅ K=7/6 루트 499 s |
| 브라우저 벤치(Chromium 워커) | esbuild 번들 + WASM f32 은행 + 후보 판단 시간 | ✅ `scripts/research-v7/browser/run.cjs` |

## 2026-11-28 C5 경제 설계 기법 (제품 경제, AI 성능 연구가 아님)

- **운영 함수 위의 오버레이 시뮬레이션**: 경기 경로를 운영 `applyMatch`로 한 번만 만들고, 정책 후보는 같은 경로 위에 덧씌운다. 모든 후보가 같은 표본을 쓰므로 차이가 정확히 비교된다.
- **결정적 거래 ID + 내용 지문**: 재시도는 같은 ID → 원래 결과, 같은 ID의 다른 요청 → 충돌. 지급·구매·강화·슬롯 모두 적용.
- **평생 1회 이정표 + 주 1회 휴식**: 연속 활동의 총 발행을 묶고(계정당 최대 2,290코인·65보석) 결석 스트레스를 줄인다.
- **견적 대조(expected price/level/version)**: 화면이 본 값을 서버가 같은 트랜잭션에서 대조한다. 버전이 어긋난 Pages·Worker 조합에서도 사용자 동의 없는 결제가 생기지 않는다.
- **확률표 버전 해시**: 뽑기 풀·경우의 수·비용을 하나의 버전으로 묶어 화면과 서버가 대조하고, 테스트에 고정해 확률 변경을 CI에서 드러낸다.
