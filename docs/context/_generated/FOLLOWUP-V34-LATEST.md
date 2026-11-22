# YachtLab 후속 절제 및 불확실성 연구 — v34

> 총 960경기, 시드쌍 선후공 교대 · 99% 짝별 정규 근사 CI. 탐색·Bayesian 정책과 딥러닝 SOTA는 구별해야 함.

| 후보 | 상대 | 경기 | 승리점수율 | 99% CI | 평균 판단 ms | 실제 롤아웃/탐색 | soft cap 초과 | 실제 상대 posterior |
|---|---|---:|---:|---|---:|---:|---:|---:|
| v34-legacy | Win DP v2 | 160 | 51.2500% | 46.6818%–55.8182% | 1.167 | 2.0 | 0 | — |
| v34-A | Win DP v2 | 160 | 50.6250% | 46.3423%–54.9077% | 1.784 | 16.0 | 16 | — |
| v34-B | Win DP v2 | 160 | 50.6250% | 46.3423%–54.9077% | 2.208 | 60.5 | 13 | — |
| v34-C | Win DP v2 | 160 | 50.6250% | 46.3423%–54.9077% | 12.272 | 69.2 | 219 | — |
| v34-D | Win DP v2 | 160 | 50.6250% | 46.3423%–54.9077% | 2.263 | 60.4 | 13 | — |
| v34-adaptive | Win DP v2 | 160 | 50.6250% | 46.3423%–54.9077% | 2.332 | 30.7 | 22 | — |

## 동일 시드 기준선과 차이

| 후보 | 상대 | 기준선 | 차이 | 99% CI | 결과가 달라진 시드쌍 |
|---|---|---|---:|---|---:|
| v34-A | Win DP v2 | v34-legacy | -0.6250%p | -2.2350%p–0.9850%p | 1/80 |
| v34-B | Win DP v2 | v34-legacy | -0.6250%p | -2.2350%p–0.9850%p | 1/80 |
| v34-C | Win DP v2 | v34-legacy | -0.6250%p | -2.2350%p–0.9850%p | 1/80 |
| v34-D | Win DP v2 | v34-legacy | -0.6250%p | -2.2350%p–0.9850%p | 1/80 |
| v34-adaptive | Win DP v2 | v34-legacy | -0.6250%p | -2.2350%p–0.9850%p | 1/80 |

## 한계 및 해석

- YachtLab Nintendo 12-category game, seat swapped and common seeds within each opponent
- All tests use separate seed ranges from the earlier 800k run; do not treat aggregate result as an independent training performance
- Bayesian v3.3 posterior assumes one stationary policy from a six-agent candidate family; Aggressive, Conservative and Random are simulated proxies, not real humans
- Random comparator uniformly samples legal action indices from independent seeded private policy RNG; no future dice or opponent RNG is exposed to learner
- v3.4 adaptive sample stopping is heuristic rather than anytime-valid 99% confidence bound
- A vs B hold exactly the same archived v4 actor weights; C/D/E are new models trained with isolated imitation, REINFORCE, or joint updates
- Each 99% CI is per planned contrast; multiple comparisons/selection require correction before SOTA claims
- No default deployment or claim of improvement without independent holdout

GitHub Actions `followup-v34-*` 아티팩트에서 원시 시드쌍 결과 확인.
