# 연구 로드맵 / 백로그 (실행 가능성 기준)

2026-11-20 연구 계획. **P0/P1은 우선순위 가설이며 성능을 보장하지 않음.** 사용자는 대규모 연구 작업을 단계별로 여러 번 의뢰하기보다 한 작업에서 여러 후보를 구현·실험·비교하는 구성을 선호한다.

## 무료 AI와 향후 서버 AI

무료 AI의 제품 방향은 사용자 기기에서 실행되는 12카테고리 AI와 오프라인 PWA다. v5-R Float32 시험판은 비열등성 대국을 통과했다. 기본 적용을 판단하기 전에 저사양 Android/iOS 실기기에서 초기화, 메모리, 백그라운드 복귀 및 저장소 한계를 측정한다. 승리점수율 리뷰도 같은 기본 적용 조건을 따른다. [제품 검증](./V5-R-PRODUCT.md)

향후 YachtLab Pass의 서버 AI 후보는 검증된 최강 연구 모델을 서버에서 교체 가능하게 운영하는 방식이다. 현재 직접 대결 근거가 있는 후보는 v6-P이며 기기 기본 탑재 범위에는 포함하지 않는다. 서버·권한·구독·결제는 향후 설계에 남아 있다.

## 제품(게임·온라인·경제) 현황 — 2026-11-24

제품 로드맵·배포 기록은 [PRODUCT-2026-11-24](./PRODUCT-2026-11-24.md). 완료: 빠른 대전·공개 관전방·서버 검증 AI 대전(Phase 4.5), 퀘스트·업적(Phase 5), 재화 원장·상점·인벤토리·장착 표시(Phase 6). 다음: 사람 확인(실제 Google 로그인 회원 흐름), 운영 지표로 경제 재보정, 상품 아트·카탈로그 확대, 특수 등급 기획, 랭크·레이팅(서버 검증 무작위 대전만 입력), AI 전략 복기, PWA. 보류: 월간 퀘스트, 상단 보너스 퀘스트·업적, 매우 어려운 AI 승리 퀘스트, 현금 결제.

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

## 2026-11-20 실험 이후 의사결정

- ✅ 58개 전략·매개변수 실험과 45,784 실제 경기(대량 리그) 완료, [최종 기록](./EXPERIMENT-ZOO-2026-11-20.md).
- ✅ 딥 강화학습 4종, 표형 강화학습 8종의 **Choice-only** 학습·평가 완료. 모두 최적 DP에는 못 미침.
- ✅ `trailGate--5` 탐색 1위의 **독립 검증 실패**까지 보존. 기존 Win DP v2를 기본 연구 기준선으로 유지.
- 🔲 다음 주력 연구는 3~5개 카테고리 경쟁 DP/상대 분포, 가치 신경망의 residual 경쟁학습, 실제 경쟁 self-play 및 chance-node 탐색. 기존 임계값 게이트를 계속 튜닝해 작은 데이터에 과적합하지 않도록 할 것.
- 🔲 장기 발전에서는 여러 상대가 적응하는 조건의 강건성/게임 이론적 최적 대응 검토.

## 2026-11-20 자기 대국 통합 연구 착수

사용자는 **자기 대국 중심으로 전체를 실험·구현·연구**하도록 요청. [SELFPLAY-RESEARCH.md](./SELFPLAY-RESEARCH.md)에 실제 **12라운드 게임 보상으로 훈련**하는 진화적 리그/PSRO-inspired population best-response와 on-policy REINFORCE residual policy, 라운드별 상대 분포 캘리브레이션, 3개 카테고리 승률 DP 연구를 통합 기록. 기존 Win DP v2 및 기본 사용자 AI를 보존.

- 🔬 전체 게임 승패 보상 진화적 리그 훈련 + 이전 세대와 자기 대국 (코드 구현)
- 🔬 전체 게임 승패 REINFORCE 정책 경사 (코드 구현)
- 🔬 상대 DP Expert·Win DP v2·Greedy의 남은 점수 예측 캘리브레이션 (코드 구현)
- 🔬 내 마지막 3개 카테고리 정확 Bellman 및 상대 가우시안 **근사** 분포 (연구용)
- 🔲 **실제 승률 우위는 본실험 실행 후 확정**. 대규모 모델 학습과 최종 분리 시드 대전이 완결되지 않았다면 명확히 미완료로 표시할 것.

## 자기 대국 첫 본실험 이후 (2026-11-20)

