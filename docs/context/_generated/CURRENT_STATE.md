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
- [GROWTH-2026-11-26.md](../GROWTH-2026-11-26.md)
- [HANDOFF.md](../HANDOFF.md)
- [LARGE-SCALE-V32-ROADMAP.md](../LARGE-SCALE-V32-ROADMAP.md)
- [ONLINE-YACHT-PRODUCT.md](../ONLINE-YACHT-PRODUCT.md)
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
- [V5-R-PRODUCT.md](../V5-R-PRODUCT.md)
- [V6-APEX-RESEARCH.md](../V6-APEX-RESEARCH.md)
- [V6-INTEGRATION-HANDOFF.md](../V6-INTEGRATION-HANDOFF.md)
- [V7-APEX-RESEARCH.md](../V7-APEX-RESEARCH.md)
- [V7-PRODUCT-HANDOFF.md](../V7-PRODUCT-HANDOFF.md)

## 최근 Git 커밋 (맥락 자동 커밋 제외)

| 커밋 | 날짜 (Git 기록) | 설명 |
|---|---|---|
| [e891c2a](https://github.com/oyueo-mm/YachtLab/commit/e891c2a) | 2026-11-26 | Merge PR #94: CI shards, board-centred online table, guest shop, SEO pages & calculator, result sharing |
| [dfd1ba1](https://github.com/oyueo-mm/YachtLab/commit/dfd1ba1) | 2026-11-26 | docs(context): growth work, decisions D-060..D-065, measured CI timings |
| [ad5163f](https://github.com/oyueo-mm/YachtLab/commit/ad5163f) | 2026-11-26 | feat(seo): search pages, exact odds calculator, real-dice score pad, home title (D-062) |
| [9f61b33](https://github.com/oyueo-mm/YachtLab/commit/9f61b33) | 2026-11-26 | feat(shop): guests browse the shop; buying or drawing asks to sign in and restores the view (D-063) |
| [5954b62](https://github.com/oyueo-mm/YachtLab/commit/5954b62) | 2026-11-26 | feat(table): board-centred 1:1 online table, seat colours, silhouette avatar, no-scroll score sheet, reward toast (D-060) |
| [7d96dba](https://github.com/oyueo-mm/YachtLab/commit/7d96dba) | 2026-11-26 | ci: classify changes, run Vitest and build in parallel, shard Playwright 4x2, gate deploy (D-061) |
| [187b387](https://github.com/oyueo-mm/YachtLab/commit/187b387) | 2026-11-26 | Merge PR #93: Win DP v7.1/v7.2 research (9551 result, single-bank I2RO1 confirmed > v4-D, I3, exact solver K=7) |
| [e7a9933](https://github.com/oyueo-mm/YachtLab/commit/e7a9933) | 2026-11-26 | Add Google Search Console verification meta tag |
| [0fb8443](https://github.com/oyueo-mm/YachtLab/commit/0fb8443) | 2026-11-26 | Merge pull request #92 from oyueo-mm/codex/online-yacht-economy |
| [e638a62](https://github.com/oyueo-mm/YachtLab/commit/e638a62) | 2026-11-25 | research(v7.2): pre-register final free 'very hard' selection games (family 9591) + latency eligibility (Pixel 7 x4 emulation) for I2R1/I2R1W6/I2RO1B3/v5-B3 |

## 최근 GitHub Actions 상태

- GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회.

| 워크플로 | 최근 완료 상태 | 커밋 |
|---|---|---|
| [YachtLab gameplay UI targeted smoke](https://github.com/oyueo-mm/YachtLab/actions/runs/45756594267) | success | dfd1ba174d |
| [Test and deploy YachtLab](https://github.com/oyueo-mm/YachtLab/actions/runs/45756594253) | success | dfd1ba174d |
| [YachtLab Win DP v5 research (exact PMF + interactive endgame)](https://github.com/oyueo-mm/YachtLab/actions/runs/45726546327) | success | 187b387e51 |
| [Deploy YachtLab Online Worker (manual)](https://github.com/oyueo-mm/YachtLab/actions/runs/45717409511) | success | 8e00f3172f |

## 다음 채팅과 작업의 시작점

1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).
2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.
3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.
