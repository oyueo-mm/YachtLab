# YachtLab Online v0.1 — Phase 4: 실제 배포·운영

> 상태: **운영 중 (2026-11-23).** Workers Free 계정, 결제 수단 없음, Workers Paid 미가입(소유자 확인). 같은 계정의 `ideadock-auth` Worker와 무료 일일 사용량을 공유한다.

## 1. 배포 현황

| 항목 | 값 |
|---|---|
| 온라인 서버 | `https://yachtlab-online.hoho96385210.workers.dev` (Worker `yachtlab-online`, workers.dev 무료 주소, 사용자 도메인·라우트 없음) |
| 공개 사이트 | `https://oyueo-mm.github.io/YachtLab/` → 홈 "온라인 대전"이 위 서버에 연결 |
| 배포 방법 | 소유자가 수동 워크플로 `deploy-online-worker.yml` 실행 (`free_plan_confirmed` 확인 필수, 저장소 비밀값 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`) — [run 45170197533](https://github.com/oyueo-mm/YachtLab/actions/runs/45170197533), 커밋 `4a3b991` |
| 리소스 | Worker 1개, SQLite Durable Object 클래스 2개(`YachtRoom`, `RoomDirectory`, 마이그레이션 `v1`). KV·D1·R2·Queues·Cron·사용자 도메인 없음 |
| 프런트 연결 | `deploy.yml`: 테스트는 서버 주소 없는 빌드로 실행(“준비 중” 상태와 `?online-server=` 온라인 UI 모두 검증), Pages 업로드용만 `VITE_ONLINE_SERVER_URL`로 다시 빌드 후 주소 포함 여부 확인 |
| main 병합 | PR #44 → `dd5fc72` (Pages 배포 run [45178454377](https://github.com/oyueo-mm/YachtLab/actions/runs/45178454377) 성공) |

## 2. 무료 한도 보호 (공유 계정 기준)

Workers Free 일일 한도(공식): Workers 요청 100,000, DO 요청 100,000(수신 WebSocket 메시지 20:1), DO duration 13,000 GB-s, **SQLite 행 쓰기 100,000**, 행 읽기 5,000,000, 저장 5 GB. 초과 시 과금이 아닌 오류(00:00 UTC 초기화). `ideadock-auth`와 공유하므로 이 서비스가 계정 한도를 다 쓰지 않도록 다음을 배포 전에 추가했다(`b8d2960`).

| 장치 | 값 | 효과 |
|---|---|---|
| 하루 방 생성 한도 `DAILY_ROOM_LIMIT` | 300 / UTC일 | 1경기 행 쓰기 약 120 → 최대 약 36,000(일일 한도의 36%). 초과 시 503 `DAILY_LIMIT` |
| 동시 방 `MAX_ROOMS` | 50 | 저장량·알람 상한 |
| 방 생성 / 입장 / 미리보기·소켓 | IP 해시당 분당 5 / 30 / 120 | **메모리 카운터**(행 쓰기 0) |
| 재접속·연결 종료 | 행 쓰기 0 | 유휴 시각은 메모리, 알람은 앞당길 때만 `setAlarm` |
| 방당 소켓 / 연결 시도 | 8 / 분당 20 | |
| 메시지 크기·속도, 이벤트 수 | 2 KB, 버스트 30·초당 8, 800 | |
| 허용 출처 | `https://oyueo-mm.github.io`만 | 다른 사이트에서 서버 사용 불가(403) |
| 보존 기간 | 빈 대기실·종료 30분, 진행 중 24시간, 최대 48시간 | `deleteAll`로 저장 데이터 삭제 |

## 3. 실서버 검증 (2026-11-23)

이 작업 컨테이너의 프록시는 WebSocket 업그레이드를 지원하지 않아, 실서버 검증은 GitHub Actions의 `online-live-check.yml`(수동 또는 PR 라벨 `online-live-check`)에서 실행했다. 일반 CI는 실서버를 호출하지 않는다.

| 실행 | 결과 |
|---|---|
| [45175468744](https://github.com/oyueo-mm/YachtLab/actions/runs/45175468744) (병합 전, 배포본과 서버 코드 동일한 `f410787`) | **PASS** — 방 생성, 초대 미리보기(토큰 없음), 입장, WebSocket 인증, 중복 명령 1회 적용, 잘못된 차례 거부, 연결 끊김 중 진행·재접속 `since` 동기화, ping 자동 응답, **12라운드 완주·양쪽 결과 일치(100:86)**, 만석·잘못된 토큰·`playerId` 위조 거부, 없는 코드 404, 다른 출처 403, **서버 알람 턴 타이머 120초 만료 처리(지연 0초)** |
| [45181133166](https://github.com/oyueo-mm/YachtLab/actions/runs/45181133166) (병합 후 main, 공개 사이트 포함) | **PASS** — 위 항목 전체 + **공개 사이트에서 데스크톱·Pixel 7 두 브라우저가 초대 링크로 만나 턴 중 새로고침 후 12라운드 완주, 양쪽 결과 일치** (15.9초) |

검증 후 서버 `/usage`: 오늘 생성 7방 / 한도 300, 남은 방 4 / 50(30분 유휴 후 자동 삭제).

## 4. 사용량과 비용

- **비용:** 계정이 Workers Free이고 결제 수단이 없으므로(소유자 확인) 한도를 넘어도 과금되지 않고 해당 요청이 실패한다. 유료 리소스는 만들지 않았다.
- **오늘 이 서비스 사용량(추정):** 7방 × 1경기 측정치(행 쓰기 약 120, DO 요청 약 19, Worker 요청 5~6) → 행 쓰기 약 840 이하(일일 0.8%), DO 요청 약 130, Worker 요청 약 40. 계정 전체의 실제 수치는 Cloudflare 대시보드(Workers & Pages → `yachtlab-online` → Metrics, Durable Objects → Metrics)에서 확인해야 한다. 이 작업은 Cloudflare API 토큰 없이 진행되어 계정 지표를 직접 조회하지 않았다.
- **운영 점검:** `curl https://yachtlab-online.hoho96385210.workers.dev/usage` → `roomsToday`, `liveRooms`.

## 5. 운영상 위험

1. **공유 한도:** `ideadock-auth`와 계정 무료 한도를 공유한다. YachtLab은 하루 300방(행 쓰기 약 36%)으로 상한을 두었지만, 두 서비스 합이 한도에 닿으면 **둘 다** 그날 남은 시간 동안 실패할 수 있다. 필요하면 `DAILY_ROOM_LIMIT`를 낮춘다.
2. **분산 남용:** IP별 제한은 여러 IP를 쓰는 남용을 막지 못한다. 일일 방 한도가 최종 상한이며, 도달 시 그날 온라인 방 생성이 중단된다(서비스 거부, 과금 아님). Cloudflare WAF 속도 제한 규칙은 아직 설정하지 않았다.
3. **메모리 카운터:** 속도 제한은 디렉터리 객체가 축출되면 초기화된다(일시적으로 느슨해짐). 하루 방 한도는 SQLite에 저장되어 유지된다.
4. **유휴 기준:** 재접속·종료는 저장하지 않으므로 축출 후에는 마지막 게임 이벤트 시각 기준으로 정리된다(예정보다 이르게 정리될 수 있음, 늦어지지는 않음).
5. **관측성:** `observability.enabled = false`(로그 사용량 절약). 장애 분석이 필요하면 일시적으로 켠다.
6. **계정 플랜 변경:** 계정이 Workers Paid로 바뀌면 같은 남용이 과금으로 이어진다. 그 전에 DO 지출 한도와 사용량 알림을 설정해야 한다.
7. **단일 디렉터리 객체:** 방 생성·입장·연결마다 호출. 초당 약 1,000요청 소프트 한도가 상한(현재 규모에는 충분).

## 6. 되돌리기

- 프런트만 끄기: `deploy.yml`의 `VITE_ONLINE_SERVER_URL` 단계 제거 후 main에 반영 → 온라인 대전이 "준비 중"으로 돌아감.
- 서버 중지: Cloudflare 대시보드에서 `yachtlab-online` Worker 비활성화/삭제(다른 Worker·리소스와 무관).
