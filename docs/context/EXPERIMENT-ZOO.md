# 대량 알고리즘 실험 (Algorithm Zoo)

**목적:** DP만이 아니라 다양한 AI 계열과 매개변수 조합을 최대한 많이 실제 닌텐도식 Yacht Dice에서 평가한다.

**중요:** 58개 **정책 후보/설정**이 모두 독립적인 새로운 알고리즘이라는 뜻은 아니다. DP/승률 DP/탐색/위험조절/카테고리 선호 등 여러 **계열**의 정책 설정을 구분해 비교한다. 별도로 REINFORCE, A2C, DQN, Double DQN 등 **서로 다른 학습 원리**의 실험도 수행하되, 우선 마지막 한 칸 Choice로 범위를 제한한다.

## 연구 구현

- [실제 12라운드 정책 실험](../../scripts/sweep-algorithms.mjs)
- [4종 강화학습·4종 대조군 학습/평가](../../training/choice_rl_zoo.py)
- [GitHub Actions 자동 실험](../../.github/workflows/algorithm-zoo.yml)
- [실제 CI 실행 결과가 기록되는 최신 보고서](./_generated/LATEST_EXPERIMENT.md) (실행 성공 이후 생성)
- [모든 정책의 설정과 통계 JSON](./_generated/zoo-summary.json) (실행 성공 이후 생성)

## 정책 탐색 연구 계열

| 계열 | 실험 내용 | 핵심 변경 |
|---|---|---|
| Baseline | DP Expert, Win DP v1, Win DP v2 | 비교 기준/보존 모델 |
| Legacy Greedy / Expectimax | 기존 비-DP 알고리즘 | 근사 효용과 턴 기댓값 |
| Legacy MCTS | 32·96·256회 UCT 설정 | 샘플 기반 현재 턴 탐색 |
| Balance Gate | 예측 승패 균형 근처만 Win DP v2 | 사용 시점 선택 |
| Trailing Gate | 예상 점수차가 특정 값 이하일 때 Win DP v2 | 불리한 상황에 집중 |
| DP-Loss Cap | Win DP v2가 포기하는 **기대점수**의 최대량 제한 | 승률/점수의 절충 |
| Adaptive Loss Cap | 뒤지고 있을수록 더 큰 기대점수 손실을 허용 | 경기 상황 적응 |
| Competitive Win-Value Gate | 승리 예측값이 50% 근처일 때만 Win DP v2 | 가치 불확실성 처리 |
| Risk Proxy | DP Q에 주사위 수·잔여 라운드 기반 변동성 **대리값** 추가 | 위험 성향 변화 |
| Category Prior | 상단/요트/스트레이트 점수 기록 선호도 추가 | 점수판 조합 실험 |
| DP-Guided UCB | 16·48·96회 확률 롤아웃 | 샘플 탐색 |
| Conditional UCB | 예상 점수차를 기준으로 3칸 남았을 때만 탐색 | 상황적 탐색 |

여기서 **Risk Proxy는 통계적으로 보정된 분산/승리 확률이 아니다**. 대리 변동성 지표에 따른 휴리스틱 실험이며 결과가 좋아도 그 사실을 별도로 증명해야 한다.

## 강화학습 (서로 다른 실제 구현)

- **REINFORCE:** 최종 이진 보상을 policy gradient로 학습; moving-average baseline 사용.
- **A2C:** 정책 손실 + critic 가치 오차로 함께 학습.
- **DQN:** Q-learning, replay buffer, target network.
- **Double DQN:** 행동 선택과 대상 가치 평가를 별도 네트워크로 수행.
- 기존 연구용 QR-DQN은 [이전 실험](./RESULTS.md)의 비교 참고 기준.
- 대조군: 즉시 종료, 무작위 고정, 5·6만 고정, 4·5·6 고정.

**엄격한 한계:** 강화학습 4종은 **Choice 1개 카테고리(목표≥25점)**에서만 훈련된다. 이 실험의 점수는 12카테고리 실제 대전 승률과 비교하지 않는다. 그 환경의 정확한 목표점수 DP 기준은 약 41.671%이다.

## 경쟁 리그의 세 단계와 선택 편향 통제

