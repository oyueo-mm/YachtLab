# ADMIN-1 관리자 페이지 · FEEDBACK-1 사용자 제안 (담당 06, 2026-11-28)

> 상태: **구현·격리 검증 완료, 운영 미활성.** 관리자 계정 등록(`ADMIN_ACCOUNTS`), 쓰기 활성(`ADMIN_WRITES=on`), 제안 게시판 공개(`FEEDBACK_BOARD=on`)는 모두 **별도 승인** 대상이다. SEC-1 결정에 따라 관리자 쓰기 기능은 **SEC-1 담당자(08)의 독립 검증 전에는 운영에서 켜지 않는다.** `wrangler.toml`(바인딩·마이그레이션 v5·변수)과 `worker/src/economy.ts`가 바뀌었으므로 CI-1.2(D-100) 보호 입력 → 자동 배포가 정지되고 수동 승인 배포만 가능하다.
>
> 결정: D-107~D-111. 코드: `worker/src/admin/`(roles·store·member·stats·api), `worker/src/feedback/board.ts`, `src/admin/`, `src/engagement/`. 테스트: `tests/admin-feedback.test.ts`(26), `tests/admin-sec1.test.ts`(13), `tests/admin-worker.test.ts`(wrangler dev E2E 1), `tests/ui/admin-feedback.spec.ts`(Playwright 3×2).

## 0. 조사한 기존 구조 (작업 전)

| 항목 | 기존 상태 |
|---|---|
| 관리자 API | `GET /api/admin/metrics`, `GET /api/admin/ledger/:id` — Worker 시크릿 `ADMIN_TOKEN` 하나(공유 bearer, 역할·감사·만료 없음). **유지**(CLI 운영 점검용 레거시) |
| 회원 인증 | Google OIDC → 계정별 SQLite DO `UserStore`, bearer 세션 `s1.<userId>.<secret>`(해시 저장, 30일) |
| 통계 | `MatchHub` 일별 카운터(120일, 개인 ID 없음), `RoomDirectory.usage()` |
| 전체 회원 목록 | **없음**(계정마다 별도 DO). 순회는 금지 조건 |
| 경제 | `EconomyStore` 원장(`event_id` PK, 잔액·원장 한 트랜잭션, `verify()`) — 07/C5 담당의 별도 지급 계약 PR은 저장소에 없음 → 이 원장을 그대로 재사용 |

## 1. 1단계 — 관리자 인증·기반

* **관리자 식별:** 기존 회원 계정 ID(`u_…`) + Worker **시크릿** `ADMIN_ACCOUNTS="u_…:owner,u_…:viewer"`. 정적 프런트엔드·저장소·URL에는 아무 비밀도 없다(`#admin` 화면을 숨기는 것은 통제가 아님).
* **역할(최소 권한)** — `worker/src/admin/roles.ts`

| 역할 | 권한 |
|---|---|
| viewer | `stats.read`(집계만) |
| support | + `users.read`(회원 상세, 감사됨), `reports.read/write` |
| operator | + `audit.read`, 공지·보상·코드·제재·제안 **초안** |
| owner | + `approve`(초안 승인·실행) |

* **관리자 세션 분리:** `POST /api/admin/session`(회원 세션 필요) → 별도 토큰 `a1.…`(해시 저장, **30분 미사용·4시간 절대 만료**, 계정당 최근 3개). 이후 모든 관리자 호출은 `a1.`만 받는다(회원 `s1.` 거부). 브라우저는 sessionStorage에만 둔다(탭 종료 시 소멸).
* **매 요청 서버 검증:** 역할은 요청마다 `ADMIN_ACCOUNTS`에서 다시 읽는다 → 목록에서 빼면 열린 세션도 즉시 무효(세션 삭제). 비관리자·만료·미등록 경로 모두 **같은 404**(존재 은닉), 권한 부족은 403 + 감사 기록.
* **재인증(후속 작업에서 실제 Google 재인증으로 교체, §9.1):** 관리자 세션은 Google `prompt=login`·`max_age=0` 재인증과 `auth_time` 검사를 거친 1회용 티켓으로만 발급됩니다. 고위험 작업(승인·실행, 보상·코드·제재 초안, 보상 회수)은 재인증 후 **10분 이내**에만 가능하고, 승인에는 작업 ID를 직접 입력해야 합니다.
* **감사 로그:** `audit` 테이블(append-only, 삭제·수정 경로 없음): 관리자 로그인/거부, 모든 쓰기, 회원 상세·신고 열람, 권한 거부. IP는 저장하지 않고 해시된 클라이언트 키만.
* **요청 제한:** 관리자 API 120/분/클라이언트, 세션 발급 10/분.
* **공통 레이아웃:** `src/admin/AdminConsole.tsx` — 사이드바(현황·통계·운영 그룹, 권한 없는 메뉴 숨김), 모바일은 메뉴 선택 상자.

