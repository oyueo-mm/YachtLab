# INT-1 제품 통합 (격리 브랜치 `integration/int-1`, Draft PR #147)

기준 main `d775ecb` (보안 출시 #137·#138·#139 포함) · 운영 Pages `d775ecb-mx07j30u` · Worker `692e00a4-d983-4ccb-b93c-4e52c06deca6`(복귀 `6ef2c717-60f1-48c0-89ee-3b7ae8b0f1de`)
승인 범위: 격리 통합·충돌 해결·공통 인터페이스 연결·테스트·검증용 Draft PR. **main 병합·운영 배포·기능 활성화·실제 사용자 보상 지급·담당 브랜치 변경 없음.** 결정: [D-139](../context/DECISIONS.md) (트랙 결정 D-103~D-138).

## 1. 통합 기록 (기준 head와 통합 커밋)

| 순서 | PR | 통합한 head | 통합 커밋 | 충돌 해결 |
|---|---|---|---|---|
| 1 | #140 C5 | `5d49414` | `6bea655` | 없음 |
| 2 | #141 ADMIN-1/FEEDBACK-1 | `4cd73a0` | `f5891da` → `1ffa39e`(보상 경로 단일화) → `78b41d0`(v5 확정) → `ea2b4fa`(e2e) | `routes.ts`, `accounts-api.ts`, `index.ts`, 문서 |
| 3 | #142 LIVE-1 | `762b86a` | `d55835f` | `index.ts`, `routes.ts`, `wrangler.toml`(v6), `App.tsx`, 문서 |
| 4 | #143 SOC-1 | `cda0cae` | `b579006` (+SOC-1-F1 수정) | `App.tsx`, `index.ts`, 문서 |
| 5 | #144 UI-1 | `d6a2a7d` | `c79b8a4` (+진입 플래그·알림함 분리) | `App.tsx`, `MatchPopup.tsx`(UI-1 판), `OnlineGame.tsx`(UI-1 A3 결과창), 문서 |
| 6 | #146 FX-1 | `d9c3fa8` | `4c042f8` | `items-content.css`(양쪽 유지), 문서 |
| 7 | #145 UI-2 | `8964bcc` (재검증: browser(1) 재실행 성공, `ci-result` 성공) | `a519965` | `DrawPanel.tsx`·`EconomyPages.tsx`(UI-2 판 + C5 견적 패치), `ItemViews.tsx`(UI-2 판), 문서 |
| — | 통합 검증·문서 | — | `045718c`, `89e3566`, 이후 커밋 | — |

각 담당 브랜치는 읽기만 했다(변경·삭제 없음). 문서 충돌(DECISIONS/ROADMAP/RESULTS/TECHNIQUES/CONTEXT/HANDOFF)은 모두 양쪽 유지 후 번호만 일괄 부여했다.

## 2. 통합에서 바꾼 것 (각 PR에 없던 변경)

| 항목 | 내용 | 시험 |
|---|---|---|
| 보상 지급 경로 하나 | `worker/src/admin/grant-port.ts`: 운영 보상(`op:`)·채택 보상(`sug:`) = C5 보상함 지급, 교환 코드(`code:<id>[:<n>]`) = C5 직접 지급. 잔액은 `EconomyStore.grantCredit`(원장 `g:<txId>`)만 바꾼다. 삭제: `EconomyStore.adminGrant`(`admin:` 원장), `creditAdminClaim`, ADMIN `wallet()`. `GRANT_CAPS` = C5 `GRANT_LIMITS` | `tests/int1-admin-grants.test.ts` |
| 승인 게이트 둘 다 | `ADMIN_REWARD_POLICY`(정책 버전) + C5 `APPROVED_SOURCES`(출석·연속 활동·주간 연승). 운영 설정에서 관리자·제안·코드 지급은 `SOURCE_DISABLED`, 코드 예약은 해제(코드 소진 없음) | 〃 |
| 알림함 = 메시지, 보상함 = 재화 | 알림함 화면의 받기 버튼·쿠폰 입력 제거, "받을 보상 n개 → 출석·보상" 안내. 쿠폰은 `#rewards` 한 곳. `/api/me/rewards/redeem`은 C5 RewardsView(+`granted`)로 응답(이전엔 ADMIN 형식이라 C5 화면이 깨졌다) | 〃 (RewardsView 형식, 화면 소스 확인) |
| 정지 계정 | 보상 POST·쿠폰·알림함 수령 403, 일일 콘텐츠 쓰기 403, C5 `dailyContentDone`은 정지 중 기록 안 함 | 〃 |
| LIVE-1 일일 관리 | `engagement()`에 `dailyAdminRoutes` 등록(ADMIN 확장 라우트, `stats.read`/`content.write`, 감사 `daily.puzzle`). 공유 `ADMIN_TOKEN`은 GET 2개만 | `tests/daily-integration.test.ts` |
| SOC-1-F1 | 빠른 대전이 두 회원을 짝짓기 전에 양방향 `isBlocking` 확인(오류 = 짝짓지 않음), 차단 쌍은 재매칭 간격 동안 기억(`queue.blockedSkip` 지표) | `tests/online-matchmaking.test.ts` "SOC-1-F1" 3건 |
| 진입 플래그 | `/api/features`에 `retention`·`feedback`·`mailbox`·`notices` 추가(각자 변수, 기본 꺼짐). 신규 변수 `MAILBOX="off"`, `NOTICES="off"` | `int1-admin-grants` "entry flags" |
| UI-2 × C5 | UI-2 구조에 C5 견적 필드·409 처리 재적용(`docs/context/int1-ui2/ui2-c5-port.patch`, 9 hunk 그대로 적용됨), UI 시험 `tests/ui/int1-ui2-c5.spec.ts` 추가 | 실제 Worker: `tests/int1-spectator-worker.test.ts` |
| UI-2 × FX-1 | `src/shell/shop/PreviewStage.tsx` = FX-1 `FxPreview` 재수출, `src/shell/shop/fx1-stills.ts`(주사위 카드 정적 3D 썸네일, 공유 WebGL 1개·직렬 대기열·8초 뒤 해제) | `ui2-shop`·`fx1-preview` UI 시험 |
| 하트비트 비용 | `/api/me/inbox` 하트비트의 계정 DO 호출 4회(ping·요청 수·초대·보낸 초대)를 `UserStore.inboxBeat` 1회로 합침 | 친구·접속 상태 시험 64건 |
| 결정 번호 | 임시 ID 36개 → D-103~D-138(제목에 `[구 …]`), 통합 결정 D-139 | — |

UI-1 시험 경쟁 수정(사이드바 닫기)과 LIVE-1 WebSocket close 이벤트 시험 수정은 담당 브랜치 그대로 들어왔다(충돌 없음, 해당 파일 미수정).

## 3. 추가 확인 11건

| # | 확인 | 결과 |
|---|---|---|
| 1 | LIVE-1 자정 30분 유예 × C5 활동 날짜 | 서버 시각 `min(at, now)`의 KST 날짜로 1회. 유예 중 끝낸 전날 도전 = 오늘 활동, 전날 소급 없음(C5 "소급 없음"과 일치). 시험 고정 |
| 2 | 정지 계정의 일일 콘텐츠 우회 | 일일 POST 403 + `dailyContentDone` 정지 가드 → 연속 활동 보상 우회 불가 |
| 3 | SOC-1-F1 | 해결(§2) |
| 4 | 관전자 제외(실제 Worker) | wrangler dev: 3인 방에서 관전을 고른 회원은 경기 조작 불가, **기록 0·원장 변화 0·경기 잠금 없음**(관전 중 서버 AI 대전 시작 가능), 참가자 2명만 기록·`m:<matchId>` 원장 |
| 5 | UI-1 사이드바 닫기 / LIVE-1 close 이벤트 시험 수정 | 보존(§2) |
| 6 | UI-2 C5 이식 패치 | 그대로 적용. 실제 Worker에서 UI-2가 보내는 본문으로 구매·강화 200, 가격·설정·확률·단계 불일치 409(`PRICE_CHANGED`·`POLICY_CHANGED`·`ODDS_CHANGED`·`LEVEL_CHANGED`), 거절 시 잔액·보유 불변 |
| 7 | FX-1 정적 썸네일·단일 3D 무대 | 카드 그리드 `.stage-board` 0, 상세 1, 상세 반복 열고 닫아도 WebGL 컨텍스트 잔존 없음(`fx1-preview` 시험). 썸네일은 화면 근처 카드만 요청 |
| 8 | 공개 기능 플래그·진입점 통일 | `/api/features` 한 곳, `src/shell/entries.ts`만 진입점을 그림. 관리자 콘솔은 진입점 없음(`#admin` + 서버 관리자 세션) |
| 9 | 알림함/보상함 분리 | §2 |
| 10 | Workers Free 사용량 | §5 |
| 11 | v5(ADMIN) → v6(LIVE-1) 마이그레이션 | `wrangler.toml`: v1~v4 불변, `v5` = `AdminHub`·`SuggestionBoard`, `v6` = `DailyBoard`. 순서 시험 고정, 로컬 wrangler dev 시험이 모두 이 순서로 적용·실행 |

## 4. 기능 플래그 (모두 비활성)

`RETENTION` 미설정 · `ECONOMY_QUOTE` 미설정 · `ADMIN_WRITES="off"` · `ADMIN_APPROVAL="two-person"` · `FEEDBACK_BOARD="off"` · `MAILBOX="off"`(신규) · `NOTICES="off"`(신규) · `ADMIN_REWARD_POLICY` 미설정 · `DAILY="off"` · `DAILY_NEW_ACCOUNTS_RANKED="off"` · 일일 보상 0 · `FRIEND_RESIDUE_CLEANUP` 미설정 · C5 `APPROVED_SOURCES` = 자동 재방문 3종(그것도 `RETENTION` 꺼짐으로 미작동). 관리자 계정 시크릿 `ADMIN_ACCOUNTS` 미등록.

남은 문서 불일치: ADMIN `flags.approval`은 `self`/`two-person`만 보고한다(문서의 `single-operator` 표기는 `self`).

## 5. Workers Free 사용량 (기능별, 코드 경로 기준 추정)

Free 한도(Cloudflare 문서 기준, 배포 전 대시보드에서 재확인): Worker 요청 10만/일, DO 요청 10만/일, SQLite 행 쓰기 10만/일·읽기 500만/일, 저장 5 GB, 번들 gzip 3 MB.

| 기능 | 켜진 상태 비용 | 운영 기본(꺼짐) | 비고 |
|---|---|---|---|
| 번들 | 1,660.5 KiB / gzip 272.9 KiB (운영 401.3 KiB) | — | 증가분 대부분 LIVE-1 퍼즐 데이터. 한도의 약 9% |
| SOC-1 받은함 하트비트(로그인 탭당 60초, 화면 보일 때) | Worker 1 + DO 3(인증 1·계정 1·FriendIndex 1, 메모리만) | 켜짐(SOC-1 기본) | 통합 전 SOC-1 그대로면 DO 6, main은 4. 로그인 탭 1시간 = Worker 60·DO 180 → DO 10만/일 ≈ 탭 555시간/일 |
| SOC-1 경기 시작/종료 | 참가자당 FriendIndex 1(행 쓰기 1) | 켜짐 | |
| SOC-1 빠른 대전 차단 확인(F1) | 회원끼리 짝짓기 1회당 DO 2(양쪽 `isBlocking`), 차단 쌍은 재확인 없음 | 켜짐 | 게스트 쌍 0 |
| ADMIN-1 활동 보고 | 회원당 KST 하루 1회 AdminHub 1(실패 시 최대 분당 1회 재시도), 행 쓰기 1~2 | 켜짐(관리자 미등록이어도 집계) | AdminHub 단일 객체 |
| ADMIN-1 콘솔·게시판·공지 | 관리자·게시판 사용 시에만 | 꺼짐 | |
| C5 보상 | 출석 POST 1/일(DO 2), 연속·연승은 경기 정산 트랜잭션 안(추가 요청 0, 지급 시 행 2~3) | 꺼짐 | |
| LIVE-1 오늘의 요트 | 공식 1판 ≈ 37요청, 행 쓰기 ≈ 42, 참가 상한 500명 → 최악 ≈ 2만 행/일 | 꺼짐 | DAILY-LIVE-1 §7 측정값 |
| UI-1·UI-2·FX-1 | 서버 요청 추가 0(정적 썸네일·3D는 브라우저) | — | UI-1 공지 배너는 `notices` 켜질 때만 GET 1 |

결론: 신규 유료 리소스 없음(모든 저장소 SQLite DO). 꺼진 기능은 비용 0. 켜진 상태의 첫 한도는 **DO 요청 수**(하트비트)이며 통합 수정으로 main보다 적다. 운영 요청량은 측정하지 않았다(배포 뒤 Cloudflare 지표로 확인). 후속: FriendIndex·AdminHub 단일 객체 샤딩은 동시 접속 수천 규모에서 검토.

## 6. 검증

| 항목 | 결과 |
|---|---|
| `npx tsc -b`, `worker` tsc | 통과 |
| `npm test`(vitest 전체, `4c042f8`) | 104 파일 통과 / 1 건너뜀, 1,032 통과 / 1 건너뜀 |
| 이후 추가 시험 | `int1-spectator-worker`(실제 Worker 2건), UI-2 관련 vitest 117, 친구·접속 64 — 통과 |
| `npm run build`, SEO `--check` | 통과 |
| Playwright(로컬 preview, UI-2 관련 8개 스펙) | 95 통과 / 9 건너뜀 / 2 실패 → 원인: 실제 FX-1 썸네일 연결 뒤 "처음엔 2D" 전제가 바뀜 → 시험 전제 조정 후 `ui2-shop` 36/36(2회 반복) |
| 전체 Playwright·필수 GitHub CI | Draft PR #147 최종 head에서 확인(최종 보고에 기록) |

미실시: 구 Pages ↔ 통합 Worker·통합 Pages ↔ 운영 Worker 교차 실행, 실기기 FPS·메모리 실측. 배포 준비 단계에서 지난 출시와 같은 방식으로 수행한다.

## 7. 배포 시 유의 (승인 전 실행 금지)

- `wrangler.toml` 변경(v5·v6 마이그레이션, 바인딩 3개, 변수)은 D-100 보호 입력 → 자동 배포가 멈추고 **수동 고위험 경로(`worker-production-approval`)**만 가능.
- 새 DO 클래스는 추가만이라 기존 데이터 영향 없음. 적용된 태그는 바꿀 수 없으므로 이 순서가 확정이다. 코드 롤백 시 새 클래스는 남아도 무해(바인딩 미사용), 삭제 마이그레이션은 만들지 않는다.
- UserStore 추가 테이블(C5 `grant_tx`/`retention`, LIVE-1 `daily_*`, SOC-1 `soc_*`)은 생성형이라 구 코드와 호환.
- 간헐 실패(기존): `game-shell.spec.ts:14`(main에도 있음).

## 8. SEC-1 2차 감사 인계

[SEC-1 2차 감사 인계](../audits/sec-1-2026-11-28/AUDIT-2-HANDOFF-INT-1.md) 참고(ADMIN-1 [체크리스트](../admin/SEC-1-AUDIT-2-CHECKLIST.md) 기반).
