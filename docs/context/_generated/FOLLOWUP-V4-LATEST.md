# YachtLab 후속 절제 및 불확실성 연구 — v4

> 총 1,000,000경기, 시드쌍 선후공 교대 · 99% 짝별 정규 근사 CI. 탐색·Bayesian 정책과 딥러닝 SOTA는 구별해야 함.

| 후보 | 상대 | 경기 | 승리점수율 | 99% CI | 평균 판단 ms | 실제 롤아웃/탐색 | soft cap 초과 | 실제 상대 posterior |
|---|---|---:|---:|---|---:|---:|---:|---:|
| v4-A | Win DP v2 | 200,000 | 50.0853% | 49.8729%–50.2976% | 0.944 | — | 0 | — |
| v4-B | Win DP v2 | 200,000 | 50.0178% | 49.8051%–50.2304% | 1.129 | — | 0 | — |
| v4-C | Win DP v2 | 200,000 | 50.1025% | 49.8911%–50.3139% | 1.027 | — | 0 | — |
| v4-D | Win DP v2 | 200,000 | 50.2522% | 50.1436%–50.3609% | 0.984 | — | 0 | — |
| v4-E | Win DP v2 | 200,000 | 50.1112% | 49.8999%–50.3226% | 0.994 | — | 0 | — |

## 동일 시드 기준선과 차이

| 후보 | 상대 | 기준선 | 차이 | 99% CI | 결과가 달라진 시드쌍 |
|---|---|---|---:|---|---:|
| v4-B | Win DP v2 | v4-A | -0.0675%p | -0.1136%p–-0.0214%p | 1385/100000 |
| v4-C | Win DP v2 | v4-A | 0.0172%p | -0.0406%p–0.0751%p | 2115/100000 |
| v4-D | Win DP v2 | v4-A | 0.1670%p | -0.0547%p–0.3887%p | 28596/100000 |
| v4-E | Win DP v2 | v4-A | 0.0260%p | -0.0499%p–0.1019%p | 3610/100000 |

## 한계 및 해석

- YachtLab Nintendo 12-category game, seat swapped and common seeds within each opponent
- All tests use separate seed ranges from the earlier 800k run; do not treat aggregate result as an independent training performance
- Bayesian v3.3 posterior assumes one stationary policy from a six-agent candidate family; Aggressive, Conservative and Random are simulated proxies, not real humans
- Random comparator uniformly samples legal action indices from independent seeded private policy RNG; no future dice or opponent RNG is exposed to learner
- v3.4 adaptive sample stopping is heuristic rather than anytime-valid 99% confidence bound
- A vs B hold exactly the same archived v4 actor weights; C/D/E are new models trained with isolated imitation, REINFORCE, or joint updates
- Each 99% CI is per planned contrast; multiple comparisons/selection require correction before SOTA claims
- No default deployment or claim of improvement without independent holdout

GitHub Actions `followup-v4-*` 아티팩트에서 원시 시드쌍 결과 확인.
