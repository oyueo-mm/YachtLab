# 전체 12라운드 자기 대국 연구 — 자동 실험 결과

> 승패 보상으로 정책 가중치를 실제 학습한 결과. 세계 SOTA나 검증된 최강 모델이라고 가정하지 않음.

- 코드 SHA: 6e3968befa49e57f7168e3f10296ae840dde9942
- 전체 게임 진화 탐색: 6 세대 × 12 후보, 리그 상대 DP Expert/Win DP v2/이전 세대.
- 실제 최종 승패 보상 REINFORCE: 10 epochs × 96 games.
- 최종 후보는 별도 시드 검증에서 고정: **DP anchored residual (zero)**.
- 후보 가중치 및 학습 이력: [결과 체크포인트](https://github.com/oyueo-mm/YachtLab/actions/workflows/full-selfplay.yml) (Actions Artifacts).

## 독립 시드 확증

| 정책 | 상대 | 경기 | 승리 점수율 | 95% 짝별 근사 CI |
|---|---|---:|---:|---|
| DP anchored residual (zero) | DP Expert | 3600 | 50.750% | 50.132%–51.368% |
| DP anchored residual (zero) | Win DP v2 | 3600 | 49.903% | 49.403%–50.403% |
| Win DP v2 | DP Expert | 900 | 50.000% | 48.776%–51.224% |

## 모델 선택 검증(확증과 다른 시드)

| 후보 | 종합 리그 점수 |
|---|---:|
| DP anchored residual (zero) | 52.153% |
| REINFORCE full-game self-play | 51.806% |
| ES champion g5 | 51.597% |
| ES champion g4 | 51.528% |
| ES champion g3 | 51.250% |

## 해석상 주의사항

- Evolution strategies and REINFORCE are genuine training from full-game win rewards, but neither is a proof of Nash equilibrium or world SOTA.
- The league uses historical snapshots and DP opponents; it is PSRO-inspired, not a complete PSRO meta-solver or an equilibrium oracle.
- Parameter/hyperparameter selection uses separate training and validation seeds. Confirmatory direct head-to-head uses a new untouched range.
- Win DP v2 assumes a fixed DP Expert final-turn opponent policy, so opponent modeling might differ for learned policies.
- Winning on one fixed set of opponents does not establish robustness to all opponent strategies.
- Candidate may not improve over the baseline; in that case only the research checkpoint is saved and the website default must not change.

- 원시 경기별 결과는 `full-selfplay-research` GitHub Actions 아티팩트에 보존함.
- 전체 실험/학습 상세: [프로젝트 연구 설명](../SELFPLAY-RESEARCH.md).
- 기존 검증: [RESULTS](../RESULTS.md), [Algorithm Zoo](../EXPERIMENT-ZOO-2026-11-20.md).
