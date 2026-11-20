# YachtLab 2026-11-20 확장 연구 — 실제 독립 검증 결과

> 원칙: 실제 12카테고리 닌텐도식 Yacht Dice, 5개 주사위, 턴당 최대 3회, upper 63점 +35점. 최종 승리 점수율은 승리 1/무승부 0.5/패배 0. **Win DP v2를 능가한 새로운 경쟁 AI의 우위는 현재 확인되지 않았다.**

## 코드·연구 증거

- 구현: [PR #15 — PSRO 오라클·상태별 확률분포·PPO 여러 시드](https://github.com/oyueo-mm/YachtLab/pull/15), main merge `6f822441cd3d2683fd49f6875dccbf6b53f34278`.
- [확장 연구 설계 및 평가 프로토콜](./EXTENDED-PSRO-PMF-PPO-RESEARCH.md)
- [확장 본 실험 GitHub Actions](https://github.com/oyueo-mm/YachtLab/actions/runs/44756143942); [GitHub Pages 배포 검증](https://github.com/oyueo-mm/YachtLab/actions/runs/44756143900).
- 소규모 PR 파이프라인 PSRO, PMF, 3×PPO, 수학 테스트와 통합 집계 완료: [PR CI](https://github.com/oyueo-mm/YachtLab/actions/runs/44755609428).
- 해당 실행의 raw scorecards/예측기/행렬/가중치는 Actions 아티팩트, 간결한 결과는 `docs/context/_generated/`에 CI가 자동 갱신함.

## 1. PSRO approximate best-response 오라클 독립 품질 평가 (성공한 본 실험)

기존 7개 정책 PSRO 모델(첫 4개 기본 정책 + ES 근사 오라클 3개)을 같은 결정적 시드로 재현했다. 각 오라클 탄생 당시의 meta-mixture와 기존 모집단을 동결하고, **훈련과 다른 320개의 paired seed × 선후공 두 대국**으로 평가했다.

각 단계의 기존 비교 정책은 *원래 학습 meta-game 행렬에서* 가장 높은 기대 payoff 정책을 선택했다. **새 독립 평가를 보고 비교 정책을 재선택하지 않았음**. 새 오라클과 기존 정책은 같은 상대 샘플과 시드를 사용했다.

| 단계 | 새 오라클의 meta-mixture 상대 승리점수율 | 비교 기존 정책 | 새 오라클 − 기존 정책 | paired 95% 근사 CI |
|---|---:|---|---:|---|
| oracle 0 | 48.9844% | risk-seeking residual | **−1.0156%p** | **−3.9755~+1.9442%p** |
| oracle 1 | 50.8594% | PSRO oracle 0 | **+0.8594%p** | **−2.3158~+4.0345%p** |
| oracle 2 | 52.4219% | upper-bonus residual | **+2.1094%p** | **−1.0364~+5.2551%p** |

**판정:** 셋 모두 CI에 0 포함. 새 오라클의 실제 independent best-response **개선 미입증**. 세 번째의 +2.11%p는 흥미로운 탐색 신호이지 확증 성과가 아니다.

훈련 모집단에 없던 Greedy 상대는 oracle 0/1/2가 각각 **74.297%, 74.531%, 73.203%**였다(동일 320 seed pairs). 그러나 Greedy 상대 점수만으로 강한 경쟁 정책 대응이나 전체게임 Nash가 입증되지는 않는다.

원시 결과: [PSRO 오라클 자동 보고서](./_generated/PSRO-ORACLE-AUDIT.md), `training/results/psro-oracle-audit.json` Actions artifact.

## 2. 점수판 상태까지 조건으로 사용한 상대 최종 점수 경험적 PMF (성공한 본 실험)

정규분포/기존 unconditional PMF의 조건이 상대 이름·남은 카테고리 수뿐이라는 한계를 개선하려고, **열린 12개 카테고리 비트마스크, 상단 점수, 현재 총점, 단독 DP 미래 기대점수 기반 예상 최종점수**로 CART-like 조건부 잔차 분포를 학습.

- 각 상대 정책(DP Expert, Win DP v2, Greedy)마다 **650 학습/200 모델 선택/400 독립 평가 실제 게임**.
- 리프의 이산 잔차 히스토그램을 Gaussian kernel로 평활, 데이터가 적을 때 같은 남은 카테고리 수의 전역 prior로 shrinkage. 조건은 maxDepth 3로 제한.
- CRPS와 음의 로그우도(NLL)는 **낮을수록 좋은 확률 예측 척도**.
- 한 게임의 여러 라운드는 종속 관측이므로 **400게임 단위의 paired CRPS 차이**에 95% 근사 CI를 계산.

| 상대 | Gaussian CRPS | 기존 무조건부 PMF CRPS | 새 점수판 조건부 PMF CRPS | Gaussian − 새 PMF CRPS (game-clustered 95% CI) |
|---|---:|---:|---:|---|
| DP Expert | 17.6306 | **17.6193** | 17.6371 | −0.0065 (−0.0548~+0.0418) |
| Win DP v2 | 17.8672 | **17.8452** | 17.8908 | −0.0236 (−0.0790~+0.0318) |
| Greedy | 15.0158 | 14.8573 | **14.7389** | **+0.2769 (+0.1840~+0.3698)** |

**판정:** Greedy의 조건부 예측은 독립 평가에서 확실히 개선. 강한 Win DP v2와 DP Expert에서는 **개선 미입증**; 특히 남은 카테고리만 사용하는 기존 PMF보다도 조건부 예측이 나빴음. 성능 향상이 상대 정책에 따라 달라진다.

그 조건부 PMF를 사용하는 실험용 **Win DP v3**의 대전:
- vs Win DP v2 **240경기 47.0833%** (paired 95% CI **44.751~49.416%**).
- vs DP Expert **200경기 47.7500%** (CI **45.230~50.270%**).
- vs Gaussian Win DP v3 **120경기 50.000%** (동일 평가 주사위 시드에서는 동률).

표본은 작고 여러 가설을 시험했으므로 별도 대규모 연구 없이 열세라고 일반화하지 않으나, **기존 Win DP v2 교체 근거는 없음**. **경험적 PMF는 정확한 모든 미래 주사위 경로의 전개가 아님**을 명시.

원시 분포/평가표: [점수판 조건부 PMF 자동 결과](./_generated/SCORECARD-PMF-LATEST.md), `training/results/scorecard-conditional-pmf.json` Actions artifact.

## 3. 전체게임 PPO 다중 초기화·확대 학습

각 PPO 변형을 **3개 독립 초기화에서 각 8,192 full-game 경기**로 학습해 총 **49,152 실제 게임 훈련**을 수행하도록 구현했다. 기존 single-seed 2,688게임/모델 연구와 달리 training seed variance, 학습하지 않은 strong zero-residual 기준, Win DP v2와의 정면 경기까지 다같이 보고한다.

- [동일 PSRO 혼합 모집단 상대 PPO/교사 KL 확장 프로토콜](./EXTENDED-PSRO-PMF-PPO-RESEARCH.md)
- [확장 PPO 3시드 자동 집계](./_generated/PPO-MULTISEED-LATEST.md)

**확장 PPO 본실험 결과는 위 Actions가 성공하여 3개 학습 시드와 미사용 확증을 모두 집계할 때 확정한다.** 이 항목은 실행 중인 동안 결과를 임의로 추측해 기록하지 않는다.

## 최종 승률 정책 및 연구적 경계

- 기본 게임의 **Win DP v2 보존**, 기존 AI 사이트와 연구용 코드의 배포를 구분.
- 이번 PSRO 오라클은 제한된 모집단의 PSRO 메타게임으로 평가. `restricted exploitability` 수치는 **전체 12라운드 Nash exploitability가 아니다**.
- 상대 PMF는 현 데이터와 상대 전략을 조건으로 하는 경험적 예측기. 스코어카드 마스크를 추가했다고 모든 상대에 성능 향상이 보장되지 않는다.
- 독립 대전·반복 시드에서 확실한 우위가 있을 때만 기본 AI 교체 검토.
