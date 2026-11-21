# 독립 경쟁형 YahtzeeRL 신경망 실모델 vs YachtLab Win DP v2

> **매우 중요한 제한:** 원본 YahtzeeRL은 13칸, YachtLab은 12칸이다. 이번 결과는 **원본 13칸 경쟁형 MuZero 신경망의 가중치를 그대로 사용하되 12칸으로 전이(zero-shot)한 실험**이다. 원본 13칸 모델에 대한 공정한 승률이나 원저자의 정식 13칸 MCTS 실행 성능이 아니다. MCTS 재탐색 없이 원본 체크포인트의 greedy policy head만 실행했다.

## 연구 대상

- 외부 공개 코드(커밋 고정): https://github.com/itxtx/yahtzeeRL/tree/603644269dfbe638a082ca7d39317eb7ac2727fd
- 원본 가중치: https://huggingface.co/itxtx/yahtzee-rl-checkpoints
- 원본 학습: 13-category simplified Yahtzee, 2-player self-play, Stochastic MuZero/explicit chance node, margin-shaped terminal reward, checkpoint step_011800
- 원본 보고 성능: 휴리스틱 대비 512게임 승률 81.1%, 모델 자체 정책 head와 MCTS 대국은 50% 근처. 이는 **원본 규칙의 보고된 수치**이므로 아래 12칸 결과와 혼합 금지.
- 변환: Three-of-a-Kind는 양쪽 모두 0으로 이미 기록된 것으로 인코딩하고, 나머지 12칸은 명칭에 따라 맵핑. 하위 족보 실제 점수는 YachtLab 규칙으로 처리하여 원본 학습 분포와 어긋남. 소스의 원래 JAX 모델 구조와 **공개된 가중치를 그대로 로드**함.

## 실측 전이 성능

| 지표 | 결과 |
|---|---:|
| 대국 수 | **320게임** (160 paired seeds, 두 선후공 모두) |
| 실제 사전학습 정책 전이 승리점수율 | **21.875%** |
| Win DP v2 승리점수율 | **78.125%** |
| 전이 정책 95% paired CI | 17.852%–25.898% |
| 원본 체크포인트 정책 평균 점수(12칸 게임) | 153.397 |
| Win DP v2 평균 점수 | 191.619 |
| 상단 보너스(전이 / Win DP v2) | 3.750% / 68.125% |
| 요트(전이 / Win DP v2) | 22.500% / 28.438% |
| 판정 | Win DP v2 wins in this zero-shot transfer test |

### 초반·중반·후반 실제 점수 격차

| 라운드 | 전이 신경망 평균 | Win DP v2 평균 | 격차(전이−v2) | 외부 정책의 솔로 DP regret (표본) |
|---|---:|---:|---:|---:|
| 초반 | 64.622 | 68.041 | -3.419 | 0.978점 (320개) |
| 중반 | 55.031 | 58.731 | -3.700 | 1.353점 (320개) |
| 후반 | 32.431 | 41.003 | -8.572 | 1.554점 (320개) |

### 점수 카테고리별 실제 기록 차이

| 카테고리 | 전이 신경망 | Win DP v2 | 격차 |
|---|---:|---:|---:|
| aces | 1.184 | 1.778 | -0.594 |
| deuces | 3.825 | 5.313 | -1.487 |
| threes | 6.572 | 8.719 | -2.147 |
| fours | 9.238 | 12.000 | -2.762 |
| fives | 12.469 | 15.688 | -3.219 |
| sixes | 15.769 | 19.556 | -3.787 |
| choice | 22.506 | 22.700 | -0.194 |
| four | 14.403 | 11.406 | 2.997 |
| full | 14.556 | 18.475 | -3.919 |
| small | 14.719 | 14.578 | 0.141 |
| large | 25.594 | 23.344 | 2.250 |
| yacht | 11.250 | 14.219 | -2.969 |

### 관측된 큰 솔로 DP 기대점수 손실 사례

- 10라운드, 주사위 5·3·5·1·5 / 외부 신경망 fives vs DP Expert keep:555 / 솔로 기대점수 손실 10.052점
- 2라운드, 주사위 3·2·2·3·3 / 외부 신경망 full vs DP Expert keep:333 / 솔로 기대점수 손실 10.035점
- 10라운드, 주사위 3·3·6·4·5 / 외부 신경망 keep:3456 vs DP Expert keep:33 / 솔로 기대점수 손실 9.894점
- 10라운드, 주사위 6·2·5·6·6 / 외부 신경망 sixes vs DP Expert keep:666 / 솔로 기대점수 손실 9.270점
- 10라운드, 주사위 5·6·6·4·4 / 외부 신경망 keep:4456 vs DP Expert keep:4466 / 솔로 기대점수 손실 8.239점
- 10라운드, 주사위 3·6·6·5·1 / 외부 신경망 sixes vs DP Expert keep:66 / 솔로 기대점수 손실 7.928점
- 10라운드, 주사위 4·4·4·1·2 / 외부 신경망 fours vs DP Expert keep:444 / 솔로 기대점수 손실 7.890점
- 10라운드, 주사위 4·2·1·1·4 / 외부 신경망 fours vs DP Expert keep:44 / 솔로 기대점수 손실 7.890점

## 학습할 점과 정확한 해석

- **정확한 주사위 chance node:** 원래 YahtzeeRL은 252개 멀티셋의 정확한 전이확률을 사용하므로, 단순 랜덤 rollout보다 더 안정적인 검색 학습 신호를 만들 수 있다. YachtLab Win DP v2도 exact chance 백업을 쓰지만, 이 방식을 **신경망 교사 학습과 결합**하는 점이 참고할 부분이다.
- **MCTS-정책 증류:** 원본은 깊이별 노이즈가 적은 방문횟수(target)를 정책 헤드에 학습한다. 원본에서는 MCTS와 greedy head의 512게임 대결이 대부분 비등해 장기적으로 저지연 정책을 얻는 효과를 보여준다.
- **상대 점수차를 보상에 반영:** 원저자는 terminal outcome sign과 score-margin의 tanh를 혼합한다. 단순 승/패만 최종 보상으로 쓰는 정책보다 학습 안정성을 높일 가능성이 있으나, YachtLab에 효과가 있다는 것은 별도의 실험으로 입증해야 한다.
- **훈련 체크포인트 회귀:** 더 학습한 모델이 약해져 이전 체크포인트가 선택됐다. YachtLab QR-DQN에서 찾은 현상과 유사하나 같은 원인이라고 확정할 수 없으며, 시드·독립 검증이 필요하다.
- **동일 규칙 재학습 필요:** 13칸 학습 모델을 12칸으로 zero-shot 전이시키면 정책 순위와 기대점수가 무너질 수 있다. 이번에 전이 모델이 패배했다면 단정적으로 원본 강자보다 Win DP v2가 강하다고 해석하면 안 된다. 제대로 된 검증은 12칸 룰로 학습하거나 원본 13칸 룰에 Win DP 계열을 이식해야 한다.

## 재현 정보

- 대국 난수: YachtLab의 player-independent public dice RNG, same seed and swapped seats; 160 independent paired seeds.
- 체크포인트는 CI 실행 시 Hugging Face에서 내려받으며, 모델 파일은 **YachtLab 저장소에 복사·배포하지 않음**.
- 원본 코드 고정 커밋, checkpoint step_011800; 모델의 실제 외부 JAX 추론을 stdout bridge로 호출한 기록과 원시 게임 데이터는 GitHub Actions artifacts에 보존.
- Win DP v2 기본 정책은 수정하지 않았다.
