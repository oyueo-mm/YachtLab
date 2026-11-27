# C1 경제 v2 연구 — Claude 이관 기록 (2026-11-27)

최신 C1 정책 평가와 C5 계약은 [독립 연구 보고서](../ECONOMY-V2-RESEARCH.md) 및 [C5 인수인계](HANDOFF-C5-ECONOMY-V2.md)에 있다. 이 문서의 실행·결함 기록은 Claude 연구 커밋 기준이다.

> 브랜치 `claude/festive-cori-ilmlfk`(기준 main `d8a24a8`). **main 병합·운영 배포·경제 정책 변경을 하지 않았다.** `src/economy/live/*`, `worker/src/*`, 가격표·보상·뽑기 확률은 그대로다. 실제 부스터 기능은 없다.
> 보고서 초안: [ECONOMY-V2-RESEARCH.md](../ECONOMY-V2-RESEARCH.md) · 자동 생성 표: [RESULTS-V2-GENERATED.md](./RESULTS-V2-GENERATED.md).
> 운영 상태: C0 보고서(`ops/c0-production-verification-20261127` 브랜치 `docs/operations/C0-PRODUCTION-VERIFICATION-2026-11-27.md`) 기준으로 **Worker 운영 배포 보류, 운영 활성 버전 미확인**. 이 연구의 어떤 결과도 운영 상태 검증으로 간주하지 않는다.

## 1. 실행 상태

| 항목 | 상태 |
|---|---|
| 전체 시뮬레이션 `scripts/economy/v2/run.ts` | ✅ **완료**: 1,108/1,108 작업, 208,140명, 4스레드 1,485.2초, 종료 코드 0. 로그 [logs/run-full-2026-11-27.log](./logs/run-full-2026-11-27.log) |
| 정확 계산 `analytics.ts` | ✅ [results/analytics.json](./results/analytics.json) |
| 표·그림 `report.ts` | ✅ RESULTS-V2-GENERATED.md, [figures/pareto.svg](./figures/pareto.svg), [figures/sources-base.svg](./figures/sources-base.svg) |
| 테스트 `tests/economy-v2.test.ts` | ✅ 18/18 통과(로컬, `npx vitest run tests/economy-v2.test.ts`). 전체 `npm test`·`npm run build`·Playwright는 이 브랜치에서 **돌리지 않았다**(타입 검사 `tsc --noEmit -p tsconfig.json`의 경제 관련 오류 0만 확인) |
| 보고서 | 🟡 초안. §6 정책 "추천"은 의도적으로 비워 둠(잠정 관찰만) |

### 결과 파일

| 파일 | 내용 |
|---|---|
| `results/meta.json` | 시드·시작 시각·작업 수·실행 시간·CPU·Node |
| `results/E0.json` | 4시간 하루(목요일) 원인 분해, 9개 상황 × 신규/기존, 셀당 1,000명 |
| `results/E1.json` | 32개 후보(`SINGLE` 29 + `POLICIES` 3) × 6개 플레이 시간(15/30/60/120/240/480분) × 신규/기존, 200명, 90일, 스냅숏 1/7/30/90일 |
| `results/E2.json` | 경기 배율(1~3) × 가격(100/85/70/50%), 60·240분, 150명 |
| `results/E3.json` | 부스터 14종 × {BASE, V2-BAL}, 기존 6개 시간 + 신규 30·240분, 150명 |
| `results/E4.json` | 민감도 19종 × {BASE, V2-CONS, V2-BAL, V2-EXP} × 60·240분 × 신규/기존, 150명 |
| `results/E5.json` | 24시간 봇 3종(서버 AI·빠른 대전·친구 담합) × 6개 후보, 30일, 30명 |
| `results/E6.json`, `population.json` | 가정 모집단 2,000명(시간별 비중·접속 확률) Gini·상위 10%·하위 50%·p90/p10 |
| `results/E7.json` | 독립 시드 블록(시드 +1) — 90일 획득 평균이 1% 이내로 재현 |
| `raw/E1-users.csv.gz` | E1 사용자별 원시 행(90일 스냅숏, 헤더 1 + 76,800행) |

