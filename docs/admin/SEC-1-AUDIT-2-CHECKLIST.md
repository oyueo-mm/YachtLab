# SEC-1 2차 독립 감사 — ADMIN-1 / FEEDBACK-1 검증 목록 (2026-11-28)

> 대상: Draft PR #141(브랜치 `claude/charming-pasteur-7gzm9e`). 운영 미배포, 관리자 계정 미등록, `ADMIN_WRITES=off`, `FEEDBACK_BOARD=off`.
> 원칙(D-098): 이 문서는 확인 항목과 테스트 위치만 공개합니다. 감사 중 발견한 우회 경로의 재현 절차는 비공개로 전달해 주세요.
> 재현: `npx vitest run tests/admin-feedback.test.ts tests/admin-sec1.test.ts tests/admin-followup.test.ts tests/admin-worker.test.ts`, `npx playwright test tests/ui/admin-feedback.spec.ts`.

## A. 1차 감사 출시 차단 조건 11개 (재확인)

| # | 조건 | 확인 방법 | 자동 테스트 |
|---|---|---|---|
| A1 | 서버 측 관리자 역할 검사 | `handleAdminRoute`가 요청마다 `ADMIN_ACCOUNTS`를 다시 읽는지, 역할을 바꾸거나 삭제하면 열린 세션도 바로 막히는지 | feedback "checks the role…", sec1 A |
| A2 | 읽기·쓰기 권한 분리 | `roles.ts`의 권한 표, 각 라우트의 `need()`, 확장 라우트의 `permission`·`write` | sec1 "support…", followup §8 |
| A3 | 관리자 세션 분리·보호 | `a1.` 세션(해시 저장, 30분 유휴·4시간 절대 만료, sessionStorage), 로그아웃 시 서버 삭제, 회원 `s1.` 토큰 거부 | sec1 session |
| A4 | 민감 행위 재인증 | **실제 Google 재인증**(B1 항목) | followup §1, E2E |
| A5 | 일반 사용자의 관리자 API 접근 차단 | 비관리자, 세션 없음, 잘못된 토큰, 미등록 경로가 모두 같은 404인지 | sec1, E2E |
| A6 | 모든 관리자 쓰기 감사 | 쓰기 라우트마다 audit 행, 감사 표에 UPDATE·DELETE 경로 없음, 확장 쓰기 감사, 레거시 토큰 감사 | sec1 audit, followup §8, E2E |
| A7 | 저장형 XSS 방지 | 텍스트 노드로만 렌더, 원시 HTML API 없음(정적 검사), Playwright 실브라우저 확인 | sec1 XSS, UI spec |
| A8 | 입력·첨부 이미지 검증 | `cleanText`, 길이·분류·링크 규칙, 본문 16KB, 첨부 업로드 비활성, `checkAttachment` 형식·크기 | sec1, feedback board |
| A9 | 투표·채택 보상 중복 방지 | `sg_votes` 기본키, `reward_action` 1회, 알림함 ID와 원장 ID 멱등 | sec1 duplicate |
| A10 | 민감 문의·보안 제보 비공개 접수 | `security`·`privacy` 분류 자동 비공개, 목록·상세·추천·신고에서 제외 | sec1 private |
| A11 | C5 경제 원장 우회 금지 | 관리자·게시판 코드에 원장·잔액 직접 쓰기 없음(정적 검사), `adminGrant`만 사용, `verify()` 일치 | sec1 ledger |

## B. 후속 작업으로 바뀐 부분 (2차 집중 검토)

