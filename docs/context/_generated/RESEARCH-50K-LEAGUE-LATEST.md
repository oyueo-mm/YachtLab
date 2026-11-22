# YachtLab 4모델 직접 대결 리그 실험

> 300,000경기. 완결 게임, 모든 시드 선후공 교대, 99% paired-seed 정규근사 CI. 이 보고서는 사전 고정한 연구 비교이고 서비스 배포 근거가 아님.

| 대진 (왼쪽 기준) | 경기 수 | 승리점수율 | 99% 신뢰구간 | 평균 판단 ms | 실제 롤아웃/탐색 | soft cap 횟수 | 최대 판단 ms |
|---|---:|---:|---|---:|---:|---:|---:|
| v3 vs v33 | 50,000 | 50.0010% | 49.9600%–50.0420% | 0.627 | — | 0 | 170.3 |
| v3 vs v34 | 50,000 | 50.0780% | 49.9781%–50.1779% | 0.581 | — | 0 | 128.7 |
| v3 vs v4-D | 50,000 | 49.9390% | 49.7888%–50.0892% | 0.630 | — | 0 | 149.7 |
| v33 vs v34 | 50,000 | 50.0540% | 49.9728%–50.1352% | 0.324 | — | 0 | 175.7 |
| v33 vs v4-D | 50,000 | 49.9120% | 49.7715%–50.0525% | 0.302 | — | 0 | 139.4 |
| v34 vs v4-D | 50,000 | 49.8320% | 49.6735%–49.9905% | 0.474 | — | 0 | 228.4 |

## 후보 3상대 평균 대국 점수 (설명용 순서, 유의차 순위가 아님)

| 모델 | 3개 직접 대진 단순평균 승리점수율 |
|---|---:|
| v4-D | 50.1057% |
| v3 | 50.0060% |
| v33 | 49.9883% |
| v34 | 49.9000% |

- **리그 순위는 단순 평균 점수순**. 6대진의 다중 비교·상대 정책 불일치·공통 시드 상관을 반영한 통계적 확정 순위가 아니다.

## 해석 시 주의

- Paired same-seed two-seat complete 12-category games, independent from previous large-scale seeds
- Separate frozen v3.3 scorecard pack and original v4-D reinforcement actor; NO new training from the holdout
- Known opponent label Win DP v3 provided only for the actual v3 variant. Against v3.3/v3.4/v4-D opponents, models get Other and fall back; no oracle knowledge of unmodeled policy
- Previous 50.2762% v3.3 advantage vs v2 was a small observed increase, not evidence that superiority over v3 is established
- 99% per-pair Wald intervals on the paired 0/0.5/1 win-credit. Six league matchups are a multiple-comparison family: require per-match multiplicity adjustment before SOTA
- Budget modes' rollout early termination and approximate confidence are heuristic; soft time caps are not hard response deadlines
- No production promotion, SOTA declaration or cross-opponent global strength conclusion from point estimates alone

Raw shard results: GitHub Actions artifacts `research50k-league-*`; 모든 조합의 pair/source SHA·중복 검증 포함.
