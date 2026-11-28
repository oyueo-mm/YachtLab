# INT-1 운영 출시 계획 (2026-11-28, 실행 전 자료)

> **이 문서는 준비 자료다. 실제 main 병합, 운영 배포, 설정·시크릿 변경, 기능 활성화는 각각 별도 승인을 받은 뒤에만 한다.**
> 대상: `integration/int-1`(Draft PR #147). SEC-1 재감사를 통과한 커밋만 출시 후보가 된다.
> 관련 결정: D-100(Worker 배포), D-102(빌드·토큰 분리), D-139(통합), D-140(감사 후속), D-141(오늘의 요트 비경쟁).

## 1. 최종 출시 체크리스트

| # | 항목 | 확인 방법 | 담당 |
|---|---|---|---|
| 1 | SEC-1 재감사 통과(출시 차단 발견 0) | 재감사 보고서가 head SHA와 묶여 있음 | SEC-1 |
| 2 | 필수 CI 성공 | PR #147 `ci-result` 성공, 같은 SHA | 자동 |
| 3 | 교차 호환성(기존·통합 Pages × Worker) | [INT-1 통합 기록 §10](./INT-1-INTEGRATION.md) 결과 | 개발 |
| 4 | 롤백 시험(통합 → 기존 → 통합) | `YL_ROLLBACK_BASE=… npx vitest run tests/rollback-worker.test.ts` | 개발 |
| 5 | 승계 시험(기존 → 통합) | `YL_UPGRADE_BASE=… npx vitest run tests/account-upgrade-worker.test.ts` | 개발 |
| 6 | 모든 신규 플래그 꺼짐 | `worker/wrangler.toml`: `DAILY`·`ADMIN_WRITES`·`FEEDBACK_BOARD`·`MAILBOX`·`NOTICES` = `"off"`, `RETENTION`·`ECONOMY_QUOTE` 미설정 | 개발 |
| 7 | 운영 시크릿 미등록 확인 | `ADMIN_ACCOUNTS`·`DAILY_SECRET`·`ADMIN_REWARD_POLICY` 없음(기능이 꺼져 있으므로 불필요) | 운영자 |
| 8 | 사용자 UI·UX 확인 | 아래 §10 | 사용자 |
| 9 | 출시 직전 운영 상태 기록 | 활성 Worker UUID, Pages `version.json`, Cloudflare 사용량 화면 | 운영자 |

## 2. 안전한 배포 순서

1. PR #147을 Ready로 바꾸고 main에 병합한다(승인 필요). `ci-result`가 필수다.
2. **Pages가 먼저 배포된다**(`Test and deploy YachtLab`). 통합 Pages는 기존 Worker에서도 안전하게 동작해야 하며, 교차 검증 조합 3에서 확인한다. 신규 기능 진입점은 `/api/features` 플래그가 없으면 숨는다.
3. **Worker 자동 배포는 멈춘다.** `wrangler.toml`과 보호 입력이 바뀌었기 때문이다(D-100). Summary에 "guarded input"이 표시된다.
4. **수동 고위험 배포를 한다**(§3).
5. 배포 직후 공개 점검을 한다.
   - `/healthz`
   - `/api/features`: 신규 플래그가 모두 false이고 기존 값은 그대로인지
   - 게스트 친구 방 1판(생성·입장·양쪽 1턴·관전·재접속·기권 결과 창)
   - 로그인
6. 24시간 관찰한다(§9 지표). 이상이 있으면 §5 롤백.

## 3. Worker 수동 승인 절차

1. Actions → `deploy-online-worker.yml` → **Run workflow**를 main에서 실행한다.
2. `verify` 작업(자격 증명 없음)이 번들을 빌드하고 `release.json`을 만든다. 커밋·SHA-256·크기를 확인한다.
3. `approve` 작업에서 Environment `worker-production-approval`의 Required reviewer(운영자)가 승인한다.
4. `deploy` 작업(`worker-production`)이 검증된 번들만 `wrangler deploy --no-bundle`로 올린다.
5. Summary에서 새 UUID, 롤백 대상 UUID(직전 활성), 번들 SHA-256을 기록한다.
6. 성공하면 이후 자동 배포가 재개된다.

## 4. 데이터베이스(Durable Object) 마이그레이션 계획

| 태그 | 내용 | 상태 |
|---|---|---|
| v1~v4 | 기존 클래스(YachtRoom, RoomDirectory, UserStore, GuestLink, MatchHub, FriendIndex) | 운영 적용됨, 변경 없음 |
| v5 | `AdminHub`, `SuggestionBoard` 신규 SQLite 클래스 | 이번 배포로 적용 |
| v6 | `DailyBoard` 신규 SQLite 클래스 | 이번 배포로 적용 |

- 새 클래스 **추가만** 한다. 기존 클래스 이름·바인딩은 그대로다. 삭제·이름 변경 마이그레이션은 만들지 않는다.
- 기존 객체 안의 신규 테이블은 생성형이라 처음 사용할 때 만들어진다(`CREATE TABLE IF NOT EXISTS`, 추가 열은 `ALTER TABLE ADD COLUMN`).
  - C5: `grant_tx`, `retention`
  - LIVE-1: `daily_*`, `daily_used`
  - SOC-1: `soc_*`, `presence_*`
  - ADMIN-1: 회원 제재·알림함, `acct_cleanup_ext`
- 적용된 마이그레이션 태그는 되돌릴 수 없다. 코드를 롤백해도 v5·v6 클래스는 남지만 바인딩을 쓰지 않으므로 무해하다(롤백 시험에서 확인).

## 5. 롤백 계획

| 상황 | 조치 | 비고 |
|---|---|---|
| 배포 직후 오류율 증가·핵심 경로 실패 | Cloudflare Deployments에서 직전 버전 **Rollback**(별도 승인) | 롤백 배포에는 파이프라인 주석이 없어 자동 배포가 스스로 정지한다. 수정 커밋을 수동 워크플로로 배포하면 재개된다 |
| Pages만 문제 | Pages는 main 되돌림 커밋(PR)으로 재배포 | Worker는 유지 |
| 특정 신규 기능 문제 | 해당 플래그를 `"off"`로(변수 변경 = 보호 입력 → 수동 배포) | 코드 롤백보다 먼저 검토 |

**롤백해도 안전한 것(시험 확인):**
- 통합 Worker가 쓴 계정·세션·친구·전적·구매·C5 원장을 기존 Worker가 그대로 읽는다(원장 검증 통과).
- 다시 올린 통합 Worker는 출석 상태·일일 도전을 그대로 이어 받고 중복 지급하지 않는다(`tests/rollback-worker.test.ts`).
- 관리자 색인·게시판 탈퇴 정리 작업은 이전 버전이 읽지 않는 별도 테이블에 있어 유실되지 않는다(INT-7).

**롤백으로 되돌릴 수 없거나 주의할 것:**
- 마이그레이션 v5·v6(남음, 무해)
- 롤백 기간에 기존 Worker에서 일어난 탈퇴는 이전 방식으로 정리된다. 관리자 색인·게시판에는 롤포워드 뒤 남은 행이 있을 수 있다(신규 기능이 꺼져 있으면 영향 없음).
- 롤백이 30일을 넘거나 롤백 중 같은 계정이 다시 탈퇴하면 확장 정리 대기열이 지워질 수 있다(INT-7 남은 위험)

**운영 수칙:** 롤백 전에 Hub 지표 `account.cleanup.*`(retry·gaveUp·remaining)를 확인하고, 롤백은 가능한 짧게 유지한다.

## 6. 기능별 순차 활성화 계획 (각각 별도 승인)

| 순서 | 기능 | 변수 | 활성화 전 필수 | 비활성 기준 |
|---|---|---|---|---|
| 0 | 기본 출시(모두 꺼짐) | — | §1 | §5 |
| 1 | 공지 | `NOTICES="on"` | INT-4 수정(완료), 관리자 쓰기가 필요하므로 2와 함께 | 공지 경로 오류율 > 1% |
| 2 | 관리자 쓰기 | 시크릿 `ADMIN_ACCOUNTS`, `ADMIN_WRITES="on"` | **ADM-1 실제 Google 재인증 검증(사용자 참여)**, 운영자 Google 2단계 인증, 감사 로그 보존 기간 결정(B7) | 감사 행 누락·재인증 실패 반복 |
| 3 | 서비스 제안 게시판 | `FEEDBACK_BOARD="on"` | 2, 신고 처리 운영 인력 | 신고 급증·저장형 XSS 의심 |
| 4 | 알림함 | `MAILBOX="on"` | 2 | 수령 오류 |
| 5 | 재방문 보상(출석·연속 활동·주간 연승) | `RETENTION="on"` | ECO-1·INT-3 수정(완료), 격리 Worker 재현(`retention-worker-e2e`), 소유자 계정 먼저 확인 | 원장 검증 실패 1건이라도 |
| 6 | 오늘의 요트(비경쟁) | 시크릿 `DAILY_SECRET`, `DAILY="on"` | D-141 비경쟁 전환(완료), DLY-3·INT-5 수정(완료), `DAILY_SECRET_FROM`은 내일 이후만(DLY-5), 퍼즐 은행 잔여일 ≥ 14 | 검증 실패(`DAILY_VERIFY_FAILED`)·참가 상한 도달 |
| 7 | 교환 코드·운영 보상·채택 보상 지급 | `ADMIN_REWARD_POLICY`, C5 출처 승인(코드 변경 = 보호 입력) | 지급액 정책 승인, 2·5 | 원장 이상 |
| 8 | 견적 필수화 | `ECONOMY_QUOTE="required"` | **구 Pages가 남지 않음 확인**(Pages 배포 후 충분한 기간), 기존 승인 조건 | 409 급증 |

`DAILY_NEW_ACCOUNTS_RANKED`는 D-141로 의미가 없어졌다(순위 없음).

## 7. 활성화 전 필수 검증 (공통)

- 격리 로컬 Worker에서 해당 플래그를 켠 전체 시험 통과
- 운영 소유자 계정으로 한 번 사용(실제 재화 지급 기능이면 지급액 승인 후)
- 변경 전후 `/api/features` 확인
- 롤백 기준(변수 off)을 미리 정해 둠

## 8. 장애 대응·비활성화 기준

| 기능 | 즉시 끄는 조건 | 조치 |
|---|---|---|
| 전체 Worker | 5분 이상 오류율 > 5% 또는 로그인 실패 급증 | Cloudflare 롤백(승인), 원인 분석 |
| 재방문 보상 | 원장 검증(`/api/admin/ledger/:id`) 실패, 중복 지급 의심 | `RETENTION` 제거(수동 배포). 지급된 원장은 그대로 둔다(소급 수정 금지) |
| 오늘의 요트 | `DAILY_VERIFY_FAILED` 로그, 비밀값 문제 | `DAILY="off"` |
| 관리자 | 감사 행 누락, 의심 로그인 | `ADMIN_WRITES="off"`, `ADMIN_ACCOUNTS`에서 계정 제거 |
| 게시판 | 신고 급증 | `FEEDBACK_BOARD="off"` |
| 비상 정지(배포) | 자동 배포 이상 | `WORKER_PRODUCTION_DEPLOY_ENABLED=false` |

## 9. 운영 모니터링 지표

- **Cloudflare 대시보드:** Worker 요청 수·오류율·CPU, Durable Object 요청 수·저장 행 쓰기(Free 한도 대비, [Workers Free 분석](./INT-1-WORKERS-FREE.md))
- **Hub 지표(`/api/admin/metrics`, ADMIN_TOKEN 읽기 전용):**
  - `worker.error`
  - `account.cleanup.retry/gaveUp/remaining`
  - `queue.blockedSkip`
  - `grant.*`
  - `daily.*.started/completed`
  - `code.refused.*`
- **로그:** `ACCOUNT_CLEANUP`, `ADMIN_LEGACY_AUDIT_FAILED`, `DAILY_VERIFY_FAILED`, `ONLINE_WORKER_UNEXPECTED`

## 10. 사용자가 직접 확인할 UI·UX 체크리스트

실기기·실제 GPU·청음 평가는 자동 시험으로 대신할 수 없다.

- [ ] 실제 휴대폰(iOS Safari, Android Chrome)에서 홈·온라인 대전·상점·인벤토리·뽑기 화면이 넘치지 않음
- [ ] 빠른 대전 팝업 드래그·최소화(실제 터치)
- [ ] 상점 3D 미리보기와 주사위 재질·소리(실제 GPU·스피커)
- [ ] 장시간(30분 이상) 상점·인벤토리 이동 후 끊김·발열 없음
- [ ] 결과 공유 이미지가 실제 메신저에서 잘 보임
- [ ] 다크 모드·글자 크기 확대(OS 설정)
- [ ] 키보드만으로 상점 상세·구매 확인 가능
- [ ] 친구 패널, 친구 대전 신청, 대기실 관전 선택