| # | 항목 | 확인할 것 | 테스트 |
|---|---|---|---|
| B1 | Google 재인증 | `purpose=admin` → `prompt=login`·`max_age=0`. 콜백의 `auth_time ≥ 시작 시각 − 60초`. 티켓(2분, 1회용, 해시 저장, 계정·탭 묶음). 비관리자 콜백 응답이 같은지. 재인증 콜백이 계정을 만들지 않는지. 상태 쿠키·nonce·PKCE가 회원 로그인과 같은 수준인지 | followup §1, E2E(`fakeAdminReauth`, 다른 세션으로 티켓 사용 401) |
| B2 | `ADMIN_REAUTH=off` | 루프백 `APP_URL`에서만 적용되는지, `wrangler.toml`에 없는지 | followup §1, sec1 config |
| B3 | 고위험 작업 목록 | 승인, 보상·코드·제재 초안, 회수, `highRisk` 확장 라우트에 10분 제한이 걸리는지. 빠진 쓰기가 없는지 | followup §1 |
| B4 | 단일 운영자 정책 | 기본값이 2인인지. 대기 시간, 초안 작성 뒤 재인증, 영향 범위, 하루 예산, `self-approved` 감사. `self` 값이 무제한으로 해석되지 않는지. **경쟁 조건:** 같은 초안을 동시에 두 번 승인할 때(`decide`의 `status = 'pending'` 조건부 갱신) | followup §2 |
| B5 | 지급액 정책 게이트 | `ADMIN_REWARD_POLICY`가 없을 때 보상·코드·채택 보상 초안이 거부되는지, 정책 버전이 기록되는지, 상한이 C5와 같은지 | followup §7 |
| B6 | 탈퇴 정리 재시도 | `@admin`·`@board` 작업이 탈퇴 트랜잭션 안에서 대기열에 들어가는지, 세대 경계(`tomb.deleted_at`), 재가입 후 늦은 재시도가 새 데이터를 건드리지 않는지, 탈퇴 수를 한 번만 세는지 | followup §3, E2E |
| B7 | 보존 정책 | 진행 중 제재 유지·재가입 시 복원, 끝난 제재의 사유 삭제, 1년 뒤 삭제, 무기한 정지 최대 1년, 이의제기 본문 삭제. **결정 필요:** 감사 로그 보존 기간 | followup §4 |
| B8 | 레거시 `ADMIN_TOKEN` | GET 2개만 허용(설정으로 늘릴 수 없음), 감사, 분당 30회 제한, `ADMIN_TOKEN_ROUTES=metrics/off`. 상수 시간 비교 | followup §5, E2E |
| B9 | 활동 집계 | KST 경계, `(계정, 일)` 1회 계산, 미전송분 재전송, 순서 뒤집힘. 보고가 계정 ID와 공개 닉네임 외 개인정보를 싣지 않는지 | followup §6 |
| B10 | LIVE-1 확장 계약 | 확장 라우트가 인증·권한·쓰기 스위치·재인증·감사를 우회할 수 없는지. 기존 경로와 충돌하는지(경로 매칭 순서: 확장 라우트가 기본 라우트보다 먼저) | followup §8 |
| B11 | C5 어댑터 | `toGrantRequest`의 txId·출처·상한·actor(승인자)·policyVersion. 연결 전이므로 통합 시 다시 검증 | followup §7 |

## C. 남은 위험과 결정 대기

- **C1.** Google 계정 자체가 탈취되면 막을 수 없습니다. 운영자 2단계 인증 확인이 필요합니다(운영 체크리스트).
- **C2.** 이용 제한 계정이 게스트로 플레이하는 것은 막을 수 없습니다(계정 보상·기록은 없음). 빠른 대전에서는 "로그인 만료"로 표시됩니다.
- **C3.** 전역 단일 객체 `AdminHub`·`SuggestionBoard`의 처리량과 가용성. 객체를 잃으면 색인과 감사 로그를 복구할 수 없습니다(백업 없음).
- **C4.** 감사 로그 보존 기간이 미정이고, 처리방침(#126) 반영이 필요합니다.
- **C5.** DO 마이그레이션 태그는 INT-1이 확정합니다(#142 `v5`와 충돌).
- **C6.** #140 연결 후 원장 ID 접두사가 `admin:`에서 `g:`로 바뀌므로, 통합 시 `verify()`를 다시 검증해야 합니다.

## D. 감사 결과 기록

| 항목 | 결과(통과/발견/보류) | 비공개 참조 | 확인자·일시 |
|---|---|---|---|
| A1–A11 | | | |
| B1–B11 | | | |
