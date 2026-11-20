# YachtLab 통합 경쟁형 AI 연구 (2026-11-20)

## 목적과 범위

닌텐도식 Yacht Dice 12개 카테고리, 주사위 5개, 턴당 3회 굴림, 상단 63점 +35점 규칙만 대상으로 한다. 연구의 목표함수는 승리 1 / 무승부 0.5 / 패배 0 의 기대값이다. 기존 DP Expert는 단독 전체 게임 기대점수 최적화 정책이므로 비교 기준을 유지한다. 미국식 13개 카테고리 Yahtzee 성적과 비교하지 않는다.

이번 릴리스는 **다섯 영역을 단일 연구 파이프라인으로 구성**한 것이며, 실험 후보를 세계 SOTA라고 표시하지 않는다.

## 1. 마지막 두 카테고리 정확 승률 DP

파일: src/competitive-v2.ts

- 자신의 마지막 두 카테고리까지 승률을 최적화하고, 마지막 한 개는 기존 Win DP를 재사용한다. 그 이전에는 DP Expert를 호출한다.
- 상대의 남은 0~2개 카테고리의 예상 결과가 필요하다.
- 주사위 252개 전체 멀티셋, 210개 부분 멀티셋, 공정 확률 전이를 완전 탐색한다.
- 승률 값이 동률이면 기대점수를 두 번째 선택 기준으로 사용한다.
- 상대 고정 정책 가정 아래 정확한 계산이며, 전체 2인전 게임 이론적 최적해는 아니다.

## 2. 상대 최종 점수분포

함수: dpOpponentGains(mask, upper)

- 남은 0개는 고정 점수, 1개는 기존 한 턴 DP 정책 점수분포, 2개는 DP Expert 정책의 첫 턴 선택과 두 번째 턴의 조건부 분포를 모두 합산한다.
- 각 확률질량의 합은 1이며 평균은 기존 DP 미래 가치와 일치해야 한다(교차 단위테스트).
- 상단 63점의 새 35점 보너스를 포함한다.
- 상대가 실제 DP Expert를 쓰는 경우에만 상대 모델이 맞다. 사람, Greedy, Win DP와 같은 상대에게 같은 분포라고 주장하지 않는다.

## 3. 실제 경기 리그

- Win DP v2는 기존 AI와 독립적으로 선택 가능. 기본 상대와 기존 모델 파일은 변경하지 않는다.
- DP Expert, Win DP, Greedy 상대의 양 좌석 대전, 별도 시드, 승률 신뢰구간, 각 경기 원시 데이터 보존.
- 한 시드를 사용한 선후공 2경기를 한 쌍으로 취급한 근사 신뢰구간을 계산한다.
- 독립 미사용 시드를 확보하지 않고 튜닝과 최종 성능 평가를 혼합하지 않는다.

## 4. DP-guided 확률 탐색

파일: src/research-guided-mcts.ts

- DP 전체 게임 Q값으로 루트 행동 후보를 선별하고 UCB로 주사위 확률 시나리오를 샘플링한다.
- 현재 턴 종료 후는 DP 미래 기대점수로 근사한다.
- 상대의 미래 **평균** 점수와 시그모이드 변환으로 평가하므로 이 수치는 실제 승리 확률이 아니다.
- 연구 후보 Guided MCTS는 성능 확인 전 공개 AI 목록에 넣지 않는다.
- 숨겨진 엔진 RNG나 seed를 사용하여 미래 주사위를 예측하지 않는다.

## 5. 학습 모델과 교차 검증

파일: training/qr_dqn_choice.py, scripts/research-league.mjs

- QR-DQN 최소 실험: 마지막 남은 초이스 카테고리, 다섯 주사위, 최대 3회 굴림, 목표 25점 달성 확률. 31차원 관측, 33개 행동, 16 quantiles, experience replay, target network, quantile Huber 학습.
- 학습 6,000 에피소드, 별도 3,000 에피소드 평가, 결과 JSON과 모델 체크포인트를 Actions 아티팩트에 보존한다.
- 한 카테고리 실험은 전체 게임 강화학습 결과나 세계 SOTA라는 의미가 아니다.
- 리그의 Hybrid 조건을 파라미터 탐색으로 선택하고 독립 검증 구간에서 비교한다. 이는 신경망 강화학습과 다른 방법론이다.

## 실행

- npm ci && npm test && npm run build
- node scripts/research-league.mjs --smoke
- node scripts/research-league.mjs
- python training/qr_dqn_choice.py --episodes 6000 --eval 3000 --seed 26020
- GitHub Actions: .github/workflows/integrated-research.yml

PR에서는 브라우저/단위/빌드와 연구용 소규모 스모크 테스트를 검증하고, main 반영 뒤 연구 전체 리그 및 QR-DQN 학습을 실행한다.

## 검증과 해석

실제 승률, 평균 점수, 원시 결과, 상대 정책 가정, 실행시간, CI 실패까지 모두 보존한다. 95% 구간이 50%를 넘었다는 사실만으로 모든 상대에게 강하거나 세계 최고 모델이라고 주장하지 않는다. 신규 실험 시드(1100000~)는 이전 910000/930000 세트 및 기존 학습/검증 세트와 구별한다.

## 참고문헌

- Jakub Pawlewicz, Towards Optimal Play in Multi-Player Yahtzee (2011): https://doi.org/10.3233/ICG-2011-34103
- James Glenn, An Optimal Strategy for Yahtzee: https://gunpowder.cs.loyola.edu/~jglenn/research/optimal_yahtzee.pdf
- Nicholas A. Pape, Yahtzee: Reinforcement Learning Techniques for Stochastic Combinatorial Games: https://arxiv.org/abs/2601.00007
