# 알고리즘 대량 실험 — 자동 생성 결과

> 성공한 스크립트가 계산한 실제 통계. 이 문서는 자동 생성되며 세계 SOTA 주장이 아닙니다.

- 실행 시간(UTC): 2026-11-20T08:50:30.742Z
- 소스 커밋: GitHub commit 491abcb1c2058f279606f4ff8a7213cd08a74572
- 시험 후보: **58개 파라미터/기법 조합**, 알고리즘 계열 12종.
- 규칙: 12카테고리 Nintendo-style Yacht Dice; 승리 1/무승부 0.5/패배 0.
- 모든 비교에서 독립적인 주사위 RNG를 선수별로 사용하고 시드마다 선후공을 바꿈.
- **주의:** 선별 단계의 최고 승률은 여러 후보 중 선택된 편향이 있음. 미사용 최종 시드의 직접 대결 결과가 핵심.

## 유망 후보 탐색 — 상위 12종

| 후보 | 상대 | 경기 | 승리 점수율 | 95% 근사 CI |
|---|---|---:|---:|---|
| trailGate--5 | baseline-DP | 800 | 50.688% | 49.832~51.543% |
| guidedConditional-20 | baseline-DP | 800 | 50.438% | 49.045~51.830% |
| trailGate--15 | baseline-DP | 800 | 50.438% | 49.734~51.141% |
| baseline-WinDPv2 | baseline-DP | 800 | 50.250% | 49.048~51.451% |
| trailGate--25 | baseline-DP | 800 | 50.063% | 49.620~50.505% |
| riskProxy-0_5 | baseline-DP | 800 | 49.813% | 47.823~51.802% |
| guided-16 | baseline-DP | 800 | 49.563% | 47.529~51.596% |
| guided-96 | baseline-DP | 800 | 48.750% | 47.037~50.463% |
| riskProxy-1 | baseline-DP | 800 | 48.750% | 46.525~50.975% |
| guidedConditional-0 | baseline-DP | 800 | 48.688% | 46.988~50.387% |
| guidedConditional--20 | baseline-DP | 800 | 48.563% | 46.736~50.389% |
| guided-48 | baseline-DP | 800 | 48.313% | 46.424~50.201% |

## 확증 — 탐색 종료 후 고정된 1개 후보

- 사전 선별 후보: **trailGate--5** (trailGate).

| 후보 | 상대 | 경기 | 승리 점수율 | 95% 근사 CI |
|---|---|---:|---:|---|
| trailGate--5 | baseline-DP | 12000 | 50.200% | 49.993~50.407% |
| trailGate--5 | baseline-WinDPv2 | 12000 | 49.796% | 49.582~50.010% |
| trailGate--5 | baseline-WinDP | 2000 | 50.500% | 49.987~51.013% |
| baseline-WinDPv2 | baseline-DP | 3000 | 50.900% | 50.361~51.439% |

## 연구적 한계

- Many candidates are hyperparameter variants, not independent algorithm families.
- Risk proxies and category priors are heuristics, not calibrated win probabilities.
- Opponent models in Win DP v2 assume fixed DP Expert policy.
- Exhaustive self-play, trained deep RL, PSRO, and full expectiminimax are not implemented by this sweep.
- Changing a source model, calibration, or opponent changes the interpretation of the result.
- GitHub Actions artifacts may expire; a compact summary is committed to the repository.

## 원시 결과

- [결과 JSON 요약](./zoo-summary.json)
- 원시 경기별 점수 및 모든 후보군 스캔 결과: GitHub Actions `algorithm-zoo-raw` 아티팩트
- 재현: `node scripts/sweep-algorithms.mjs` (`--smoke`는 축소 테스트)
- 기존 검증 결과: [RESULTS.md](../RESULTS.md)
