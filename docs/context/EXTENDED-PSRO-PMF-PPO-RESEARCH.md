# PSRO 오라클 독립 검증·점수판 조건부 점수분포·대규모 다중 시드 PPO

> 2026-11-20 확장 연구 프로토콜. **이 문서의 계획값은 성적이 아니다.** 실제 결과는 성공한 CI 및 docs/context/_generated의 근거로 확인한다. 닌텐도식 요트다이스 12개 카테고리 기준.

## 이전 연구에서 확인한 한계

- [기존 PSRO/PMF/PPO 실험 보고서](./PSRO-PPO-PMF-2026-11-20-FINAL.md)에서 PSRO mix vs Win DP v2 2,400게임 **49.4375%**, PPO vs Win DP v2 3,200게임 **49.5313%**, Win DP v3 PMF vs Win DP v2 400게임 **49.375%**. 세 결과 모두 95% 짝별 근사 CI에 50% 포함.
- 제한 메타게임 exploitability **0.0002289**는 학습 정책 7개 사이의 값이며, **오라클이 실제로 강한 best response인지**를 직접 검증한 수치는 아니다.
- 이전 상대 분포는 정책과 남은 카테고리 수만 조건으로 썼고, 실제 점수판 마스크/상단 보너스 상태를 구별하지 않았다. Greedy에서는 CRPS가 개선됐지만 Win DP v2에서는 미미하게 악화.
- PPO는 변형당 **2,688 full-game 학습경기 단일 초기화**였으므로 seed variance/다중 초기화 일반화가 불분명하다.

## A. PSRO 오라클의 실제 대응 품질

- 코드: [독립시드 oracle audit](../../scripts/audit-psro-oracles.mjs), [기존 메타게임 실제 학습](../../scripts/research-psro.mjs), [Nash restricted solver](../../src/psro-meta.ts).
- 기존 empirical PSRO를 학습 시드로 재생해 각 단계의 메타게임 혼합 분포, ES oracle, 기존 정책 모집단을 동결.
- **훈련 시드·행렬 추정 시드와 분리된 320 seed pairs × 선후공 2게임**을 단계별로 적용.
- 고정 mixture에서 새 oracle과 그 단계의 기존 후보 중 **학습 메타 행렬에서만 선정한 가장 강한 incumbent** 및 Win DP v2를 **동일한 혼합 상대 샘플·시드**로 평가.
- 정책별 승리 점수율과 **oracle−incumbent paired difference**의 95% 정규 근사 CI 계산. 미포함 양수일 때만 해당 표본에서 대응 품질 증가 주장.
- 별도 정책 **Greedy**는 오라클 학습 모집단에 없던 상대이므로, 학습 혼합을 벗어난 일반화 검사로 추가. Greedy 상대 우위만으로 meta-game Nash 대응 성능 확증이 아님.
- 결과: [PSRO 오라클 audit](./_generated/PSRO-ORACLE-AUDIT.md) 및 원시 per-seed 결과 Actions Artifact.

**정확성 한계:** 오라클은 실제 게임 중 최적의 정책 전체를 완전 탐색하지 않는 진화적 ES 근사다. 진짜 Nash exploitability나 best-response regret 상계는 얻지 못한다.

## B. 점수판 조건부 상대 최종점수 PMF

- 핵심 라이브러리 [scorecard conditional PMF](../../src/conditional-score-pmf.ts), [전체 연구 러너](../../scripts/research-scorecard-pmf.mjs), [Win DP v3 forecast](../../src/competitive-v3.ts).
- 조건부 입력: **열려있는 12개 점수칸 비트마스크**, 남은 카테고리 수, **상단 누적점수**, 현재 확정 총점, 정확한 DP의 **예상 최종 총점**.
- 모형: 각 남은 카테고리 수(3~12)에 대해 이진 점수칸 유무/점수 임계값을 기준으로 최대 3단계 CART 분할. 리프의 실제 총점 잔차 이산 히스토그램을 Gaussian kernel로 평활하고, 작은 표본은 무조건부 prior로 수축(shrinkage).
- 학습: 상대 정책(DP Expert/Win DP v2/Greedy)별 **650게임**. 하이퍼파라미터 선택 별도 **200게임**, 최종 미사용 확증 **400게임**.
- 진짜 총점 분포 예측 점수: 정규분포, 기존 남은 카테고리만 사용하는 이산 PMF, **점수판 조건부 PMF**의 CRPS·discrete NLL 직접 비교. **하나의 게임에서 수집한 라운드 10개는 종속 표본**이므로 게임별 차이의 CI를 사용.
- 후반 3카테고리 Win DP v3에 실제로 조건부 PMF를 넣어 Win DP v2, v3 Gaussian, DP Expert와 선후공 대전해 별도 검증.
- 결과: [조건부 PMF 독립 확증](./_generated/SCORECARD-PMF-LATEST.md).

