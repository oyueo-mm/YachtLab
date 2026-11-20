# 2026-11-20 PSRO·상대 적응형 자기 대국·경험적 PMF·전체게임 PPO 최종 보고서

> **실제 CI 완료 및 독립 대전 검증 기록.** 신규 연구 코드는 실제 YachtLab 12카테고리 닌텐도식 규칙에서 구현/실행됐다. **기존 Win DP v2보다 강한 새 AI는 독립 확증으로 입증되지 않았다.** 기존 AI와 사용자 기본값을 유지한다.

## 근거 · 재현

- 원본 구현 및 리뷰: [GitHub PR #14](https://github.com/oyueo-mm/YachtLab/pull/14) (merge commit `9eff1ea5ebc8426ae0adcfda12879e6b2bdea9fc`).
- [성공한 본실험 Actions](https://github.com/oyueo-mm/YachtLab/actions/runs/44725235023), 원시 JSON/학습 모델/정책 분포 아티팩트 3개.
- [PSRO 자동 전체 요약](./_generated/PSRO-LATEST.md) · [상대 분포 확증 요약](./_generated/PMF-LATEST.md) · [PPO 자동 확증 결과](./_generated/PPO-LATEST.md).
- [실험 코드·가설·프로토콜](./PSRO-PPO-PMF-RESEARCH.md), [기존 자기대국 연구](./SELFPLAY-2026-11-20-FINAL.md).
- [수학 테스트](../../tests/psro-meta.test.ts) · [PPO surrogate/GAE 테스트](../../tests/ppo-surrogate.test.ts). PR에서 14개 테스트 파일과 모든 연구 스모크 실행, 사이트 빌드·브라우저 검증 통과.

## 1. 실제 PSRO restricted meta-game solver

이제 단순 역사적인 정책과 대전하는 *PSRO-inspired* 리그를 넘어 다음 요소를 구현했다: 정책 전체쌍 게임 payoff 행렬, fictitious-play 제로섬 meta-strategy solver, 현재 meta mix를 상대로 새 정책을 학습하는 ES **근사 best-response oracle**, 세 차례 oracle 추가/행렬 재구성/재해결. 초기는 DP Expert/Win DP v2/위험형 residual/상단보너스 residual의 4개 정책, 마지막은 총 **7개 정책**.

선후공 교대 실제 대전의 승리점수율을 사용하고, 모집단의 반대칭 payoff `2·winCredit-1`을 풀었다. 마지막 제한게임 솔버 출력:

- **최종 meta mix:** DP Expert 4.81%, Win DP v2 4.86%, 위험형 잔차 정책 약 0.0025%, 보너스형 24.25%, Oracle 0 26.79%, Oracle 1 39.28%, Oracle 2 약 0.0025%.
- restricted exploitability proxy **0.0002289** (제로섬 payoff scale), fictitious-play duality gap **0.0004578**.
- **경고:** 이는 자체 모집단/유한 표본의 제한게임에서만 작다. **실제 12라운드 모든 가능한 정책에 대한 Nash exploitability가 아니다.** ES oracle은 진짜 최적 대응이라고 보증할 수 없다.

| 독립 확증 상대 | 게임 | PSRO 혼합 승리 점수율 | paired 95% 근사 CI |
|---|---:|---:|---|
| Win DP v2 | **2,400** | **49.4375%** | **48.245~50.630%** |
| DP Expert | **2,400** | **49.6875%** | **48.365~51.010%** |

**판정:** 두 상대에 대한 승률 우위 미입증. meta-game 안의 작은 exploitability를 성능 개선이나 세계 SOTA로 오인하면 안 됨.

## 2. 다양한 상대 정책의 경험적 이산 점수분포

기존 Gaussian residual에 더해 실제 게임 데이터에서 남은 카테고리 수(3~12)·상대 정책별 **잔차 histogram + kernel density smoothing + Gaussian prior shrinkage**를 학습했다. 대역폭은 훈련과 다른 검증 시드에서 선택하고 최종 확증 시드는 따로 두었다. DP Expert, Win DP v2, Greedy **각 350 훈련 + 180 후보선택 + 320 미사용 평가게임**. 한 평가 게임의 10개 라운드 예측을 측정했으며 같은 게임 안의 관측은 서로 상관된다.

| 상대 | Gaussian CRPS ↓ | 이산 PMF CRPS ↓ | 개선(+) / 악화(−) |
|---|---:|---:|---:|
| DP Expert | 18.2201 | 18.2191 | +0.0010 (미미) |
| Win DP v2 | **17.4464** | 17.4499 | **−0.0035 (악화)** |
| Greedy | 15.0835 | **14.9413** | **+0.1422 (개선)** |

미사용 평가 log score NLL도 측정. Greedy **4.7041 → 4.6373** 개선, Win DP v2 **4.8422 → 4.8383** 소폭 개선. 이처럼 **CRPS와 NLL은 서로 다른 특성을 측정하며 모순된 개선 판정이 나올 수 있다.** 확률 예측을 단순히 “전부 더 정확해졌다”고 말할 수 없다.

### 이산 PMF를 사용하는 Win DP v3

`src/competitive-v3.ts`의 내 마지막 3개 카테고리 Bellman DP에 상대 미래 총점의 **경험적 discrete PMF**를 전달해 실제 대전. 상대가 0~2칸 남았을 때의 기존 정확 DP 분포 사용은 유지.

| 대결 | 게임 | v3 PMF 승리 점수율 | 95% 근사 CI |
|---|---:|---:|---|
| vs Win DP v2 | 400 | 49.375% | 47.589~51.161% |
| vs Win DP v3 Gaussian | 200 | 50.000% | 50.000~50.000% |
| vs DP Expert | 240 | 49.792% | 47.298~52.286% |

**판정:** 직접 승률 개선 미입증. 상대 점수분포는 **표본 추정치이지 정확한 완전열거 PMF가 아니다**. 특히 v3 Gaussian과 200경기에서 정확히 50%였다는 결과는 두 정책이 완전히 같다는 증명이나 각 실험에서 나올 CI의 보편적 경향이 아니다. 표본 내 차이가 없었다는 뜻이다.

## 3. 실제 전체 12라운드 clipped PPO와 DP 교사 정규화

코드는 [행동별 정책 네트워크](../../src/neural-residual.ts), [clipped surrogate/GAE 수학](../../src/ppo-surrogate.ts), [학습 러너](../../scripts/train-ppo-psro.mjs).

- **일반 PPO**와 **PPO + DP teacher KL** 2종을 **각 32배치×84 = 2,688 full-game 학습경기**에서 갱신.
- 실제 최종 게임 승패 보상 `win=1 / draw=.5 / loss=0`. 로그확률 고정 → 중요도 비율 → clip `ε=.2` → 여러 epoch/minibatch reuse. Terminal GAE(`λ=.95,γ=1`) + sigmoid critic 학습.
- DP의 정확한 44개 행동 Q 중 손실제한을 만족하는 합법 후보와 행동별 MLP residual에 학습. **마지막 2개 카테고리는 여전히 기존 Win DP v2**.
- 상대는 앞서 실제 PSRO에서 구한 메타 정책 혼합분포와 과거 PPO 신경망 스냅샷, DP Expert·Win DP v2 정책을 포함.
- 원시 행동·시드의 공정성: 공개 점수판/주사위만 모델 입력, 주사위 내부 PRNG 비공개. 샘플 정책 old logprob 보존하여 PPO gradient 계산.
- **후보 선택 시드**에서 일반 PPO가 선택됐고, 다음의 **새 독립 시드**로 우위를 확인.

| 확증 상대 | 경기 | 일반 PPO 승리 점수율 | paired 95% 근사 CI |
|---|---:|---:|---|
| Win DP v2 | **3,200** | **49.5313%** | **48.450~50.612%** |
| DP Expert | **3,200** | **50.0781%** | **49.027~51.129%** |
| PPO+DP 교사 KL | 560 | 48.929% | 46.490~51.367% |

**판정:** 신경망 가중치를 실제 PPO 방식으로 학습하는 데 성공했지만 Win DP v2/DP Expert를 상대로 독립적으로 검증된 승률 우위는 없음. PPO가 반드시 더 강하다고 주장하지 않으며 **기존 Win DP v2를 교체하지 않는다.** 특히 2,688경기는 PPO의 표준 대규모 학습에 비하면 작은 연구 예산임.

## 4. 확인한 한계와 연구적으로 유용한 결론

1. 실제 restricted meta-game의 **근사 Nash**를 구할 수 있다. 다만 이는 관찰한 정책 풀이와 유한 시드에 대한 수치이며, 본 게임 Nash 성능의 대용 지표가 아니다.
2. 상대가 적응하는 모집단을 도입해 학습 과적합을 줄이려 시도했지만, **그 자체만으로 승률 우위가 생기지 않는다**.
3. 이산 잔차 분포는 Greedy처럼 DP Expert와 다른 행동을 자주 하는 상대에서는 Gaussian보다 일부 예측 지표가 좋았다. Win DP v2에서는 오히려 CRPS가 나빠졌다.
4. PPO의 실제 clipped 업데이트·GAE·교사 정규화는 구현했지만 작은 actor/보상 변동성/학습 예산 때문에 개선 미입증.
5. 한 연구의 선택/확증 시드 구간 분리는 했지만, 여러 연구 가설을 동시에 비교했으므로 개별 95% CI만으로 포괄적인 다중검정 보정이 끝난 것은 아니다.
6. 자동 워크플로 아티팩트는 정책별 가중치·실제 게임 결과·메타 행렬·점수 분포를 보존하나, 90일 설정으로 만료될 수 있다. 이 보고서와 Git에 자동 저장된 요약은 이후에도 참고 가능.

## 5. 후속 연구 우선순위

- **P0**: 전체 게임에서 직접 승률을 향상시킬 만큼 학습 예산을 키우고 여러 초기화 시드/상대에 대해 재현성 검증. 행동 분포가 실제로 기준 DP와 달라진 양·빈도 기록.
- **P0**: opponent final-score 정확 분포를 3개 이상 남은 상태로 확장(가능한 마스크/상단 점수 범위부터) + PMF에 scorecard mask/upper 상태 조건 추가.
- **P0**: PSRO의 oracle 품질(혼합 상대에 대한 정책 반응)과 payoff 행렬 불확실성 정량화, exploitability 신뢰구간.
- **P1**: 강한 적대적 상대 집합에 대한 held-out mixture, PPO value function 학습 안정화·actor 표현력 증대, chance-aware search.

**최종 채택 AI: Win DP v2 유지.** 다음 개발자는 [CONTEXT.md](../../CONTEXT.md)와 이 보고서, 원시 Actions를 함께 읽고 유의미한 직접 대전 우위가 나오기 전까지 사용자 기본 모델을 교체하면 안 된다.
