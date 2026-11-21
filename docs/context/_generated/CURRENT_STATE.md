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
- [br-error-enumeration.yml](../../../.github/workflows/br-error-enumeration.yml)
- [br-research.yml](../../../.github/workflows/br-research.yml)
- [competitive-research.yml](../../../.github/workflows/competitive-research.yml)
- [confirm-v2.yml](../../../.github/workflows/confirm-v2.yml)
- [context-sync.yml](../../../.github/workflows/context-sync.yml)
- [deploy.yml](../../../.github/workflows/deploy.yml)
- [discovered-external.yml](../../../.github/workflows/discovered-external.yml)
- [external-championship.yml](../../../.github/workflows/external-championship.yml)
- [full-selfplay.yml](../../../.github/workflows/full-selfplay.yml)
- [integrated-research.yml](../../../.github/workflows/integrated-research.yml)
- [native12-dqn.yml](../../../.github/workflows/native12-dqn.yml)
- [neural-selfplay.yml](../../../.github/workflows/neural-selfplay.yml)
- [offpolicy-ppo-expanded.yml](../../../.github/workflows/offpolicy-ppo-expanded.yml)
- [psro-extended.yml](../../../.github/workflows/psro-extended.yml)
- [psro-ppo.yml](../../../.github/workflows/psro-ppo.yml)
- [qr-20k.yml](../../../.github/workflows/qr-20k.yml)
- [qr-autoresearch.yml](../../../.github/workflows/qr-autoresearch.yml)
- [qr-deep-research.yml](../../../.github/workflows/qr-deep-research.yml)
- [qr-followup.yml](../../../.github/workflows/qr-followup.yml)
- [qr-four-pillars.yml](../../../.github/workflows/qr-four-pillars.yml)
- [sota-attack-lab.yml](../../../.github/workflows/sota-attack-lab.yml)
- [sota-independent-confirm.yml](../../../.github/workflows/sota-independent-confirm.yml)
- [tabular-zoo.yml](../../../.github/workflows/tabular-zoo.yml)
- [v31-large.yml](../../../.github/workflows/v31-large.yml)
- [v31-research.yml](../../../.github/workflows/v31-research.yml)
- [v32-research.yml](../../../.github/workflows/v32-research.yml)
- [yahtzeerl-transfer.yml](../../../.github/workflows/yahtzeerl-transfer.yml)

## 맥락 허브의 보존된 문서

- [AUTOMATION.md](../AUTOMATION.md)
- [DECISIONS.md](../DECISIONS.md)
- [EXPERIMENT-ZOO-2026-11-20.md](../EXPERIMENT-ZOO-2026-11-20.md)
- [EXPERIMENT-ZOO.md](../EXPERIMENT-ZOO.md)
- [EXTENDED-PSRO-PMF-PPO-RESEARCH.md](../EXTENDED-PSRO-PMF-PPO-RESEARCH.md)
- [EXTENDED-PSRO-PMF-PPO-RESULTS.md](../EXTENDED-PSRO-PMF-PPO-RESULTS.md)
- [FULLGAME-OFFPOLICY-RESEARCH.md](../FULLGAME-OFFPOLICY-RESEARCH.md)
- [HANDOFF.md](../HANDOFF.md)
- [LARGE-SCALE-V32-ROADMAP.md](../LARGE-SCALE-V32-ROADMAP.md)
- [PSRO-PPO-PMF-2026-11-20-FINAL.md](../PSRO-PPO-PMF-2026-11-20-FINAL.md)
- [PSRO-PPO-PMF-RESEARCH.md](../PSRO-PPO-PMF-RESEARCH.md)
- [QR-FOUR-PILLARS-INVALID-RUN.md](../QR-FOUR-PILLARS-INVALID-RUN.md)
- [QR-SUITE-POSTRUN-AUDIT.md](../QR-SUITE-POSTRUN-AUDIT.md)
- [README.md](../README.md)
- [REFERENCES.md](../REFERENCES.md)
- [RESULTS.md](../RESULTS.md)
- [ROADMAP.md](../ROADMAP.md)
- [SELFPLAY-2026-11-20-FINAL.md](../SELFPLAY-2026-11-20-FINAL.md)
- [SELFPLAY-RESEARCH.md](../SELFPLAY-RESEARCH.md)
- [TECHNIQUES.md](../TECHNIQUES.md)
- [V31-RESEARCH.md](../V31-RESEARCH.md)
- [V32-EXACT-FORECAST.md](../V32-EXACT-FORECAST.md)

