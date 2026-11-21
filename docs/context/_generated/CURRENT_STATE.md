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
- [neural-selfplay.yml](../../../.github/workflows/neural-selfplay.yml)
- [offpolicy-ppo-expanded.yml](../../../.github/workflows/offpolicy-ppo-expanded.yml)
- [psro-extended.yml](../../../.github/workflows/psro-extended.yml)
- [psro-ppo.yml](../../../.github/workflows/psro-ppo.yml)
- [qr-20k.yml](../../../.github/workflows/qr-20k.yml)
- [qr-autoresearch.yml](../../../.github/workflows/qr-autoresearch.yml)
- [qr-deep-research.yml](../../../.github/workflows/qr-deep-research.yml)
- [qr-followup.yml](../../../.github/workflows/qr-followup.yml)
- [qr-four-pillars.yml](../../../.github/workflows/qr-four-pillars.yml)
- [tabular-zoo.yml](../../../.github/workflows/tabular-zoo.yml)
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

## 최근 Git 커밋 (맥락 자동 커밋 제외)

| 커밋 | 날짜 (Git 기록) | 설명 |
|---|---|---|
| [1a8a43d](https://github.com/oyueo-mm/YachtLab/commit/1a8a43d) | 2026-11-21 | research: evaluate actual pretrained competitive YahtzeeRL network via labeled 12-category zero-shot transfer |
| [6992fa9](https://github.com/oyueo-mm/YachtLab/commit/6992fa9) | 2026-11-21 | research: audit additional independent Yacht opponent source strategies and diagnose competitive losses |
| [2fc4cde](https://github.com/oyueo-mm/YachtLab/commit/2fc4cde) | 2026-11-21 | chore(research): publish external strategy adaptation tournament results [skip ci] |
| [4e82bbd](https://github.com/oyueo-mm/YachtLab/commit/4e82bbd) | 2026-11-21 | research: 12-rule source strategy championship against Rust, Pancht and Benji-inspired opponents |
| [d841906](https://github.com/oyueo-mm/YachtLab/commit/d841906) | 2026-11-21 | chore(research): exact WinDP BR diagnostics and counterfactual audit [skip ci] |
| [bdd7fb6](https://github.com/oyueo-mm/YachtLab/commit/bdd7fb6) | 2026-11-21 | chore(research): exhaustive last-turn WinDP policy error audit [skip ci] |
| [18bac46](https://github.com/oyueo-mm/YachtLab/commit/18bac46) | 2026-11-21 | docs(research): show concrete WinDP versus exact best-response actions for each error |
| [7d61faf](https://github.com/oyueo-mm/YachtLab/commit/7d61faf) | 2026-11-21 | chore(research): exhaustive last-turn WinDP policy error audit [skip ci] |
| [c8d6eae](https://github.com/oyueo-mm/YachtLab/commit/c8d6eae) | 2026-11-21 | research: exhaustively enumerate 100800 last-turn Win DP best-response decision states |
| [2bdec89](https://github.com/oyueo-mm/YachtLab/commit/2bdec89) | 2026-11-21 | research: exact Win DP response, stochastic coupled search, checkpoint stability and supervised teacher study |

## 최근 GitHub Actions 상태

- GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회.

| 워크플로 | 최근 완료 상태 | 커밋 |
|---|---|---|
| [YachtLab independently trained YahtzeeRL checkpoint transfer diagnostic](https://github.com/oyueo-mm/YachtLab/actions/runs/44907769281) | success | 279082ebf4 |
| [YachtLab independent discovered Yacht AI forensic evaluation](https://github.com/oyueo-mm/YachtLab/actions/runs/44907476073) | success | bc448daacf |
| [Test and deploy YachtLab](https://github.com/oyueo-mm/YachtLab/actions/runs/44907331693) | failure | e94804e9f2 |
| [YachtLab external-source strategy championship](https://github.com/oyueo-mm/YachtLab/actions/runs/44905127036) | success | 4e82bbd7c4 |
| [YachtLab exhaustive exact last-turn WinDP error enumeration](https://github.com/oyueo-mm/YachtLab/actions/runs/44900566422) | success | 18bac46f8d |

## 다음 채팅과 작업의 시작점

1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).
2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.
3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.