### 안전한 운영자 계정 등록 방법(실행하지 않음 — 별도 승인)

1. 운영자가 사이트에서 Google 로그인 → 계정 설정/프로필에서 본인 `u_…` ID 확인(또는 운영 점검 중 `/api/me`).
2. 계정 소유자가 Cloudflare 대시보드 또는 `wrangler secret put ADMIN_ACCOUNTS`로 **시크릿** 입력(예: 본인 `owner`, 두 번째 운영자 `owner`, 조회 담당 `viewer`). `wrangler.toml`이나 저장소에 넣지 않는다.
3. 처음에는 `ADMIN_WRITES=off`로 읽기 전용 운영 → SEC-1 독립 검증 → 별도 승인 후 `on`.
4. 기본은 2인 승인(`two-person`)입니다. 운영자가 1명이면 `ADMIN_APPROVAL=single-operator`를 쓸 수 있습니다(제한 규칙, §9.2). 예전 값 `self`도 같은 제한 규칙으로 처리됩니다.
5. 회수: 시크릿에서 해당 ID를 지우면 다음 요청부터 접근 불가.

## 2. 2단계 — 읽기 전용 대시보드

**원칙:** 모든 사용자 DO 순회 금지, 없는 지표는 `null` → 화면 "미집계". 데이터 원천은 ① 기존 Hub 일별 카운터, ② 신규 `AdminHub`의 활동 집계·회원 색인, ③ 회원 상세 시 그 계정 DO 1개.

### 2.1 신규 집계 구조 (개인정보 최소)

* 계정이 **UTC 하루 첫 인증 시 1회** `activity` 보고(계정 DO에 마지막 활동일 1행). 보고에는 주/월 첫 활동 여부와 이전 활동과의 간격만 → AdminHub는 ID 없이 일별 `active`, `weekFirst`, `monthFirst`, `return.*`를 센다 ⇒ **DAU·WAU·MAU가 근사 아닌 정확한 고유 수**.
* 회원 색인 `members`: ID, 공개 닉네임, 가입 시각, 마지막 활동일, 제재 상태. **이메일·실명·IP·세션 없음.** 색인 배포 이후 활동한 계정만 포함 → "전체 회원 수"는 미집계로 표시하고 "색인된 회원"을 따로 보인다.
* 가입·탈퇴 카운터. 탈퇴하면 색인 행 삭제.

### 2.2 메뉴와 지표 상태

| 메뉴 | 제공 | 미집계(이유) |
|---|---|---|
| 서비스 대시보드 | 색인 회원, 신규 가입 추이, DAU/WAU/MAU, 재방문 간격, 매칭 대기·진행 경기, 방 사용량, 플래그 | 전체 회원 수(전역 저장소 없음), 사이트 동시 접속자(세지 않음) |
| 사용자 | 닉네임/ID 검색, 상태 필터, 정렬, 페이지네이션(50), 상세: 가입·활동·전적·코인·보석·주요 상품·업적 수·원장 점검·제재·알림함 | 이메일 등 인증 정보는 의도적으로 비노출 |
| 경기 | 일별·기간 경기 수, 모드별, 완료율·기권율, 평균 시간, 참가 인원 분포(`players.N`, 신규) | 경기별 원시 목록 |
| 매칭 | 요청, 성사율, 대기 평균·오늘 p50/p90, 취소율, 시간대(`queue.hour.HH`, 신규) | 과거 일자 분위수 |
| 경제 | 발행(경기·퀘스트·업적), 운영 보상(`grant.admin.*`), 소비(`spend.*`, 신규), 출처별 지급, 잔액 구간 표본, 원장 이상(`ledger.problem`) | 전체 잔액 분포(표본만) |
| 상품 | 등급별 구매, 상품별(`item.*`), 강화 단계(`upgrade.level.N`), 뽑기·중복·족보 | 장착률, 컬렉션 완성(계정 순회 필요) |
| 퀘스트·업적 | 완료, 일일 전부 완료율(DAU 대비), 퀘스트·업적별(`quest.id.*`, `achievement.id.*`) | 퀘스트 배정(참여) 수 |
| 시스템 | Worker 응답, 운영 한도, 서버 오류(`worker.error`), 탈퇴 정리, 최근 관리 이벤트, 제안 현황 | 요청량·CPU(Cloudflare 대시보드) |

