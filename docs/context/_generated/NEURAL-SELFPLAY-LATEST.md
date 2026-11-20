# 신경망 기반 전체 게임 자기 대국 — 실제 실행 결과

> 실제 12라운드 승패를 reward로 쓰는 on-policy 신경망 학습 결과. 실험용이며 SOTA 주장이 아니다.

- 소스 SHA: 361f75d10fe623ac1c7c3d72e7cd896ead216cb8
- 학습 에피소드: **정책당 7200 전체 12라운드 경기**
- 학습 방식: REINFORCE, Monte-Carlo advantage actor-critic (not bootstrapped A2C).
- 정책은 DP Q 위에서 행동별 12→12→1 MLP 보정, 마지막 두 카테고리는 기존 Win DP v2.
- 최종 고정 후보: **Neural Monte-Carlo Actor-Critic**.

## 완전히 새로운 미사용 시드 확증

| 정책 | 상대 | 경기 | 승리점수율 | 95% paired-normal CI |
|---|---|---:|---:|---|
| Neural Monte-Carlo Actor-Critic | DP Expert | 3600 | 51.403% | 50.742%–52.064% |
| Neural Monte-Carlo Actor-Critic | Win DP v2 | 3600 | 49.736% | 49.239%–50.233% |
| Neural REINFORCE | Neural Monte-Carlo Actor-Critic | 600 | 50.000% | 49.537%–50.463% |

## 후보 선택용 별도 시드

| 후보 | vs DP Expert | vs Win DP v2 |
|---|---:|---:|
| DP anchored zero neural | 50.000% | 50.250% |
| Neural REINFORCE | 50.000% | 50.000% |
| Neural Monte-Carlo Actor-Critic | 50.250% | 50.500% |

## 한계

- Actor-critic uses Monte-Carlo terminal advantage, not bootstrapped temporal-difference A2C/PPO.
- Final two categories use fixed Win DP v2, not learned neural behavior.
- This is a small residual network (12 hidden units), not a large foundation model.
- Evolution policy, 3-turn solver and PSRO equilibrium solver are separate experiments; no claim to run full AlphaZero/MuZero.
- One seed per learner and fixed training budget; hyperparameter superiority is unverified.
- Selection/validation and untouched confirmation seeds are disjoint, but several research experiments may still have multiple-comparison effects.
- Even if trained and deployed on research GitHub, no baseline AI is replaced without direct statistically substantiated improvements.

- 원시 경기 결과·정책별 가중치/훈련 기록: GitHub Actions `full-neural-selfplay` 아티팩트.
- 기존 ES/REINFORCE 소형 정책 자기 대국 결과: [SELFPLAY-LATEST.md](./SELFPLAY-LATEST.md)
- 연구 문서: [SELFPLAY-RESEARCH.md](../SELFPLAY-RESEARCH.md)