셀 키 형식: `"<후보 id>|<persona id>|new|existing"`. 각 셀에 `firstObtainMin`/`firstBuyMin`/`firstLv3*`/`firstTier*`(검열 중앙값 + 95% 순서통계량 구간 + 도달 비율)와 `h.{1,7,30,90}`(분포 통계·출처·소각·보유·공유 비율)가 있다.

## 2. 재현

```bash
npm ci
```

```bash
npx vitest run tests/economy-v2.test.ts
```

```bash
npx tsx scripts/economy/v2/run.ts
```

```bash
npx tsx scripts/economy/v2/analytics.ts
```

```bash
npx tsx scripts/economy/v2/report.ts
```

- 빠른 점검: `npx tsx scripts/economy/v2/run.ts --quick`(약 2분, `docs/economy/v2/results-quick/`에 쓴다. 커밋하지 말 것).
- 시드 `20261127`(E7 = `20261128`), 시뮬레이션 시작 `2026-11-30 00:00 KST`(월요일, `T0`), E0은 목요일(`T0 + 3일`). 기존 사용자 = 현행 경제 60일 워밍업 후 전환. 모두 **개발 시드**이며 홀드아웃이 아니다.
- 환경: Linux 컨테이너, 4 vCPU Intel Xeon, Node v22.23.5, tsx 4.x. `worker_threads`로 CPU 수만큼 병렬. 결과는 스레드 수와 무관하게 결정적이다(사용자별 시드 `hashSeed("econ-v2", seed, persona, index)`).

## 3. 코드 지도

| 파일 | 역할 |
|---|---|
| `src/economy/v2/params.ts` | `V2Params`(후보 전체 기술), `baselineParams()`는 운영 `ECONOMY`·뽑기 상수에서 읽음. 부스터 모델 타입 |
| `src/economy/v2/engine.ts` | `applyMatchV2` = 운영 `applyMatch`와 같은 규칙에 파라미터를 넣은 판, 연구 훅(부스터 `b:`, 주간 연승 `st:`). 운영 `rollover`·`replaceQuests`·`unlockAchievements` 재사용. **`ECONOMY.events`가 비어 있을 때만 동치**(이벤트 분기 없음, 테스트가 확인) |
| `src/economy/v2/catalog.ts` | 후보별 가격 카탈로그(운영 `priceOf`/`upgradeCost`에서 출발), 확정·제안 등급 매핑, 뽑기 풀·확률, 컬렉션 |
| `src/economy/v2/sim.ts` | 사용자 에이전트(세션·대기·모드·정산·소비·스냅숏) |
| `src/economy/v2/candidates.ts` | 후보(`SINGLE`, `POLICIES`, `INTERACTION`, `BOOSTERS`), 페르소나(`MAIN_PERSONAS`, `SENSITIVITY`, `POPULATION`, `ABUSE`) |
| `scripts/economy/v2/run.ts` | 실험 E0~E7 정의·병렬 실행·집계·원시 저장 |
| `scripts/economy/v2/analytics.ts` | 등급 재분류 가격·강화·뽑기 확률, 카탈로그 총액, 하루 이론 최대 |
| `scripts/economy/v2/report.ts` | 결과 표 MD와 SVG |
| `tests/economy-v2.test.ts` | 기준선 재현(무작위 4,000경기 + 경계 6종), 가격·뽑기 재현, 재분류 ID 보존, 반올림, 부스터·연승 정산 경계, 시뮬레이터 결정성·잔액 보존, 상한 지표 회귀 |

## 4. 반드시 알아야 할 문제 (우선순위 순)

