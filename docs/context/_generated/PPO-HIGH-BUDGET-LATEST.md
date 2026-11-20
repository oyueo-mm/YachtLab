# 전체 게임 PPO 학습량 추가 2배 확대·3개 독립 시드 종합 보고

> 일반 PPO, PPO + DP teacher KL 각각 세 개 초기화에서 실제 12라운드 경기로 학습. **강한 AI 판정은 Win DP v2 직접 검증이 우선**.

- 전체 학습게임: **98,304** (PPO 각 16,384경기 × 2 변형 × 3 시드).
- 후보 선택(세 시드 validation 성적 평균): **Zero-neural reference**. 모델마다 final seed를 교차 선택하지 않음.
- 신뢰구간은 (1) 경기별 쌍 표본에 대한 정규 근사, (2) 3개 **독립 훈련 시드** 평균에 대한 t(2) 구간을 함께 표시.

## 독립 확증 — 모든 후보 공개

| 후보 | 상대 | 3개 훈련시드 평균 | 훈련시드 평균 95% t(2) 구간 | 총 대국쌍 | 조건부 경기별 95% CI |
|---|---|---:|---:|---:|---:|
| Zero-neural reference | Win DP v2 | 50.083% | 48.538%–51.629% | 1800 | 49.605%–50.561% |
| Zero-neural reference | DP Expert | 50.153% | 48.596%–51.710% | 1800 | 49.415%–50.891% |
| Full-game clipped PPO | Win DP v2 | 47.361% | 43.887%–50.835% | 1800 | 46.074%–48.649% |
| Full-game clipped PPO | DP Expert | 50.083% | 49.359%–50.808% | 1800 | 48.739%–51.428% |
| Full-game clipped PPO + DP teacher KL | Win DP v2 | 49.431% | 46.759%–52.102% | 1800 | 48.445%–50.416% |
| Full-game clipped PPO + DP teacher KL | DP Expert | 50.889% | 49.165%–52.613% | 1800 | 49.824%–51.954% |

## 학습 시드별 성적(Win DP v2 대상)

| 모델 | Seed 0 | Seed 1 | Seed 2 |
|---|---:|---:|---:|
| Zero-neural reference | 50.333% | 49.375% | 50.542% |
| Full-game clipped PPO | 46.958% | 46.208% | 48.917% |
| Full-game clipped PPO + DP teacher KL | 48.708% | 50.667% | 48.917% |

## 해석 및 제한

- Three separately initialized actors per PPO variant; training dice seeds, validation seeds and untouched confirmation seed sets are offset by one million per seed index.
- Each PPO variant and baseline is evaluated on the same untouched seed range within each training seed; no trial was selected based on final confirmation.
- Selection of a variant is based exclusively on pooled validation across training seeds. Final results for all variants are shown to avoid hiding failed variants.
- The t-based 95% intervals use only THREE training initializations (df=2) and are extremely uncertain; paired-game normal intervals condition on these fitted models.
- The PPO actor is a small neural residual anchored in DP; last two categories use Win DP v2. Hyperparameter optimization was not exhaustive.
- No claim of Nash optimality or broader SOTA. A win-credit confidence interval including 0.5 is not proof of equivalence.
- The PSRO population used for training was constructed from separate game seeds and all opponent strategies are public observation only.

- 학습/validation/확증 raw game JSON과 신경망 가중치는 각 Actions ppo-high-budget-seed-0/1/2 아티팩트에 보존.
