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
- ⏭ 다음 후보 — Cloudflare 대시보드 지표로 실제 사용량 확인·`DAILY_ROOM_LIMIT` 조정, WAF 속도 제한, 재대결·관전·3~8인 UI, 로그 HMAC/앵커링, 재접속 시 효과음 일괄 재생 수정.

## 2026-11-23: 게임 중심 UI 개편 (`feat/game-lobby-redesign`)

- ✅ 로비형 홈(온라인 대전 준비 중 / 오프라인 대전), 몰입형 게임 화면, 연구실 분리, 2.5D 주사위 연출·제스처, 합성 효과음·설정 저장, 족보 툴팁. [D-011](./DECISIONS.md)
- 📝 13칸 규칙 확장 설계만 작성: [규칙 확장 설계](../rules/RULESET-EXTENSION.md). 구현은 별도 승인 후.
- ✅ 2차: 오프라인 상세 설정(AI·사람), 게임 화면에서 설정 UI 제거, 홈 주사위 체험, 족보 도움말 정리, **3D 물리 주사위**(2.5D 대체 유지)와 충돌 기반 효과음, 주사위 실험실. [D-013](./DECISIONS.md), [D-014](./DECISIONS.md), [3D 주사위](../ui/DICE-3D.md)
- ✅ 3차: 시작 유도형 홈(체험 영역 제거), 3D 자유 착지 + 고정 선반, AI 모델 전수 조사·통합 선택기(대전 가능 19 / 조건부 11 / 연구 전용 12), 브라우저 뒤로 가기 이탈 확인. [D-015](./DECISIONS.md), [D-016](./DECISIONS.md), [모델 레지스트리](../ai/MODEL-REGISTRY.md)
- ✅ 4차: 더 강한 3D 던지기(`vigorous`, 속도 +40%·회전 1.8배·첫 충돌 +60%), 족보 완성 3D 연출, 무광 차콜 테이블, 버튼 체계(알약형 축소), 모바일 점수 기록 바 겹침 수정, 고정·해제 연타 안정화. [D-017](./DECISIONS.md), [D-018](./DECISIONS.md), [3D 주사위](../ui/DICE-3D.md)

- 📝 4차 후속 모바일 AI 대전 UI: 주사위판 우선 배치, 점수 기록/요약/보조 메뉴 순서 변경, 중복 턴·굴림 정보 숨김, 모바일 족보 3D 연출 축소. 새 PR에서 검증 후 배포 여부 결정. [D-019](./DECISIONS.md).
