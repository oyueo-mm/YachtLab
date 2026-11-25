# YachtLab 맥락 허브

> 새 채팅, 새 개발 도구, 새 팀원이 **이 페이지부터** 읽도록 만든 단일 진입점.
> 원본은 GitHub 저장소의 docs/context/이며, Wiki가 연결되면 이 문서를 동기화한다.
> 원칙: 실제 코드와 실험 증거 > 재현 가능 보고서 > 연구 제안. 실험 전 가설을 성과처럼 기록하지 않는다.

## 30초 만에 현재 프로젝트 파악

- 프로젝트: Nintendo-style **Yacht Dice**, 12카테고리, 주사위 5개, 최대 3회 굴림, 상단 63점 이상 +35점.
- 목적 1: **단독 기대점수** 최대화. 기본 기준선 DP Expert, 완전 게임 DP 계산의 초기 기대점수 **191.760879752165점**.
- 목적 2: **1:1 승리 점수율** 최대화. 승리=1, 무승부=0.5, 패배=0. DP Expert보다 근소하게 높은 경쟁형 모델 Win DP / Win DP v2 개발.
- 최근 확인된 직접 경기: Win DP v2 vs DP Expert **20,000경기에서 50.630%**, 근사 95% CI **50.406~50.854%**. Win DP v2 vs Win DP **10,000경기에서 50.435%**, 95% CI **50.132~50.738%**.
- **주의:** 미국식 13카테고리 Yahtzee가 아님. 게임 엔진의 시드/난수 내부 상태를 AI에 유출해 다음 눈을 예측하도록 하는 것은 연구 공정성을 해침.
- 목표: DP 외 모든 접근을 허용하되, 실제 경쟁 승률/공정한 검정/추론 비용으로 모델을 선택한다. 현재 세계 SOTA 주장은 하지 않는다.

## 맥락 내비게이션

**경제(재화·퀘스트·업적·가격) 연구:** [경제 연구 보고서](../economy/ECONOMY-RESEARCH.md) · [1차 결과](../economy/RESULTS-GENERATED.md) · [2차 추가 검증](../economy/FOLLOWUP-GENERATED.md) · [온라인 매칭·관전방 계획](../online/MATCHMAKING-SPECTATE-PLAN.md) · [저장 쓰기·AI 대전 보안](../online/STORAGE-AND-AI-MATCH-SECURITY.md) · 결정 D-029~D-037.

**제품(게임·온라인·계정) 작업:** [제품 개발 현황 2026-11-24](./PRODUCT-2026-11-24.md) · [온라인 소셜·계정 설계](../online/SOCIAL-AND-ACCOUNTS.md) · [모바일 성능·UI (PR A)](../ui/PHASE-A-2026-11.md) · 결정 D-025~D-028.

**[Win DP v5 연구 — 정확 정책 PMF·정확 2인 종반·PMF 롤아웃 (2026-11-25)](./V5-APEX-RESEARCH.md)** — 전 상태 정확 DP Expert PMF 은행, 정확 expectiminimax 종반, v5-R(Apex 주 후보) 확증 대국. 연구 브랜치, 기본 AI 불변.

**[Win DP v3.1 연구 계획·한계·독립 실험](./V31-RESEARCH.md)** — 3턴 v3와 마지막 1턴 정확 BR을 결합한 연구용 후보. 결과는 자동 검증 후 [_generated/V31-LATEST.md](./_generated/V31-LATEST.md)에 기록되며 **현재 SOTA 주장이 아님**.


