# 전체 게임 PPO 여러 독립 시드 중 1번째 학습 실험

> 실제 PPO clipped surrogate(행동 로그확률 보존·비율 클리핑·재사용) + GAE + critic. 단순 REINFORCE가 아님.

- 코드: 6e3968befa49e57f7168e3f10296ae840dde9942
- 실제 full-game train: 정책별 8192게임, 후보선택/최종확증 다른 시드.
- 강한 상대: DP Expert, Win DP v2, PSRO restricted meta-game mixture, 이전 PPO 세대.
- 비교: PPO, PPO+DP teacher KL, 학습 전 잔차0 기준.
- 선택: **Zero-neural reference**. 학습 전 기준이 1위일 수 있으며 이 경우 학습 성능 향상이 아님.

## 미사용 시드 독립 대전

| 후보 | 상대 | 경기 | 승리점수율 | 95% 짝별 근사 CI |
|---|---|---:|---:|---|
| Zero-neural reference | Win DP v2 | 1200 | 49.375% | 48.623%–50.127% |
| Zero-neural reference | DP Expert | 1200 | 50.208% | 48.868%–51.549% |
| Full-game clipped PPO | Win DP v2 | 1200 | 44.917% | 42.635%–47.198% |
| Full-game clipped PPO | DP Expert | 1200 | 49.333% | 46.876%–51.790% |
| Full-game clipped PPO + DP teacher KL | Win DP v2 | 1200 | 50.333% | 48.581%–52.086% |
| Full-game clipped PPO + DP teacher KL | DP Expert | 1200 | 50.875% | 48.954%–52.796% |
| Full-game clipped PPO | Full-game clipped PPO + DP teacher KL | 360 | 48.889% | 44.862%–52.916% |

## 모델 선택 전용 리그

| 후보 | vs DP Expert | vs Win DP v2 |
|---|---:|---:|
| Zero-neural reference | 49.625% | 50.625% |
| Full-game clipped PPO | 46.750% | 46.250% |
| Full-game clipped PPO + DP teacher KL | 50.875% | 47.125% |

## 한계

- PPO policy is a small per-action MLP residual on DP Expert Q; final two categories are delegated to Win DP v2.
- Opponent mixture comes from empirical PSRO zero-sum restricted meta-game, and snapshots are updated during PPO; not an optimal full-game Nash learner.
- The GAE reward is a terminal match result and player-specific decision transition, not a dense intermediate reward or advantage oracle.
- Teacher regularizer is KL to the DP-Q-induced softmax in the candidate action set, not an exact KL over every physically legal action.
- PPO replay is on-policy within a batch; multiple minibatch updates use fixed behavior log probabilities.
- CI pairs share a seed with seat swap; 95% intervals approximate. One training seed per variant; no broad SOTA claim.
- Checkpoint model stays research-only until independently and directly better than Win DP v2.

- Actions artifact `ppo-full-game-models-and-raw`에는 파라미터, 학습 진행 기록, 게임별 결과 포함.