`queue.hour.HH`는 `HubCore`의 대기열 입장 시 1줄 추가로 기록한다(C3 소관 파일, 동작 변경 없음 — C3에 공유).

## 3. 3단계 — 관리자 쓰기 (기본 비활성)

모든 쓰기는 `ADMIN_WRITES=on`이 아니면 403. 위험 작업은 **초안 → 다른 owner 승인(10분 내 세션 + ID 입력) → 실행**. 실행은 작업 ID에서 파생된 ID로 멱등.

| 기능 | 구현 |
|---|---|
| 보상 | 개별(ID 목록)·조건(가입 기간, 최근 N일 활동)·전체(색인) 대상, 예약 시각, 만료(1시간~90일), **대상 수·총 지급량 미리보기**(쓰기 꺼져도 가능), 1인 안전 상한(코인 10,000·보석 300 — 정책 아님), 지급 이력. AdminHub 알람이 25건씩 **알림함**에 전달(INSERT OR IGNORE). 실패는 지수 백오프 6회 → `failed` → "실패 재시도"(중복 지급 없음). 중단 시 대기분 취소, 이미 전달된 미수령 보상은 회원별 회수. 수령된 보상은 원장이 append-only라 회수하지 않음 |
| 교환 코드 | 생성(지정/자동 10자), 기간, 전체 횟수, 계정별 횟수, 대상(이 시각 이전 가입자), 초안→승인 후 활성, 즉시 비활성화, 사용 이력. 미존재·초안·비활성은 같은 답(코드 추측 방지), 계정·IP 요청 제한. 예약→지급→확정 순, 지급 실패 시 같은 ID로 재시도(원장 멱등) |
| 공지 | 작성·수정·종료, 게시 예약·종료 시각, 중요, 분류(공지·점검·업데이트·이벤트), 공개 `GET /api/notices`(60초 캐시) → 회원 알림함 화면. 전역 배너 부착은 01 요청(H-06-2) |
| 신고·제재 | 회원 신고(`POST /api/reports`: 유형·내용·경기 ID, 하루 10건, 중복 접수 차단). 상태(접수·검토·조치·기각)·메모. 증거: 신고자 계정의 **서버 검증 경기 기록**(없으면 "찾지 못함" 표시 — 채팅 원문은 서버에 없음). 제재: 경고(즉시), 닉네임 초기화·기간 제한·정지(승인). 사유 기록·회원 통지(알림함)·해제·감사. **집행:** 정지 = 회원 쓰기 전부·온라인·친구 차단(읽기·로그아웃·탈퇴·이의제기만), 제한 = 온라인 대전·친구 요청·제안/신고 작성 차단. 탈퇴 후 재가입해도 진행 중 제재 복원 |
| 이의제기 | 회원이 제재별 제출(중복 처리 중 차단, 최대 3회), 상태(접수·검토·인용·기각), 답변 통지, 인용 시 제재 해제(`sanctions.write` 필요), 제재 이력과 연결 |

**경제 원장 재사용(C5/07):** 지급 경로는 단 하나 — 회원이 알림함에서 받기 → 계정 DO 한 트랜잭션에서 `MemberOps.claim` + `EconomyStore.adminGrant`(→ 기존 `post`, 원장 id `admin:<item id>`, kind `admin-grant`, funding `play`) → `verify()` 재합산 일치. 관리자·게시판 코드는 잔액·원장을 직접 쓰지 않는다(정적 테스트). 금액 정책은 07/C5 연구 후 확정.

**격리 검증:** 운영 데이터에 실제 지급·정지·삭제를 하지 않았다. 모든 검증은 node:sqlite 메모리 DB와 임시 디렉터리의 `wrangler dev --local`(가짜 IdP)에서 수행.

