# YachtLab 경쟁형 AI 연구 계획 (2026-11-20)

## 연구 질문

기대 최종점수를 최대화하는 DP Expert보다, 대전 승리 점수율을 높이는 전략을 만들 수 있을까? 평균 점수와 승률은 별개의 목표다. 이번 릴리스에서는 마지막 라운드만 경쟁 목적으로 최적화하는 **Win DP**를 실험 모델로 추가한다. 아직 SOTA라는 주장은 하지 않는다.

## Win DP의 정확한 적용 범위

- 마지막 라운드 이전: 기존 DP Expert 정책을 그대로 사용.
- 상대가 12개 카테고리를 모두 끝냈고 내가 마지막 한 칸을 남겼다면: 상대의 확정 점수에 대한 승리 점수율을 주사위 모든 가능한 결과를 열거한 DP로 **정확히 최적화**.
- 두 사람 모두 마지막 한 칸씩 남았고 내가 선공이면: 상대가 DP Expert로 자신의 마지막 한 턴을 완료한다는 **명시적 조건부 가정**으로 상대 최종 점수 분포를 계산. 그 분포에 대한 승리 점수율을 정확한 턴 DP로 최대화.
- 위 조건을 만족하지 못하면 DP Expert로 자동 폴백.
- 상대가 DP Expert 외 다른 AI라면 상대 정책 가정이 맞지 않을 수 있다. 이것은 다인전 전체 최적해가 아니다.
- 알고리즘은 Game.rng와 Game.seed를 읽어 미래 주사위를 예측하지 않는다. 확률적으로 공정한 주사위를 가정하며 상태와 난수 상태는 게임 엔진의 기존 호환성을 유지한다.

## 수학적 모델

현재 기록된 내 총점을 S, 가능한 마지막 주사위 눈 d에 따른 추가 카테고리 점수와 새 상단 보너스를 b(d), 상대 최종 점수의 확률질량함수를 q(t)라 하자.

- Stop(d) = sum over t of q(t) times (1 if S+b(d)>t; 0.5 if equal; else 0).
- W_0(d) = Stop(d).
- W_r(d) = max(Stop(d), maximum over legal held multisets h of E[W_(r-1)(h + independent fair rerolls)]).

동일한 승리 점수율을 얻는 선택에서는 기대점수를 2차 기준으로 비교한다. 기존 252개 정렬된 전체 주사위 조합과 210개 부분 멀티셋의 전이 커널을 재사용한다. 상단 보너스 35점과 63점 경계, 완전한 0점 기록을 모두 반영한다. 상대의 마지막 카테고리 점수분포는 기존 DP Expert처럼 기대점수를 최대로 하는 정책의 모든 주사위 결과를 합산한 값이다.

## 평가 프로토콜

    node scripts/research-competitive.mjs 2000

각 혼합 시드 910000+i에서 Win DP가 먼저, DP Expert가 나중인 경기와 두 AI의 좌석을 맞바꾼 경기를 한 쌍으로 실행한다. 2000경기는 1000개 시드 짝이다. 최근 AI 별 독립 난수 스트림을 적용한 실제 TypeScript match/engine에 의해 모든 12라운드 결과를 얻으며, 실제 승패·평균 총점·최종 라운드에서 기존 DP와 달리 선택한 행동 수를 기록한다.

승리 1, 무승부 0.5, 패배 0의 평균을 승리 점수율로 사용한다. 95% 신뢰구간은 **좌석을 바꾼 두 경기의 시드별 평균**을 독립 관측치로 취급한 정규 근사 CI이다. 같은 시드의 두 경기 간 상관을 무시하고 독립 2000경기로 취급하지 않는다. CI에 0.5가 포함되면 승률 우월성을 확정하지 않는다. 더 높은 신뢰도의 최종 주장에는 독립 미사용 시드, 다양한 상대, 모델/설정 사전 고정과 다중 비교 검정을 추가해야 한다.

