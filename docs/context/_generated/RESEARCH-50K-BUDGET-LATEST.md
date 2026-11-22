# YachtLab v3.4 5만 경기 × 탐색 예산 실험

> 350,000경기. 완결 게임, 모든 시드 선후공 교대, 99% paired-seed 정규근사 CI. 이 보고서는 사전 고정한 연구 비교이고 서비스 배포 근거가 아님.

| 탐색 모드 | 경기 수 | 승리점수율 | 99% 신뢰구간 | 평균 판단 ms | 실제 롤아웃/탐색 | soft cap 횟수 | 최대 판단 ms |
|---|---:|---:|---|---:|---:|---:|---:|
| legacy | 50,000 | 50.0510% | 49.8593%–50.2427% | 1.008 | 2.0 | 63 | 157.8 |
| A | 50,000 | 50.1030% | 49.9256%–50.2804% | 1.284 | 16.0 | 1582 | 261.6 |
| B | 50,000 | 50.1130% | 49.9355%–50.2905% | 2.192 | 60.6 | 4809 | 283.3 |
| C | 50,000 | 50.1290% | 49.9496%–50.3084% | 10.775 | 88.5 | 59522 | 1471.7 |
| C-relaxed | 50,000 | 50.0870% | 49.9082%–50.2658% | 30.724 | 182.9 | 27950 | 1637.4 |
| D | 50,000 | 50.1110% | 49.9334%–50.2886% | 2.223 | 60.5 | 5021 | 304.6 |
| adaptive | 50,000 | 50.1170% | 49.9388%–50.2952% | 2.311 | 31.0 | 6756 | 1362.3 |

## 동일 시드 legacy 2×2 탐색 대비 차이

| 후보 | 승리점수율 차이 | paired 99% CI | 결과가 바뀐 시드 쌍 |
|---|---:|---|---:|
| A | 0.0520%p | -0.0359%p–0.1399%p | 309/25000 |
| B | 0.0620%p | -0.0266%p–0.1506%p | 314/25000 |
| C | 0.0780%p | -0.0171%p–0.1731%p | 357/25000 |
| C-relaxed | 0.0360%p | -0.0580%p–0.1300%p | 354/25000 |
| D | 0.0600%p | -0.0291%p–0.1491%p | 317/25000 |
| adaptive | 0.0660%p | -0.0238%p–0.1558%p | 322/25000 |

## 해석 시 주의

- Paired same-seed two-seat complete 12-category games, independent from previous large-scale seeds
- Separate frozen v3.3 scorecard pack and original v4-D reinforcement actor; NO new training from the holdout
- Known opponent label Win DP v3 provided only for the actual v3 variant. Against v3.3/v3.4/v4-D opponents, models get Other and fall back; no oracle knowledge of unmodeled policy
- Previous 50.2762% v3.3 advantage vs v2 was a small observed increase, not evidence that superiority over v3 is established
- 99% per-pair Wald intervals on the paired 0/0.5/1 win-credit. Six league matchups are a multiple-comparison family: require per-match multiplicity adjustment before SOTA
- Budget modes' rollout early termination and approximate confidence are heuristic; soft time caps are not hard response deadlines
- No production promotion, SOTA declaration or cross-opponent global strength conclusion from point estimates alone

Raw shard results: GitHub Actions artifacts `research50k-budget-*`; 모든 조합의 pair/source SHA·중복 검증 포함.