1. **상한 지표 버그**: 커밋된 결과의 `reducedDayShare`, `cappedDayShare`, `everCapped`는 **전부 0(무효)**. 원인은 `sim.ts`가 절대 경제일(`econ.day`)과 상대 시뮬레이션 일(`day`)을 비교한 것이다. 실행 후 수정했고 회귀 테스트를 추가했다. 다른 값(지급·소비·보유·시간)은 이 지표를 읽지 않으므로 영향이 없다. → 이 열이 필요하면 `run.ts`를 다시 돌린다(약 25분/4코어). 재실행하면 이 세 필드만 바뀌어야 한다. 바뀌는 다른 값이 있으면 조사한다.
2. **rev 2(신규 11종) 판매 가정**: `includeRev2: true`. C0 기준 운영 Worker가 `54c1367`이면 운영에서는 판매되지 않는다. `includeRev2: false` 민감도를 추가 실행할 것(run.ts `runJob`의 옵션).
3. **위시리스트 모델 민감도**: TIER1(확정 재분류)에서 기존 사용자 다음 상품이 약 10분으로 떨어진 것은 영웅→일반 이모티콘(2,250 → 225코인) 영향이다. 위시 확률(`DEFAULT_PERSONA.want`)과 위시 대상 등급(현행 등급 기준)을 바꿔 재확인한다.
4. **즐겨찾기 강화 규칙 산물**: NSTART의 첫 Lv.3 82일(BASE 20일)은 무료 뽑기로 얻은 비싼 보드가 "첫 주사위·보드"가 된 결과로 보인다. 즐겨찾기 선택 규칙(`sim.ts` spender 분기)을 "가장 싼 강화 가능 주사위"로 바꿔 비교한다.
5. 소비 성향 기본값은 거의 전액 소비(소각/발행 약 99%)이며 뽑기 소각이 가장 크다. 잔액·집중도 수치는 이 가정에 의존한다.
6. 경기 사건 독립 추출, 점수 정규 근사, 상대 균등 풀, 시즌 상품·슬롯 미모델링, 보석 사용 단순화.

## 5. 다음 단계 (제안, 승인 필요 항목 포함)

1. (연구) 상한 지표 수정 후 재실행 + `includeRev2:false` + 위시·즐겨찾기 민감도.
2. (연구) 미실행 조합: **PLOW + NSTART + 일일 퀘스트 ×1.25~1.5, 경기 배율 없음**(발행 증가 없이 체감 개선 후보). `candidates.ts`의 `POLICIES`에 새 id로 추가한다(기존 id 의미 변경 금지).
3. (연구) 채팅 38종 제안 배분(9/8/9/7/5)을 실제 상품으로 모델링(현재는 analytics의 총액만: 현행 판매 36줄 64,790 → 제안 127,985코인).
4. (보고) §6 추천안 확정, 기존 구매자 보상안 수치화(원장 `buy:` 금액 분포가 필요하므로 운영 집계 접근 후).
5. (승인 후, C5) 설정 버전 올림, 구매 요청 `expectedPrice`·409, 재분류 품목의 취득 시 등급 강화비, `comp:v2:` 원장. **사용자 승인 전 운영 반영 금지.**

## 6. 하지 않은 것

- main 병합·PR 생성·Pages/Worker 배포·운영 계정 접근(공개 `/healthz`·`/usage`·`/api/features` GET만 조회).
- `src/economy/live/*`, `worker/src/*`, UI·렌더러·물리·공통 파일 변경(A1 병행과 충돌 방지).
- 공통 맥락 문서는 포인터만 추가했다: `docs/context/RESULTS.md`(요약 수치와 결함), `ROADMAP.md`(경제 v2 행 상태), `HANDOFF.md`(진입 링크). 경제 v2는 아직 결정이 없으므로 DECISIONS 항목과 TECHNIQUES 항목은 만들지 않았다. 보고서 확정 시 Codex가 갱신한다. `_generated/`는 수동 편집 금지.
