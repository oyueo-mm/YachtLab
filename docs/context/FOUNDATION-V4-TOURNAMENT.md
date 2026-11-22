# DP Expert · Win DP v2 · v4 원본 · v4-D: 독립 30만 경기 직접 토너먼트

- **모델 4개**: DP Expert(단일 플레이 총점 기대값 DP), Win DP v2(승률 중심 DP), v4 원본(모방학습+REINFORCE, 후반 v3.4), v4-D(REINFORCE 단독, 후반 v3.3). 요청된 "v4"의 혼동을 막으려면 v4 원본과 v4-D를 각각 검증한다.
- **6개 일대일 대진**: DP Expert ↔ Win DP v2, DP Expert ↔ v4 원본, DP Expert ↔ v4-D, Win DP v2 ↔ v4 원본, Win DP v2 ↔ v4-D, v4 원본 ↔ v4-D.
- **대진마다 최소 50,000경기**, 동일 독립 시드 25,000개 × 선후공 교대 2게임. 총 300,000게임. 10 샤드 × 2,500시드쌍 × 2게임 = 50,000/대진. 신규 seed family 7201~7210 (기존 대결 6101~6110과 충돌 방지).
- **12카테고리 전체 대국**: 요트 주사위 3회, +35 상단 보너스(63점) 및 적용된 공식 엔진 규칙. 양측 모두 자기 정책으로 행동하고 게임 종료까지 기록.
- **v4 정보 경계**: 상대가 실제 Win DP v2 또는 DP Expert일 때만 상대의 정책명을 제공하고, 다른 v4와 대결할 때는 `Other`로 처리하여 숨겨진 정책 정보를 주지 않는다.
- **원본 체크포인트 고정**: v4 원본은 `training/research-archive/v4-original-seed0.json`(기존 80만 경기 실험), v4-D는 `training/research-archive/v4-reinforce-seed1-frozen.json`(기존 100만 경기 절제 실험). v3.3의 상대 분포 자료는 연구 run `44922054901`의 artifact `v33-forecast-locked`에서 읽기 전용으로 불러온다. 새 시드로 다시 학습하지 않는다.
- **통계**: 승리 1, 무승부 .5, 패배 0의 경기 점수율, 시드쌍 기준 99% 정규 근사 CI. 사전 등록 6대진에 Holm 다중비교 조정 p와 Bonferroni 가족별 99% CI도 제공한다. 단순 3상대 평균으로 순서를 소개하더라도 통계적으로 검증된 범용 강도 순위라고 단정하지 않는다.
- **코드**: [벤치마크](../../scripts/bench-foundation-v4.mjs) · [요약기](../../scripts/summarize-foundation-v4.mjs) · [GitHub Actions](../../.github/workflows/foundation-v4-tournament.yml). PR 스모크 6대진 및 전체 단위 테스트 통과 뒤 main에 반영하고, 실제 60 샤드가 모두 완료된 경우에만 최종 리포트 생성.
- **계산 공존**: 별개 실행 간 GitHub Actions 동시 실행 수를 최대 4개로 제한. 이전 진행 중인 65만 경기 연구 워크플로를 취소하거나 변경하지 않는다.
- **연구 한계**: DP Expert는 단일 플레이 총점의 정확한 기대값 최적 정책이지만 2인 대국에서 모든 상대에게 승률 최적일 필요는 없다. 상대가 고정된 4모델 외 인간·새로운 AI에서의 성능을 보장하지 않으며 기본 AI를 자동 교체하지 않는다.
