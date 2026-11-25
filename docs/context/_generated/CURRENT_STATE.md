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
| Win DP v4-D | [src/ai.ts](../../../src/ai.ts) |
| Distilled Policy | [src/ai.ts](../../../src/ai.ts) |
| Distilled PPO | [src/ai.ts](../../../src/ai.ts) |

- 나열된 모델 수: **11개**. 이는 소스에서 선언된 목록이며, 조건부 등록 여부 및 실제 모델 평가 결과를 뜻하지 않음.
- 연구용 별도 탐색/학습 모듈은 공개 AI 목록에 포함되지 않을 수 있음. [기법 도감](../TECHNIQUES.md) 참고.

## 저장소에서 발견한 워크플로

- [algorithm-zoo.yml](../../../.github/workflows/algorithm-zoo.yml)
- [br-error-enumeration.yml](../../../.github/workflows/br-error-enumeration.yml)
- [br-research.yml](../../../.github/workflows/br-research.yml)
- [competitive-research.yml](../../../.github/workflows/competitive-research.yml)
- [confirm-v2.yml](../../../.github/workflows/confirm-v2.yml)
- [context-sync.yml](../../../.github/workflows/context-sync.yml)
- [deploy-online-worker.yml](../../../.github/workflows/deploy-online-worker.yml)
- [deploy.yml](../../../.github/workflows/deploy.yml)
- [discovered-external.yml](../../../.github/workflows/discovered-external.yml)
- [external-championship.yml](../../../.github/workflows/external-championship.yml)
- [followup-ablations.yml](../../../.github/workflows/followup-ablations.yml)
- [foundation-v4-tournament.yml](../../../.github/workflows/foundation-v4-tournament.yml)
- [frontier-200k.yml](../../../.github/workflows/frontier-200k.yml)
- [full-selfplay.yml](../../../.github/workflows/full-selfplay.yml)
- [gameplay-ui-smoke.yml](../../../.github/workflows/gameplay-ui-smoke.yml)
- [integrated-research.yml](../../../.github/workflows/integrated-research.yml)
- [native12-dqn.yml](../../../.github/workflows/native12-dqn.yml)
- [neural-selfplay.yml](../../../.github/workflows/neural-selfplay.yml)
- [offpolicy-ppo-expanded.yml](../../../.github/workflows/offpolicy-ppo-expanded.yml)
- [online-live-check.yml](../../../.github/workflows/online-live-check.yml)
- [psro-extended.yml](../../../.github/workflows/psro-extended.yml)
- [psro-ppo.yml](../../../.github/workflows/psro-ppo.yml)
- [qr-20k.yml](../../../.github/workflows/qr-20k.yml)
- [qr-autoresearch.yml](../../../.github/workflows/qr-autoresearch.yml)
- [qr-deep-research.yml](../../../.github/workflows/qr-deep-research.yml)
- [qr-followup.yml](../../../.github/workflows/qr-followup.yml)
- [qr-four-pillars.yml](../../../.github/workflows/qr-four-pillars.yml)
- [research-50k-league.yml](../../../.github/workflows/research-50k-league.yml)
- [sota-attack-lab.yml](../../../.github/workflows/sota-attack-lab.yml)
- [sota-independent-confirm.yml](../../../.github/workflows/sota-independent-confirm.yml)
- [tabular-zoo.yml](../../../.github/workflows/tabular-zoo.yml)
- [v31-large.yml](../../../.github/workflows/v31-large.yml)
- [v31-research.yml](../../../.github/workflows/v31-research.yml)
- [v32-research.yml](../../../.github/workflows/v32-research.yml)
- [v5-apex-research.yml](../../../.github/workflows/v5-apex-research.yml)
- [yahtzeerl-transfer.yml](../../../.github/workflows/yahtzeerl-transfer.yml)

## 맥락 허브의 보존된 문서

