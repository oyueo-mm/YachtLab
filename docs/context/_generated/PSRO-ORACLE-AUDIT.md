# PSRO 오라클의 실제 최적 대응 품질 — 독립 시드 검증

- 학습 중 메타게임 혼합을 단계별로 고정한 뒤 완전히 다른 시드에서 새 Oracle의 승리점수율과 그 단계의 최강 기존 전략을 paired comparison.
- 총 단계당 320 seed pairs × 2 seats.
- 같은 상대 샘플·시드와 두 좌석으로 통제. 유의성은 paired 차이의 95% 근사 구간으로 판정.

| 확장 단계 | Oracle 승리점수율 (vs 단계별 meta mix) | 기존 최강 정책 | Oracle − 기존 정책 (95% CI) | 미관측 Greedy 상대 |
|---|---:|---|---:|---:|
| 0 | 48.984% | risk-seeking residual | -1.016% (-3.975%~1.944%) | 74.297% |
| 1 | 50.859% | PSRO oracle 0 | 0.859% (-2.316%~4.035%) | 74.531% |
| 2 | 52.422% | upper-bonus residual | 2.109% (-1.036%~5.255%) | 73.203% |

## 해석
- Finite ES approximation is not a Nash oracle or optimal best response.
- Meta mixture and incumbent are frozen from training. Audit seeds are disjoint.
- Mix sampling and pair games use shared evaluation seeds across candidates for paired-difference confidence intervals.
- For an oracle to count as improvement, the paired CI of oracle minus previous incumbent must exclude zero in the positive direction.
- Only three stages and a small policy pool; held-out Greedy tests do not establish general robustness.
- PSRO restricted meta-game exploitability ignores policy space outside its finite population.
- 원시 시드별 정책쌍 대결 차이는 Actions psro-oracle-audit 아티팩트 JSON에 보존.
