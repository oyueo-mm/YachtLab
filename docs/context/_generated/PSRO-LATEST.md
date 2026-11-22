# 실제 PSRO restricted meta-game 및 상대 적응 리그 결과

> 모집단 간 직접 대국 payoff로 zero-sum empirical meta-game을 만들고 fictitious play로 계산한 **근사 제한게임 Nash 분포**. 본게임 Nash가 아님.

- source SHA: 8766651129f14e38e6da02646cf31f71b44af3a8
- 정책 모집단: DP Expert, Win DP v2, risk-seeking residual, upper-bonus residual, PSRO oracle 0, PSRO oracle 1, PSRO oracle 2
- 대국으로 채운 게임 payoff 행렬은 연구 아티팩트 JSON 저장. 대각선 0, 반대칭 보장.
- 현재 제한게임 exploitability proxy (zero-sum payoff): 0.000229
- fictitious-play duality gap: 0.000458

## 최종 후보: 메타게임 확률 혼합 정책

| 정책 | 상대 | 경기 | 승리점수율 | paired 95% 근사 CI |
|---|---|---:|---:|---|
| PSRO restricted meta-game mixture | Win DP v2 | 2400 | 49.438% | 48.245%–50.630% |
| PSRO restricted meta-game mixture | DP Expert | 2400 | 49.688% | 48.365%–51.010% |

## 최종 메타게임 혼합 확률

| 정책 | 확률 |
|---|---:|
| DP Expert | 4.81% |
| Win DP v2 | 4.86% |
| risk-seeking residual | 0.00% |
| upper-bonus residual | 24.25% |
| PSRO oracle 0 | 26.79% |
| PSRO oracle 1 | 39.28% |
| PSRO oracle 2 | 0.00% |

## 한계

- This is genuine empirical meta-game solving and iterative approximate oracle expansion; the oracle is finite ES search and not a true optimal response.
- Restricted exploitability is only within sampled observed policy population, not the extensive-form game Nash exploitability.
- Payoff matrix has finite-seed sampling noise; its entry confidence intervals should be quantified before strong equilibrium claims.
- The opponent in each candidate game is sampled from the current meta mixture and changes after each oracle expansion.
- Independent final seed ranges were excluded from training, validation and matrix estimation.
- No verified improvement means no deployment/default AI replacement.

- 원시 경기와 오라클 이력은 GitHub Actions artifact `psro-matrix-and-adaptive-oracles`에 보관.