- [AI-REVIEW.md](../AI-REVIEW.md)
- [AUTOMATION.md](../AUTOMATION.md)
- [DECISIONS.md](../DECISIONS.md)
- [EXPERIMENT-ZOO-2026-11-20.md](../EXPERIMENT-ZOO-2026-11-20.md)
- [EXPERIMENT-ZOO.md](../EXPERIMENT-ZOO.md)
- [EXTENDED-PSRO-PMF-PPO-RESEARCH.md](../EXTENDED-PSRO-PMF-PPO-RESEARCH.md)
- [EXTENDED-PSRO-PMF-PPO-RESULTS.md](../EXTENDED-PSRO-PMF-PPO-RESULTS.md)
- [FOLLOWUP-V33-V34-V4-ABLATIONS.md](../FOLLOWUP-V33-V34-V4-ABLATIONS.md)
- [FOUNDATION-V4-TOURNAMENT.md](../FOUNDATION-V4-TOURNAMENT.md)
- [FRONTIER-200K-RESEARCH.md](../FRONTIER-200K-RESEARCH.md)
- [FULLGAME-OFFPOLICY-RESEARCH.md](../FULLGAME-OFFPOLICY-RESEARCH.md)
- [HANDOFF.md](../HANDOFF.md)
- [LARGE-SCALE-V32-ROADMAP.md](../LARGE-SCALE-V32-ROADMAP.md)
- [PRODUCT-2026-11-24.md](../PRODUCT-2026-11-24.md)
- [PSRO-PPO-PMF-2026-11-20-FINAL.md](../PSRO-PPO-PMF-2026-11-20-FINAL.md)
- [PSRO-PPO-PMF-RESEARCH.md](../PSRO-PPO-PMF-RESEARCH.md)
- [QR-FOUR-PILLARS-INVALID-RUN.md](../QR-FOUR-PILLARS-INVALID-RUN.md)
- [QR-SUITE-POSTRUN-AUDIT.md](../QR-SUITE-POSTRUN-AUDIT.md)
- [README.md](../README.md)
- [REFERENCES.md](../REFERENCES.md)
- [RESEARCH-50K-FOUR-WAY-LEAGUE.md](../RESEARCH-50K-FOUR-WAY-LEAGUE.md)
- [RESULTS.md](../RESULTS.md)
- [ROADMAP.md](../ROADMAP.md)
- [SELFPLAY-2026-11-20-FINAL.md](../SELFPLAY-2026-11-20-FINAL.md)
- [SELFPLAY-RESEARCH.md](../SELFPLAY-RESEARCH.md)
- [TECHNIQUES.md](../TECHNIQUES.md)
- [V31-RESEARCH.md](../V31-RESEARCH.md)
- [V32-EXACT-FORECAST.md](../V32-EXACT-FORECAST.md)
- [V5-APEX-RESEARCH.md](../V5-APEX-RESEARCH.md)
- [V6-APEX-RESEARCH.md](../V6-APEX-RESEARCH.md)
- [V6-INTEGRATION-HANDOFF.md](../V6-INTEGRATION-HANDOFF.md)

## 최근 Git 커밋 (맥락 자동 커밋 제외)

| 커밋 | 날짜 (Git 기록) | 설명 |
|---|---|---|
| [4e13b12](https://github.com/oyueo-mm/YachtLab/commit/4e13b12) | 2026-11-25 | Merge pull request #80 from oyueo-mm/codex/game-review-product |
| [9c234b6](https://github.com/oyueo-mm/YachtLab/commit/9c234b6) | 2026-11-25 | feat: present completed matches in a full-screen game review |
| [53e9620](https://github.com/oyueo-mm/YachtLab/commit/53e9620) | 2026-11-25 | Merge PR #79: Win DP v6 research (exp-utility policy set, WASM/Rust bank builders, YPB1 codec, analysis v6) |
| [e78a06f](https://github.com/oyueo-mm/YachtLab/commit/e78a06f) | 2026-11-25 | feat(research-v6): integration helpers for Codex — bankFromWasm, YPB1 Float32/INT16 bank codec (+tests, size study), V6-INTEGRATION-HANDOFF |
| [837e305](https://github.com/oyueo-mm/YachtLab/commit/837e305) | 2026-11-25 | docs(v6): H3 and auxiliary confirmation (v6-P vs DP Expert 51.263%), Holm decisions, RESULTS entry |
| [a5eea74](https://github.com/oyueo-mm/YachtLab/commit/a5eea74) | 2026-11-25 | docs(v6): confirmation 9511/9512 results — v6-P beats v5-R head-to-head (50.131%, 50.209%), H2 vs v2 not confirmed; dev 9012 (v6-C/v6-D no gain); correct conclusions across context docs |
| [24f1ddb](https://github.com/oyueo-mm/YachtLab/commit/24f1ddb) | 2026-11-25 | research(v6): MLP-1024 PMF distillation results (3.2% material disagreement) |
| [162e10c](https://github.com/oyueo-mm/YachtLab/commit/162e10c) | 2026-11-25 | research(v6): PMF distillation and hybrid decision-study raw results |
| [152f6c4](https://github.com/oyueo-mm/YachtLab/commit/152f6c4) | 2026-11-25 | docs(v6): recommendations and limitations |
| [a824296](https://github.com/oyueo-mm/YachtLab/commit/a824296) | 2026-11-25 | docs(v6): research report draft (implementation, value accuracy, execution optimisation, analysis-v6 contract, 70-technique status), shared context updates, D-V6-1 |

## 최근 GitHub Actions 상태

- GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회.

| 워크플로 | 최근 완료 상태 | 커밋 |
|---|---|---|
| [YachtLab Win DP v5 research (exact PMF + interactive endgame)](https://github.com/oyueo-mm/YachtLab/actions/runs/45625754318) | success | 7870bda414 |
| [Test and deploy YachtLab](https://github.com/oyueo-mm/YachtLab/actions/runs/45625745422) | cancelled | f486023536 |
| [YachtLab gameplay UI targeted smoke](https://github.com/oyueo-mm/YachtLab/actions/runs/45624810571) | success | e09163e64f |

## 다음 채팅과 작업의 시작점

1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).
2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.
3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.
