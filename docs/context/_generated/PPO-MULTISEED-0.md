# 전체 게임 PPO 여러 독립 시드 중 0번째 학습 실험

> 실제 PPO clipped surrogate(행동 로그확률 보존·비율 클리핑·재사용) + GAE + critic. 단순 REINFORCE가 아님.

- 코드: 6f822441cd3d2683fd49f6875dccbf6b53f34278
- 실제 full-game train: 정책별 8192게임, 후보선택/최종확증 다른 시드.
- 강한 상대: DP Expert, Win DP v2, PSRO restricted meta-game mixture, 이전 PPO 세대.
- 비교: PPO, PPO+DP teacher KL, 학습 전 잔차0 기준.
- 선택: **Zero-neural reference**. 학습 전 기준이 1위일 수 있으며 이 경우 학습 성능 향상이 아님.

## 미사용 시드 독립 대전

| 후보 | 상대 | 경기 | 승리점수율 | 95% 짝별 근사 CI |
|---|---|---:|---:|---|
| Zero-neural reference | Win DP v2 | 1200 | 50.333% | 49.388%–51.279% |
| Zero-neural reference | DP Expert | 1200 | 50.750% | 49.517%–51.983% |
| Full-game clipped PPO | Win DP v2 | 1200 | 48.750% | 46.599%–50.901% |
| Full-game clipped PPO | DP Expert | 1200 | 49.083% | 46.969%–51.198% |
| Full-game clipped PPO + DP teacher KL | Win DP v2 | 1200 | 49.750% | 47.833%–51.667% |
| Full-game clipped PPO + DP teacher KL | DP Expert | 1200 | 50.708% | 48.894%–52.522% |
| Full-game clipped PPO | Full-game clipped PPO + DP teacher KL | 360 | 50.000% | 46.297%–53.703% |

## 모델 선택 전용 리그

| 후보 | vs DP Expert | vs Win DP v2 |
|---|---:|---:|
| Zero-neural reference | 50.125% | 50.500% |
| Full-game clipped PPO | 48.000% | 45.750% |
| Full-game clipped PPO + DP teacher KL | 50.250% | 49.500% |

## 한계

- PPO policy is a small per-action MLP residual on DP Expert Q; final two categories are delegated to Win DP v2.
- Opponent mixture comes from empirical PSRO zero-sum restricted meta-game, and snapshots are updated during PPO; not an optimal full-game Nash learner.
- The GAE reward is a terminal match result and player-specific decision transition, not a dense intermediate reward or advantage oracle.
- Teacher regularizer is KL to the DP-Q-induced softmax in the candidate action set, not an exact KL over every physically legal action.
- PPO replay is on-policy within a batch; multiple minibatch updates use fixed behavior log probabilities.
- CI pairs share a seed with seat swap; 95% intervals approximate. One training seed per variant; no broad SOTA claim.
- Checkpoint model stays research-only until independently and directly better than Win DP v2.

- Actions artifact `ppo-full-game-models-and-raw`에는 파라미터, 학습 진행 기록, 게임별 결과 포함.
