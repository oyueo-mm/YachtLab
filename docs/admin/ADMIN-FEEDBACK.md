# ADMIN-1 관리자 페이지 · FEEDBACK-1 사용자 제안 (담당 06, 2026-11-28)

> 상태: **구현·격리 검증 완료, 운영 미활성.** 관리자 계정 등록(`ADMIN_ACCOUNTS`), 쓰기 활성(`ADMIN_WRITES=on`), 제안 게시판 공개(`FEEDBACK_BOARD=on`)는 모두 **별도 승인** 대상이다. SEC-1 결정에 따라 관리자 쓰기 기능은 **SEC-1 담당자(08)의 독립 검증 전에는 운영에서 켜지 않는다.** `wrangler.toml`(바인딩·마이그레이션 v5·변수)과 `worker/src/economy.ts`가 바뀌었으므로 CI-1.2(D-100) 보호 입력 → 자동 배포가 정지되고 수동 승인 배포만 가능하다.
>
> 결정: D-ADM-1~5. 코드: `worker/src/admin/`(roles·store·member·stats·api), `worker/src/feedback/board.ts`, `src/admin/`, `src/engagement/`. 테스트: `tests/admin-feedback.test.ts`(26), `tests/admin-sec1.test.ts`(13), `tests/admin-worker.test.ts`(wrangler dev E2E 1), `tests/ui/admin-feedback.spec.ts`(Playwright 3×2).

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
* **재인증:** 승인·실행은 관리자 세션 발급 후 **10분 이내**만 허용(`REAUTH_REQUIRED`) + 작업 ID 직접 입력 확인. 한계: Google 재로그인(`max_age`)까지 강제하지는 않음 — 회원 세션 탈취 시 관리자 세션도 발급 가능. SEC-1 검토 항목 R-1(§6).
* **감사 로그:** `audit` 테이블(append-only, 삭제·수정 경로 없음): 관리자 로그인/거부, 모든 쓰기, 회원 상세·신고 열람, 권한 거부. IP는 저장하지 않고 해시된 클라이언트 키만.
* **요청 제한:** 관리자 API 120/분/클라이언트, 세션 발급 10/분.
* **공통 레이아웃:** `src/admin/AdminConsole.tsx` — 사이드바(현황·통계·운영 그룹, 권한 없는 메뉴 숨김), 모바일은 메뉴 선택 상자.

### 안전한 운영자 계정 등록 방법(실행하지 않음 — 별도 승인)

1. 운영자가 사이트에서 Google 로그인 → 계정 설정/프로필에서 본인 `u_…` ID 확인(또는 운영 점검 중 `/api/me`).
2. 계정 소유자가 Cloudflare 대시보드 또는 `wrangler secret put ADMIN_ACCOUNTS`로 **시크릿** 입력(예: 본인 `owner`, 두 번째 운영자 `owner`, 조회 담당 `viewer`). `wrangler.toml`이나 저장소에 넣지 않는다.
3. 처음에는 `ADMIN_WRITES=off`로 읽기 전용 운영 → SEC-1 독립 검증 → 별도 승인 후 `on`.
4. 운영자가 1명이면 `ADMIN_APPROVAL=self`도 가능하지만 기본은 2인 승인(`two-person`).
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
| 민감 행위 재인증 | 승인은 10분 내 세션 + 작업 ID 입력 | sec1, feedback "old admin session…" |
| 일반 사용자 API 차단 | 비관리자·회원 세션 → 404 | sec1, E2E |
| 모든 관리자 쓰기 감사 | 각 쓰기 라우트 `audit(...)`, append-only | sec1 "each write route…", "no delete path" |
| 저장형 XSS 방지 | 텍스트 저장·텍스트 노드 렌더, 원시 HTML API 사용 금지(정적 검사) | sec1, Playwright XSS |
| 입력·첨부 검증 | `cleanText`, 길이·분류·링크 규칙, 본문 크기 16KB, `checkAttachment`, 첨부 비활성 | sec1, feedback board |
| 투표·채택 보상 중복 방지 | `sg_votes` PK, `reward_action` 1회, 알림함 id·원장 id 멱등 | sec1 "duplicate…" |
| 민감 문의·보안 제보 비공개 | `security`/`privacy` 자동 비공개, 목록·추천·신고 불가 | sec1 "private intake" |
| C5 원장 우회 금지 | 지급은 `adminGrant`→`post`만, 정적 검사 | sec1 "no reward path…" |

