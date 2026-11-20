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

| 문서 | 먼저 확인할 내용 |
|---|---|
| **[대량 실험 최종 보고서](./EXPERIMENT-ZOO-2026-11-20.md)** | 58개 정책 설정/45,784경기와 12개 학습 모델의 실제 결과, 실패 사례·신뢰구간 |
| [알고리즘 대량 실험](./EXPERIMENT-ZOO.md) | 58개 후보/설정, 4종 강화학습 파일럿, 대규모 경기 리그 및 결과 자동 기록 |
| [최신 대량 실험 결과 (자동)](./_generated/LATEST_EXPERIMENT.md) | 실제 연구 워크플로 실행 성공 후 생성되는 결과 |
| **[전체 게임 자기 대국·Win DP v3 연구](./SELFPLAY-RESEARCH.md)** | 진화적 리그, 실제 게임 승패 REINFORCE, 상대 모델링, 마지막 3개 카테고리 솔버 |
| [전체 게임 신경망 자기 대국](./SELFPLAY-RESEARCH.md#후속-실제-12라운드-신경망-자기-대국) | REINFORCE와 Monte-Carlo actor-critic, DP-Q 기반 12→12→1 신경망 |
| [신경망 자기 대국 자동 결과](./_generated/NEURAL-SELFPLAY-LATEST.md) | 성공한 실제 학습 및 확증 경기의 기록 |
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
