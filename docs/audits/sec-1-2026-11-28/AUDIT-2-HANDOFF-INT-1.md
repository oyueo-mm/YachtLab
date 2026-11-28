# SEC-1 2차 감사 인계 — INT-1 통합 트리 (2026-11-28)

> 대상: 브랜치 `integration/int-1`, Draft PR #147(최종 head는 PR에 기록). 기준 main `d775ecb`. 운영 미배포, 관리자 계정 미등록, 모든 신규 기능 꺼짐([INT-1 §4](../../operations/INT-1-INTEGRATION.md)).
> 원칙(D-098): 확인 항목과 테스트 위치만 공개한다. 발견한 우회 경로의 재현 절차는 비공개로 전달한다.
> 기본 목록: ADMIN-1 [SEC-1-AUDIT-2-CHECKLIST](../../admin/SEC-1-AUDIT-2-CHECKLIST.md)(A1–A11, B1–B11). 이 문서는 **통합으로 바뀐 곳**과 새 교차 표면만 더한다.

## 1. 기존 목록에서 통합으로 달라진 항목

| 항목 | 통합 전 | 통합 후 확인할 것 |
|---|---|---|
| A9·A11 원장 | ADMIN `adminGrant`(`admin:` 원장) | `adminGrant`·`creditAdminClaim` 삭제. 운영 보상·채택 보상·교환 코드가 `worker/src/admin/grant-port.ts` → C5 `RewardGrants` → `EconomyStore.grantCredit`(`g:<txId>`)만 쓰는지. 관리자·게시판·일일 코드에 잔액·원장 직접 쓰기 없음(정적 검사), `verify()` 일치 |
| B5·B11 정책·어댑터 | 연결 전 | `ADMIN_REWARD_POLICY` 게이트 + C5 `APPROVED_SOURCES` 게이트가 **둘 다** 걸리는지. 운영 출처 집합에서 `op:`/`sug:`/`code:`가 `SOURCE_DISABLED`인지. txId 결정성, actor(`admin:<승인자>`), `policyVersion` 기록, 상한 `GRANT_LIMITS` 하나 |
| B10 LIVE-1 확장 | 미등록 | `dailyAdminRoutes`가 `engagement().extensions`로 등록됨. `stats.read`·`content.write` 권한, 쓰기 스위치·감사(`daily.puzzle`) 우회 불가, 공유 `ADMIN_TOKEN`은 GET 2개만 |
| C5 마이그레이션 | 미정 | 확정: `v5` = `AdminHub`·`SuggestionBoard`, `v6` = `DailyBoard`(D-139). 추가만, 삭제 없음 |
| C6 원장 접두사 | `admin:` → `g:` 예정 | 완료. 원장 검증 시험이 `g:` 계약으로 이전됨 |

## 2. 새 교차 표면 (INT-1 집중 검토)

| # | 항목 | 확인할 것 | 시험 |
|---|---|---|---|
| I1 | 교환 코드 1회 | `/api/me/rewards/redeem`·`/api/me/redeem` 두 경로가 같은 예약(txId)을 쓰는지. 동시·반복·대소문자/하이픈 변형 요청이 1회만 지급되는지. 확정적 거절은 예약 해제(코드 미소진), 일시 오류는 재시도 가능 | `int1-admin-grants` |
| I2 | 보상함 단일 원천 | 알림함 항목은 코인·보석 0, 수령은 C5 `grant_tx`에서만. 호환 경로 `/api/me/mailbox/:id/claim`이 같은 txId를 수령(두 번 지급 불가). 회수는 미수령만, 수령분은 append-only | `int1-admin-grants`, `admin-feedback` |
| I3 | 정지 계정 | 보상 POST·쿠폰·알림함 수령·일일 POST가 403, C5 `dailyContentDone` 정지 가드. 정지 계정이 허용된 경로(로그아웃·탈퇴·이의제기) 외로 상태를 바꿀 수 없는지 | `int1-admin-grants` |
| I4 | 일일 × 연속 활동 | 공식 완료만 `dailyContentDone`, 퍼즐·연습·지난 도전 제외. KST 날짜 = `min(at, now)`(클라이언트 시각 불신), 하루 1회 | `int1-admin-grants`, `daily-integration` |
| I5 | 차단 × 빠른 대전(SOC-1-F1) | 회원 쌍을 짝짓기 전 양방향 `isBlocking`, 오류 시 짝짓지 않음. 차단 사실이 상대에게 드러나는 응답·시간 차가 없는지(대기 유지만 보임) | `online-matchmaking` "SOC-1-F1" |
| I6 | 관전 구성원 | 관전 선택 회원은 명령 불가·기록 0·보상 0·경기 잠금 없음(실제 Worker), 외부 관전 키 미발급 | `int1-spectator-worker`, `lobby-watch` |
| I7 | 견적 필드 | UI-2 본문의 `expectedPrice`·`expectedLevel`·`configVersion`·`oddsVersion`. 불일치 409에서 잔액·보유 불변, 같은 `requestId` 재사용 거부 | `int1-spectator-worker`, `sec1-economy` |
| I8 | 공개 플래그 | `/api/features`의 `retention`·`feedback`·`mailbox`·`notices`·`daily`가 각자 변수에서만 켜지는지. 플래그가 꺼져도 서버 경로 자체가 열려 있는 곳(공지 GET, 알림함 GET)이 민감 정보를 내지 않는지 | `int1-admin-grants` "entry flags" |
| I9 | 하트비트 합치기 | `UserStore.inboxBeat`가 기존 개별 호출과 같은 응답·같은 권한(본인 계정만)을 갖는지 | 친구·접속 시험 |
| I10 | 정적 썸네일 | FX-1 썸네일 캐시(sessionStorage)가 계정 정보·게임 상태를 담지 않는지, 공유 WebGL 컨텍스트가 상세 무대와 겹쳐 남지 않는지 | `fx1-preview`, `ui2-shop` |

## 3. 재현

```
npx vitest run tests/int1-admin-grants.test.ts tests/int1-spectator-worker.test.ts tests/online-matchmaking.test.ts tests/admin-feedback.test.ts tests/admin-sec1.test.ts tests/admin-followup.test.ts tests/admin-worker.test.ts tests/daily-integration.test.ts tests/sec1-economy.test.ts tests/lobby-watch.test.ts
npm run build && npm run preview -- --port 5173 &
npx playwright test tests/ui/admin-feedback.spec.ts tests/ui/int1-ui2-c5.spec.ts tests/ui/ui2-shop.spec.ts tests/ui/fx1-preview.spec.ts tests/ui/rewards.spec.ts
```

## 4. 결과 기록

| 항목 | 결과(통과/발견/보류) | 비공개 참조 | 확인자·일시 |
|---|---|---|---|
| 기존 A1–A11, B1–B11 | | | |
| §1 변경 항목 | | | |
| I1–I10 | | | |
