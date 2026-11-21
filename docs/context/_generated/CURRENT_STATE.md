# YachtLab 현재 코드 상태 (자동 생성)

> 이 문서는 GitHub Actions 또는 node scripts/update-context.mjs --write 실행으로 생성됨. 수동으로 수정하지 마세요.
> **성능 주장은 여기서 생성하지 않습니다.** 자세한 출처와 한계는 [검증 결과](../RESULTS.md)를 확인하세요.

## 코드에서 확인한 게임 설정

- 게임 규칙: [src/engine.ts](../../../src/engine.ts) (여기에는 12개 카테고리, 상단 63점 +35, 스트레이트 15/30점 등 계산 코드가 있음).
- 선언된 카테고리 수: **12개**.
- 카테고리: aces · deuces · threes · fours · fives · sixes · choice · four · full · small · large · yacht.
- package.json: yachtlab / 1.0.0 / module.

## 실제 소스에서 읽은 AI 모델 목록

| 모델 | 소스 확인 |
|---|---|
| Random | [src/ai.ts](../../../src/ai.ts) |
| Greedy | [src/ai.ts](../../../src/ai.ts) |
| Expectimax | [src/ai.ts](../../../src/ai.ts) |
| MCTS | [src/ai.ts](../../../src/ai.ts) |
| PPO | [src/ai.ts](../../../src/ai.ts) |
| DP Expert | [src/ai.ts](../../../src/ai.ts) |
| Win DP | [src/ai.ts](../../../src/ai.ts) |
| Win DP v2 | [src/ai.ts](../../../src/ai.ts) |
| Distilled Policy | [src/ai.ts](../../../src/ai.ts) |
| Distilled PPO | [src/ai.ts](../../../src/ai.ts) |

- 나열된 모델 수: **10개**. 이는 소스에서 선언된 목록이며, 조건부 등록 여부 및 실제 모델 평가 결과를 뜻하지 않음.
- 연구용 별도 탐색/학습 모듈은 공개 AI 목록에 포함되지 않을 수 있음. [기법 도감](../TECHNIQUES.md) 참고.

## 저장소에서 발견한 워크플로

- [algorithm-zoo.yml](../../../.github/workflows/algorithm-zoo.yml)
- [competitive-research.yml](../../../.github/workflows/competitive-research.yml)
- [confirm-v2.yml](../../../.github/workflows/confirm-v2.yml)
- [context-sync.yml](../../../.github/workflows/context-sync.yml)
- [deploy.yml](../../../.github/workflows/deploy.yml)
- [full-selfplay.yml](../../../.github/workflows/full-selfplay.yml)
- [integrated-research.yml](../../../.github/workflows/integrated-research.yml)
- [neural-selfplay.yml](../../../.github/workflows/neural-selfplay.yml)
- [offpolicy-ppo-expanded.yml](../../../.github/workflows/offpolicy-ppo-expanded.yml)
- [psro-extended.yml](../../../.github/workflows/psro-extended.yml)
- [psro-ppo.yml](../../../.github/workflows/psro-ppo.yml)
- [qr-20k.yml](../../../.github/workflows/qr-20k.yml)
- [qr-deep-research.yml](../../../.github/workflows/qr-deep-research.yml)
- [qr-four-pillars.yml](../../../.github/workflows/qr-four-pillars.yml)
- [tabular-zoo.yml](../../../.github/workflows/tabular-zoo.yml)

## 맥락 허브의 보존된 문서