| 문서 | 먼저 확인할 내용 |
|---|---|
| **[전체 게임 강화학습 5계열 + PPO 2배 확대](./FULLGAME-OFFPOLICY-RESEARCH.md)** | Double Dueling/PER, QR-DQN, ExIt, Dyna-Q, Discrete SAC 및 98,304 PPO 학습 |
| [전체 게임 RL 다섯 알고리즘 자동 결과](./_generated/FULLGAME-RL-ZOO-LATEST.md) | 실제 12라운드 학습/독립 대전/실패 모델 포함 |
| [PPO 2배 학습 자동 결과](./_generated/PPO-HIGH-BUDGET-LATEST.md) | 기존 49,152게임과 비교, 3시드×2모델×16,384게임 |
| **[대량 실험 최종 보고서](./EXPERIMENT-ZOO-2026-11-20.md)** | 58개 정책 설정/45,784경기와 12개 학습 모델의 실제 결과, 실패 사례·신뢰구간 |
| [알고리즘 대량 실험](./EXPERIMENT-ZOO.md) | 58개 후보/설정, 4종 강화학습 파일럿, 대규모 경기 리그 및 결과 자동 기록 |
| [최신 대량 실험 결과 (자동)](./_generated/LATEST_EXPERIMENT.md) | 실제 연구 워크플로 실행 성공 후 생성되는 결과 |
| **[전체 게임 자기 대국·Win DP v3 연구](./SELFPLAY-RESEARCH.md)** | 진화적 리그, 실제 게임 승패 REINFORCE, 상대 모델링, 마지막 3개 카테고리 솔버 |
| **[자기 대국·경쟁 v3 종합 결과](./SELFPLAY-2026-11-20-FINAL.md)** | 전체 게임 학습 2계열·상대분포·v3, 신경망 전체게임 강화학습, 독립 검증 결과 |
| [전체 게임 신경망 자기 대국](./SELFPLAY-RESEARCH.md#후속-실제-12라운드-신경망-자기-대국) | REINFORCE와 Monte-Carlo actor-critic, DP-Q 기반 12→12→1 신경망 |
| [신경망 자기 대국 자동 결과](./_generated/NEURAL-SELFPLAY-LATEST.md) | 성공한 실제 학습 및 확증 경기의 기록 |
| **[확장 PSRO 오라클·점수판 조건부 PMF 실제 결과](./EXTENDED-PSRO-PMF-PPO-RESULTS.md)** | 새 오라클 vs 기존 정책의 paired CI, Greedy 상대 CRPS 개선, v3 독립 대전 |
| **[PSRO 오라클·점수판 조건부 PMF·대규모 PPO](./EXTENDED-PSRO-PMF-PPO-RESEARCH.md)** | 오라클 실제 대응력, 게임 상태별 점수분포, 3시드/49,152게임 학습 실험 |
| [PSRO 오라클 독립 평가](./_generated/PSRO-ORACLE-AUDIT.md) | 매 PSRO 단계의 새 oracle vs 기존 최강 정책의 독립 승률·paired CI |
| [점수판 조건부 PMF 결과](./_generated/SCORECARD-PMF-LATEST.md) | scorecard mask/upper/current/DP projected 조건부 CRPS 검증 |
| [PPO 3시드 대규모 결과](./_generated/PPO-MULTISEED-LATEST.md) | seed간 안정성, 기준 모델·PPO·PPO+teacher 교차 대전 |
| **[PSRO·PPO·상대 PMF 본실험 최종 결론](./PSRO-PPO-PMF-2026-11-20-FINAL.md)** | 7정책 모집단의 Nash 혼합, PPO·PMF 실제 결과, 독립 승률 검증 |
| **[PSRO·PPO·이산 점수분포 연구](./PSRO-PPO-PMF-RESEARCH.md)** | 실제 메타게임 Nash 솔버, 적응형 상대 리그, PMF 검정, clipped PPO |
| [PSRO 실제 메타게임 결과](./_generated/PSRO-LATEST.md) | 새 오라클에 따라 바뀌는 혼합 정책과 제한게임 exploitability |
| [상대 이산 점수분포 평가](./_generated/PMF-LATEST.md) | Gaussian vs PMF CRPS·로그우도 비교 |
| [전체 게임 PPO 실제 결과](./_generated/PPO-LATEST.md) | PPO vs PPO+DP teacher KL 및 Win DP v2 확증 |
| [자기 대국 최신 자동 실험](./_generated/SELFPLAY-LATEST.md) | GitHub Actions가 본실험 성공 후 최종 후보와 독립 검증 결과를 기록 |
| [현재 상태 — 자동 생성](./_generated/CURRENT_STATE.md) | 현재 브랜치 코드로 확인한 AI·카테고리·최근 변경 사항 |
| [실험 결과·검증 근거](./RESULTS.md) | 직접 수행한 비교, 게임 수, 신뢰구간, 평가상의 한계 |
| [전체 AI 알고리즘 후보 도감](./TECHNIQUES.md) | 확률/DP/탐색/RL/자기 대국/진화/하이브리드 전 후보 |
| [연구 우선순위·백로그](./ROADMAP.md) | 실험 완료·미완료·우선 연구 방향과 승인 기준 |
| [설계 의사결정](./DECISIONS.md) | 규칙/보상/난수/검증/배포/되돌리기 정책 |
| [논문과 출처](./REFERENCES.md) | 원 논문·공식 문서와 적용 가능 범위 |
| [다음 채팅 인수인계](./HANDOFF.md) | AI에게 그대로 전달할 조사 순서와 작업 지침 |
| [맥락 갱신 방식](./AUTOMATION.md) | GitHub Actions 자동화 범위, 한계, 실패 복구 |

## 실제 구현 참고

- 코드: [엔진](../../src/engine.ts), [AI 목록](../../src/ai.ts), [단독 DP](../../src/dp.ts), [Win DP](../../src/win-dp.ts), [Win DP v2](../../src/competitive-v2.ts)
- 연구용: [확률 탐색](../../src/research-guided-mcts.ts), [QR-DQN 파일럿](../../training/qr_dqn_choice.py)
- 원래 연구 문서: [DP](../../training/dp/README.md), [경쟁형 v1](../COMPETITIVE-RESEARCH.md), [경쟁형 v2 및 연구 파일럿](../INTEGRATED-RESEARCH.md)
- 실제 워크플로: [배포](../../.github/workflows/deploy.yml), [리그](../../.github/workflows/integrated-research.yml), [대규모 확증](../../.github/workflows/confirm-v2.yml)

## 문서 정확성 규칙

1. **자동 생성 상태**는 코드와 Git 기록에서 읽은 사실만 정리한다. 성능 개선·SOTA는 자동으로 판정하지 않는다.
2. **수동 연구 기록**은 실험의 동일 규칙·상대·시드·예산과 출처 링크를 반드시 남긴다.
3. 아이디어와 실제 구현, 예비 결과와 최종 확증 결과를 명확하게 구분한다.
4. 새 모델 개발/비교 후 ROADMAP, RESULTS, DECISIONS에서 영향을 받은 항목을 갱신한다.
5. 한 채팅의 추정·합의가 자동으로 GitHub에 업로드되지는 않는다. GitHub에 **커밋된 변화**와 주기적으로 확인 가능한 저장소 메타데이터가 자동 동기화 대상이다.
