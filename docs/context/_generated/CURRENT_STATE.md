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
| [a5cc3f4](https://github.com/oyueo-mm/YachtLab/commit/a5cc3f4) | 2026-11-21 | research: independently confirm v3, MCTS and conditional BR improvements with 10000 more 12-rule games |
| [dcab43d](https://github.com/oyueo-mm/YachtLab/commit/dcab43d) | 2026-11-21 | chore(research): publish six-policy SOTA attack benchmark [skip ci] |
| [cba6700](https://github.com/oyueo-mm/YachtLab/commit/cba6700) | 2026-11-21 | research: evaluate opponent-specific BR, forecast DP, MCTS, neural distillation and new full-turn QR retraining |
| [c77f8cc](https://github.com/oyueo-mm/YachtLab/commit/c77f8cc) | 2026-11-21 | chore(research): publish independent trained 12-category DQN vs Win DP v2 [skip ci] |
| [15b4443](https://github.com/oyueo-mm/YachtLab/commit/15b4443) | 2026-11-21 | research: benchmark authentic 12-category pretrained Yacht DQN against Win DP v2 with 2000 paired games |
| [86664e5](https://github.com/oyueo-mm/YachtLab/commit/86664e5) | 2026-11-21 | chore(research): publish authentic YahtzeeRL checkpoint transfer diagnostics [skip ci] |
| [637baec](https://github.com/oyueo-mm/YachtLab/commit/637baec) | 2026-11-21 | chore(research): publish discovered Yacht source adversaries' loss analysis [skip ci] |
| [820b619](https://github.com/oyueo-mm/YachtLab/commit/820b619) | 2026-11-21 | fix(research): reliably download independently trained YahtzeeRL checkpoint artifacts |
| [1a8a43d](https://github.com/oyueo-mm/YachtLab/commit/1a8a43d) | 2026-11-21 | research: evaluate actual pretrained competitive YahtzeeRL network via labeled 12-category zero-shot transfer |
| [6992fa9](https://github.com/oyueo-mm/YachtLab/commit/6992fa9) | 2026-11-21 | research: audit additional independent Yacht opponent source strategies and diagnose competitive losses |

## 최근 GitHub Actions 상태

- GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회.

| 워크플로 | 최근 완료 상태 | 커밋 |
|---|---|---|
| [YachtLab SOTA candidate independent large-sample confirmation](https://github.com/oyueo-mm/YachtLab/actions/runs/44910398610) | success | e64f8c6f06 |
| [YachtLab SOTA challenger research 4-pillars](https://github.com/oyueo-mm/YachtLab/actions/runs/44910090422) | success | c35c6c0031 |
| [Test and deploy YachtLab](https://github.com/oyueo-mm/YachtLab/actions/runs/44910007931) | failure | 6394cf2b36 |
| [YachtLab actual 12-category pretrained DQN independent competition](https://github.com/oyueo-mm/YachtLab/actions/runs/44909157511) | success | 15b4443509 |
| [YachtLab independently trained YahtzeeRL checkpoint transfer diagnostic](https://github.com/oyueo-mm/YachtLab/actions/runs/44908082097) | success | 820b619737 |
| [YachtLab independent discovered Yacht AI forensic evaluation](https://github.com/oyueo-mm/YachtLab/actions/runs/44907575575) | success | 6992fa901e |

## 다음 채팅과 작업의 시작점

1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).
2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.
3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.