**정확성 한계:** 이것은 시뮬레이션에서 배운 **경험적 점수 분포**다. 상대의 모든 주사위 경로를 마스크/상단 점수별로 전부 열거한 *정확한 분포 DP*는 아니다. 정확한 모델로 부르지 않으며 Win DP v2 CRPS가 실제 줄어야 개선이라고 말할 수 있다.

## C. PPO 다중 초기화·대규모 학습

- 학습: [PPO multiseed runner](../../scripts/train-ppo-multiseed.mjs), [다중 시드 결과 집계](../../scripts/summarize-ppo-multiseed.mjs).
- 정책 2가지: **일반 clipped PPO**와 **PPO + DP teacher-KL**. 공통 강한 기준 정책으로 학습하지 않은 zero-residual neural을 유지.
- 학습 초기화와 주사위 시드가 다른 **3회 반복(seed-index 0·1·2)**. 정책별 반복당 **64배치×128게임=8,192 전체 12라운드 경기**, 총 **49,152 실제 학습게임** (기존의 약 9.14배 총 연구 학습량).
- 실행 비용을 관리하기 위해 GitHub Actions matrix 3개 병렬 job. 각각 PSRO에서 훈련한 **같은 제한 메타게임 혼합분포**를 이용하지만 서로 다른 신경망 초기값, 게임 훈련·validation·확증 시드를 사용.
- PPO의 **clipped ratio ε=.2, GAE λ=.95, critic, minibatch 3epochs, Adam**, DP teacher-KL 버전 분리. 각 배치의 old log probability를 동결하고 모델을 여러 번 갱신.
- **각 학습 시드마다 두 PPO 모델과 zero-residual 기준을 동일한 독립 확인용 seed에서 Win DP v2·DP Expert 각각 1,200경기 평가**. **모든 모델의 미사용 확증 성적을 공개**해 안 좋은 학습 시드를 숨기지 않는다.
- 모델 변형 하나의 선택은 3개 validation 평균으로만 하고 최종 확증 승률로 재선택하지 않음.
- 최종 집계는 (a) 3학습 시드 평균/표준편차와 자유도2 t근사 구간, (b) 학습시드 고정 조건에서 양 좌석 교대 게임쌍의 근사 CI를 함께 기록. n=3개 훈련 시드 CI 불확실성은 매우 큼.
- 결과: [다중 시드 PPO 최종 보고](./_generated/PPO-MULTISEED-LATEST.md) 및 [각 시드별 학습 요약](./_generated/PPO-MULTISEED-0.md).

## CI·재현·채택 기준

[확장 PSRO/PMF/PPO GitHub Actions](../../.github/workflows/psro-extended.yml):
1. PR: 모든 단위 테스트 + 소규모 실제 게임 파이프라인 + seed 0/1/2 스모크와 통합 집계.
2. main: PSRO 재현/오라클 평가, 조건부 PMF, 3개 PPO 병렬 대규모 학습, 결과 aggregation.
3. 연구 raw JSON, 약식 모델/정책 가중치, 실험별 개별 대국, 시드 및 파라미터는 90일 Actions 아티팩트 6개에 저장.
4. 성공 시 docs/context/_generated 결과 요약을 자동 commit해 새 채팅에서도 복구 가능한 맥락으로 남김.

**배포 게이트:** 기본 AI는 계속 Win DP v2다. PSRO 오라클의 실제 대응 품질, Win DP v2의 상대 PMF CRPS, 훈련 시드 간 PPO 성능과 독립 대전 개선이 입증되어야 새 AI의 기본 모델 전환을 검토한다. 결과가 미완료이거나 실패했다면 미완료/음성 결과 그대로 기록한다.