## 4. 4단계 — 사용자 제안·건의 (FEEDBACK-1)

* 작성: 신규 기능·UI/UX·상품·게임 모드·버그 + **보안 취약점·개인정보/민감 문의(자동 비공개)**. 제목 4~80자, 내용 10~4,000자.
* 게시판(`#suggestions`): 목록·상세, 검색(제목·내용), 분류·상태 필터, 최신순·추천순, 계정별 추천/취소(자기 글 불가, 하루 100), 내 제안, 운영자 답변, 상태(접수·검토 중·채택·개발 중·구현 완료·보류·미채택).
* 채택 보상: 채택 시 사유 필수 기록 → 제안당 1회 보상 초안(중복 요청 거부) → 승인 → 알림함(`sg:<id>`) → 수령 시 원장 1회. 작성만으로는 지급 없음. 작성자 동의 시 "업데이트 기여자" 목록(`/api/suggestions/contributors`).
* 악용·개인정보: 2분 간격·하루 5개·24시간 같은 제목 금지, IP당 10/분, 신고 5건 자동 숨김 후 관리자 검토, 텍스트만 저장·텍스트 노드로만 렌더(HTML·Markdown·클릭 링크 없음), `javascript:`/`data:` 등 거부, 링크 3개 제한, 제어·양방향 문자 제거.
* **첨부: 비활성.** 이유 — 무료 범위에서 안전한 이미지 저장소가 확정되지 않음(R2는 계정에서 별도 활성화·결제 수단 등록이 필요하고, DO SQLite에 이미지를 넣으면 저장 비용·2MB 행 제한·보존 정책 문제). 유료 저장소를 임의 개설하지 않았다. 향후 경로용으로 형식(PNG/JPEG/WebP 매직 바이트)·크기(1MB) 검증 함수 `checkAttachment`와 테스트만 둠. 첨부 필드가 오면 `ATTACHMENTS_OFF`.
* 계정 삭제: 공개 글은 "탈퇴한 사용자"로 익명화·기여자 표시 해제, 그 계정의 추천·신고 삭제(추천 수 반영), **비공개(보안·개인정보) 글은 삭제.** 삭제 연동은 best-effort(실패 시 경고 로그) — 잔존 위험 R-4.
* 전체 내비게이션 연결은 **01 담당 요청**(H-06-2): `#suggestions`, `#mailbox` 메뉴 항목, 중요 공지 배너, 프로필·경기 결과의 "신고" 버튼(`reportMember` 함수 제공).

## 5. 관리 UI 품질

표·검색·필터·기간(7/14/30/90일)·페이지네이션·단일 계열 막대 그래프(한 색, 호버/포커스 툴팁, "표 보기" 대체, `미집계`는 0과 구분). PC 사이드바, 모바일은 메뉴 선택 상자·가로 스크롤 없음(Playwright 확인). 쓰기 꺼짐 배너와 비활성 버튼.

## 6. SEC-1 출시 차단 조건 대응 (독립 검증용 인터페이스)

| SEC-1 요구 | 구현 | 테스트 |
|---|---|---|
| 서버 측 관리자 역할 검사 | `handleAdminRoute`가 매 요청 `ADMIN_ACCOUNTS` 재조회 | sec1 "member session…", feedback "checks the role…" |
| 읽기·쓰기 권한 분리 | 역할→권한 표, 라우트별 `need(permission)` | sec1 "support can read…" |
| 관리자 세션 분리·보호 | `a1.` 별도 토큰, 해시 저장, 30분/4시간, sessionStorage, 로그아웃 서버 삭제 | sec1 session 2건 |
| 민감 행위 재인증 | 세션 발급과 고위험 작업에 실제 Google 재인증(`prompt=login`, `max_age=0`, `auth_time`, 1회용 티켓) 필요, 10분 이내 + 작업 ID 입력 | followup §1, E2E, sec1 |
| 일반 사용자 API 차단 | 비관리자·회원 세션 → 404 | sec1, E2E |
| 모든 관리자 쓰기 감사 | 각 쓰기 라우트 `audit(...)`, append-only | sec1 "each write route…", "no delete path" |
| 저장형 XSS 방지 | 텍스트 저장·텍스트 노드 렌더, 원시 HTML API 사용 금지(정적 검사) | sec1, Playwright XSS |
| 입력·첨부 검증 | `cleanText`, 길이·분류·링크 규칙, 본문 크기 16KB, `checkAttachment`, 첨부 비활성 | sec1, feedback board |
| 투표·채택 보상 중복 방지 | `sg_votes` PK, `reward_action` 1회, 알림함 id·원장 id 멱등 | sec1 "duplicate…" |
| 민감 문의·보안 제보 비공개 | `security`/`privacy` 자동 비공개, 목록·추천·신고 불가 | sec1 "private intake" |
| C5 원장 우회 금지 | 지급은 `adminGrant`→`post`만, 정적 검사 | sec1 "no reward path…" |

