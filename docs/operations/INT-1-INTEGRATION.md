# INT-1 제품 통합 (격리 브랜치 `integration/int-1`)

기준 main `d775ecb` (보안 출시 #137·#138·#139 포함) · 운영 Pages `d775ecb-mx07j30u` · Worker `692e00a4-d983-4ccb-b93c-4e52c06deca6`
승인 범위: 격리 통합·충돌 해결·공통 인터페이스 연결·테스트·검증용 Draft PR. **main 병합·운영 배포·플래그 활성화·재화 지급·담당 브랜치 변경 없음.**

## A. 통합 기록 (기준 SHA와 통합 후 변경)

| 순서 | PR | 통합 기준 head | 통합 커밋 | 상태 |
|---|---|---|---|---|
| 1 | #140 C5 | `5d49414` | `6bea655` | 통합됨(충돌 없음) |
| 2 | #141 ADMIN-1/FEEDBACK-1 | `4cd73a0` | `f5891da` | 통합됨 — 충돌 5파일 해결 |
| 3 | #142 LIVE-1 | (담당 최종 보고·CI 대기) | — | 대기 |
| 4 | #143 SOC-1 | (담당 최종 보고·CI 대기) | — | 대기 |
| 5 | #144 UI-1 | (담당 최종 보고·CI 대기) | — | 대기 |
| 6 | #145 UI-2 | (담당 최종 보고·CI 대기) | — | 대기 |
| 7 | #146 FX-1 | (main 병합으로 PR CI 재개 필요) | — | 대기 |

### #141 충돌 해결 (`f5891da`)
- `src/routes.ts`: 양쪽 라우트 합집합(`rewards` + `suggestions`/`mailbox`/`admin`).
- `worker/src/accounts-api.ts`: 의존성 두 필드 모두 유지(`quoteRequired`, `adminReauth`). **정지 계정 가드를 C5 보상 POST(출석·수령·코드)보다 앞에** 배치.
- `worker/src/index.ts`: C5 quote 인자 + ADMIN 지표 배열을 결합(buy·upgrade·draw), 경기 정산 지표 두 줄 모두 유지.
- DECISIONS/ROADMAP: 합집합(최종 번호는 §4 일괄 부여).

### 공통 보상 지급 경로 단일화 (`1ffa39e`)
- `worker/src/admin/grant-port.ts`: `deliverAdminItem`·`claimAdminItem`·`redeemAdminItem`·`revokeAdminItem` — UserStore와 테스트 가짜가 같은 함수를 쓴다. `toGrantRequest` 연결.
- 관리자 보상(`op:`)·채택 보상(`sug:`) = C5 inbox 지급, 교환 코드(`code:<id>[:<n>]`) = C5 direct 지급 → `EconomyStore.grantCredit`(원장 `g:<txId>`)만 잔액을 바꾼다. ADMIN 알림함은 메시지만(금액 0), **보상함 단일 원천 = C5 `grant_tx`**, 알림함 `unclaimed`는 C5 inbox 수.
- 승인 기록: 캠페인·채택 보상·활성화된 코드가 승인 관리자와 승인된 금액 정책 버전을 운반(C5 `actor`=`admin:<id>`, `policyVersion`). 없으면 거절.
- 삭제한 중복 경로: `EconomyStore.adminGrant`(`admin:` 원장), C5 `creditAdminClaim`, ADMIN `wallet()`(C5 `balance()` 유지). `GRANT_CAPS`는 C5 `GRANT_LIMITS`를 참조(상한 표 하나).
- 교환 코드: `/api/me/rewards/redeem`(C5 화면)과 `/api/me/redeem`이 같은 흐름(예약 → C5 지급 → 확정). 확정적 거절(예: `SOURCE_DISABLED`)은 예약을 풀어 코드를 소진하지 않는다. 동시·반복 요청은 같은 예약(txId)이라 1회만 지급.
- 회수: 미수령 C5 grant만 취소, 수령된 것은 유지(원장 append-only), grant 없는 메시지만 알림함에서 숨김.
- **두 승인 게이트 모두 유지**: `ADMIN_REWARD_POLICY`(초안 시 POLICY_PENDING) + C5 `APPROVED_SOURCES`(출석·연속 활동·주간 연승만). 운영 설정에서는 관리자 보상·채택 보상·교환 코드가 `SOURCE_DISABLED`로 막힌다.
- 시험: ADMIN 시험을 단일 경로 계약으로 이전, `tests/int1-admin-grants.test.ts`(운영 게이트·예약 해제·동시 수령/코드 1회·회수·정지 계정·가드 순서).

### DO 마이그레이션 확정
- 운영 v1~v4 그대로. **v5 = `AdminHub`·`SuggestionBoard`(ADMIN-1, 태그 확정)**, **v6 = `DailyBoard`(LIVE-1, 통합 시 확정)**. 신규 클래스 추가만이라 기존 DO 데이터 영향 없음. 이 통합의 Worker 배포는 `wrangler.toml` 변경 때문에 CI-1.2 보호 입력 → **수동 고위험 경로**.

## B. 통합 계획 (조사 기준, 진행에 따라 갱신)
기준: main `d775ecb` · 운영 Pages `d775ecb-mx07j30u` · Worker `692e00a4-d983-4ccb-b93c-4e52c06deca6`(복귀 `6ef2c717…`)
승인 범위: 조사·계획만. 병합·배포·플래그 활성화·재화 지급·기존 브랜치 변경 없음.

## 0. 대상 PR 상태

| PR | head | main 대비 | CI | 확정 가능 |
|---|---|---|---|---|
| #140 C5 | `5d49414` (문서상 `f35b409` + 문서 커밋 1개) | 3 뒤 | 통과 | 예(개발 종료) |
| #141 ADMIN-1 | `4cd73a0` | 3 뒤 | 통과 | 예(개발 종료) |
| #142 LIVE-1 | `434e876` | 최신 | 진행 중 | 담당 확정 후 |
| #143 SOC-1 | `cda0cae` | 최신 | 브라우저 통과 | 담당 확정 후 |
| #144 UI-1 | `b957dd3` | 최신 | 진행 중 | 담당 확정 후 |
| #145 UI-2 | `d13e8b1` | 최신 | ci-result 진행 중 | 담당 확정 후 |
| #146 FX-1 | `dbb26f9` | 10 뒤 | **미실행**(DECISIONS 충돌로 PR CI 불가) | 담당이 main 병합 후 |

LIVE-1 세션이 이미 한 일(#142 `434e876`, 자기 PR 안): 공유 ADMIN_TOKEN 일일 경로 제거, `dailyAdminRoutes`(stats.read / content.write+감사) 내보내기만, `dailyContentDone` 어댑터(C5 없으면 no-op), 일일 보상 0. **등록·연결은 INT-1에 남아 있음** → 중복 없음.

## 1. 통합 순서 (격리 브랜치, 의존성 순)

1. **main → 통합 브랜치** (보안 수정 #137/#138/#139 포함 상태에서 시작)
2. **#140 C5** — 공통 지급·원장(`RewardGrants`/`grantCredit`), 보상함 `grant_tx`, quote 필드·409. Worker 저장소는 UserStore 추가 테이블만(DO 마이그레이션 없음).
3. **#141 ADMIN-1** — 충돌: `worker/src/index.ts`, `accounts-api.ts`, `src/routes.ts`, DECISIONS/ROADMAP.
   - 통합 작업: `grant-port.ts` `toGrantRequest()`로 `deliver/claim/redeemGrant` 내부를 `grants.issue/claim`으로 교체, `EconomyStore.adminGrant`(`admin:` 원장)·`creditAdminClaim` 경로 제거, `wallet()`/`balance()` 하나로.
   - 보상함 단일 원천 = C5 `grant_tx`; ADMIN `inbox` 테이블은 메시지만(코인·보석 필드 미사용).
   - 교환 코드: C5 `/api/me/rewards/redeem` 하나만 유지, ADMIN `/api/me/redeem` 제거 또는 C5로 위임. `code:<id>:<n>` 키로 "계정당 1회" 보장 여부 테스트(동시 요청 포함).
   - 게이트 둘 다 유지: `ADMIN_REWARD_POLICY`(미설정=POLICY_PENDING) + C5 `APPROVED_SOURCES`(attendance/activity-streak/weekly-streak만).
   - 정지 계정: `/api/me/rewards/*` POST(출석·수령·코드) 전에 standing 검사.
   - 상한: `GRANT_CAPS` = C5 `GRANT_LIMITS` 하나로(ADMIN 문서의 10,000/300 문구는 정리).
4. **#142 LIVE-1** — 충돌: `index.ts`, `routes.ts`, `wrangler.toml`, App.tsx.
   - `engagement()`에 `extensions: dailyAdminRoutes(deps)` 등록, ADMIN 권한 `content.write` 추가 확인, 감사 로그 `daily.puzzle`.
   - `daily-activity.ts` → C5 `UserStore.dailyContentDone({kind:"daily.official.completed"})`만. 퍼즐·연습·지난 도전 제외 테스트.
   - 순위 게시·활동 보고 단계별 멱등(재시도 중복 없음) 테스트.
   - 공유 `ADMIN_TOKEN` 쓰기 경로 복구 금지(허용 목록 GET 2개만 유지).
5. **#143 SOC-1** — Worker 변경 다수지만 마이그레이션 없음. 충돌: `index.ts`, `accounts-api.ts`, `account.ts`, `host.ts`(#141과), App.tsx.
6. **#144 UI-1** — 충돌: `MatchPopup.tsx`(UI-1 판 채택), `OnlineGame.tsx`, `OnlineMulti.tsx`(#143과), App.tsx.
   - 진입점 `src/shell/entries.ts`: `features.daily`는 있음, `retention`/`mailbox`/`feedback`/`notices`는 어느 PR의 `/api/features`에도 없음 → 기본 숨김(요구사항과 일치). 플래그 키를 `/api/features`에 추가할 때 기본값 false.
   - 보상함 진입점 `#rewards` 하나(UI-1·C5 합의), `/api/me/notifications` 요청 엔드포인트는 신규 기능이라 보류.
7. **#145 UI-2** — 충돌: `EconomyPages.tsx`, `DrawPanel.tsx`(#140과).
   - **C5 quote 필드(`expectedPrice/expectedLevel/configVersion/oddsVersion`)·409(ODDS_CHANGED/PRICE_CHANGED/POLICY_CHANGED/REQUEST_REUSED/CLIENT_UPDATE_REQUIRED) 재적용** — UI-2는 보내지 않음(유실 위험 최대).
   - 카탈로그 rev 3(C5) 이후 "신상품" 레일 대상 확인.
8. **#146 FX-1** — 충돌: `ItemViews.tsx`(UI-2 판 채택 후 FX-1 변경 재적용), `items-content.css`(#143과), DECISIONS/RESULTS/TECHNIQUES.
   - UI-2 `PreviewStage.tsx`를 `../../fx-preview` 재수출로 교체, 썸네일 `registerPreviewProvider` 연결, 단일 활성 WebGL 무대 정책·정적 썸네일 캐시 검증.

## 2. 충돌 지도 (git merge-tree, main `d775ecb` 기준)

- main 대비: #146만 DECISIONS.md.
- 코드 충돌 쌍: 140×141(routes, accounts-api, index), 140×142(routes), 140×143(App), 140×145(DrawPanel, EconomyPages), 141×142(App, routes, index, **wrangler.toml**), 141×143(App, index), 142×143(App, index), 143×144(App, MatchPopup, OnlineGame), 143×146(items-content.css), 145×146(ItemViews).
- 문서 충돌: DECISIONS.md는 모든 쌍, CONTEXT/HANDOFF/ROADMAP/RESULTS/TECHNIQUES 일부.

## 3. DO 마이그레이션·저장소 (첫 운영 배포 전 확정)

현재 운영: v1~v4. 제안: **v5 = `AdminHub`,`SuggestionBoard` (ADMIN-1)**, **v6 = `DailyBoard` (LIVE-1)** — 통합 순서와 동일, 태그는 단순 `v5`/`v6`.
- 신규 클래스만 추가(기존 클래스 이름·바인딩 불변) → 기존 데이터 영향 없음. 적용된 태그는 이름 변경 불가하므로 통합 PR에서 한 번에 확정.
- 롤백: 코드 롤백 시 새 DO 클래스는 남아도 무해(바인딩만 미사용). 삭제 마이그레이션은 만들지 않음.
- CI-1.2: `wrangler.toml` 변경 = 보호 입력 → 이 통합의 Worker 배포는 **수동 고위험 경로(승인 Environment)**. UserStore 추가 테이블(C5 `grant_tx`/`retention`, LIVE-1 `daily_*`)은 생성형이라 구 코드 호환.
- 기존 운영 DO 데이터 호환: 직전 운영 소스 기준 `account-upgrade-worker` 방식의 저장소 승계 시험을 통합 트리에 대해 실행(계정·세션·친구·원장 보존).

## 4. 결정 번호 (최종 부여 제안, 통합 순서대로)

D-103~D-106 C5(D-C5-1~4) · D-107~D-116 ADMIN-1(D-ADM-1~10) · D-117~D-122 LIVE-1 · D-123~D-128 SOC-1 · D-129 UI-1(UI1-D1) · D-130~D-133 UI-2 · D-134~D-138 FX-1. (UI-2 문서의 "D-104"=FxPreview 인용은 FX1-D4의 최종 번호로 교정. #126 초안 번호는 그 PR 병합 시 별도.)

## 5. 기능 플래그 (모두 기본 비활성 유지 확인)

`RETENTION` 미설정, `ECONOMY_QUOTE` 미설정, `ADMIN_WRITES=off`, `ADMIN_APPROVAL=two-person`, `FEEDBACK_BOARD=off`, `ADMIN_REWARD_POLICY` 미설정, `DAILY=off`, `DAILY_NEW_ACCOUNTS_RANKED=off`, `NO_DAILY_REWARDS`/`DAILY_REWARDS_APPROVED=false`, `FRIEND_RESIDUE_CLEANUP` 미설정. 확인 필요: ADMIN `flags.approval`이 `single-operator` 값을 매핑하지 않음(문서 불일치).

## 6. Workers Free 영향 검토 항목

SOC-1 접속 상태 heartbeat(`/api/me/inbox`) 요청 빈도, FriendIndex 중앙 presence 쓰기, LIVE-1 DailyBoard(일자별 1 객체) 쓰기, ADMIN AdminHub 단일 객체(관리자만), C5 grant 트랜잭션. 측정: 로컬 Worker 시나리오별 요청·SQLite 쓰기 수 계측 → 일일 사용자 수 가정으로 환산. 신규 유료 리소스 없음(모두 SQLite DO).

## 7. 회귀·통합 검증 계획

1. 각 단계 병합 후: `tsc -b`, worker/server tsc, `vitest`(전체), `npm run build`.
2. 통합 완료 후: 전체 Playwright(데스크톱+모바일), 필수 GitHub CI.
3. 기능 간 통합 테스트(로컬 wrangler):
   - 공통 원장: 출석/연속/주간 지급이 `g:` 원장 1회, ADMIN 경로가 같은 원장으로 수렴, 수령 중복·동시 수령·코드 중복 수령 차단.
   - 정지 계정: 출석·수령·코드 거부.
   - 다인전·관전자 보상 격리(관전자·대기실 관전자 무보상, SOC-1 lobby watch).
   - LIVE-1 공식 완료 → `dailyContentDone` 1회, 퍼즐·연습 제외, 재시도 멱등.
   - 관리자: 일반 세션으로 `/api/admin/*` 404, 권한별 접근, 감사 로그 기록, ADMIN_TOKEN은 GET 2개만.
   - 개인정보: 공개 프로필·접속 상태 상호 친구만, 차단 반영(SOC-1-F1 빠른 대전 차단 쌍 매칭은 알려진 후속).
4. 호환성: 구 Pages(d775ecb) ↔ 통합 Worker, 통합 Pages ↔ 운영 Worker(692e00a4) 교차 실행(지난 출시와 같은 방식).
5. 성능: WebGL 단일 무대·컨텍스트 해제, 썸네일 캐시, 메모리(장시간 상점·인벤토리 이동).
6. SEC-1 2차 감사 인계 문서(ADMIN-1 `SEC-1-AUDIT-2-CHECKLIST.md` 기준).

## 8. 알려진 위험·미결

- SOC-1 병합만으로도 Worker 자동 배포 대상(보호 입력 없음) — 통합 PR로 묶으면 `wrangler.toml` 변경 때문에 수동 경로.
- 간헐 실패: `game-shell.spec.ts:14`(main에도 존재), SOC-1 보고 `game-flow.spec.ts:313`.
- ADMIN 문서의 구식 정보(#142가 "v5"·ADMIN_TOKEN 경로 사용) — 통합 시 문서 정정.
- ADMIN mailbox id 표기 `sg:` vs `sug:` 불일치 확인.
