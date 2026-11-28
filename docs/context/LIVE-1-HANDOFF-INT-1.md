# LIVE-1 → INT-1 인계 (2026-11-28)

> LIVE-1(담당 05) 개발 범위는 **완료로 확정**됐다. 이 문서는 INT-1이 통합·배포 단계에서 검증할 항목과 남은 위험을 정리한다.
> 근거 PR: [#142](https://github.com/oyueo-mm/YachtLab/pull/142) (브랜치 `claude/funny-hamilton-5aavn9`). 상세 설계: [DAILY-LIVE-1](./DAILY-LIVE-1.md). 결정: D-117~D-122(임시 ID).
> LIVE-1은 **main 병합·운영 배포·`DAILY` 활성화·운영 설정 변경을 하지 않았다.** 다른 담당 PR(#140 C5, #141 ADMIN-1)도 병합하지 않았다(계약 문서만 읽음).

## 1. 이 PR의 상태

| 항목 | 상태 |
|---|---|
| 기능 플래그 | `DAILY = "off"` (wrangler.toml 기본값). `/api/daily/*` 전부 404, `#daily`는 "준비 중" |
| 관리자 API | 공유 `ADMIN_TOKEN` 경로 **제거됨**. `dailyAdminRoutes`(`worker/src/daily-admin.ts`)만 내보냄 — 미등록 상태라 404 |
| C5 연동 | `worker/src/daily-activity.ts` 어댑터. `UserStore.dailyContentDone`이 없으면 no-op |
| 재화 | 일일 콘텐츠 자체 코인 **없음** (`NO_DAILY_REWARDS`, `DAILY_REWARDS_APPROVED = false`) |
| 연속 활동 | **공식 오늘의 요트 완료(`daily.official.completed`)만** 인정. 전략 퍼즐·공식 시작·같은 날 연습·지난 도전은 제외 |
| DO 마이그레이션 | 임시 태그 `v5-live1-daily` (`DailyBoard`) |
| 결정 번호 | 임시 `D-117~D-122` |

## 2. INT-1 통합 검증 항목

### 2.1 ADMIN-1 `dailyAdminRoutes` 등록
- ADMIN-1 라우터(`handleAdminRoute`) 백엔드에 `extensions: dailyAdminRoutes({ board: dailyBoard, now: dailyClock(env) })` 등록.
- 확인: `GET /api/admin/daily?date=` → `stats.read`(viewer 이상), `POST /api/admin/daily/puzzle` → `content.write`(operator·owner), `ADMIN_WRITES=off`면 쓰기 거부, 감사 행 `daily.puzzle`(target=puzzleId, detail={date, disabled}).
- `DailyAdminRoute` 타입이 `AdminExtensionRoute[]`에 대입되는지 `tsc`로 확인(구조 동일, 권한만 2개 값으로 좁힘).
- 비관리자·세션 없음 → 404. 공유 `ADMIN_TOKEN`으로는 접근 불가(현재 시험이 확인).

### 2.2 C5 `dailyContentDone` 실제 연결
- C5 병합 뒤 별도 코드 없이 연결됨(어댑터가 메서드 존재로 판단). 확인할 것:
  - `RETENTION=on` 격리 Worker에서 공식 완료 → 활동일 1일 기록, 이정표 지급은 C5 트랜잭션 안에서.
  - 같은 날 연습·지난 도전·퍼즐 답 → 활동일 변화 없음.
  - C5 실패 시 다음 일일 API 호출에서 활동만 재시도되고 순위 보드는 중복 집계되지 않음(`submitted`·`activity` 열 분리).
  - `at`은 서버 완료 시각. 자정 직후 유예(00:00~00:30) 완료는 C5의 날짜 기준(KST)으로 다음 날에 기록될 수 있음 — 의도된 동작인지 C5와 확인.
- 정지 계정 처리: 일일 API는 계정 세션 검사만 한다. ADMIN-1의 정지 계정 POST 차단이 `/api/daily/*`에도 적용되는지 통합 시 확인.

### 2.3 UI-1 홈 진입점
- `src/daily/DailyPage.tsx`의 `DailyHomeCards`(오늘의 도전·오늘의 퍼즐 카드)를 로비에 배치. `features.daily`가 참일 때만 노출.
- 현재 연결은 `routes.ts` `daily` 1줄과 `App.tsx` 지연 로드 1줄뿐(공통 내비게이션 미변경).
- 모바일 검증 기준: `tests/ui/daily.spec.ts`(Pixel 7, 320·360 px 가로 넘침 없음, 주요 버튼 44 px 이상).

### 2.4 DO 마이그레이션 순서
- `wrangler.toml`: v4 뒤에 ADMIN-1 `v5-admin-feedback`(AdminHub, SuggestionBoard), LIVE-1 `v5-live1-daily`(DailyBoard)가 각각 있다. 최종 순서·태그를 정해 하나의 목록으로 합친다.
- **적용된 태그는 바꿀 수 없으므로 첫 운영 배포 전에 확정.** 바인딩·마이그레이션·변수 변경은 D-100 보호 입력 → 승인된 수동 배포.

### 2.5 `DAILY_SECRET` 운영 절차
- 운영자가 `wrangler secret put DAILY_SECRET`(32자 이상, 예: `openssl rand -base64 48`). 저장소·대화·로그 금지.
- 제자리 교체 금지. 교체는 `DAILY_SECRET`(새 값) + `DAILY_SECRET_PREVIOUS`(이전 값, 비밀) + `DAILY_SECRET_FROM=YYYY-MM-DD`(내일 이후). PREVIOUS는 이전 날짜 재검증에 계속 필요.
- 불완전한 설정 → 일일 기능 꺼짐(fail closed), 로그 `DAILY_SECRET_CONFIG`(이유만).
- 유출 시: FROM=내일로 교체. 유출된 날 순위 무효화 기능은 없음(운영 판단, 후속 후보).

## 3. 남은 위험·정책 (인계 기록)

### 3.1 다계정 주사위 사전 확인
- 같은 날 모든 참가자가 같은 주사위를 만나므로, **그날 0시(KST) 이전에 만든 보조 계정**으로 먼저 플레이하면 본 위치의 눈을 알 수 있다. 막지 못하는 남는 위험이다.
- 현재 완화: 당일 가입 계정은 순위 제외(`DAILY_NEW_ACCOUNTS_RANKED=off`), 공유 문구·이미지에 눈 없음, 같은 날 연습은 공식 완료 뒤에만.
- 계정별 다른 주사위는 "같은 조건" 요구와 충돌해 채택하지 않음. 운영 지표(같은 기기·같은 IP 다계정 등)로 추가 완화가 필요하면 별도 결정.

### 3.2 퍼즐 재출제 정책
- 예약은 2026-12-01 ~ **2027-02-22**(84일, 하루 3문제, 예비 30).
- 예약이 끝난 날짜는 **다시 보는 퍼즐**: 시작일부터의 날짜 순번 mod 예약 일수 → 그날의 3문제를 결정적으로 재출제. ID `rerun:<날짜>:<원래 ID>`, 답 기록은 원래 문제와 분리, 제목에 "다시 보는 퍼즐".
- 운영 보고서 `puzzleBank.runwayDays`가 14일 아래로 내려가기 전에 새 문제 생성(`npx tsx scripts/daily/generate-puzzles.ts --days N`, 재현성 시험이 은행 갱신을 함께 요구).
- 퍼즐 답은 공개 저장소·분석 도구로 계산 가능 → 퍼즐 기록은 참여 기록일 뿐, 보상·경쟁 순위·연속 활동에 쓰지 않는다.

### 3.3 운영 요청·쓰기 예산 (추정치 — **운영 실측 없음**)

| 항목 | 추정 | 근거 |
|---|---|---|
| 공식 1판 요청 | 시작 1 + 단계 13~37(DP 최적 평균 35.7) + 화면 조회 몇 회 | 200일 테이프 측정 |
| 공식 1판 SQLite 쓰기 | 약 42행: 계정 객체(생성 1 + 단계 + 게시 표시 1 + 활동 표시 1), 보드 2, 허브 지표 2 | 코드 경로 |
| C5 연결 뒤 추가 | 공식 완료당 C5 쪽 상태·지급 몇 행(C5 측정 필요) | C5 계약 |
| 같은 날 연습 | 공식과 같은 단계 비용, 하루 5회 상한 | `DAILY_PRACTICE_PER_DAY` |
| 지난 도전 | 서버 요청 0(브라우저 재생) | — |
| 퍼즐 | 조회는 정답 키 조회만, 답 1회 = 쓰기 2행 | — |
| 일일 상한 | `DAILY_PARTICIPANT_LIMIT=500` → 최악 약 2.1만 행 쓰기/일 | 계정 공유 무료 한도(일 10만 행)의 약 21% |
| Worker 번들 | 1,427 KiB / gzip 217 KiB | `wrangler deploy --dry-run` |

- **비공개 경로 1주 관찰 때 실측**: 요청 수·DO 쓰기 행·CPU 시간, 완료율, `DAILY_VERIFY_FAILED`·`DAILY_SECRET_CONFIG` 로그 0건. 실측이 추정을 넘으면 상한을 낮춘다.

## 4. INT-1 공개 순서 (D-122)

1. #140·#141·#142 충돌 정리, 마이그레이션 순서·결정 번호 확정, 필수 CI 통과.
2. 승인된 수동 Worker 배포(`DAILY="off"`, `RETENTION` 미설정).
3. 운영자 `DAILY_SECRET` 설정.
4. 비공개 경로(`?online-server=…#daily`)에서 1주 관찰(§3.3).
5. UI-1 홈 진입점과 `DAILY="on"`을 함께 결정(별도 승인).

## 5. LIVE-1이 한 일과 하지 않은 일 (2026-11-28)

| 구분 | 내용 |
|---|---|
| 한 일 | #142 브랜치 커밋(기능·통합 계약 어댑터·문서·시험), `main`을 #142 브랜치로 병합(충돌 해결: 결정 번호만), PR 설명 갱신, PR 활동 구독·점검 예약(종료함) |
| 하지 않은 일 | `main` 병합, 다른 담당 PR 병합, 운영 Worker·Pages 배포, Worker 변수·비밀 변경, `DAILY`·`RETENTION` 활성화, `AdminExtensionRoute` 실제 등록 |
| 로컬만 | #140·#141 브랜치를 읽기 전용으로 가져와 계약 확인(푸시·병합 없음) |
