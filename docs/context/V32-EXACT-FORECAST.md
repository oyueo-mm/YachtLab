# Win DP v3.2: 마지막 3개 카테고리의 DP Expert 정확 점수분포

> **연구용.** 이름에 v3.2가 붙었다고 승률이 높다는 주장은 아니다. 점수분포의 수학적 오차 감소와 실제 12라운드 승률 향상은 서로 다른 가설이다.

## 설계

기존 [v3](../../src/competitive-v3.ts)의 내 3턴 chance-node Bellman 최적화는 유지한다. 다만 상대 최종 점수분포가 `DP Expert`라는 **고정 정책**이고 상대가 정확히 3개 남았으면 기존 Gaussian 예측 대신 [정확 DP Expert 3턴 점수분포](../../src/research-exact-three-score.ts)를 사용한다.

핵심 알고리즘은 `mask`, 상단 누적 `upper`, 공개 현재 주사위 및 남은 굴림에 따라 DP Expert가 미래 단독 기대점수를 최대화하는 **실제 행동 정책**을 복원하고, 252개 주사위 멀티셋/재굴림 확률을 정책을 따라 전개한다. 첫 턴에서 기록한 카테고리·점수·보너스에 따라 남은 2턴의 분포를 재귀 합성한다. 캐시는 `(mask, capped upper)` 조건이다.

- 상대 3턴 PMF의 확률합 1 및 평균 = DP Expert의 `dpFutureValue(mask,upper)`을 각각 검증하며, 잘못된 분포는 수용하지 않는다.
- 상대가 DP Expert가 아닌 v2/v3/unknown이면 3턴 정확 PMF를 거짓 적용하지 않고 [v3.1](../../src/research-v31.ts)로 돌아간다.
- 상대와 내가 각각 정확히 3개의 카테고리를 가진 국면에서만 적용하고, 나머지 구간은 v3.1 동일.
- 내 3턴의 응답 DP도 **고정 상대 점수분포를 가정**한다. 상대가 내 점수에 전략을 바꾸는 2인 게임의 Nash 해법은 아니다.
- 성능 검정 이전에는 [src/ai.ts](../../src/ai.ts), 기존 v2, 사용자 사이트 목록을 변경하지 않는다.

## 파일

- [확률 계산](../../src/research-exact-three-score.ts)
- [v3.2 정책](../../src/research-v32.ts)
- [v3 payoff 입력 확장](../../src/competitive-v3.ts)
- [정확성 테스트](../../tests/research-v32.test.ts)
- [독립 300개 seed-pair 파일럿](../../.github/workflows/v32-research.yml)
- [성공 시 자동 생성 보고](./_generated/V32-LATEST.md)

## 승급 기준

1. 컴파일·테스트 통과, 3카테고리의 다른 scorecard/bonus 조건에서 분포 합 1·DP 기대값 일치.
2. 각 후보 300시드 쌍 × 양좌석 = 600경기의 파일럿 및 중앙/p95 추론시간 점검. 작은 표본은 승률 확증이 아니다.
3. 성능이 유망하고 지연 예산에 맞으면 **새 미사용 시드·여러 상대** 대규모 비교를 사전 등록한다. 상대 v2에 대한 우위를 주장하려면 v2 정책 조건부 예측을 새로 연구해야 한다.

이후 [v3.3–v4 연구 로드맵](./LARGE-SCALE-V32-ROADMAP.md)의 상대 모델 정확화, dynamic expectiminimax, 캐시/근사 가치 함수·Expert Iteration/league self-play로 확대한다.
