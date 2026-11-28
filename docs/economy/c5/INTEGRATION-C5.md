# C5 통합 안내 — INT-1용 (2026-11-28)

> PR [#140](https://github.com/oyueo-mm/YachtLab/pull/140) 브랜치 `claude/happy-euler-paasea`. 소유자가 2026-11-28 **C5-CORE를 채택**하고 개발을 승인했다(D-C5-2).
> **main 병합·운영 Worker 배포·운영 보상 활성화·기존 사용자 실제 지급은 별도 승인 대상이다.** Worker 플래그 `RETENTION`은 기본 off다.
> 결정 번호는 C5 임시 ID(D-C5-1~4)다. 최종 번호는 INT-1이 정한다. 다른 담당 브랜치(#141, #142)는 **병합하지 않았다**. 읽고 대조만 했다.

## 1. 이 PR이 제공하는 공통 인터페이스

| 인터페이스 | 위치 | 사용자 |
|---|---|---|
| `EconomyStore.grantCredit(userId, entry, items, now)` — 비경기 보상의 **유일한 원장 기록 경로** | `worker/src/economy.ts` | `RewardGrants`만 호출 |
| `RewardGrants.issue / claim / claimAll / revoke / expire / inbox / history / verify` | `worker/src/grants.ts` | 07 출석·연속 활동·주간 연승, 06 관리자·제안·교환 코드, 05 일일 콘텐츠 |
| `APPROVED_SOURCES` = 출석·연속 활동·주간 연승 (그 밖은 `SOURCE_DISABLED`) | `worker/src/grants.ts` | 출처별 활성화는 별도 승인 |
| `creditAdminClaim(grants, userId, { eventId: "admin:<id>", source, coins, gems, label, campaign, actor }, now)` | `worker/src/grants.ts` | ADMIN-1 `adminGrant` 전환용 어댑터 |
| `RetentionStore.claimAttendance / onMatch / onDailyContent / status` | `worker/src/retention.ts` | `UserStore` |
| `UserStore.dailyContentDone({ kind, at })` (RPC) | `worker/src/index.ts` | LIVE-1 `DailyRewardHook` 연결점 |
| API `GET /api/me/rewards`, `POST /api/me/rewards/attendance`, `POST /api/me/rewards/claim {txId \| "all"}`, `POST /api/me/rewards/redeem {code}` | `worker/src/accounts-api.ts` | 화면 `#rewards` |
| 견적 필드 `expectedPrice / expectedLevel / configVersion / oddsVersion`, 단계적 필수화 `ECONOMY_QUOTE` | `worker/src/economy.ts`, `accounts-api.ts` | 상점·뽑기 화면 |
| 확률표 버전 `drawOdds(pool)` | `src/economy/live/draw.ts` | 뽑기 화면, Worker 뽑기 상태 |
| 비매품 칭호 `title.streak30 / streak100 / streak365` (카탈로그 rev 3) | `src/economy/live/catalog.ts` | 연속 활동 이정표만 지급 |

## 2. 충돌 범위 (병합 순서와 관계없이 확인할 곳)

| 파일 | #140 (C5) | #141 ADMIN-1 | #142 LIVE-1 | 처리 |
|---|---|---|---|---|
| `worker/src/economy.ts` | `grantCredit`·`hasLedger`·`balance`·`hasEconomy`, 견적·요청 지문, `post`의 `config` 인자 | `adminGrant`, `wallet()` | — | `wallet()`과 `balance()`는 같은 기능이다. 하나만 남긴다. `adminGrant` 본문은 §3처럼 `creditAdminClaim`으로 바꾼다. 보호 입력(D-100) → 수동 배포 |
| `worker/src/index.ts` | `UserStore`에 `grants`·`retention` 필드·init, `recordMatch` 안 재방문 정산, 보상 RPC 4개 + `dailyContentDone`, `Env.RETENTION`·`ECONOMY_QUOTE`, 백엔드 `quoteRequired` | 관리자·제안 RPC, `ADMIN_OPS`, 라우팅 | 일일 API, `DailyBoard` | 같은 클래스의 서로 다른 메서드다. 텍스트 충돌은 생성자·`init`·`Env` 블록에서 난다. 모두 추가형이라 셋 다 유지한다 |
| `worker/src/accounts-api.ts` | 보상 라우트, `parseQuote`·`missingQuote`, `quoteRequired`, `UserApi` 선택 메서드 | `authenticateStanding`, 정지 계정 차단(POST 거부) | — | 정지 계정 차단 줄이 `/api/me/rewards/*` POST보다 **앞에** 오게 한다(정지 계정은 출석·수령 불가) |
| `worker/wrangler.toml` | **변경 없음** (`RETENTION` 미설정 = off) | DO v5 마이그레이션·변수 | DO v5 마이그레이션·변수 | #141·#142가 둘 다 v5를 쓴다 → INT-1이 번호를 정리한다 |
| `src/routes.ts`, `src/App.tsx` | 라우트 `rewards` 1줄씩 | `admin`·`suggestions`·`mailbox` | `daily` | 라우트 목록 한 줄씩 합친다. 메뉴 연결은 UI-1·01 담당 |
| `src/economy/live/catalog.ts` | 칭호 3종(rev 3), `CATALOG_REV = 3` | — | — | A2·UI-2 카탈로그 작업과 순서만 맞춘다 |
| `src/cosmetics-a2.css` | 칭호 표식 3줄(`tests/a2-cosmetics.test.ts`가 요구) | — | — | A2 영역, 추가 3줄 |
| `docs/context/DECISIONS.md` | D-C5-1~4 | D-101~D-105 초안 | D-101~D-106 초안 | 셋 다 D-101 이후를 쓴다. 기존 D-101은 SEC-1(main). INT-1이 재번호한다 |
| 상점·공용 화면(`EconomyPages.tsx`, `DrawPanel.tsx`) | 견적 필드 전송, 409 처리 코드 추가(문구·구조 그대로) | — | — | UI-2 상점 개편과 겹치면 **요청 본문 필드만** 보존한다 |

## 3. ADMIN-1(#141) adminGrant·mailbox 전환 방안

#141은 우편함(`inbox` 테이블, 공지·제재 알림·보상)과 수령 시 `EconomyStore.adminGrant`로 원장 `admin:<id>` 행을 쓴다. 지급 경로가 두 개가 되지 않도록 다음 순서로 맞춘다.

1. **원장 경로 단일화(필수):** `adminGrant(userId, eventId, coins, gems, label, now)` 본문을 `creditAdminClaim(grants, userId, { eventId, source: kind === "adoption" ? "suggestion" : "operator", coins, gems, label, campaign, actor }, now)` 호출로 바꾼다.
   - txId는 `admin:<우편함 ID>` 그대로라 #141의 재수령 멱등은 바뀌지 않는다. 원장 행은 `g:admin:<id>`, 지급 기록은 `grant_tx`에 남는다.
   - 출처별 상한·`SOURCE_DISABLED`·`verify()`가 적용된다. #141의 운영 상한 검사는 그대로 둔다(이중 안전).
2. **보상함 통합(권장 최종형):** 보상이 붙은 우편함 항목은 전달 시점에 `grants.issue({ txId: "admin:<id>", delivery: "inbox", expiresAt })`로 만들고, 우편함 행은 메시지(코인 0)만 갖는다.
   - 수령은 `POST /api/me/rewards/claim`(또는 #141 화면이 같은 `grants.claim` 호출) 한 곳이다.
   - 미수령 회수는 `grants.revoke(txId, "admin:<id>")`이고, 지급된 보상은 되돌리지 않는다.
3. **교환 코드:** 전역 코드 목록·사용 수량은 #141 AdminHub(`createCode`·`redeem`·`confirmRedeem`)가 맡는다. 계정 쪽 지급은 `grants.issue({ txId: "code:<코드ID>", source: "redeem-code" })`다.
   - 지금 `/api/me/rewards/redeem`은 `REDEEM_OFF`만 돌려준다. #141 연결과 금액 승인 뒤 AdminHub 예약 → 계정 지급 2단계로 바꾼다(계약 §5).
4. **운영 데이터 이전:** #141은 운영 미배포이고 `ADMIN_WRITES=off`라, 이전할 `admin:` 원장 행이 없다. 만약 먼저 배포되어 `admin:` 행이 생기면 `EconomyStore.verify()`는 그대로 성립한다(`grants.verify()`는 `g:` 행만 본다). 새 전달부터 1·2를 적용하면 된다.
5. **활성화 조건:** 관리자·제안 보상 금액은 미승인이다. `operator`·`suggestion`·`compensation`·`redeem-code`는 `APPROVED_SOURCES`에 없어서 코드가 들어와도 지급되지 않는다. 승인 시 Worker 설정에서 출처를 켜고 SEC-1 2차 감사(관리자 쓰기)를 통과해야 한다.

## 4. LIVE-1(#142) 일일 콘텐츠 연동

- #142의 `DailyRewardHook`/`NO_DAILY_REWARDS`는 그대로 둔다(`DAILY_REWARDS_APPROVED = false`, 일일 콘텐츠 코인 미승인).
- 연속 활동만 승인되었다("승인된 일일 콘텐츠 완료"). 공식 오늘의 요트 완료(`daily.official.completed`)가 서버에서 판정되면, 일일 API가 같은 계정 객체 RPC `dailyContentDone({ kind, at })`를 부른다.
  - 활동일 1일로 기록하고 이정표 보상이 생기면 같은 트랜잭션에서 지급한다.
  - `daily.puzzle.answered`·`daily.official.started`는 활동이 아니다(`ACTIVITY_DAILY_KINDS`).
- 클라이언트가 보고한 완료·연습 기록은 근거가 아니다. 서버 판정 직후 서버 코드에서만 부른다.

## 5. 견적 필드 단계적 필수화

| 단계 | 조건 | Worker 설정 | 동작 |
|---|---|---|---|
| 0 (현재) | 신규 Pages 배포 전 | `ECONOMY_QUOTE` 미설정 | 필드가 있으면 검사, 없으면 기존 동작 |
| 1 | 견적을 보내는 Pages가 배포됨 | 그대로 | 운영 지표에서 견적 없는 구매 비율(신규 카운터 `shop.noQuote` — 활성화 PR에서 추가)을 관찰 |
| 2 | 2주 이상, 견적 없는 요청이 사실상 0 | `ECONOMY_QUOTE="required"` (수동 배포) | 필드가 없으면 `409 CLIENT_UPDATE_REQUIRED`, 차감 없음. 화면은 새로 고침 안내 |
| 롤백 | 문제 발생 | 변수를 지우고 재배포 | 0단계로 복귀(스키마 변화 없음) |

## 6. 운영 활성화 체크리스트 (별도 승인 후)

1. INT-1이 #140·#141·#142의 충돌을 정리하고 DO 마이그레이션 번호를 확정한다. 필수 CI가 통과해야 한다.
2. 수동 고위험 Worker 배포(D-100 보호 입력)를 한다. 이때 `RETENTION`은 아직 설정하지 않는다(테이블만 생성).
3. 격리 Worker에서 `RETENTION=on`으로 시나리오를 재현한다(`tests/retention-worker-e2e.test.ts`). 운영에서는 소유자 계정부터 확인한다.
4. 운영 `RETENTION="on"`. **기존 사용자 소급 지급은 없다**(진행도 0부터, 과거 경기로 이정표를 주지 않음).
5. 프로필·결과 화면에 진입점을 둔다(UI-1). 결과 영수증에는 이미 연속 활동·주간 연승 지급 줄이 들어간다.
6. 롤백: `RETENTION`을 지우면 보상 경로는 404가 되고 정산이 멈춘다. 이미 지급된 원장은 그대로 둔다.

## 7. 활성화 뒤 측정 계획

| 지표 | 출처 | 기준 / 경보 |
|---|---|---|
| 출처별 발행량 | Hub 카운터 `grant.<source>`·`grant.<source>.coins/.gems`(신규), 기존 `econ.coins/gems` | 시뮬레이션 예측: 일일 플레이어 +15.9%, 가끔 접속 +31.8%(90일). 2주 평균이 예측의 1.5배를 넘으면 검토 |
| 소비량 | 기존 `buy.<tier>.<currency>`·`upgrade`·`slot.*`·`shop.draw` × 가격표 | 발행 대비 소각률(월) |
| 잔액 분포 | 기존 `balance.<bucket>`(활성 회원 첫 경기) | 상위 구간 증가 속도. 시뮬레이션 365일 평균 잔액 +18% |
| 계정별 하루 최대 | 기존 `econ.maxCoinsOneAccount` | 이론상 최대 약 323 → C5-CORE 358코인. 초과 시 조사 |
| 재방문율 | `dau.members` + 출석 수령 수 `grant.attendance` + 활동일 | D1·D7·D30 재방문(같은 집계일 기준 회원 비율). 활성화 전 4주와 비교(계절성 주의). 개인 ID 없이 일 단위 합계만 |
| 연속 활동 분포 | `grant.activity-streak`(이정표별 txId 접두 집계는 활성화 PR에서) | 3·7·14·30일 도달 비율 |
| 주간 연승 | `grant.weekly-streak` | 계정당 주 50코인 상한 확인 |
| 이상 징후 | `grant_tx` + `verify()`(관리자 원장 검사 경로에 포함됨) | 불일치 0건 |
