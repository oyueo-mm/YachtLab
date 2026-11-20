# YachtLab 실험·성능 기록 (검증 사실만)

> 수치를 새 실험의 기준점으로 삼기 전 **규칙·상대·시드·평가지표·표본수**를 확인한다. 아래는 2026-11-20에 실제 GitHub 소스와 성공한 Actions 실행을 확인하고 고정한 실험 요약이다.

## 1. 단독 기대점수 기준선

- 전체 게임 DP Expert 초기 이론 기대 추가 총점 = **191.760879752165점** (12개 카테고리, 상단 63점 +35점, Float64 DP).
- 단독 기대점수의 이론적 의미: 정확한 확률 모델·동일 규칙·개인 총점 최대화 목적에서 다른 정책이 이를 지속적으로 초과할 수 없음(수치 오차/버그/규칙 차이 제외).
- 기존 v0.4 각 모델 **별도 미사용 시드 1,000경기** 평균 (단독 정책 평가):

| AI | 평균 총점 | 95% CI |
|---|---:|---|
| DP Expert | **191.884** | 189.601~194.167 |
| Distilled Policy | 187.822 | 185.471~190.173 |
| Distilled PPO | 185.983 | 183.651~188.315 |
| Expectimax | 174.516 | 172.295~176.737 |
| Greedy | 161.661 | 159.677~163.645 |
| PPO | 100.182 | 98.940~101.424 |

**자료:** [v0.4 최종 보고](../../benchmarks/v04/REPORT.md), [단독 DP 규칙과 검산](../../training/dp/README.md). 다른 시기의 benchmark 평균 점수와 뒤섞지 않는다.

## 2. 기존 Win DP v1 vs DP Expert

| 실험 | 게임 수 | Win DP 승리점수율 | 95% 짝별 정규 근사 구간 | 판단 |
|---|---:|---:|---:|---|
| 파일럿 | 2,000 | 50.2000% | 49.960~50.440% | 우월성 확정 불가 |
| 독립 확장 | 20,000 | **50.1625%** | **50.0917~50.2333%** | 작은 상대별 통계적 우위 |

