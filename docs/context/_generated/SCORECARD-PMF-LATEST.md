# 점수판 조건부 상대 점수분포 독립 확증

> 상대 정책·남은 카테고리 외에 **점수판 열린 항목 비트마스크, 상단 점수, 현재 총점, DP 예상 총점**을 조건부 분포에 반영한 CART+smoothed histogram.

- policy별 training 650 / selection 200 / untouched confirm 400 games.
- 중요한 평가지표: CRPS(낮을수록 좋음); 개별 10개 라운드는 같은 game cluster로 처리해 개선 신뢰구간 계산.

| 상대 정책 | Gaussian CRPS | 남은 턴만 PMF CRPS | **점수판 조건부 PMF CRPS** | Gaussian−조건부 CRPS (game-clustered 95% CI) |
|---|---:|---:|---:|---|
| DP Expert | 17.6306 | 17.6193 | 17.6371 | -0.0065 (-0.0548–0.0418) |
| Win DP v2 | 17.8672 | 17.8452 | 17.8908 | -0.0236 (-0.0790–0.0318) |
| Greedy | 15.0158 | 14.8573 | 14.7389 | 0.2769 (0.1840–0.3698) |

## 조건부 모델을 적용한 Win DP v3

| 후보 | 상대 | 게임 | 승리 점수율 | paired 95% CI |
|---|---|---:|---:|---|
| Win DP v3 conditioned | Win DP v2 | 240 | 47.083% | 44.751%–49.416% |
| Win DP v3 conditioned | Win DP v3 gaussian | 120 | 50.000% | 50.000%–50.000% |
| Win DP v3 conditioned | DP Expert | 200 | 47.750% | 45.230%–50.270% |

## 한계
- The distribution is empirical and only approximates future score outcomes; it is not exact scorecard-specific DP enumeration.
- Multiple snapshots per game share terminal score; confidence intervals use per-game aggregates rather than treating snapshots as independent.
- Separate policy-specific models assume the opponent's policy is known. Adversarial adaptation or mismatched opponent models may invalidate calibrated forecasts.
- Win DP v3 has exact own-three-turn Bellman conditional on the forecast; the forecast itself is approximate.
- Conditional PMF adoption depends on held-out CRPS; an improved likelihood or game score is not implied by training fit alone.
- No Win DP v2 replacement without independent win-credit evidence.
- 전체 학습 모델·검증 격자와 raw match는 Actions Artifact scorecard-conditional-pmf 참조.