- [AUTOMATION.md](../AUTOMATION.md)
- [DECISIONS.md](../DECISIONS.md)
- [EXPERIMENT-ZOO-2026-11-20.md](../EXPERIMENT-ZOO-2026-11-20.md)
- [EXPERIMENT-ZOO.md](../EXPERIMENT-ZOO.md)
- [EXTENDED-PSRO-PMF-PPO-RESEARCH.md](../EXTENDED-PSRO-PMF-PPO-RESEARCH.md)
- [EXTENDED-PSRO-PMF-PPO-RESULTS.md](../EXTENDED-PSRO-PMF-PPO-RESULTS.md)
- [FULLGAME-OFFPOLICY-RESEARCH.md](../FULLGAME-OFFPOLICY-RESEARCH.md)
- [HANDOFF.md](../HANDOFF.md)
- [PSRO-PPO-PMF-2026-11-20-FINAL.md](../PSRO-PPO-PMF-2026-11-20-FINAL.md)
- [PSRO-PPO-PMF-RESEARCH.md](../PSRO-PPO-PMF-RESEARCH.md)
- [QR-SUITE-POSTRUN-AUDIT.md](../QR-SUITE-POSTRUN-AUDIT.md)
- [README.md](../README.md)
- [REFERENCES.md](../REFERENCES.md)
- [RESULTS.md](../RESULTS.md)
- [ROADMAP.md](../ROADMAP.md)
- [SELFPLAY-2026-11-20-FINAL.md](../SELFPLAY-2026-11-20-FINAL.md)
- [SELFPLAY-RESEARCH.md](../SELFPLAY-RESEARCH.md)
- [TECHNIQUES.md](../TECHNIQUES.md)

## 최근 Git 커밋 (맥락 자동 커밋 제외)

| 커밋 | 날짜 (Git 기록) | 설명 |
|---|---|---|
| [c5a466d](https://github.com/oyueo-mm/YachtLab/commit/c5a466d) | 2026-11-21 | research: implement QR-DQN stability, DP-unrestricted, counterfactual gating and rich state experiments |
| [34c39ea](https://github.com/oyueo-mm/YachtLab/commit/34c39ea) | 2026-11-21 | research: launch QR16 loss2 20k full-game training across five seeds |
| [a33fd33](https://github.com/oyueo-mm/YachtLab/commit/a33fd33) | 2026-11-21 | docs(research): audit QR suite success, counterfactual omission and DP Expert comparator contamination [skip ci] |
| [34f4e39](https://github.com/oyueo-mm/YachtLab/commit/34f4e39) | 2026-11-21 | research: QR-DQN, IQN and 5-seed controlled full-game experimental suite |
| [f9f3e7c](https://github.com/oyueo-mm/YachtLab/commit/f9f3e7c) | 2026-11-21 | research: full-game five RL families and doubled multi-seed PPO training |
| [6680443](https://github.com/oyueo-mm/YachtLab/commit/6680443) | 2026-11-21 | docs: finalize PSRO oracle, scorecard PMF and 49k-game multi-seed PPO evidence |
| [319f53a](https://github.com/oyueo-mm/YachtLab/commit/319f53a) | 2026-11-21 | docs: preserve verified PSRO oracle audit and scorecard PMF holdout outcomes |
| [6f82244](https://github.com/oyueo-mm/YachtLab/commit/6f82244) | 2026-11-20 | research: audit actual PSRO oracle best-response, scorecard conditional PMF and independent PPO seeds |
| [fc6a4ac](https://github.com/oyueo-mm/YachtLab/commit/fc6a4ac) | 2026-11-20 | docs: preserve verified PSRO, empirical PMF and PPO head-to-head experiments |
| [9eff1ea](https://github.com/oyueo-mm/YachtLab/commit/9eff1ea) | 2026-11-20 | research: full PSRO meta-solver, adaptive population, empirical PMF and full-game clipped PPO |

## 최근 GitHub Actions 상태

- GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회.

| 워크플로 | 최근 완료 상태 | 커밋 |
|---|---|---|
| [YachtLab QR-DQN and IQN deep research](https://github.com/oyueo-mm/YachtLab/actions/runs/44871720844) | success | 98ee2e1dfd |
| [YachtLab QR four-pillar research](https://github.com/oyueo-mm/YachtLab/actions/runs/44871720826) | success | 98ee2e1dfd |
| [Test and deploy YachtLab](https://github.com/oyueo-mm/YachtLab/actions/runs/44871697524) | cancelled | 3e40e05103 |
| [.github/workflows/qr-four-pillars.yml](https://github.com/oyueo-mm/YachtLab/actions/runs/44871616455) | failure | 39f7f674d8 |
| [YachtLab QR16 loss2 20k five-seed training](https://github.com/oyueo-mm/YachtLab/actions/runs/44845182600) | success | 34c39ea0be |

## 다음 채팅과 작업의 시작점

1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).
2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.
3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.