1. **스크리닝:** 여러 후보(비용이 큰 MCTS/Expectimax는 더 적은 시드) × DP Expert 기준. 상대·주사위 규칙 통일, 선후공 교대.
2. **재평가:** 탐색에 쓰지 않은 새 시드 구간에서 상위 후보 12종과 원본 Win DP v2의 동일 상대 비교.
3. **최종 확증:** 2차 데이터만 보고 대표 후보 **한 개를 고정한 뒤**, 새로운 시드로 DP Expert 및 **Win DP v2와 직접 대국**. 그 결과로만 미사용 시드 조건의 개선을 평가.

- 유의확률/95% 신뢰구간은 **동일 시드에 좌석을 교대하는 두 게임의 평균**을 하나의 관측치로 다룬 정규 근사.
- 시드 구간은 과거 2026-11-20의 910000/930000/1100000/1350000대 연구 평가와 분리.
- 여러 후보를 탐색하고 가장 높은 사람만 보고하면 **선택 편향**이 발생한다. 예선 최고 승률은 절대 확증 성과로 취급하지 않는다.
- 최종 확증 시에도 여러 후보·상대에 대한 보정을 자동으로 적용하지 않으므로, 큰 범위의 SOTA 주장은 별도 학술적 검증이 필요.
- MCTS류는 DP보다 판단 비용이 클 수 있으므로 판단 ms/게임을 반드시 같이 기록.
- 상대별 독립 주사위 PRNG를 게임 엔진이 관리하고, 연구 정책은 미래 난수 상태를 입력 피처로 읽지 않는다. 현재 공개 Game 타입의 seed/rng 경계를 별도로 정리하는 것은 향후 과제.

## 결과 기록 규칙

성공한 Actions 실행은 전체 후보 스캔과 최종 개별 경기 JSON을 Artifacts에 저장하고, 저장소에는 **요약 결과를 자동 커밋**한다.

링크: [최신 결과](./_generated/LATEST_EXPERIMENT.md), [JSON 요약](./_generated/zoo-summary.json), [기존 확증 결과](./RESULTS.md).

실험이 실패했다면 GitHub Actions의 실패 로그를 보관하고, 결과를 성공한 것처럼 기록하지 않는다. 개별 게임 JSON은 리포지토리에 강제로 넣지 않으며 만료 전 Actions에서 확인 가능하다.

## 실행

```sh
npm ci
node scripts/sweep-algorithms.mjs --smoke
node scripts/sweep-algorithms.mjs
python -m pip install numpy torch
python training/choice_rl_zoo.py --episodes 9000 --eval 5000 --seed 27111
```

연구 결과가 좋다고 해도 기존 AI 기본값을 자동 변경하거나 모델을 직접 배포하지 않는다. 연구 후보가 충분히 검증되면 별도 PR로 사용자 기능에 도입한다.

## 별도 표형 강화학습 알고리즘 8종

- [실제 구현](../../training/tabular_choice_zoo.py) · [자동 실험 워크플로](../../.github/workflows/tabular-zoo.yml)
- **Q-learning, SARSA, Expected SARSA, Double Q-learning, First-Visit Monte Carlo Control, Dyna-Q, UCB Q-learning, Optimistic Q-learning** 총 8종을 별도 훈련한다.
- 학습: 각 250,000에피소드, 테스트: 정책별 독립 미사용 10,000게임, 모델 Q-테이블과 학습 곡선 결과 저장.
- 대상 상태: 정렬된 5개 주사위 252개 조합 × 남은 재굴림 3개 상태, 초이스에서 25점 이상 획득 여부. **전체 12라운드 요트다이스 모델이 아니다.**
- 비교 대조군: 5·6만 유지, 4 이상 유지, 랜덤. 본 실험의 정확 목표 DP 성능 기준은 약 41.671%.
- 본 연구 계열은 Deep RL과 다른 **표 기반 강화학습** 방법이다. 초이스 축소 환경의 실험을 전체 YachtLab 승률이라고 보고하지 않는다.

## 실제 실행 결과 안내 (2026-11-20)

[최종 보고서](./EXPERIMENT-ZOO-2026-11-20.md)에서 **58개 전체 게임 정책·설정, 총 45,784경기 및 딥/표형 RL 12종**의 결과를 확인. 선별된 정책의 독립 우월성은 **미입증**이므로 Win DP v2를 유지함. [대량 연구 CI](https://github.com/oyueo-mm/YachtLab/actions/runs/44704462236), [표형 RL CI](https://github.com/oyueo-mm/YachtLab/actions/runs/44705368822).