## 최근 Git 커밋 (맥락 자동 커밋 제외)

| 커밋 | 날짜 (Git 기록) | 설명 |
|---|---|---|
| [6e3968b](https://github.com/oyueo-mm/YachtLab/commit/6e3968b) | 2026-11-21 | research: integrate v3.2 exact three-slot DP Expert score forecast |
| [c26466e](https://github.com/oyueo-mm/YachtLab/commit/c26466e) | 2026-11-21 | research: launch 170k-game paired v2.1/v3/v3.1 independent confirmation |
| [6617a32](https://github.com/oyueo-mm/YachtLab/commit/6617a32) | 2026-11-21 | fix(v3.2): write pilot output to the correct v32 challenge directory |
| [e91f74c](https://github.com/oyueo-mm/YachtLab/commit/e91f74c) | 2026-11-21 | docs(v3.2): distinguish exact fixed-policy PMF from adaptive win-rate optimal play |
| [53b6a06](https://github.com/oyueo-mm/YachtLab/commit/53b6a06) | 2026-11-21 | ci(v3.2): validate exact score PMF and launch independent paired pilot |
| [af43a50](https://github.com/oyueo-mm/YachtLab/commit/af43a50) | 2026-11-21 | research(v3.2): matched v3 baseline versus exact forecast pilot summary |
| [7d639e4](https://github.com/oyueo-mm/YachtLab/commit/7d639e4) | 2026-11-21 | benchmark(v3.2): seat-swapped exact-vs-Gaussian DP Expert opponent pilot |
| [d321f8c](https://github.com/oyueo-mm/YachtLab/commit/d321f8c) | 2026-11-21 | test(v3.2): prove three-slot DP score PMF normalization, expectation, gating, and RNG invariance |
| [0191869](https://github.com/oyueo-mm/YachtLab/commit/0191869) | 2026-11-21 | research(v3.2): exact fixed DP Expert final-score forecast with strict opponent gate |
| [83dcb75](https://github.com/oyueo-mm/YachtLab/commit/83dcb75) | 2026-11-21 | feat(research): allow exactly enumerated three-category DP Expert forecast in v3 |

## 최근 GitHub Actions 상태

- GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회.

| 워크플로 | 최근 완료 상태 | 커밋 |
|---|---|---|
| [YachtLab PSRO + adaptive opponents + empirical PMF + full-game PPO](https://github.com/oyueo-mm/YachtLab/actions/runs/44915629790) | success | 6617a32fbb |
| [YachtLab v3.2 exact three-slot opponent forecast research](https://github.com/oyueo-mm/YachtLab/actions/runs/44915629754) | success | 6617a32fbb |
| [Full-game self-play and three-turn competitive research](https://github.com/oyueo-mm/YachtLab/actions/runs/44915629679) | success | 6617a32fbb |
| [PSRO oracle audit, scorecard conditional PMF and multi-seed large PPO](https://github.com/oyueo-mm/YachtLab/actions/runs/44915600917) | cancelled | e91f74c7f7 |
| [Test and deploy YachtLab](https://github.com/oyueo-mm/YachtLab/actions/runs/44915600852) | cancelled | e91f74c7f7 |
| [YachtLab Win DP v3.1 research and independent confirmation](https://github.com/oyueo-mm/YachtLab/actions/runs/44915350777) | success | 8d5980f97b |
| [YachtLab 170k-game v2.1 v3 v3.1 independent comparison](https://github.com/oyueo-mm/YachtLab/actions/runs/44915350772) | success | 8d5980f97b |

## 다음 채팅과 작업의 시작점

1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).
2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.
3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.
