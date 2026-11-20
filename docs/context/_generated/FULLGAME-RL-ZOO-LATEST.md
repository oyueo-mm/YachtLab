# 12라운드 전게임 강화학습 대안 실험 실제 결과

> 전체 12라운드 최종 승패로 학습, 기존 Win DP v2의 우위가 유지되는지 독립 선후공 대전 평가.

| 모델 | 전체 게임 학습 수 | Win DP v2 상대 학습 전 | 학습 후 | 학습 후 paired 95% CI | validation 최종 선택 |
|---|---:|---:|---:|---|---|
| Double Dueling DQN + PER | 1500 | 49.750% | 42.042% | 39.824%–44.259% | untrained |
| QR-DQN | 1500 | 50.125% | 51.333% | 49.298%–53.369% | trained |
| Expert Iteration | 350 | 49.750% | 48.583% | 46.712%–50.454% | untrained |
| Dyna-Q exact model | 1500 | 49.917% | 13.417% | 11.554%–15.279% | untrained |
| Discrete SAC | 1500 | 49.250% | 5.458% | 4.212%–6.704% | untrained |

## 정확한 구현 범위
- Double Dueling DQN plus PER plus 3-step targets is Rainbow-lite, not full Rainbow (no C51, noisy networks).
- Fixed quantile 16-head QR-DQN; Implicit Quantile Networks (IQN) not implemented.
- ExIt expert is sampled full-game win-credit Monte Carlo with DP/WinDP continuation and limited search; its statistical superiority over teacher not guaranteed.
- Dyna-Q uses the exact known simulator to synthesize next learner decisions, separate future dice RNG, not an approximate learned world model.
- Discrete SAC uses entropy-regularized stochastic actor and twin linear Q critics, a small-feature approximation not a full high-capacity deep SAC.
- All five learners use legal DP-anchored candidate actions within 6 expected-score points, falling back to existing Win DP v2 for last 2 categories.
- This pilot uses one training seed per algorithm and relatively small compute; confidence intervals are seat-paired normal approximation, multiple-comparison uncorrected.
- No new model is deployed as the default until independent robust improvement against Win DP v2 is confirmed.

원시 게임별 점수, 모델 가중치, 훈련 업데이트 기록은 GitHub Actions fullgame-rl-zoo-raw 아티팩트에 저장.
