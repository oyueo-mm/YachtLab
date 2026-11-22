# YachtLab 후속 절제 및 불확실성 연구 — v33

> 총 7,200경기, 시드쌍 선후공 교대 · 99% 짝별 정규 근사 CI. 탐색·Bayesian 정책과 딥러닝 SOTA는 구별해야 함.

| 후보 | 상대 | 경기 | 승리점수율 | 99% CI | 평균 판단 ms | 실제 롤아웃/탐색 | soft cap 초과 | 실제 상대 posterior |
|---|---|---:|---:|---|---:|---:|---:|---:|
| v3-baseline | Win DP v2 | 400 | 50.0000% | 48.4186%–51.5814% | 0.957 | — | 0 | — |
| v33-known | Win DP v2 | 400 | 50.1250% | 48.5111%–51.7389% | 1.171 | — | 0 | — |
| v33-belief | Win DP v2 | 400 | 49.5000% | 48.2120%–50.7880% | 2.144 | — | 0 | 0.3783 |
| v3-baseline | Win DP v3 | 400 | 50.0000% | 50.0000%–50.0000% | 0.484 | — | 0 | — |
| v33-known | Win DP v3 | 400 | 50.0000% | 50.0000%–50.0000% | 0.787 | — | 0 | — |
| v33-belief | Win DP v3 | 400 | 49.5000% | 48.5915%–50.4085% | 1.141 | — | 0 | 0.4931 |
| v3-baseline | DP Expert | 400 | 50.8750% | 48.3589%–53.3911% | 1.039 | — | 0 | — |
| v33-known | DP Expert | 400 | 51.2500% | 48.7185%–53.7815% | 1.451 | — | 0 | — |
| v33-belief | DP Expert | 400 | 50.2500% | 47.7500%–52.7500% | 2.265 | — | 0 | 0.5031 |
| v3-baseline | Aggressive | 400 | 49.8750% | 46.2087%–53.5413% | 1.341 | — | 0 | — |
| v33-known | Aggressive | 400 | 49.8750% | 46.2087%–53.5413% | 0.354 | — | 0 | — |
| v33-belief | Aggressive | 400 | 49.3750% | 45.5984%–53.1516% | 2.149 | — | 0 | 0.9088 |
| v3-baseline | Conservative | 400 | 49.5000% | 45.6816%–53.3184% | 0.957 | — | 0 | — |
| v33-known | Conservative | 400 | 48.8750% | 44.9933%–52.7567% | 0.316 | — | 0 | — |
| v33-belief | Conservative | 400 | 48.5000% | 44.5824%–52.4176% | 2.117 | — | 0 | 0.7084 |
| v3-baseline | Random | 400 | 100.0000% | 100.0000%–100.0000% | 1.602 | — | 0 | — |
| v33-known | Random | 400 | 100.0000% | 100.0000%–100.0000% | 0.907 | — | 0 | — |
| v33-belief | Random | 400 | 100.0000% | 100.0000%–100.0000% | 2.218 | — | 0 | 1.0000 |

## 동일 시드 기준선과 차이

| 후보 | 상대 | 기준선 | 차이 | 99% CI | 결과가 달라진 시드쌍 |
|---|---|---|---:|---|---:|
| v33-known | Win DP v2 | v3-baseline | 0.1250%p | -0.1970%p–0.4470%p | 1/200 |
| v33-belief | Win DP v2 | v3-baseline | -0.5000%p | -1.4085%p–0.4085%p | 2/200 |
| v33-known | Win DP v3 | v3-baseline | 0.0000%p | 0.0000%p–0.0000%p | 0/200 |
| v33-belief | Win DP v3 | v3-baseline | -0.5000%p | -1.4085%p–0.4085%p | 2/200 |
| v33-known | DP Expert | v3-baseline | 0.3750%p | -0.5910%p–1.3410%p | 3/200 |
| v33-belief | DP Expert | v3-baseline | -0.6250%p | -1.5867%p–0.3367%p | 3/200 |
| v33-known | Aggressive | v3-baseline | 0.0000%p | -1.2912%p–1.2912%p | 4/200 |
| v33-belief | Aggressive | v3-baseline | -0.5000%p | -1.4085%p–0.4085%p | 2/200 |
| v33-known | Conservative | v3-baseline | -0.6250%p | -2.5852%p–1.3352%p | 10/200 |
| v33-belief | Conservative | v3-baseline | -1.0000%p | -2.5709%p–0.5709%p | 6/200 |
| v33-known | Random | v3-baseline | 0.0000%p | 0.0000%p–0.0000%p | 0/200 |
| v33-belief | Random | v3-baseline | 0.0000%p | 0.0000%p–0.0000%p | 0/200 |

## 한계 및 해석

- YachtLab Nintendo 12-category game, seat swapped and common seeds within each opponent
- All tests use separate seed ranges from the earlier 800k run; do not treat aggregate result as an independent training performance
- Bayesian v3.3 posterior assumes one stationary policy from a six-agent candidate family; Aggressive, Conservative and Random are simulated proxies, not real humans
- Random comparator uniformly samples legal action indices from independent seeded private policy RNG; no future dice or opponent RNG is exposed to learner
- v3.4 adaptive sample stopping is heuristic rather than anytime-valid 99% confidence bound
- A vs B hold exactly the same archived v4 actor weights; C/D/E are new models trained with isolated imitation, REINFORCE, or joint updates
- Each 99% CI is per planned contrast; multiple comparisons/selection require correction before SOTA claims
- No default deployment or claim of improvement without independent holdout

GitHub Actions `followup-v33-*` 아티팩트에서 원시 시드쌍 결과 확인.