**독립 검증 요청 시 확인할 잔존 위험:**

* R-1 ~~회원 세션만으로 관리자 세션 발급~~ → **해소**(§9.1). 남은 위험: Google 계정 자체가 탈취되면 막을 수 없습니다. 운영자 계정에는 2단계 인증을 쓸 것을 권장합니다.
* R-2 ~~`self`면 2인 통제가 사라짐~~ → **완화**(§9.2): 단일 운영자 규칙(대기 시간, 초안 작성 뒤 재인증, 영향 범위 제한, 하루 3건, 감사 표시)으로 대체했습니다.
* R-3 제한(restrict) 계정이 로그아웃 후 게스트로 온라인 플레이하는 것은 막을 수 없음(계정 보상·기록은 없음). 빠른 대전에서 제한 계정은 "로그인 만료"로 표시됨(UX 후속).
* R-4 ~~탈퇴 연동 1회 시도~~ → **해소**(§9.3): 친구 정리와 같은 내구성 대기열로 처리합니다.
* R-5 제재 기록의 탈퇴 후 보관 → 보존 정책을 구현했습니다(§9.4). 처리방침(#126) 반영과 기간 확정은 별도 승인입니다.
* R-6 단일 전역 `AdminHub`/`SuggestionBoard` DO 처리량(현 규모 충분, 대규모 시 분할).

## 7. API 요약

관리자(`Authorization: Bearer a1.…`): `POST session|logout`, `GET me|overview|stats|system|members|members/:id|audit|reports|reports/:id|appeals|sanctions|notices|rewards|codes|codes/:id/redemptions|actions|suggestions|suggestions/:id`, `POST rewards/preview|rewards|rewards/:id/(cancel|retry)|members/:id/inbox/:item/revoke|codes|codes/:id/deactivate|notices|notices/:id/end|reports/:id|sanctions|sanctions/:id/lift|appeals/:id|suggestions/:id|suggestions/:id/reward|actions/:id/(approve|reject|cancel)` (모두 `/api/admin/` 아래).

회원: `GET /api/notices`(공개), `GET /api/suggestions`, `GET /api/suggestions/:id`, `GET /api/suggestions/contributors`, `POST /api/suggestions`, `POST /api/suggestions/:id/(vote|report|credit)`, `POST /api/reports`, `GET /api/me/mailbox`, `POST /api/me/mailbox/:id/claim`, `POST /api/me/redeem`, `GET /api/me/sanctions`, `GET|POST /api/me/appeals`. (`/api/me/inbox`는 기존 친구 받은함이므로 알림함은 `/mailbox`.)

## 8. 운영 준비 체크리스트 (모두 별도 승인)

- [ ] 이 PR 리뷰·CI(`npm ci`·`npm test`·`npm run build`·Playwright) 통과
- [ ] **SEC-1(08) 2차 독립 보안 검증**([검증 목록](./SEC-1-AUDIT-2-CHECKLIST.md)) — 통과 전 쓰기 활성 금지
- [x] INT-1: DO 마이그레이션 태그 확정 — ADMIN-1 `v5`, LIVE-1 `v6`(이전 임시값 `v5-admin-feedback`)와 최종 순서 확정, #140 RewardGrants 연결
- [ ] `ADMIN_REWARD_POLICY`(지급액 정책 버전) 승인 — 그 전에는 보상·코드·채택 보상 초안 거부
- [ ] 운영자 Google 계정 2단계 인증 확인
- [ ] 07/C5: 채택 보상·운영 보상·쿠폰 금액 정책, 안전 상한 확인
- [ ] 01: `#suggestions`·`#mailbox` 메뉴, 중요 공지 배너, 신고 버튼 연결
- [ ] 수동 Worker 배포(보호 입력: DO 마이그레이션 v5 `AdminHub`·`SuggestionBoard`, 변수 3개) — Workers Free 유지 확인, 롤백 대상 기록
- [ ] 계정 소유자가 `ADMIN_ACCOUNTS` 시크릿 등록(§1) → 읽기 전용 운영 확인
- [ ] 처리방침(#126)에 회원 색인·제재 보관·게시판 처리 반영(병합·공개는 별도 결정)
- [ ] `FEEDBACK_BOARD=on`(게시판 공개) 승인
- [ ] SEC-1 통과 후 `ADMIN_WRITES=on` 승인, 첫 지급은 소수 대상 미리보기로 확인
- [ ] C3에 `queue.hour.HH` 카운터 1줄 추가 사실 공유
- [ ] 롤백: 변수 `ADMIN_WRITES=off`·`FEEDBACK_BOARD=off`(즉시), `ADMIN_ACCOUNTS` 삭제(콘솔 차단). 새 DO 클래스는 삭제 마이그레이션 없이 남겨도 무해


## 9. 후속 작업 (2026-11-28, PR #141 추가 커밋)

### 9.1 실제 Google 재인증 (D-107 보강)

1. 콘솔에서 "관리자 세션 시작"을 누르면 `/auth/google/start?purpose=admin&cs=<탭 상태 해시>`로 이동합니다. Worker는 `prompt=login`과 `max_age=0`을 붙여 Google이 기존 세션을 재사용하지 않고 다시 인증하게 합니다.
2. 콜백에서 ID 토큰의 `auth_time`이 이 로그인 시작 시각(허용 오차 60초) 이후인지 확인합니다(`requireFreshAuth`). `auth_time`이 없거나 오래되면 거부합니다. 계정을 새로 만들지 않고, 관리자가 아닌 계정은 같은 오류(`admin-reauth-error=denied`)를 받습니다.
3. 관리자에게는 2분짜리 1회용 티켓을 `#admin-reauth=`로 돌려줍니다. 티켓은 해시로 저장되고 그 계정과 탭에 묶입니다.
4. `POST /api/admin/session {reauth, clientState}`는 회원 세션과 티켓을 함께 요구합니다. 다른 회원 세션이나 다른 탭에서는 쓸 수 없고, 한 번만 쓸 수 있습니다. 발급된 세션에는 `reauth_at`(Google 인증 시각)이 기록됩니다.
5. 고위험 작업은 `now − reauth_at ≤ 10분`일 때만 허용합니다. 대상은 승인·실행, 보상·코드·제재(경고 제외) 초안, 보상 회수, 확장 라우트 중 `highRisk`입니다. 조회는 30분 미사용·4시간 세션으로 계속할 수 있습니다.
6. `ADMIN_REAUTH=off`는 `APP_URL`이 루프백(127.0.0.1)일 때만 적용됩니다. 배포된 Worker에서는 항상 `google`이고, `wrangler.toml`에 이 변수를 두지 않습니다(테스트로 고정).

### 9.2 단일 운영자 승인 정책 (D-112)

기본값은 계속 `two-person`입니다. `ADMIN_APPROVAL=single-operator`일 때만 owner가 자기 초안을 승인할 수 있고, 다음 조건을 **모두** 만족해야 합니다.

| 규칙 | 값 | 목적 |
|---|---|---|
| 대기 시간 | 초안 작성 후 10분 | 실수·충동 실행 방지, 같은 세션으로 즉시 실행 금지 |
| 초안 작성 뒤 재인증 | `reauth_at > created_at`, 10분 이내 | 탈취된 관리자 세션 하나로 작성·승인을 모두 할 수 없게 함 |
| 영향 범위 | 보상은 개별 회원 20명 이하(조건·전체 불가), 제한·정지는 30일 이하(무기한 불가), 코드는 전체 100회 이하 | 큰 작업은 두 번째 관리자 필요 |
| 하루 예산 | 본인 승인 하루 3건(KST) | 남용 상한 |
| 감사 | `action.execute` 상세에 `approval: "self-approved"` | 사후 검토 |

예전 값 `self`는 무제한 승인이 아니라 이 규칙으로 해석합니다.

### 9.3 탈퇴 정리 재시도 (D-114)

탈퇴 트랜잭션은 계정 데이터 삭제와 함께 기존 C4.2 정리 대기열(`acct_cleanup`)에 `@admin`과 `@board` 대상을 기록합니다. 처리 방식은 친구 정리와 같습니다.

* 즉시 1회 시도하고, 실패하면 알람 백오프로 16회까지 재시도합니다. 그 뒤에는 보류하고, `ACCOUNT_CLEANUP_RETRY_EPOCH`로 다시 처리하며, 30일 기록이 끝나면 폐기합니다.
* 모든 단계는 **멱등이고 세대에 묶입니다.** 기준 시각은 이 삭제 기록의 시각(`tomb.deleted_at`)입니다.
  * `AdminCore.deleted(userId, deletedAt)`: `created_at ≤ deletedAt`인 색인 행만 지우고, 탈퇴는 `deletions` 표로 한 번만 셉니다.
  * `BoardCore.forget(userId, before)`: `before` 이전의 글·추천·신고만 처리합니다.
* 따라서 재가입한 같은 Google 계정의 새 데이터는 늦은 재시도에도 건드리지 않습니다.

### 9.4 탈퇴 후 제재 기록의 보존 정책 (D-113, 처리방침 승인 전 제안)

| 데이터 | 보존 목적 | 탈퇴 시 처리 | 삭제 시점 |
|---|---|---|---|
| 진행 중인 제한·정지 | 탈퇴·재가입으로 제재를 피하지 못하게 함(재가입 시 복원) | 최소 항목 유지(사유 포함, 이의제기 대응) | 제재 종료 시각(`until`) / 무기한은 탈퇴 후 최대 1년 |
| 끝난 제재(경고, 닉네임 초기화, 만료, 해제) | 감사 추적, 재범 판단 | 사유 문구를 지우고 종류·시각·처리자만 유지 | 탈퇴 후 1년 |
| 이의제기 | 처리 기록 | 본문 삭제, 상태만 유지 | 연결된 제재를 지울 때 함께 |
| 그 계정이 낸 신고 | 대상 제재의 근거 | 신고자 ID를 `deleted`로 바꿈 | 처리 완료 후 1년 |
| 관리자 감사 로그 | 운영 책임 | 그대로(대상 ID 포함) | **미정**: 현재 무기한, 2년 보존 안을 처리방침과 함께 결정 |

`purgeRetention`은 AdminHub 알람(6시간 간격)에서 실행됩니다. 기간 상수는 `RETENTION`에 있습니다. 기간과 처리방침(#126) 문구는 별도 승인입니다.

### 9.5 기존 ADMIN_TOKEN 경로 검토 (D-115)

| 발견 | 위험 | 조치 |
|---|---|---|
| 하나의 공유 토큰이 역할·세션·만료 없이 동작 | 누가 썼는지 알 수 없음, 토큰 유출 시 장기간 사용 가능 | 사용할 때마다 감사 로그(`actor=token:ADMIN_TOKEN`, `legacy.<route>`), 클라이언트당 분당 30회 제한 |
| `ledger/:userId`가 임의 회원의 잔액·원장 점검 결과를 반환 | `users.read` 권한 검사와 감사를 우회 | 감사 기록. `ADMIN_TOKEN_ROUTES=metrics`나 `off`로 끌 수 있음. 콘솔 회원 상세(`users.read`, 감사됨)가 같은 정보를 제공 |
| 모듈이 같은 토큰으로 새 관리자 라우트를 추가할 수 있었음(LIVE-1 #142의 `POST /api/admin/daily/puzzle`) | 쓰기 작업이 권한·쓰기 스위치·감사를 우회 | 레거시 경로를 코드에 고정된 **GET 2개 허용 목록**으로 제한(설정으로 늘릴 수 없음). 새 라우트는 확장 등록(§9.7)으로만 추가 |
| 토큰과 콘솔 세션이 같은 Authorization 헤더 사용 | 혼동 | 토큰이 정확히 일치할 때만 레거시 경로를 탑니다. 그 밖은 `a1.` 세션 검사로 가고, 실패하면 같은 404입니다 |

권장 순서: 콘솔을 운영하기 시작하면 `ADMIN_TOKEN_ROUTES=metrics`로 줄이고, 운영 점검 스크립트를 옮긴 뒤 `off`로 끕니다. 별도 승인 사항입니다.

### 9.6 DAU·WAU·MAU 정확성 (D-110 보강)

* **시간대:** 회원 활동 집계를 UTC에서 **KST**로 바꿨습니다(`kstDay`, 월요일 시작 주, KST 달력 월). 경제·퀘스트·LIVE-1 일일 콘텐츠와 같은 날짜 경계를 씁니다. Hub 카운터(경기·매칭·경제 통계)는 기존대로 UTC이고, 화면에 각각 표시합니다.
* **정확성:** 계정이 "주 첫 활동"과 "월 첫 활동" 여부를 직접 판정하므로, 일별 합계만으로 정확한 고유 수가 나옵니다. 70일 무작위 활동(KST 23:59와 00:01 경계)을 전수 계산한 값과 일치하는지 테스트로 확인했습니다.
* **중복:** 색인은 `(계정, 일)`을 한 번만 셉니다(`last_day ≥ day`면 무시). 응답을 잃어 재전송되거나 순서가 뒤집혀도 다시 세지 않습니다. 묶음은 일 순서로 정렬해 처리합니다.
* **실패 복구:** 계정은 보고를 `activity_outbox`에 남기고, 색인이 확인응답을 줄 때만 지웁니다. 실패하면 다음 인증 때(최소 1분 간격, 동시에 1건) 미전송분을 한 번에 다시 보냅니다. 최근 14일분까지 보관합니다.
* **한계:** 같은 Google 계정이 탈퇴 후 재가입하면 새 계정으로 셉니다. 색인 배포 전 활동은 집계되지 않습니다. 색인 객체 자체를 잃으면 복구할 수 없습니다(Durable Object 저장소에 의존).

### 9.7 C5 #140 RewardGrants 연동 준비 (D-109 보강)

* 지급 ID를 이미 C5 txId 규칙에 맞췄습니다.
  * 운영 캠페인: `op:<campaignId>`
  * 제안 채택 보상: `sug:<suggestionId>`
  * 교환 코드: `code:<codeId>`(계정당 2회 이상 허용하는 코드는 `:<n>`)
* 1회 상한을 C5 `GRANT_LIMITS`에 맞췄습니다(`operator` 5000/200, `redeem-code` 1000/50, `suggestion` 2000/100). 이 값은 안전 상한이고 금액 정책이 아닙니다.
* **금액은 별도 승인 대상입니다.** `ADMIN_REWARD_POLICY`(승인된 정책 버전)가 없으면 보상·코드·채택 보상 초안을 모두 `POLICY_PENDING`으로 거부합니다. 있으면 그 버전을 작업에 기록하고, C5의 `policyVersion`으로 넘깁니다.
* `worker/src/admin/grant-port.ts`의 `toGrantRequest()`가 알림함 항목을 C5 `GrantRequest`로 바꿉니다(`actor = admin:<승인자>`, 운영·채택 보상은 알림함, 코드는 즉시 지급). #140은 아직 병합되지 않았으므로 연결하지 않았고, 지금은 기존 `EconomyStore.adminGrant`(원장 `admin:<id>`)를 씁니다. INT-1이 통합할 때 계정 객체의 `deliver`/`claim`/`redeemGrant` 내부만 `grants.issue`/`grants.claim`으로 바꾸면 되고, 원장 ID 접두사는 `admin:`에서 `g:`로 바뀝니다. 운영 배포 전 통합이라 기존 데이터는 없습니다.
* C5 계약 §5의 2단계 예약(전역 예약 → 계정 지급, 예약은 취소하지 않음)은 이미 `AdminCore.redeem`/`confirmRedeem`과 같은 구조입니다.

### 9.8 LIVE-1 #142 관리자 API 계약 통일 (D-115)

[LIVE-1 관리자 계약](./LIVE-1-ADMIN-CONTRACT.md) 참고. 요약: `/api/admin/daily*`는 `ADMIN_TOKEN` 대신 `AdminExtensionRoute`로 등록합니다. 보고서는 `stats.read`, 문제 내리기는 새 권한 `content.write`(operator와 owner)·쓰기 스위치·감사를 적용합니다. 동작은 테스트로 고정했습니다(followup §8). #142 브랜치는 수정하지 않았고, 변경 요청만 남깁니다.

### 9.9 SEC-1 2차 감사 목록

[SEC-1 2차 독립 감사 검증 목록](./SEC-1-AUDIT-2-CHECKLIST.md).