- ✅ **실제 full-game 학습**: 진화적 리그 + REINFORCE, 6세대/12후보 + 960건의 on-policy 경기 완료. 근거 [실행](https://github.com/oyueo-mm/YachtLab/actions/runs/44711251372).
- ✅ 상대 잔차 모델(240 훈련 + 240 독립 평가 × 3상대) 및 연구용 Win DP v3 실제 대결 완료.
- ⚠️ 학습 후보 중 어떤 것도 기존 잔차0/Win DP v2보다 우월하다는 증거 없음. 전략 보정만으로는 강한 DP의 기준을 넘기 어려움.
- 🔬 다음: **DP-Q 보조 신경망**의 표현력을 늘리고, 실제 12라운드 승패로 REINFORCE 및 Monte-Carlo advantage actor-critic 훈련. 독립 시드 확증 전에는 강하다고 주장하지 않음.
- 🔲 장기: PSRO meta-solver 및 실제 대전 최적 대응/상대 분포 강건화, 더 많은 시드·상대의 교차 평가.

## 신경망 전체 게임 자기 대국 후 결정

- ✅ REINFORCE neural·Monte-Carlo actor-critic neural 학습 완료, 각각 7,200 전체 게임; [최종 결과](./SELFPLAY-2026-11-20-FINAL.md).
- ✅ DP Expert 상대 신경망 51.403%(3,600경기), **Win DP v2 상대 49.736%(3,600경기)**. 후자 CI에 50% 포함되므로 **최강 AI 갱신 없음**.
- P0 후속: 실제 PSRO meta-solver, 보다 정확한 opponent final-score distribution 및 다중 opponent holdout.
- P0 후속: **진짜 PPO/A2C TD advantage + DP teacher KL** 훈련 및 여러 초기화 시드에서 반복.
- P1: chance-aware MCTS/value network 통합과 동일 연산 예산 제어.

## 2026-11-20 PSRO·PPO·PMF 실제 구현 연구

- 🔬 [통합 설계](./PSRO-PPO-PMF-RESEARCH.md): 제로섬 restricted PSRO **실제 메타게임 행렬/fictitious-play 솔버**, 현재 혼합 상대에 대한 ES 근사 최적대응 오라클 및 반복 모집단 추가.
- 🔬 임의 상대 3명 고정에서 벗어나, PSRO 메타 정책과 **이전 PPO 스냅샷**에 대한 적응형 자기 대국.
- 🔬 정책별/잔여 카테고리별 실측 **이산 잔차 PMF**, Gaussian 대비 CRPS·NLL 미사용 시드 검증, 연구형 Win DP v3 확률예측 입력.
- 🔬 실제 12라운드 **PPO clipped objective + GAE + actor/critic + KL 교사** 두 모델, DP Expert·Win DP v2 상대 독립 확증.
- 성능이 검증되기 전에는 성과를 주장하지 않고 기존 Win DP v2·사용자 AI 기본값 보존. 자동 결과는 [PSRO](./_generated/PSRO-LATEST.md) · [PMF](./_generated/PMF-LATEST.md) · [PPO](./_generated/PPO-LATEST.md) 참조.

## PSRO-PMF-PPO 본 실험 판정 — 2026-11-20

- ✅ 실제 PSRO meta-game matrix와 restricted Nash fictitious play **구현 및 3회 oracle 확장**, 7개 정책 모집단에서 독립 평가. [최종 보고서](./PSRO-PPO-PMF-2026-11-20-FINAL.md).
- ✅ 정책별 경험적 이산 상대 점수분포 vs Gaussian **CRPS/NLL 미사용 시드 검증**, Greedy만 눈에 띄는 CRPS 개선, Win DP v2는 소폭 악화.
- ✅ **실제 full-game clipped PPO, GAE, value critic, teacher KL** 두 정책 각각 2,688경기 학습. 실제 Win DP v2 우위 미입증.
- ⚠️ PSRO restricted exploitability 수치는 **관찰된 정책 모집단의 경험적 행렬** 기준으로 세계 SOTA 또는 전체 게임 Nash가 아님.
- ⚠️ 상대 점수 PMF는 유한 시뮬레이션으로 학습한 **경험적 근사**이지 3개 이상 모든 주사위 경로의 정확 완전열거가 아님.
- 🔲 다음 연구는 상대 정책/점수판 조건부 **정확 3개+ PMF**, PSRO 응답 오라클 품질 및 모집단 메타게임 payoff 신뢰구간, PPO 다중 학습 시드·더 큰 학습 예산·복잡한 가치망.
- 🔒 기존 Win DP v2 유지, 명확한 독립 head-to-head 개선 없이는 기본 AI 배포 금지.

## PSRO 오라클·점수판 조건부 점수분포·PPO 다중 시드 확대 연구 (2026-11-20)

- [확장 연구 프로토콜](./EXTENDED-PSRO-PMF-PPO-RESEARCH.md): 이전 PSRO에서는 실제 oracle best-response가 기존 가장 강한 정책보다 좋다는 증거가 없었으므로 **각 단계의 원래 meta mixture에 대한 새 oracle−기존 정책의 독립 paired CI**로 검증.
- 기존 남은 카테고리 수만 조건으로 쓰던 Gaussian/PMF에서 **마스크·상단 누적·현재 점수·DP projected final-score 조건부 CART empirical PMF**로 확대, 정책별 650 train/200 validation/400 confirm 경기.
- **전체게임 PPO 학습 초기화 3회**, 정책별/시드별 **8,192게임**, PPO·DP teacher KL 두 모델 **총 49,152게임**. seed별 비감독 실험 편향 없이 모든 결과/분산 보고.
- 미사용 seed의 Win DP v2 직접 승률이 개선되지 않으면 현재 기본 Win DP v2 유지. 연구 실행 상태는 [확장 자동 워크플로](../../.github/workflows/psro-extended.yml) 및 [생성 결과](./_generated/PPO-MULTISEED-LATEST.md) 참조.

## 3시드 확장 PPO 연구 종료 및 판정 (2026-11-20)

- ✅ 3개 초기화×2개 PPO 모델×각 8192 full-game episodes = **49,152 학습경기**, 전체 미사용 시드 대결과 3시드 집계 성공.
- ✅ [종합 검증 결과](./EXTENDED-PSRO-PMF-PPO-RESULTS.md) · [원시 CI](https://github.com/oyueo-mm/YachtLab/actions/runs/44756143942).
- ⚠️ 기존 zero-neural reference가 validation 최고. 일반 PPO vs Win DP v2 3시드 평균 **48.222%**, 초기화 sd 3.076%p; **DP teacher KL PPO 평균 50.069%**, sd 0.296%p. KL은 안정성 징후가 있으나 강함 향상 입증 불가.
- 🔲 후속: 일반 PPO의 극단적 훈련시드 불안정 원인을 actor gradient/clipFraction/보상 분포, 서브리그 opponents, critic value error로 분리하고, KL β의 여러 시드 반복 및 실제 큰 네트워크 학습 검토.
- 🔒 상대점수 PMF는 Greedy 상대에서만 CRPS 개선, PSRO approximate best-response oracle 세 단계 모두 독립 우위 미입증. 기존 **Win DP v2 유지**.

## 2026-11-21 RL 5계열 비교와 PPO 2배 확대

- [구현/평가 범위 문서](./FULLGAME-OFFPOLICY-RESEARCH.md): Full 12-round **Double Dueling DQN + PER + 3-step**, fixed 16-quantile **QR-DQN**, full-game MC oracle **Expert Iteration**, exact-engine Dyna-Q, twin-Q **Discrete SAC**.
- **명칭 주의:** Rainbow-lite는 정식 Rainbow가 아니고, QR-DQN은 IQN과 다름. 나머지 5계열은 DP 고정 후보/후반 Win DP v2 폴백을 사용해 공정한 시작점을 보존.
- 학습 전후 각각 validation 및 independent confirmation Win DP v2/DP Expert 상대 대전을 기록. 실험 성공 전 성능 우위 주장 금지.
- [PPO 2배 추가 학습](./_generated/PPO-HIGH-BUDGET-LATEST.md): 3 seeds × 2 PPO variants × 128 batches × 128 full-game episodes = **98,304 학습게임**. 기존 49,152게임 연구와 비교하여 성능 변동/오버피팅/학습량 증가 효과 확인.
- GitHub Actions [통합 워크플로](../../.github/workflows/offpolicy-ppo-expanded.yml), 모델 가중치+원시 경기 결과 아티팩트 저장; **기본 Win DP v2 유지**.

## 2026-11-21: Win DP v3.1 연구용 하이브리드

- 🔬 [v3.1 연구 설계·정확성 범위](./V31-RESEARCH.md): v3의 3턴 조건부 Bellman + 최종턴 v2.1 정확 BR. 정확 BR은 고정된 v2/v3 마지막 턴 상대에게만 사용.
- 🔬 독립 비교: v3.1/v3 vs v2 동일 시드, v3.1 vs v3, DP Expert; 매주 신규 시드 감시·99% 근사 다중비교 구간. 연구 완성 및 확증 전 승률 우위 미확정.
- 🔒 사용자 기본 AI 및 DP 테이블은 보존. v3의 상대 분포 근사·전역 게임 이론 최적성 문제는 미해결.

## 2026-11-22: YachtLab Online v0.1

- ✅ Phase 1 — 서버 권한형 게임 엔진(`src/online/`): 2~8인 로비/진행/종료, 명령 검증·오류 코드, 멱등성·낙관적 동시성, CSPRNG 주사위, 이벤트 로그 재구성·위변조 검출, 플레이어별 공개 뷰, 턴 제한·기권. [설계·검증](../online/ONLINE-V01-PHASE1.md). **미배포.**
- ⏭ Phase 2 후보 — 방 단위 직렬 처리 전송 계층(WebSocket), 이벤트 로그 저장·스냅샷, 서버 알람 기반 턴 타이머, 인증·재접속, 온라인 UI. 플랫폼 리소스 생성·배포는 별도 승인 후.
- ✅ Phase 2 MVP(로컬, 미배포) — 친구 초대형 1:1: 게스트 닉네임·방 생성·초대 코드/링크·입장·시작·실시간 턴 동기화·고정/재굴림·점수·종료, 새로고침/재접속/서버 재시작 복구, 서버 턴 타이머, 남용 제한. 로컬 Node WebSocket 서버 + 4차 게임판·3D 연출 재사용. [D-020](./DECISIONS.md), [Phase 2](../online/ONLINE-V01-PHASE2.md)
- ✅ Phase 3(로컬, 미배포) — Workers + SQLite Durable Objects(방당 1개) + WebSocket Hibernation + 알람, 전역 디렉터리 DO(코드·방 수·속도 제한), 보존 기간 자동 정리. `wrangler dev --local`에서 두 브라우저 12라운드·재접속·재시작 복구 검증, 공식 무료 한도 기준 비용 분석. [D-021](./DECISIONS.md), [Phase 3](../online/ONLINE-V01-PHASE3.md)
- ✅ Phase 4 — 실제 배포(2026-11-23): `https://yachtlab-online.hoho96385210.workers.dev`, 공개 사이트 연결, 실서버·공개 사이트 두 브라우저 12라운드 검증, 공유 무료 한도 보호(하루 300방). [D-022](./DECISIONS.md), [Phase 4](../online/ONLINE-V01-PHASE4.md)
- ✅ 온라인 UX(2026-11-23): 홈 메인을 온라인 대전으로, 고정 선반 선택 순서 배치, 두 화면 주사위 상태 동기화(서버 공유 고정 순서), 초대 링크 바로 입장. [D-023](./DECISIONS.md)
- ✅ 모바일 UX·연출(2026-11-23): 태블릿·가로 점수판 잘림 수정, 중복 문구 정리, 휴대폰 추천 점수 1탭 기록, 선명한 3D(적응형)·물리 사전 계산, 효과음 v2, 요트 자동 강조, 온라인 입장음, 재접속 효과음 일괄 재생 수정. [D-024](./DECISIONS.md), [문서](../ui/MOBILE-FEEL-2026-11.md)
- ⏭ 다음 후보 — Cloudflare 대시보드 지표로 실제 사용량 확인·`DAILY_ROOM_LIMIT` 조정, WAF 속도 제한, 재대결·관전·3~8인 UI, 로그 HMAC/앵커링, 재접속 시 효과음 일괄 재생 수정. 실제 기기에서 3D fps·발열·효과음 청취 확인. 라지 스트레이트 약한 강조(제안).

## 2026-11-23: 게임 중심 UI 개편 (`feat/game-lobby-redesign`)

- ✅ 로비형 홈(온라인 대전 준비 중 / 오프라인 대전), 몰입형 게임 화면, 연구실 분리, 2.5D 주사위 연출·제스처, 합성 효과음·설정 저장, 족보 툴팁. [D-011](./DECISIONS.md)
- 📝 13칸 규칙 확장 설계만 작성: [규칙 확장 설계](../rules/RULESET-EXTENSION.md). 구현은 별도 승인 후.
- ✅ 2차: 오프라인 상세 설정(AI·사람), 게임 화면에서 설정 UI 제거, 홈 주사위 체험, 족보 도움말 정리, **3D 물리 주사위**(2.5D 대체 유지)와 충돌 기반 효과음, 주사위 실험실. [D-013](./DECISIONS.md), [D-014](./DECISIONS.md), [3D 주사위](../ui/DICE-3D.md)
- ✅ 3차: 시작 유도형 홈(체험 영역 제거), 3D 자유 착지 + 고정 선반, AI 모델 전수 조사·통합 선택기(대전 가능 19 / 조건부 11 / 연구 전용 12), 브라우저 뒤로 가기 이탈 확인. [D-015](./DECISIONS.md), [D-016](./DECISIONS.md), [모델 레지스트리](../ai/MODEL-REGISTRY.md)
- ✅ 4차: 더 강한 3D 던지기(`vigorous`, 속도 +40%·회전 1.8배·첫 충돌 +60%), 족보 완성 3D 연출, 무광 차콜 테이블, 버튼 체계(알약형 축소), 모바일 점수 기록 바 겹침 수정, 고정·해제 연타 안정화. [D-017](./DECISIONS.md), [D-018](./DECISIONS.md), [3D 주사위](../ui/DICE-3D.md)

- 📝 4차 후속 모바일 AI 대전 UI: 주사위판 우선 배치, 점수 기록/요약/보조 메뉴 순서 변경, 중복 턴·굴림 정보 숨김, 모바일 족보 3D 연출 축소. 새 PR에서 검증 후 배포 여부 결정. [D-019](./DECISIONS.md).

## 2026-11-24: 제품 Phase 1+2 후속 · Phase 3 온라인 소셜 · Phase 4 계정·게스트

> 제품 로드맵 번호(1 모바일 UX·성능 → 2 연출 → 3 온라인 소셜 → 4 계정·게스트 → 5 퀘스트·업적 → 6 재화·상점·꾸미기 → 7 AI 전략 복기 → 8 바이럴·경쟁 → 9 수익화 → 10 플랫폼 확장)이며, 위의 "Online v0.1 Phase 1~4"(서버 개발 단계)와 다르다. 현황·검증·백로그: **[제품 개발 현황](./PRODUCT-2026-11-24.md)**.

- ✅ PR A(#50): 첫 굴림 최악 프레임 133→83 ms(CPU 4배 에뮬레이션), 빠른 재굴림 사전 계산 0/8→8/8, 휴대폰 한 화면 UI·추천 점수 오조작 방지, 고정 순서 Hibernation 보존, 효과음 v3 후보(연구실). [D-025](./DECISIONS.md), [문서](../ui/PHASE-A-2026-11.md). ⚠️ 실기기·사람 청취 미검증.
- ✅ PR B(#51): 같은 방 재대결(새 matchId·선공 교대·일일 한도 포함), 프리셋 채팅 10·이모티콘 8(ID만, 저장 없음). [D-026](./DECISIONS.md)
- ✅ PR C(#52): 읽기 전용 관전(전원 동의·관전 키·방당 5명·즉시 철회). [D-027](./DECISIONS.md)
- ✅ PR D(#53): 닉네임 정책, 게스트 기기 기록·프로필·통계, 서버 검증 경기 기록(아웃박스·멱등), 사용자별 SQLite DO 계정 저장소, Google OIDC(PKCE) 로그인 코드 — **외부 설정 전까지 꺼짐**. [D-028](./DECISIONS.md), [설계·비용·설정 방법](../online/SOCIAL-AND-ACCOUNTS.md)
- 🔲 다음: 실기기 체크리스트, Google 로그인 활성화·실서버 확인, 대시보드 사용량으로 한도 조정, 첫 굴림 탭→첫 프레임, 제품 Phase 5(퀘스트·업적: `match.finished` 멱등 처리, server-verified만 보상).

## 제품 경제·온라인 후속 로드맵 (2026-11-24 경제 연구 반영)

연구: [경제 연구 보고서](../economy/ECONOMY-RESEARCH.md), 결정 D-029~D-033. 순서는 의존성 기준이며 각 단계는 별도 PR·CI·배포 게이트를 거친다.

| 단계 | 작업 | 상태 | 선행 조건·검증 |
|---|---|---|---|
| E0 | 경제 시뮬레이터·후보 모델 비교·가격 역산·퀘스트/업적 확률 | ✅ 연구 완료(실제 지급 없음) | `tests/economy.test.ts`, `#economy-lab` |
| E0b | 2차 검증: 정수안 M3i-W30, 강화 1:0.5:1, 신화 선택 결제, 경기당 쓰기 실측 | ✅ 연구 완료(D-034~D-037) | `#economy-lab` 추가 검증 탭 |
| E0c | Cloudflare 대시보드 실측(DO Duration·행 쓰기·요청) → 무료 최대 규모 확정 | 🔲 **최우선** | 대시보드 접근 필요(사용자) |
| E0d | 서버 저장 절감 B(턴 첫 굴림 병합) 구현·검증 | 🔲 | 공정성 테스트(결과 선별 불가) + 실측 |
| E1 | 서버 원장: 계정 DO에 지갑·원장(`matchId:playerId:rewardType` 멱등)·server-verified 경기 종료 이벤트 처리 | 🔲 | 로그인 활성화(외부 설정) 필요, 행 쓰기 측정 |
| E2 | 퀘스트·업적 엔진(일일 3·주간 3·하루 1회 교체·실력 구간 기준, 업적 확률표 표시), 재화는 표시만(상점 없음) | 🔲 | E1, 보상 수치는 보수적으로 시작(하향 금지 원칙), 상단 보너스 관련 보류 |
| E3 | 인벤토리 페이지·장착(loadout) 서버 공개·슬롯(이모티콘 4/8, 채팅 6/10) | 🔲 | E1, MATCHMAKING-SPECTATE-PLAN §4 |
| E4 | 상점 페이지(코인/보석/선택 결제)·확정 강화(Lv.3) | 🔲 | E1~E3, 실제 카탈로그·디자인 확정(이번엔 미확정) |
| E5 | 무작위 매칭 → 공개 관전 목록 | 🔲 | Cloudflare 무료 한도 재산정(아래) |
| E6 | 서버 검증 AI 대전(서명 전사 방식) | 🔲 | Workers CPU 10ms 안 DP 재생 측정 |
| E7 | 현금 결제 | 🔲 범위 밖 | 별도 승인·법무·환불 정책 |
| E8 | 실제 server-verified 기록으로 사용자 유형·숙련도·**실제 경기 시간** 재보정 후 시뮬레이터 재실행 | 🔲 | 출시 후 데이터 |

**주의(측정):** 현재 온라인 방은 경기당 약 120 행 쓰기라 무료 플랜 하루 방 300 한도에서 지속 사용자 수가 작다. 경제 처리는 쓰기를 약 13% 늘릴 뿐이며 병목은 방 저장 구조다. 무작위 매칭 도입 전에 방 저장 쓰기 감소(이벤트 묶음 저장 등) 또는 유료 전환 판단이 필요하다.

## 2026-11-24: 온라인 친구 다인전 2~20명 (PR #59)

- ✅ 방 생성 시 최대 인원 2~20, 초대 링크·코드, 게스트·회원, 대기실(참가자·준비·방장 권한·위임·자동 승계), 순차/동시 진행, 턴·라운드 제한 시간, 적응형 점수판·실시간/최종 순위, 다인 재대결, 장기 방치 방 정리, 경제·퀘스트·업적·기록 연동(server-verified, 단독 1위만 승리). 2인 빠른 대전·서버 AI 대전 유지. [D-044](./DECISIONS.md), [설계](../online/MULTIPLAYER.md)
- ⏭ 후속: 다인 방 관전 화면 배치 최적화, Workers 대시보드에서 20인 방 CPU·쓰기 실측 재확인, 20인 방이 하루 예산 10단위를 쓰는 정책의 실제 사용량 기반 조정.

## 2026-11-25: 게임 완성도·콘텐츠·친구 시스템 (PR #61 이후)

- ✅ A 온라인: 빠른 대전 공개 필수(D-045), 프로필 닉네임, 온라인 화면 간소화, 방 생명주기·`left` 기권(D-046), 3~20인 관전 화면 — PR #61 병합·Worker 배포.
- ✅ C 채팅·이모티콘 미전송 근본 원인 수정과 보드 하단 보내기 바(D-047), ✅ B PC 게임 화면(D-048), ✅ D 라지 스트레이트·결과 소리 후보(D-049), ✅ E–H 상점·인벤토리·실제 미리보기·아이템 200종(D-050), ✅ I/J 친구 목록·초대(D-051).
- ⏭ 후속: 결과 소리·라지 스트레이트·Lv.3 연출을 실제 휴대폰으로 들어/보고 기본값 확정, 2D 대체 화면의 주사위 무늬 표현, 외부 푸시 알림(범위 밖), 친구 수·검색 한도의 실제 사용량 기반 조정, 실제 Google 계정으로 친구·초대 사람 확인.

### 신규 플레이어 점수 기록과 모바일 점수표 (2026-11-25)

- 첫 실제 점수를 쓰기까지 경기 중 차례 안내가 표시된다. 첫 방문 튜토리얼과 반복할 수 있는 한 차례 연습은 [2026-11-26 후속 개선](./PRODUCT-2026-11-24.md#2026-11-26-최초-방문과-내비게이션)을 따른다.
- 점수 후보는 버튼, 기록된 점수는 읽기 전용으로 표시한다. 모바일 점수표는 기본 한 열과 두 열 선택지를 제공한다. 320px에서는 한 열을 사용한다.
- Chromium 모바일 크기 비교(360·375·390·412·430px)에서 점수 목록은 한 열 697px, 두 열 366.5px, 두 열 행 최소 54px이었다. 보드와 기록 버튼의 위치는 320×568~430×932 회귀 테스트로 확인한다.
## 2026-11-25: Win DP v5 연구 (연구 브랜치, [V5-APEX-RESEARCH](./V5-APEX-RESEARCH.md))

- ✅ 전 상태 정확 DP Expert PMF 은행(199,744 상태) + 독립 C++ 교차검증, 상단 정규화.
- ✅ 정확 PMF 롤아웃(v5-R) — 사전 규칙으로 Apex 주 후보 선택, 확증 결과는 RESULTS.
- ✅ 정확 2인 expectiminimax 종반(≤3칸 실시간, 4칸 복기용), 기존 독립 솔버와 1e-9 일치.
- ✅ 정확 우도 Bayesian 상대 필터(v5-D), VOI 조건부 depth-2(v5-E, 실패 보존), 잔차 가치 측정, 복기용 분석 인터페이스, 연구 워크플로.
- 🔲 다음 후보(우선순위 가설):
  1. **롤아웃의 기준 정책 개선** — 현재는 "이번 턴 최적화 + 이후 DP Expert". v5-R 자신의 미래를 근사하는 2단계 정책 반복(롤아웃 정책의 PMF는 상대 상태에 의존해 정확 은행이 불가능 → 상대 상태 요약 조건부 은행 또는 신경망 증류).
  2. **종반 창 확대의 실제 이득 재측정** — v5-B3−v5-R 차이를 확증 시드로 측정한 뒤, 4칸 창(복기용)을 같은 시드에서 대국 비교.
  3. **잔차 가치(릿지 MAE −17%)를 롤아웃 말단값 보정에 실제 적용**해 대국 성능 확인.
  4. 은행 메모리 축소(Float32 150 MB → 양자화/가치 증류)와 Web Worker + WASM 빌드(브라우저 측정).
  5. 외부 공개 AI 원본(12칸 규칙 동일)과의 직접 대결, 인간 기보 기반 상대 가설.
- 🔒 기본 AI·`src/ai.ts` 변경 없음. main 병합은 제품(Codex) 작업 완료 후.

## 2026-11-25: Win DP v6 연구 (연구 브랜치, [V6-APEX-RESEARCH](./V6-APEX-RESEARCH.md))

- ✅ PR #75(v5) 최종 검증 후 main 병합(`c543b8d`).
- ✅ 지수효용 λ-정책군 정확 PMF 은행 7종, v6-P/P3/P2/A3/A4/A6/PB3/L/Lm/C/D/Dd 구현·개발 대국. 개발에서는 우위가 보이지 않아 사전 규칙대로 v6-P를 확증 → **v6-P vs v5-R 직접 대결 50.131%(9511, 10만)·50.209%(9512, 4만) 유의**, 공통 상대 v2 이득은 미확정.
- ✅ WASM(자립형, 7 KB)·Rust PMF 생성기: TS 은행과 비트 동일. 브라우저 Web Worker 8.1 s(데스크톱 Chromium). 단일 복사 로더 RSS 677→379 MB.
- ✅ 양자화·꼬리 절단·증류의 **실제 결정** 영향 측정: Float32 손실 0, INT16 71 MB 최대 손실 5.9e-7, 신경망 증류·하이브리드는 부적합.
- ✅ 분석 API `yachtlab-analysis-v6`(승/무/패·굴림 전 가치·결정/운 분해) + 예제 데이터.
- ⏭️ 다음 우선순위:
  1. **상대 반응을 반영한 가치** — 정확 상호작용 가치(≤4칸)와 PMF 가치의 차이를 k>4로 외삽하는 방법(상대 반응 요약 특징, 경기 단위 분할), 또는 "상대도 정책군 중 최적 λ를 고르는" 반복 게임의 혼합 균형(RNR) 근사.
  2. 제품 통합 후보: v5-R + Float32(또는 INT16) 은행 + WASM 워커 생성 + IndexedDB 캐시(실기기 모바일 측정 필요).
  3. 미완료 기법(LightGBM/Cross-Attention/MCTS/RL 계열)은 PyTorch·LightGBM 사용 가능 환경에서 재개(§9 상태표).

## 2026-11-25: Win DP v7 연구 (연구 브랜치, [V7-APEX-RESEARCH](./V7-APEX-RESEARCH.md))

- ✅ 정확 결정 손실(regret) 벤치마크: 정확 상호작용 솔버(≤4칸)로 추정기 정책을 분산 0으로 비교.
- ✅ 상대 1턴 반응 정지가치 I1/I1R/I1O/I1RO 구현. 상대 반응이 v6-P 종반 손실을 약 절반으로 줄임(대조군 I1D는 개선 없음).
- ✅ v7-I1RO 사전 등록 확증: v6-P 직접 대결 9531 50.091%(Holm 보정 후 α=0.01 미달), 독립 재현 9541 50.136%(유의). 공통 상대 v2 이득은 미확정.
- ⏭️ 다음 우선순위:
  1. 새 시드 9551에서 v7-I1RO vs v6-P 추가 확증(20만 경기, 사전 등록).
  2. 반응 깊이 확장(I2: 상대 반응 뒤 내 반응까지), 상대 턴을 정책군 반응으로.
  3. 정확 솔버 양측 5칸 확장 → regret 범위 확장.
  4. I1RO Rust/WASM 포팅, 서버 상주 프로토타입(은행 7개 + I1RO).
  5. 경량 파생(I1RO-DP, 은행 1개)이 제품 v5-R을 대체할지 regret·대국으로 확인.
- 🔒 기본 AI·`src/ai.ts`·제품 코드 변경 없음.

### 2026-11-25 v7.1 진행 상황

- ✅ PR #89 병합(`b88c738`). v7 결론은 "작은 개선, 부분 확증".
- ✅ 추가 확증 사전 등록(9551~9553, 20만 경기, 검정력 0.92) → 실행 중.
- ✅ I2/I2R/I2RO(두 수 반응) 구현, 정확 regret에서 I1RO 손실을 60~70% 추가 감소.
- ✅ 정확 솔버 5·6칸 비용 측정, K=5 regret, 정확 교사 데이터 생성기, numpy 잔차 학습(외삽 실패 확인), 서버 실행 측정.
- ⏭️ 대기: 9551~9553 결과로 연구 최강 선정(성능 우선), I2RO/I2R 개발 대국 결과에 따라 I2 계열 확증 사전 등록(9561~).
- ⏭️ 미착수: I3 이상(가지치기 필요), 7칸 이상 정확 솔버(메모 개선), PyTorch 기반 신경망·Expert Iteration·Self-Play RL(환경 제약), Rust/WASM 포팅, SharedArrayBuffer 서버 프로토타입.

### 2026-11-25 v7.2 진행 상황 (브랜치 `claude/serene-planck-15tbo2`)

- ✅ 9551 H4 미채택(50.028%, p 0.152) → I1RO 부분 확증 유지.
- ✅ 트랙 A: 단일 은행 I2RO1·I2R1 구현, regret K=4/K=5에서 v5-R 손실 75~85% 감소(추가 메모리 0). 제품 주 후보 = I2RO1(사전 규칙).
- ✅ 트랙 A: 제품 확증 9571/9581 사전 등록·실행, Codex 인수인계 초안([V7-PRODUCT-HANDOFF](./V7-PRODUCT-HANDOFF.md)).
- ✅ 트랙 B: I3R/I3Rp(세 수 반응, 질량 가지치기) — regret I2R 대비 −45%. 창 변형 I3RpW4 개발 대국 등록(9108).
- ✅ 정확 솔버 해시 메모, K=7/6 첫 정확 루트.
- ⏭️ 대기: 9571/9581 판정 → 제품 교체 가능 여부. 9552/9553 판정(v7.1 세션 담당). 9108 I3 개발 → 확증 등록(9561~).
- ⏭️ 다음: 실기기 Android·iOS 측정(사용자 기기 필요), 경합 없는 브라우저·저사양 에뮬레이션 측정, K=6 교사 대량 생성(CI), I3 Rust/WASM 포팅, 결정 regret 기준 학습 평가.


### 2026-11-26 v7.1 마감

- ✅ 추가 확증 9551~9553 완료: I1RO/I1/I1R 모두 v6-P 대비 미채택 → 연구 최강 v6-P 유지(D-V7-3).
- ✅ I2 계열 개발 대국: I1RO 대비 우위 없음 → 확증 보류(D-V7-4).
- ⏭️ v8 우선순위: 중반(6~12칸) 결정 품질 — 6/6 교사 대량 생성·7칸 솔버, 표본 롤아웃 regret, 대국 검출력(Rust/WASM 엔진, 분산 감소). 9561~ 시드는 미사용.

### 2026-11-26 v7.2 제품 트랙 완료

- ✅ 무료 "매우 어려움" 최종 모델 I2RO1 선정(D-V7-5): v4-D 대비 확증·재현, v5-R과 대국상 동등. 인수인계: [V7-PRODUCT-HANDOFF](./V7-PRODUCT-HANDOFF.md).
- ⏭️ Codex: I2RO1 통합(기존 v5-R 시험판 경로에서 판단 함수만 교체), 실기기 Android·iOS 측정 후 기본값 교체 여부 결정.
- ⏭️ 연구: 9591 S3·S4(I2R1) 결과 기록. 종반 regret 개선이 대국 승률로 이어지지 않는 문제(이득 < 0.05%p/경기) → 중반 의사결정·상대 모델 쪽으로 연구 초점 이동 검토.