GitHub Actions의 Competitive research benchmark를 수동 실행하면 원시 매치 결과 JSON을 artifact로 저장한다. 학습 시드 400000+i, 검증 500000+i, 기존 최종 700000+i와 연구 기준시드가 겹치지 않도록 분리했다.

## 확장 로드맵

| 단계 | 후보 | 핵심 과제 |
|---|---|---|
| C1 | Target-score DP (마지막 2~3개 카테고리) | 정확한 목표 점수 DP와 후반부 확대 |
| C2 | Distributional DP | 단일 고정 정책의 점수 분포와 목표별 최적 정책 차이 명시 |
| C3 | Opponent-aware Distributional Planner | 상대별 점수분포 보정, 정책 불일치 검증 |
| C4 | Stochastic MCTS + DP | 정확한 chance node 및 공정한 계산시간 예산 |
| C5 | C51 / QR-DQN / A2C | 공개 정보만으로 학습, DP 교사 및 목표함수별 비교 |
| C6 | Self-play / League training | 상대별 과적합 방지와 적응형 정책 비교 |
| C7 | Exact-arithmetic/interval verification | Bellman 오차·동가 행동 검증, 독립 엔진 교차검증 |
| C8 | Robustness/Generalization | 상대 알고리즘 다양화, 새로운 시드와 동등 계산 예산 |

실험 결과와 재현 코드를 우선 남기고, 입증되지 않은 세계 SOTA 또는 최적 대전 AI 표시는 금지한다. 높은 점수의 DP는 모델 선택 메뉴에서 그대로 기본 상대와 최고 평균점수 기준을 유지한다.

## 참고문헌

- Jakub Pawlewicz, Towards Optimal Play in Multi-Player Yahtzee (2011): https://doi.org/10.3233/ICG-2011-34103
- Jakub Pawlewicz, A Nearly Optimal Computer Player in Multi-player Yahtzee (2010 preprint): https://www.mimuw.edu.pl/~pan/papers/yahtzee.pdf
- Nicholas A. Pape, Yahtzee: Reinforcement Learning Techniques for Stochastic Combinatorial Games (arXiv:2601.00007): https://arxiv.org/abs/2601.00007
- 내부 문서: training/dp/README.md, benchmarks/v04/REPORT.md

외부 문헌 상당수는 **13개 항목의 미국식 Yahtzee**를 대상으로 한다. YachtLab은 **12개 항목의 한국형 요트다이스**이므로 기대점수·보너스·기록·세계기록을 서로 직접 비교해서는 안 된다.

## 추가 독립 2개 카테고리 완전열거 실험 (2026-11-20)

공정한 5개 6면체 주사위와 턴당 3회 굴림에서 마지막 두 카테고리의 목표 점수 도달 확률을 DP로 정확하게 계산하였다. 기존 기대점수 최적화 정책의 목표 달성률과 비교하고, 헥사/초이스 상단 누적50·추가 목표35 사례는 정책별 50,000회 몬테카를로 검산하였다.

| 남은 카테고리 | 상단 누적 | 추가 목표 | 기대점수 정책 목표 달성률 | 목표 정책 목표 달성률 |
|---|---:|---:|---:|---:|
| 헥사·초이스 | 50 | 35 | 62.721% | 70.321% |
| 스몰·라지 | 63 | 30 | 33.561% | 45.402% |
| 초이스·요트 | 0 | 40 | 6.152% | 8.994% |

몬테카를로 결과: 헥사·초이스 조건에서 기대점수 정책 62.824%, 목표 정책 70.328%. 이는 전체 12라운드 경기 승률이 아니라 특정 두 카테고리 문제에서의 **추가 점수 이상 획득 확률**이다. 반올림 및 수치 오차 수준 이상의 확률 모델 검증을 위해 252개 5주사위 조합과 해당 다항확률을 직접 사용했다.