- 20,000경기 평균 점수: Win DP 191.65965, DP Expert 191.72015.
- 후반부 승률 판단 57,713건, DP Expert와 다른 행동 935건.
- **근거:** [20,000경기 성공 Actions, JSON artifact](https://github.com/oyueo-mm/YachtLab/actions/runs/44615470690), [경쟁형 연구 문서](../COMPETITIVE-RESEARCH.md).
- 조건: 마지막 한 칸 경쟁 최적화, 상대 마지막 턴은 DP Expert라고 가정.

## 3. Win DP v2 vs DP Expert / Win DP v1 (독립 확증)

| 상대 | 게임 수 | Win DP v2 승리점수율 | 짝별 95% 정규 근사 CI | Win DP v2 평균 점수 | 상대 평균 점수 |
|---|---:|---:|---:|---:|---:|
| DP Expert | **20,000** | **50.6300%** | **50.406~50.854%** | 191.07860 | 191.93755 |
| Win DP v1 | **10,000** | **50.4350%** | **50.132~50.738%** | 191.75290 | 192.44100 |

- DP Expert 상대: 마지막 2칸 솔버 판단 57,176건, 기대점수 DP와 다른 행동 7,248건.
- Win DP v1 상대: 마지막 2칸 솔버 판단 28,644건, 기대점수 DP와 다른 행동 3,580건.
- **근거:** [30,000경기 별도 확증 Actions, 원시 JSON 아티팩트](https://github.com/oyueo-mm/YachtLab/actions/runs/44690511514), [Win DP v2 코드](../../src/competitive-v2.ts).
- 결론: 이 **고정 상대·평가 프로토콜**에서 작은 승리점수율 우위를 뒷받침하는 통계적 근거. 평균 점수는 상대보다 낮음.
- 제한: 전세계 최강/모든 상대에 대한 우월성을 입증하지 않음. 승률 차이가 매우 작아 다중 후보 비교, 상대 모델 불일치, 다른 규칙에 주의.

## 4. Win DP v2 소규모 비교 리그

| 상대 | 게임 | Win DP v2 승리점수율 | 짝별 95% 근사 CI |
|---|---:|---:|---|
| DP Expert | 600 | 51.00% | 49.60~52.40% |
| Win DP v1 | 200 | 50.50% | 48.80~52.20% |
| Greedy | 200 | 75.50% | 69.84~81.16% |

- Guided MCTS 연구용 후보 vs DP Expert **48경기 42.708%**, CI 32.715~52.701%; 작은 표본에서 약세, 우열 확정 불가.
- Hybrid 전환 임계값 연구: 소규모 탐색 후 Hybrid 0 선택. **별도 검증 128경기 51.1719%**, CI 47.026~55.317%; 개선 미입증.
- **근거:** [통합 연구 리그 Actions 및 JSON](https://github.com/oyueo-mm/YachtLab/actions/runs/44689804618), [통합 연구 설계](../INTEGRATED-RESEARCH.md).

## 5. QR-DQN 파일럿은 전체 게임 결과가 아님

조건: **마지막 Choice 카테고리만**, 주사위 5개·최대 세 번 굴림, 초이스 25점 이상 달성 여부.

| 모델 | 학습 에피소드 | 독립 평가 에피소드 | 목표 달성률 |
|---|---:|---:|---:|
| QR-DQN 소규모 | 6,000 | 3,000 | 36.433% |
| QR-DQN 확장 | 30,000 | 5,000 | **39.100%** |
| 정확한 목표점수 DP 기준 | 해당 없음 | 완전 열거 | **약 41.671%** |

- 두 훈련은 **초기 시드도 다르기 때문에** 수치 차이를 학습 기간만의 인과 효과라고 확정할 수 없다.
- 체크포인트는 배포 AI가 아니며 각각 Actions artifact에 보존.
- **근거:** [6,000 episode 결과](https://github.com/oyueo-mm/YachtLab/actions/runs/44689804618), [30,000 episode 결과](https://github.com/oyueo-mm/YachtLab/actions/runs/44690511514), [실제 코드](../../training/qr_dqn_choice.py).

## 6. 두 카테고리 완전열거 학습 목표 실험

아래 수치는 **전체 게임 승률이 아니라 특정 조건에서 추가 목표 점수 이상 얻을 확률**.

| 마지막 두 칸 | 상단 누적 | 추가 목표 | 기대점수 정책 | 목표점수 정책 |
|---|---:|---:|---:|---:|
| Sixes·Choice | 50 | 35 | 62.721% | 70.321% |
| Small·Large | 63 | 30 | 33.561% | 45.402% |
| Choice·Yacht | 0 | 40 | 6.152% | 8.994% |

Sixes·Choice 조건은 정책마다 50,000번 Monte Carlo 검산. **근거:** [기존 확률 실험의 정의와 결과 기록](../COMPETITIVE-RESEARCH.md).

## 7. 검정과 재현 원칙

1. 항상 12칸 닌텐도식 요트다이스에 대한 실행인지 확인한다.
2. 승리점수율은 승리=1, 무승부=0.5, 패배=0으로 정의한다.
3. 한 시드에 대해 좌석을 교대하는 2경기를 묶어 신뢰구간의 1개 관측치로 취급한다.
4. 승률·평균점수·추론시간·유효 시드 수를 동시에 기록한다.
5. 사전 지정한 미사용 시드에서 모델을 **튜닝하지 않은 채** 평가한다. 같은 홀드아웃으로 여러 후보를 선택하면 선택 편향이 생긴다.
6. CI가 50% 초과해도 상대 집합/게임 규칙을 넘어서는 세계 SOTA라고 홍보하지 않는다.
7. GitHub Actions 아티팩트는 만료될 수 있다(일반적으로 리포지토리 보존 정책에 따름). 영구 성과 보고서는 이 문서와 git 추적 연구 코드를 함께 보존한다.

## 원시 재현 명령

- v1: node scripts/research-competitive.mjs 20000 930000
- v2: node scripts/confirm-v2.mjs 20000
- 소규모 종합 리그: node scripts/research-league.mjs
- QR-DQN: python training/qr_dqn_choice.py --episodes 30000 --eval 5000 --seed 26111

모든 수치가 자동 최신이라는 뜻은 아니다. **측정된 사실의 스냅샷**으로 유지하고 새로운 검증 실험이 완료되면 실험 출처와 함께 갱신한다.

## 후속 대량 알고리즘 탐색

2026-11-20부터 [Algorithm Zoo](./EXPERIMENT-ZOO.md) 연구를 별도 실험으로 기록한다. **새 실험 수치는 자동 성공 아티팩트가 만들어진 다음** [최신 결과](./_generated/LATEST_EXPERIMENT.md)에서 확인해야 한다. 기존 v1/v2 검증 수치를 새 후보의 점수로 재사용하지 말 것.

## 2026-11-20: 70개 후보·방법/설정 대량 실험 완료

- **[최종 보존 보고서](./EXPERIMENT-ZOO-2026-11-20.md)** · [전체 게임 자동 요약](./_generated/LATEST_EXPERIMENT.md) · [58개 설정 JSON](./_generated/zoo-summary.json).
- **실제 12카테고리 경기 45,784게임**을 통해 58개 설정(12개 계열)을 선별. 예비 1위 `trailGate--5`는 최종 독립 12,000경기에서 DP Expert 상대로 50.200% (95% CI 49.993~50.407%), Win DP v2 상대 49.796% (95% CI 49.582~50.010%). **새 성능 우위 입증 불가.**
- [전체 경기 연구 CI](https://github.com/oyueo-mm/YachtLab/actions/runs/44704462236) 성공, GitHub 자동 결과 문서 커밋 확인.
- [딥 RL 4종](https://github.com/oyueo-mm/YachtLab/actions/runs/44704462236) Choice-only, 학습 각 9,000에피소드/평가 각 5,000. **Double DQN 33.38%**가 네 학습기 중 최고, 단순 5·6 유지 휴리스틱은 37.24%.
- [표형 RL 8종](https://github.com/oyueo-mm/YachtLab/actions/runs/44705368822) Choice-only, 학습 각 250,000에피소드/평가 각 10,000. **Dyna-Q 37.05%**가 표형 학습기 중 최고, 같은 조건 5·6 유지 휴리스틱 36.64%.
- 초이스-only 정확 목표점수 DP의 이론값 약 41.671%; **RL 실험 결과는 전체 게임 승률이 아님**. 서로 다른 시드/평가 묶음 간 수치만으로 직접 우열을 단정하지 않음.
- 현재 승률 기준 연구 최강 모델로 **Win DP v2 유지**. 구현·배포 기본 AI를 이번 탐색만으로 변경하지 않음.

## 2026-11-20 전체 12라운드 자기 대국 첫 구현·검증

- 근거: [GitHub Actions 실제 본실험](https://github.com/oyueo-mm/YachtLab/actions/runs/44711251372), [자동 결과](./_generated/SELFPLAY-LATEST.md), [연구 설계](./SELFPLAY-RESEARCH.md).
- 진화 기반 리그: **6세대 × 12정책**, 상대 DP Expert·Win DP v2·이전 세대 정책. 실제 12라운드 대전 승패 보상으로 12차원 residual policy의 가중치를 학습.
- **REINFORCE 10epoch × 96 full-game training games**, 전체 경기 승패를 사용해 행동 로그확률의 미분으로 정책 파라미터를 업데이트. 초기 정책/실제 self-play 모두 연구.
- 독립 후보 선택: 기존 DP 기반 잔차 0 기준 **52.153%**, 학습된 REINFORCE **51.806%**, 최종 진화 정책 **51.597%** (DP Expert와 Win DP v2 두 상대 승리 점수율의 평균, **선택/검증 데이터**, 직접 모델간 경기 승률은 아님).
- **최종 선택은 학습하지 않은 잔차 0 기준 모델**. 새로운 시드 확증에서 DP Expert 상대 **3,600경기 50.750%** (paired 95% CI **50.132~51.368%**), Win DP v2 상대 **3,600경기 49.903%** (CI **49.403~50.403%**).
- 잔차 0 정책은 앞부분 DP Q 선택과 마지막 2개 Win DP v2를 사용하므로 사실상 기존 Win DP v2와 같은 전략. **새로운 학습 모델의 승률 개선은 미입증**. 기준 정책을 학습 성과로 소개하면 안 됨.
- 상대 모델 검증: 정책별 훈련 240/평가 240경기. 최종 점수잔차의 Gaussian RMSE: DP Expert 30.154, Win DP v2 28.913, Greedy 24.729. 같은 데이터 무보정 오차는 각각 30.131, 28.977, 28.478. DP Expert는 보정이 약간 나빠졌고, Greedy에서 개선 확인. 이는 **승률 개선 성적이 아니라 예측 RMSE**.
- Win DP v3 (내 마지막 3칸 Bellman, 상대가 3칸 이상 남으면 Gaussian 근사) vs Win DP v2 **72경기 50.000%**, vs DP Expert **48경기 46.875%**. 표본이 작고 우위 입증 실패, 사용자 기본 AI에는 미적용.
- 기록: 코드·실험·개별 결과·가중치가 Actions artifact에 보관됨. 아티팩트 보존 정책으로 만료 가능; 요약은 Git에 보존.

## 2026-11-20 신경망 전체 게임 자기 대국 추가 연구 결과

- 최종 보존 보고서 **[자기 대국 종합 보고](./SELFPLAY-2026-11-20-FINAL.md)**, [신경망 모델 원시 Actions](https://github.com/oyueo-mm/YachtLab/actions/runs/44713879146), [자동 요약](./_generated/NEURAL-SELFPLAY-LATEST.md).
- 실제 전체 게임 DP-Q 보조 행동 신경망(12→12→1)으로 **Neural REINFORCE, Monte-Carlo Advantage Actor-Critic 각각 7,200게임 학습** 완료.
- 별도 선택용 시드에서 Neural MC Actor-Critic 선택, 독립 확증 DP Expert 상대 **3,600경기 51.403%**(95% paired CI **50.742~52.064%**), Win DP v2 상대 **3,600경기 49.736%**(CI **49.239~50.233%**).
- **Win DP v2 직접 승률 개선 미입증**. DP Expert 상대의 이전 20,000경기 Win DP v2 수치와 시드가 달라 단순 숫자 비교를 우월성 검정으로 사용하지 않는다.
- 종합적으로 선형/진화 리그, 소형 신경망, 상대 예측 및 v3 모두 실제 실행됐지만 기존 최강 모델을 교체하지 않는다.

## 2026-11-20 PSRO + 이산 상대점수분포 + PPO 전체 게임 독립 확증

**영구 보존 보고서:** [PSRO-PPO-PMF-2026-11-20-FINAL.md](./PSRO-PPO-PMF-2026-11-20-FINAL.md). **원시 증거:** [성공한 본실험 GitHub Actions](https://github.com/oyueo-mm/YachtLab/actions/runs/44725235023) · [PSRO](./_generated/PSRO-LATEST.md) · [PMF](./_generated/PMF-LATEST.md) · [PPO](./_generated/PPO-LATEST.md).

- 실제 제한게임 PSRO **7정책 모집단**, 대국 payoff 행렬 + zero-sum fictitious-play meta solver + ES 근사 best-response oracle 3회 학습·확장. Restricted exploitability 0.0002289 (이 값은 전체 게임 Nash exploitability가 아님). **PSRO mixture vs Win DP v2 2,400경기 49.4375%** (paired 95% CI **48.245~50.630%**), vs DP Expert 2,400경기 49.6875% (CI 48.365~51.010%). **우위 미입증**.
- 정책별 실제 잔차 이산 PMF 훈련 350/선택 180/독립확증 320게임. Gaussian 대비 CRPS: DP Expert **18.2201→18.2191** (극히 미미), Win DP v2 **17.4464→17.4499** (악화), Greedy **15.0835→14.9413** (개선). 이는 **승률이 아니라 확률 예측 오차**. PMF Win DP v3 vs Win DP v2 **400경기 49.375%** (CI 47.589~51.161%), 우위 미입증.
- 실제 12라운드 **PPO clipped+GAE+critic** 및 **PPO + DP teacher-KL**, 각각 2,688 full-game 학습 경기. PSRO meta mix/이전 PPO 스냅샷과 적응형 리그로 훈련. 선택된 기본 PPO 독립 확증 **vs Win DP v2 3,200경기 49.5313%** (CI **48.450~50.612%**), **vs DP Expert 3,200경기 50.0781%** (CI **49.027~51.129%**). **승률 우위 미입증**.
- 연구용 원시 데이터/모델 체크포인트/PSRO payoff matrix GitHub Actions artifacts 3개 확인. 기존 Win DP v2 및 사용자 기본 AI 변경하지 않음.

## 추가 실제 독립 실험 (2026-11-20)

- [확장 실험 실제 기록](./EXTENDED-PSRO-PMF-PPO-RESULTS.md) · [원시 CI](https://github.com/oyueo-mm/YachtLab/actions/runs/44756143942).
- 세 PSRO approximate best-response oracle은 frozen historical meta mixture에서 기존 정책 대비 각각 **−1.0156%p** (CI −3.9755~+1.9442), **+0.8594%p** (CI −2.3158~+4.0345), **+2.1094%p** (CI −1.0364~+5.2551). 세 단계 모두 우위 미입증.
- 상태별 상대 PMF는 DP Expert/Win DP v2/Greedy 각 650 train, 200 validation, 400 confirm games. Gaussian→조건부 CRPS: DP Expert 17.6306→17.6371, Win DP v2 17.8672→17.8908 (**악화**), Greedy 15.0158→14.7389 (**개선**, game-cluster 95% CI 개선 +0.1840~+0.3698).
- 상태별 PMF를 쓰는 Win DP v3 vs Win DP v2 **240경기 47.083%** (CI 44.751~49.416%). 기존 Win DP v2 대체 금지.
- PPO 3시드×2변형×8192경기 = **49,152 full-game 학습**은 CI에서 별도 학습·종합 검증. 완료 시 [PPO multi-seed 결과](./_generated/PPO-MULTISEED-LATEST.md)를 근거로 추가.