**독립 검증 요청 시 확인할 잔존 위험:**

* R-1 관리자 세션 발급은 회원 세션만으로 가능(Google 재인증 미강제). 후보: 관리자 세션 시작 시 `prompt=login&max_age=0` 재로그인.
* R-2 `ADMIN_APPROVAL=self` 설정 시 2인 통제가 사라짐(기본 off).
* R-3 제한(restrict) 계정이 로그아웃 후 게스트로 온라인 플레이하는 것은 막을 수 없음(계정 보상·기록은 없음). 빠른 대전에서 제한 계정은 "로그인 만료"로 표시됨(UX 후속).
* R-4 탈퇴 시 관리자 색인·게시판 정리는 재시도 대기열 없이 1회 시도.
* R-5 제재 기록은 탈퇴 후에도 가명 ID로 보관(재가입 복원 목적) → 처리방침(#126, 미병합·비공개 유지)에 반영 필요.
* R-6 단일 전역 `AdminHub`/`SuggestionBoard` DO 처리량(현 규모 충분, 대규모 시 분할).

## 7. API 요약

관리자(`Authorization: Bearer a1.…`): `POST session|logout`, `GET me|overview|stats|system|members|members/:id|audit|reports|reports/:id|appeals|sanctions|notices|rewards|codes|codes/:id/redemptions|actions|suggestions|suggestions/:id`, `POST rewards/preview|rewards|rewards/:id/(cancel|retry)|members/:id/inbox/:item/revoke|codes|codes/:id/deactivate|notices|notices/:id/end|reports/:id|sanctions|sanctions/:id/lift|appeals/:id|suggestions/:id|suggestions/:id/reward|actions/:id/(approve|reject|cancel)` (모두 `/api/admin/` 아래).

회원: `GET /api/notices`(공개), `GET /api/suggestions`, `GET /api/suggestions/:id`, `GET /api/suggestions/contributors`, `POST /api/suggestions`, `POST /api/suggestions/:id/(vote|report|credit)`, `POST /api/reports`, `GET /api/me/mailbox`, `POST /api/me/mailbox/:id/claim`, `POST /api/me/redeem`, `GET /api/me/sanctions`, `GET|POST /api/me/appeals`. (`/api/me/inbox`는 기존 친구 받은함이므로 알림함은 `/mailbox`.)

## 8. 운영 준비 체크리스트 (모두 별도 승인)

- [ ] 이 PR 리뷰·CI(`npm ci`·`npm test`·`npm run build`·Playwright) 통과
- [ ] **SEC-1(08) 독립 보안 검증**(§6 표·잔존 위험 R-1~R-6) — 통과 전 쓰기 활성 금지
- [ ] 07/C5: 채택 보상·운영 보상·쿠폰 금액 정책, 안전 상한 확인
- [ ] 01: `#suggestions`·`#mailbox` 메뉴, 중요 공지 배너, 신고 버튼 연결
- [ ] 수동 Worker 배포(보호 입력: DO 마이그레이션 v5 `AdminHub`·`SuggestionBoard`, 변수 3개) — Workers Free 유지 확인, 롤백 대상 기록
- [ ] 계정 소유자가 `ADMIN_ACCOUNTS` 시크릿 등록(§1) → 읽기 전용 운영 확인
- [ ] 처리방침(#126)에 회원 색인·제재 보관·게시판 처리 반영(병합·공개는 별도 결정)
- [ ] `FEEDBACK_BOARD=on`(게시판 공개) 승인
- [ ] SEC-1 통과 후 `ADMIN_WRITES=on` 승인, 첫 지급은 소수 대상 미리보기로 확인
- [ ] C3에 `queue.hour.HH` 카운터 1줄 추가 사실 공유
- [ ] 롤백: 변수 `ADMIN_WRITES=off`·`FEEDBACK_BOARD=off`(즉시), `ADMIN_ACCOUNTS` 삭제(콘솔 차단). 새 DO 클래스는 삭제 마이그레이션 없이 남겨도 무해
