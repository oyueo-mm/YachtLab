# 상대 점수분포 — 실측 비정규 이산 확률분포

> 실제 게임 기반 잔차 histogram/KDE vs Gaussian, 훈련·선택·확증 세 시드 구간 완전 분리.

- source SHA: 6e3968befa49e57f7168e3f10296ae840dde9942
- 정책별 350 훈련게임, 180 대역폭 선택게임, 320 미사용 최종 확증게임.
- CRPS가 **낮을수록 정확한 확률 예측**. 음수 개선은 오히려 악화됨.

| 상대 정책 | Gaussian CRPS | 이산 PMF CRPS | Gaussian - PMF | Gaussian NLL | PMF NLL |
|---|---:|---:|---:|---:|---:|
| DP Expert | 18.2201 | 18.2191 | 0.0010 | 4.8840 | 4.8791 |
| Win DP v2 | 17.4464 | 17.4499 | -0.0035 | 4.8422 | 4.8383 |
| Greedy | 15.0835 | 14.9413 | 0.1422 | 4.7041 | 4.6373 |

## PMF 보조 Win DP v3 직접 경기

| 후보 | 상대 | 게임 | 승리 점수율 | paired 95% 근사 CI |
|---|---|---:|---:|---|
| Win DP v3 PMF | Win DP v2 | 400 | 49.375% | 47.589%–51.161% |
| Win DP v3 PMF | Win DP v3 Gaussian | 200 | 50.000% | 50.000%–50.000% |
| Win DP v3 PMF | DP Expert | 240 | 49.792% | 47.298%–52.286% |

## 한계

- PMF is sampled from policy-specific complete games; it is not exact enumeration.
- Model conditions only on policy and number of remaining categories; scorecard mask, opponent adaptation and upper-bonus state shift residuals.
- Forecast of final score is discretized by rounding projected DP expected score plus integer residual; ties in discrete game treated as half win.
- CRPS is approximate discrete-bin CRPS over residual [-160,160]; endpoint clipping and kernel tuning may influence results.
- Only select PMF as better when untouched confirmation test CRPS actually decreases.
- Win DP v3 has exact own-three-turn DP conditional on an approximate opponent model; this is not an exact full-game Nash solution.

- 전체 정책별 잔차 확률분포와 개별 대전 결과는 GitHub Actions `opponent-empirical-pmf` 아티팩트의 JSON 참조.
