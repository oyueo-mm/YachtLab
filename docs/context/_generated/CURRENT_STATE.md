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
- [psro-ppo.yml](../../../.github/workflows/psro-ppo.yml)
- [tabular-zoo.yml](../../../.github/workflows/tabular-zoo.yml)

## 맥락 허브의 보존된 문서

- [AUTOMATION.md](../AUTOMATION.md)
- [DECISIONS.md](../DECISIONS.md)
- [EXPERIMENT-ZOO-2026-11-20.md](../EXPERIMENT-ZOO-2026-11-20.md)
- [EXPERIMENT-ZOO.md](../EXPERIMENT-ZOO.md)
- [HANDOFF.md](../HANDOFF.md)
- [PSRO-PPO-PMF-2026-11-20-FINAL.md](../PSRO-PPO-PMF-2026-11-20-FINAL.md)
- [PSRO-PPO-PMF-RESEARCH.md](../PSRO-PPO-PMF-RESEARCH.md)
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
| [fc6a4ac](https://github.com/oyueo-mm/YachtLab/commit/fc6a4ac) | 2026-11-20 | docs: preserve verified PSRO, empirical PMF and PPO head-to-head experiments |
| [9eff1ea](https://github.com/oyueo-mm/YachtLab/commit/9eff1ea) | 2026-11-20 | research: full PSRO meta-solver, adaptive population, empirical PMF and full-game clipped PPO |
| [df76263](https://github.com/oyueo-mm/YachtLab/commit/df76263) | 2026-11-20 | docs: preserve complete real full-game self-play, opponent modeling and v3 research evidence |
| [361f75d](https://github.com/oyueo-mm/YachtLab/commit/361f75d) | 2026-11-20 | research: train full-game neural REINFORCE and Monte Carlo actor-critic against policy league |
| [d8fa25a](https://github.com/oyueo-mm/YachtLab/commit/d8fa25a) | 2026-11-20 | research: full-game league self-play, policy-gradient and three-turn competitive planning |
| [c5dd0a4](https://github.com/oyueo-mm/YachtLab/commit/c5dd0a4) | 2026-11-20 | docs: preserve 45,784-game algorithm zoo and 12 RL study results |
| [6002008](https://github.com/oyueo-mm/YachtLab/commit/6002008) | 2026-11-20 | research: add eight tabular RL control algorithms for YachtLab Choice benchmark |
| [491abcb](https://github.com/oyueo-mm/YachtLab/commit/491abcb) | 2026-11-20 | research: broad algorithm zoo 58 variants, 4 RL methods and held-out evaluation |
| [0a2402c](https://github.com/oyueo-mm/YachtLab/commit/0a2402c) | 2026-11-20 | docs: persistent YachtLab AI research context hub with daily GitHub/Wiki sync |
| [76f206d](https://github.com/oyueo-mm/YachtLab/commit/76f206d) | 2026-11-20 | research: independently confirm 20k Win DP v2 games and 30k-episode QR-DQN |

## 최근 GitHub Actions 상태

- GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회.

| 워크플로 | 최근 완료 상태 | 커밋 |
|---|---|---|
| [Full-game neural self-play — REINFORCE and Monte Carlo Actor-Critic](https://github.com/oyueo-mm/YachtLab/actions/runs/44725235280) | success | 9eff1ea5eb |
| [YachtLab PSRO + adaptive opponents + empirical PMF + full-game PPO](https://github.com/oyueo-mm/YachtLab/actions/runs/44725235023) | success | 9eff1ea5eb |
| [Test and deploy YachtLab](https://github.com/oyueo-mm/YachtLab/actions/runs/44725234914) | success | 9eff1ea5eb |
| [Full-game self-play and three-turn competitive research](https://github.com/oyueo-mm/YachtLab/actions/runs/44725234905) | success | 9eff1ea5eb |
| [Tabular RL algorithm zoo — last-turn Choice](https://github.com/oyueo-mm/YachtLab/actions/runs/44705368822) | success | 6002008dd8 |

## 다음 채팅과 작업의 시작점

1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).
2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.
3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.
